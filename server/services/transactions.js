'use strict';

/**
 * Agent Transaction Primitive (ATP) — v3.9.0
 *
 * Promotes WAB from "discover + execute" to "trust + transaction" by giving
 * agentic workflows four guarantees as first-class primitives:
 *
 *   1. Intent contracts   — what the user authorized, with scope/cap/expiry/nonce.
 *   2. Idempotent execution — same intent + idempotency_key never runs twice.
 *   3. Signed receipts    — Ed25519-signed canonical JSON of the outcome.
 *   4. Compensation       — explicit rollback path for each step.
 *
 * The DB-level CHECK constraints and UNIQUE (intent_id, idempotency_key)
 * make illegal states unrepresentable, not just unlikely.
 */

const crypto = require('crypto');
const { db } = require('../models/db');
const wabCrypto = require('./wab-crypto');

// ── ID helpers ───────────────────────────────────────────────────────────────
function ulid(prefix) {
  // 26-char base32 ulid-ish (time-sortable + random). Not RFC-strict but stable.
  const t = Date.now().toString(36).padStart(8, '0');
  const r = crypto.randomBytes(10).toString('hex');
  return `${prefix}_${t}${r}`;
}

function nowIso() { return new Date().toISOString(); }

// ── Intent lifecycle ─────────────────────────────────────────────────────────

const VALID_SCOPE_ACTIONS = new Set([
  'read', 'search', 'compare', 'select', 'add_to_cart', 'checkout',
  'submit_form', 'book', 'cancel', 'message', 'pay'
]);

function validateScope(scope) {
  if (!scope || typeof scope !== 'object') throw badRequest('scope must be an object');
  const { actions, domains } = scope;
  if (!Array.isArray(actions) || actions.length === 0) throw badRequest('scope.actions must be a non-empty array');
  for (const a of actions) {
    if (typeof a !== 'string' || !VALID_SCOPE_ACTIONS.has(a)) {
      throw badRequest(`scope.actions contains invalid action: ${a}`);
    }
  }
  if (domains !== undefined) {
    if (!Array.isArray(domains)) throw badRequest('scope.domains must be an array of hostnames');
    for (const d of domains) {
      if (typeof d !== 'string' || d.length === 0 || d.length > 253) throw badRequest('scope.domains contains invalid hostname');
    }
  }
}

function badRequest(msg) {
  const e = new Error(msg); e.statusCode = 400; e.code = 'invalid_request'; return e;
}
function notFound(msg) {
  const e = new Error(msg); e.statusCode = 404; e.code = 'not_found'; return e;
}
function conflict(msg, code = 'conflict') {
  const e = new Error(msg); e.statusCode = 409; e.code = code; return e;
}
function forbidden(msg, code = 'forbidden') {
  const e = new Error(msg); e.statusCode = 403; e.code = code; return e;
}

/**
 * Create a draft intent. Status starts at 'draft' and requires explicit
 * authorize() before any transaction can be executed under it.
 */
function createIntent(params) {
  const {
    userId, siteId = null, agentId = null,
    purpose, scope,
    spendCapCents = 0, spendCurrency = 'EUR',
    maxExecutions = 1,
    ttlSeconds = 3600,
    metadata = {},
  } = params;

  if (!userId) throw badRequest('userId required');
  if (!purpose || typeof purpose !== 'string' || purpose.length > 500) {
    throw badRequest('purpose required (1-500 chars)');
  }
  validateScope(scope);
  if (!Number.isInteger(spendCapCents) || spendCapCents < 0) throw badRequest('spendCapCents must be a non-negative integer');
  if (!Number.isInteger(maxExecutions) || maxExecutions < 1 || maxExecutions > 1000) {
    throw badRequest('maxExecutions must be 1..1000');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 7 * 24 * 3600) {
    throw badRequest('ttlSeconds must be 30..604800');
  }

  const id = ulid('atp_int');
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  db.prepare(`
    INSERT INTO atp_intents (
      id, user_id, site_id, agent_id, purpose, scope,
      spend_cap_cents, spend_currency, max_executions, expires_at, nonce, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, userId, siteId, agentId, purpose, JSON.stringify(scope),
    spendCapCents, spendCurrency, maxExecutions, expiresAt, nonce, JSON.stringify(metadata)
  );

  return getIntent(id);
}

function getIntent(id) {
  const row = db.prepare('SELECT * FROM atp_intents WHERE id = ?').get(id);
  if (!row) return null;
  return hydrateIntent(row);
}

function hydrateIntent(row) {
  return {
    ...row,
    scope: safeJson(row.scope, {}),
    metadata: safeJson(row.metadata, {}),
  };
}

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function listIntentsForUser(userId, { limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT * FROM atp_intents WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
  return rows.map(hydrateIntent);
}

/**
 * Authorize an intent. The user (principal) confirms the contract.
 * After this call, the intent's nonce is registered in atp_nonces to
 * make it single-use, and the intent moves to 'authorized'.
 */
function authorizeIntent(intentId, { userId }) {
  const intent = getIntent(intentId);
  if (!intent) throw notFound('intent not found');
  if (intent.user_id !== userId) throw forbidden('not your intent');
  if (intent.status !== 'draft') throw conflict(`cannot authorize intent in status '${intent.status}'`, 'invalid_state');
  if (new Date(intent.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE atp_intents SET status='expired', updated_at=? WHERE id=?").run(nowIso(), intentId);
    throw conflict('intent expired before authorization', 'expired');
  }

  const tx = db.transaction(() => {
    // Reserve the nonce — single use across the whole user.
    try {
      db.prepare('INSERT INTO atp_nonces (nonce, user_id) VALUES (?, ?)').run(intent.nonce, userId);
    } catch (e) {
      throw conflict('nonce already consumed', 'replay');
    }
    db.prepare(`
      UPDATE atp_intents
         SET status='authorized', authorized_at=?, authorized_by=?, updated_at=?
       WHERE id=? AND status='draft'
    `).run(nowIso(), userId, nowIso(), intentId);
  });
  tx();

  return getIntent(intentId);
}

function revokeIntent(intentId, { userId, reason = 'user_revoked' }) {
  const intent = getIntent(intentId);
  if (!intent) throw notFound('intent not found');
  if (intent.user_id !== userId) throw forbidden('not your intent');
  if (intent.status === 'consumed' || intent.status === 'revoked' || intent.status === 'expired') {
    throw conflict(`cannot revoke intent in status '${intent.status}'`, 'invalid_state');
  }
  db.prepare(`
    UPDATE atp_intents
       SET status='revoked', revoked_at=?, revoked_reason=?, updated_at=?
     WHERE id=?
  `).run(nowIso(), String(reason).slice(0, 500), nowIso(), intentId);
  return getIntent(intentId);
}

// ── Transaction execution ────────────────────────────────────────────────────

/**
 * Begin a transaction under an authorized intent. Idempotent on
 * (intent_id, idempotency_key): replaying the same key returns the
 * existing transaction instead of creating a new one.
 */
function beginTransaction(params) {
  const {
    intentId, idempotencyKey, siteId = null, agentId = null,
    amountCents = 0, currency = 'EUR', summary = null, metadata = {},
  } = params;

  if (!intentId) throw badRequest('intentId required');
  if (!idempotencyKey || typeof idempotencyKey !== 'string' || idempotencyKey.length > 200) {
    throw badRequest('idempotencyKey required (1-200 chars)');
  }
  if (!Number.isInteger(amountCents) || amountCents < 0) throw badRequest('amountCents must be a non-negative integer');

  const intent = getIntent(intentId);
  if (!intent) throw notFound('intent not found');
  if (intent.status !== 'authorized') throw conflict(`intent not authorized (status='${intent.status}')`, 'invalid_state');
  if (new Date(intent.expires_at).getTime() < Date.now()) {
    db.prepare("UPDATE atp_intents SET status='expired', updated_at=? WHERE id=? AND status='authorized'").run(nowIso(), intentId);
    throw conflict('intent expired', 'expired');
  }
  if (intent.used_executions >= intent.max_executions) {
    throw conflict('intent execution cap reached', 'cap_reached');
  }
  if (intent.spend_cap_cents > 0 && (intent.spent_cents + amountCents) > intent.spend_cap_cents) {
    throw conflict('spend cap would be exceeded', 'spend_cap');
  }
  if (intent.spend_currency !== currency) {
    throw badRequest(`currency mismatch: intent='${intent.spend_currency}', tx='${currency}'`);
  }

  // Idempotency check — return the existing record if same key was used.
  const existing = db.prepare(`
    SELECT id FROM atp_transactions WHERE intent_id=? AND idempotency_key=?
  `).get(intentId, idempotencyKey);
  if (existing) return { ...getTransaction(existing.id), _idempotent_replay: true };

  const id = ulid('atp_tx');
  db.prepare(`
    INSERT INTO atp_transactions (
      id, intent_id, site_id, agent_id, idempotency_key,
      amount_cents, currency, summary, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, intentId, siteId || intent.site_id, agentId || intent.agent_id, idempotencyKey,
    amountCents, currency, summary, JSON.stringify(metadata));

  return getTransaction(id);
}

function getTransaction(id) {
  const row = db.prepare('SELECT * FROM atp_transactions WHERE id=?').get(id);
  if (!row) return null;
  return { ...row, metadata: safeJson(row.metadata, {}) };
}

function listTransactionsForIntent(intentId) {
  return db.prepare('SELECT * FROM atp_transactions WHERE intent_id=? ORDER BY created_at ASC').all(intentId)
    .map(r => ({ ...r, metadata: safeJson(r.metadata, {}) }));
}

const VALID_TX_TRANSITIONS = {
  pending:     ['executing', 'failed'],
  executing:   ['executed', 'failed'],
  executed:    ['settled', 'compensated', 'failed'],
  settled:     ['compensated'],
  failed:      ['compensated'],
  compensated: [],
};

function transitionTransaction(txId, toStatus, patch = {}) {
  const tx = getTransaction(txId);
  if (!tx) throw notFound('transaction not found');
  const allowed = VALID_TX_TRANSITIONS[tx.status] || [];
  if (!allowed.includes(toStatus)) {
    throw conflict(`illegal transition ${tx.status} → ${toStatus}`, 'invalid_state');
  }

  const fields = { status: toStatus, updated_at: nowIso() };
  if (toStatus === 'executing')   fields.started_at     = nowIso();
  if (toStatus === 'executed')    fields.completed_at   = nowIso();
  if (toStatus === 'settled')     fields.settled_at     = nowIso();
  if (toStatus === 'compensated') fields.compensated_at = nowIso();
  if (patch.error !== undefined)  fields.error          = String(patch.error).slice(0, 2000);
  if (patch.summary !== undefined) fields.summary       = String(patch.summary).slice(0, 1000);

  const sets = Object.keys(fields).map(k => `${k}=?`).join(', ');
  const vals = Object.values(fields);
  db.prepare(`UPDATE atp_transactions SET ${sets} WHERE id=?`).run(...vals, txId);

  // On settled, charge the intent. On compensated, refund.
  if (toStatus === 'settled') {
    const updated = db.prepare(`
      UPDATE atp_intents
         SET spent_cents = spent_cents + ?,
             used_executions = used_executions + 1,
             updated_at = ?
       WHERE id = ?
    `).run(tx.amount_cents, nowIso(), tx.intent_id);
    // Auto-consume intent if cap hit.
    const intent = getIntent(tx.intent_id);
    if (intent.used_executions >= intent.max_executions) {
      db.prepare("UPDATE atp_intents SET status='consumed', updated_at=? WHERE id=? AND status='authorized'")
        .run(nowIso(), tx.intent_id);
    }
  }
  if (toStatus === 'compensated' && tx.status === 'settled') {
    db.prepare(`
      UPDATE atp_intents
         SET spent_cents = MAX(0, spent_cents - ?),
             updated_at = ?
       WHERE id = ?
    `).run(tx.amount_cents, nowIso(), tx.intent_id);
  }

  return getTransaction(txId);
}

// ── Step ledger ──────────────────────────────────────────────────────────────

function appendStep(txId, { action, evidence = null, before = null, after = null, compensation = null }) {
  if (!action || typeof action !== 'string') throw badRequest('step.action required');
  const tx = getTransaction(txId);
  if (!tx) throw notFound('transaction not found');

  const nextSeqRow = db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS s FROM atp_steps WHERE transaction_id=?').get(txId);
  const seq = nextSeqRow.s;
  db.prepare(`
    INSERT INTO atp_steps (transaction_id, seq, action, state, before_snapshot, after_snapshot, evidence, compensation, started_at, ended_at)
    VALUES (?, ?, ?, 'succeeded', ?, ?, ?, ?, ?, ?)
  `).run(txId, seq, action,
    before ? JSON.stringify(before) : null,
    after  ? JSON.stringify(after)  : null,
    evidence ? JSON.stringify(evidence) : null,
    compensation ? JSON.stringify(compensation) : null,
    nowIso(), nowIso());
  return getStep(txId, seq);
}

function getStep(txId, seq) {
  const row = db.prepare('SELECT * FROM atp_steps WHERE transaction_id=? AND seq=?').get(txId, seq);
  if (!row) return null;
  return {
    ...row,
    before_snapshot: safeJson(row.before_snapshot, null),
    after_snapshot:  safeJson(row.after_snapshot, null),
    evidence:        safeJson(row.evidence, null),
    compensation:    safeJson(row.compensation, null),
  };
}

function listSteps(txId) {
  return db.prepare('SELECT * FROM atp_steps WHERE transaction_id=? ORDER BY seq ASC').all(txId)
    .map(r => ({
      ...r,
      before_snapshot: safeJson(r.before_snapshot, null),
      after_snapshot:  safeJson(r.after_snapshot,  null),
      evidence:        safeJson(r.evidence,        null),
      compensation:    safeJson(r.compensation,    null),
    }));
}

// ── Receipts (signed proof of outcome) ───────────────────────────────────────

/**
 * Issue a signed receipt for an executed transaction. The receipt body is
 * canonicalized via wab-crypto and signed Ed25519 with the supplied private
 * key (typically the site's key from `wab_signing_keys`).
 *
 * If no privateKey is supplied, an ephemeral keypair is generated and the
 * public key is embedded in the receipt so verifiers can still check it.
 * This keeps the free tier usable while encouraging Pro+ users to bind a
 * persistent site key for trust continuity.
 */
function issueReceipt(txId, { privateKeyB64 = null, embedPublicKey = true } = {}) {
  const tx = getTransaction(txId);
  if (!tx) throw notFound('transaction not found');
  if (!['executed', 'settled', 'failed', 'compensated'].includes(tx.status)) {
    throw conflict(`cannot issue receipt for status '${tx.status}'`, 'invalid_state');
  }

  // Refuse double-issuance.
  const existing = db.prepare('SELECT id FROM atp_receipts WHERE transaction_id=?').get(txId);
  if (existing) return getReceipt(existing.id);

  const steps = listSteps(txId);
  const intent = getIntent(tx.intent_id);

  const body = {
    type: 'atp.receipt.v1',
    receipt_id: ulid('atp_rcpt'),
    issued_at: nowIso(),
    transaction: {
      id: tx.id,
      status: tx.status,
      amount_cents: tx.amount_cents,
      currency: tx.currency,
      summary: tx.summary,
      started_at: tx.started_at,
      completed_at: tx.completed_at,
      settled_at: tx.settled_at,
      compensated_at: tx.compensated_at,
      error: tx.error,
    },
    intent: {
      id: intent.id,
      purpose: intent.purpose,
      scope: intent.scope,
      spend_cap_cents: intent.spend_cap_cents,
      currency: intent.spend_currency,
      authorized_at: intent.authorized_at,
    },
    steps: steps.map(s => ({
      seq: s.seq, action: s.action, state: s.state,
      attempts: s.attempts,
      started_at: s.started_at, ended_at: s.ended_at,
    })),
    site_id: tx.site_id || null,
    agent_id: tx.agent_id || null,
  };

  // Decide signing key.
  let signKey = privateKeyB64;
  let publicKeyB64 = null;
  let keyOrigin = 'supplied';
  if (!signKey) {
    const kp = wabCrypto.generateKeyPair();
    signKey = kp.private_key;
    publicKeyB64 = kp.public_key;
    keyOrigin = 'ephemeral';
  }

  const signed = wabCrypto.signManifest(body, signKey, { embed_public_key: embedPublicKey });
  // wab-crypto already embedded the pub key into signed.signature.public_key if requested,
  // but we also want the raw pubkey for column storage:
  if (!publicKeyB64) publicKeyB64 = signed.signature.public_key || null;

  const canonical = canonicalizeForStorage(signed);

  const id = body.receipt_id;
  db.prepare(`
    INSERT INTO atp_receipts (id, transaction_id, site_id, algorithm, key_id, canonical_body, signature, public_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, txId, tx.site_id, 'ed25519',
    signed.signature.key_id, canonical, signed.signature.value, publicKeyB64);

  return { ...getReceipt(id), _key_origin: keyOrigin };
}

function canonicalizeForStorage(signedManifest) {
  // Store the FULL signed object as JSON; verifiers recompute canonical from this.
  return JSON.stringify(signedManifest);
}

function getReceipt(id) {
  const row = db.prepare('SELECT * FROM atp_receipts WHERE id=?').get(id);
  if (!row) return null;
  let body = null;
  try { body = JSON.parse(row.canonical_body); } catch { /* keep null */ }
  return { ...row, body };
}

function getReceiptByTransaction(txId) {
  const row = db.prepare('SELECT id FROM atp_receipts WHERE transaction_id=?').get(txId);
  return row ? getReceipt(row.id) : null;
}

/**
 * Verify a receipt. Accepts either:
 *   - a receipt id (looked up in DB), or
 *   - a raw signed receipt object (offline verification).
 * Returns { ok, reason?, key_id?, age_seconds? }.
 */
function verifyReceipt(input) {
  let signed = null;
  let stored = null;
  if (typeof input === 'string') {
    stored = getReceipt(input);
    if (!stored) return { ok: false, reason: 'receipt not found' };
    signed = stored.body;
  } else if (input && typeof input === 'object') {
    signed = input;
  } else {
    return { ok: false, reason: 'invalid input' };
  }
  if (!signed || !signed.signature) return { ok: false, reason: 'no signature' };

  const pubB64 = signed.signature.public_key || (stored && stored.public_key) || null;
  const result = wabCrypto.verifyManifest(signed, pubB64, { max_age_seconds: 365 * 24 * 3600 });
  return result;
}

// ── Compensation ─────────────────────────────────────────────────────────────

/**
 * Compensate a transaction: rolls back its effects. This is the explicit
 * "undo" primitive that distinguishes WAB from naive scrapers — every
 * executed step can carry its own compensation descriptor in its evidence.
 *
 * This function just transitions the state and unwinds the intent's spend
 * counter. Actual site-side rollback (e.g. cancelling a booking) is the
 * caller's responsibility and should be recorded as further steps before
 * calling this function.
 */
function compensateTransaction(txId, { reason = 'compensated' } = {}) {
  return transitionTransaction(txId, 'compensated', { summary: String(reason).slice(0, 1000) });
}

// ── Periodic maintenance ─────────────────────────────────────────────────────

function expireOverdueIntents() {
  const r = db.prepare(`
    UPDATE atp_intents
       SET status='expired', updated_at=datetime('now')
     WHERE status IN ('draft','authorized')
       AND datetime(expires_at) < datetime('now')
  `).run();
  return r.changes;
}

module.exports = {
  // intents
  createIntent, getIntent, listIntentsForUser, authorizeIntent, revokeIntent,
  // transactions
  beginTransaction, getTransaction, listTransactionsForIntent, transitionTransaction,
  // steps
  appendStep, getStep, listSteps,
  // receipts
  issueReceipt, getReceipt, getReceiptByTransaction, verifyReceipt,
  // compensation
  compensateTransaction,
  // maintenance
  expireOverdueIntents,
  // re-exports for tests
  _validateScope: validateScope,
};
