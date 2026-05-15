'use strict';

/**
 * /api/atp — Agent Transaction Primitive REST surface.
 *
 * Authenticated endpoints (Bearer JWT, /me-scoped):
 *   POST   /intents                      create draft intent
 *   GET    /intents                      list my intents
 *   GET    /intents/:id                  fetch one
 *   POST   /intents/:id/authorize        approve (single-use nonce burned)
 *   POST   /intents/:id/revoke           revoke
 *   POST   /transactions                 begin tx under an authorized intent
 *   GET    /transactions/:id             fetch tx + steps
 *   POST   /transactions/:id/steps       append step
 *   POST   /transactions/:id/transition  move state machine
 *   POST   /transactions/:id/compensate  rollback
 *   POST   /transactions/:id/receipt     issue signed receipt
 *
 * Public endpoints (no auth — these ARE the trust primitive):
 *   GET    /receipts/:id                 fetch a receipt (id only, no contents leak)
 *   POST   /receipts/verify              verify any signed receipt JSON offline-style
 */

const express = require('express');
const router  = express.Router();

const { authenticateToken } = require('../middleware/auth');
const transactions = require('../services/transactions');
const { db } = require('../models/db');

// ─── Tier gating ─────────────────────────────────────────────────────────────
// ATP is positioned at the open/paid boundary: intent creation and public
// verification are open (the protocol must spread), while throughput and
// advanced features are paid.
const ATP_INTENT_LIMITS = { free: 10, starter: 50, pro: 500, business: 5000, enterprise: 100000 };

function getUserTier(userId) {
  try {
    const row = db.prepare(`SELECT tier FROM sites WHERE user_id=? AND active=1 ORDER BY created_at ASC LIMIT 1`).get(userId);
    return (row && row.tier) || 'free';
  } catch { return 'free'; }
}

function checkDailyIntentQuota(userId) {
  const tier = getUserTier(userId);
  const cap = ATP_INTENT_LIMITS[tier] ?? ATP_INTENT_LIMITS.free;
  const row = db.prepare(`
    SELECT COUNT(*) AS n FROM atp_intents
     WHERE user_id=? AND datetime(created_at) >= datetime('now','-1 day')
  `).get(userId);
  return { tier, used: row.n, cap, ok: row.n < cap };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function send(res, fn) {
  try {
    const out = fn();
    res.json({ ok: true, ...(out && typeof out === 'object' ? { data: out } : {}) });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.code || 'internal_error', message: e.message });
  }
}

// ─── Intents ─────────────────────────────────────────────────────────────────
router.post('/intents', authenticateToken, express.json({ limit: '32kb' }), (req, res) => {
  const q = checkDailyIntentQuota(req.user.id);
  if (!q.ok) {
    return res.status(429).json({
      ok: false, error: 'quota_exceeded',
      message: `Daily intent quota reached (${q.used}/${q.cap} on '${q.tier}' tier).`,
      tier: q.tier, used: q.used, limit: q.cap,
      upgrade_url: '/premium.html',
    });
  }
  send(res, () => transactions.createIntent({
    userId: req.user.id,
    siteId: req.body.site_id || null,
    agentId: req.body.agent_id || null,
    purpose: req.body.purpose,
    scope: req.body.scope,
    spendCapCents: req.body.spend_cap_cents ?? 0,
    spendCurrency: req.body.currency || 'EUR',
    maxExecutions: req.body.max_executions ?? 1,
    ttlSeconds: req.body.ttl_seconds ?? 3600,
    metadata: req.body.metadata || {},
  }));
});

router.get('/intents', authenticateToken, (req, res) => {
  send(res, () => transactions.listIntentsForUser(req.user.id, {
    limit: Math.min(parseInt(req.query.limit, 10) || 50, 200),
    offset: parseInt(req.query.offset, 10) || 0,
  }));
});

router.get('/intents/:id', authenticateToken, (req, res) => {
  const intent = transactions.getIntent(req.params.id);
  if (!intent) return res.status(404).json({ ok: false, error: 'not_found' });
  if (intent.user_id !== req.user.id) return res.status(403).json({ ok: false, error: 'forbidden' });
  res.json({ ok: true, data: intent });
});

router.post('/intents/:id/authorize', authenticateToken, (req, res) => {
  send(res, () => transactions.authorizeIntent(req.params.id, { userId: req.user.id }));
});

router.post('/intents/:id/revoke', authenticateToken, express.json({ limit: '4kb' }), (req, res) => {
  send(res, () => transactions.revokeIntent(req.params.id, { userId: req.user.id, reason: req.body.reason }));
});

// ─── Transactions ────────────────────────────────────────────────────────────
function loadIntentAuthorized(intentId, userId) {
  const intent = transactions.getIntent(intentId);
  if (!intent) { const e = new Error('intent not found'); e.statusCode = 404; e.code = 'not_found'; throw e; }
  if (intent.user_id !== userId) { const e = new Error('forbidden'); e.statusCode = 403; e.code = 'forbidden'; throw e; }
  return intent;
}

function loadTxOwned(txId, userId) {
  const tx = transactions.getTransaction(txId);
  if (!tx) { const e = new Error('transaction not found'); e.statusCode = 404; e.code = 'not_found'; throw e; }
  const intent = transactions.getIntent(tx.intent_id);
  if (!intent || intent.user_id !== userId) { const e = new Error('forbidden'); e.statusCode = 403; e.code = 'forbidden'; throw e; }
  return { tx, intent };
}

router.post('/transactions', authenticateToken, express.json({ limit: '32kb' }), (req, res) => {
  send(res, () => {
    const intent = loadIntentAuthorized(req.body.intent_id, req.user.id);
    const idem = req.headers['idempotency-key'] || req.body.idempotency_key;
    return transactions.beginTransaction({
      intentId: intent.id,
      idempotencyKey: idem,
      siteId: req.body.site_id,
      agentId: req.body.agent_id,
      amountCents: req.body.amount_cents ?? 0,
      currency: req.body.currency || intent.spend_currency,
      summary: req.body.summary,
      metadata: req.body.metadata || {},
    });
  });
});

router.get('/transactions/:id', authenticateToken, (req, res) => {
  send(res, () => {
    const { tx } = loadTxOwned(req.params.id, req.user.id);
    return { ...tx, steps: transactions.listSteps(tx.id) };
  });
});

router.post('/transactions/:id/steps', authenticateToken, express.json({ limit: '256kb' }), (req, res) => {
  send(res, () => {
    loadTxOwned(req.params.id, req.user.id);
    return transactions.appendStep(req.params.id, {
      action: req.body.action,
      evidence: req.body.evidence,
      before: req.body.before,
      after: req.body.after,
      compensation: req.body.compensation,
    });
  });
});

const VALID_TARGETS = new Set(['executing','executed','settled','failed','compensated']);
router.post('/transactions/:id/transition', authenticateToken, express.json({ limit: '8kb' }), (req, res) => {
  send(res, () => {
    loadTxOwned(req.params.id, req.user.id);
    const to = req.body.to;
    if (!VALID_TARGETS.has(to)) {
      const e = new Error(`invalid target state '${to}'`); e.statusCode = 400; e.code = 'invalid_request'; throw e;
    }
    return transactions.transitionTransaction(req.params.id, to, { error: req.body.error, summary: req.body.summary });
  });
});

router.post('/transactions/:id/compensate', authenticateToken, express.json({ limit: '4kb' }), (req, res) => {
  send(res, () => {
    loadTxOwned(req.params.id, req.user.id);
    return transactions.compensateTransaction(req.params.id, { reason: req.body.reason });
  });
});

// Receipts — issuance requires Pro+ for persistent key binding;
// free tier gets ephemeral-key receipts (still verifiable, just not pinned).
router.post('/transactions/:id/receipt', authenticateToken, express.json({ limit: '4kb' }), (req, res) => {
  send(res, () => {
    const { tx } = loadTxOwned(req.params.id, req.user.id);
    return transactions.issueReceipt(tx.id, { embedPublicKey: true });
  });
});

// ─── Public verification (the trust primitive) ───────────────────────────────
const publicReceiptLimiter = (() => {
  const buckets = new Map();
  const WINDOW_MS = 60_000;
  const MAX = 120;
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || (now - b.t) > WINDOW_MS) { b = { t: now, n: 0 }; buckets.set(key, b); }
    b.n++;
    if (b.n > MAX) return res.status(429).json({ ok: false, error: 'rate_limited' });
    next();
  };
})();

router.get('/receipts/:id', publicReceiptLimiter, (req, res) => {
  const r = transactions.getReceipt(req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, data: { id: r.id, transaction_id: r.transaction_id, issued_at: r.issued_at, body: r.body } });
});

router.post('/receipts/verify', publicReceiptLimiter, express.json({ limit: '256kb' }), (req, res) => {
  const input = req.body && (req.body.receipt || req.body);
  let target = input;
  if (typeof input === 'object' && input.id && !input.signature) {
    const stored = transactions.getReceipt(input.id);
    if (!stored) return res.status(404).json({ ok: false, error: 'not_found' });
    target = stored.body;
  }
  const r = transactions.verifyReceipt(target);
  res.json({ ok: r.ok === true, verification: r });
});

router.get('/health', (req, res) => res.json({ ok: true, service: 'atp', version: '1.0.0' }));

module.exports = router;
