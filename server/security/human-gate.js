'use strict';

/**
 * WAB Safety Shield — Out-of-Band Human Gate (SPEC §8.11)
 *
 * For high-risk actions on Pro+ sites, an agent's request is held in a
 * "pending" state and a one-time confirmation code is dispatched to a
 * channel the agent CANNOT see (Telegram bot, WhatsApp, email, Slack
 * webhook, etc.). Only after a human approves OOB can the agent retry
 * with `confirmation_id` and have the request executed.
 *
 * Design properties:
 *   1. The challenge code is generated server-side; the agent never
 *      sees it. Even a fully prompt-injected agent cannot self-approve.
 *   2. Approval is bound to (session, site, action, paramsHash) — drift
 *      invalidates the approval (mirrors dry-run binding).
 *   3. Approvals are single-use.
 *   4. Pending challenges expire (default 10 min, max 30 min).
 *
 * This module is transport-agnostic. Transports are registered via
 * `setTransport(name, fn)`; sites pick one in `humanGate.transport`.
 * The default `null` transport is a no-op (used in tests + offline mode)
 * and the challenge code is also returned via an internal admin API
 * (`GET /api/wab/human-gate/:id/peek`) gated by an admin token, so
 * operators can recover from a misconfigured channel.
 */

const crypto = require('crypto');
const { isDestructiveAction } = require('./token-scope');

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const MAX_TTL_MS = 30 * 60 * 1000;
const STORE_MAX = 5000;

const STATUS = Object.freeze({
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
  CONSUMED: 'consumed',
});

const _store = new Map(); // challenge_id -> entry
const _transports = new Map();

// ─── helpers ─────────────────────────────────────────────────────────

function _hashParams(params) {
  const canon = JSON.stringify(_canonicalize(params || {}));
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 24);
}
function _canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(_canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = _canonicalize(value[k]);
  return out;
}
function _fingerprint(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}
function _genCode() {
  // 6-digit numeric. Avoids confusing chars on phones.
  return String(crypto.randomInt(100000, 1000000));
}
function _genId() {
  return 'wabh_' + crypto.randomBytes(16).toString('hex');
}
function _evictIfFull() {
  if (_store.size <= STORE_MAX) return;
  const drop = Math.ceil(STORE_MAX * 0.1);
  let i = 0;
  for (const k of _store.keys()) {
    if (i++ >= drop) break;
    _store.delete(k);
  }
}

// ─── transports ──────────────────────────────────────────────────────

function setTransport(name, fn) {
  if (typeof fn !== 'function') throw new TypeError('transport must be a function');
  _transports.set(String(name).toLowerCase(), fn);
}

function _resolveTransport(siteConfig = {}) {
  const name = String(siteConfig?.humanGate?.transport || 'null').toLowerCase();
  return _transports.get(name) || null;
}

// Default null transport — no-op; useful for offline/dev/tests.
setTransport('null', async () => ({ ok: true, channel: 'null' }));

// ─── policy ──────────────────────────────────────────────────────────

/**
 * Whether the named action requires an OOB human gate.
 * Trigger conditions:
 *   - site.humanGate.enabled === true   AND
 *   - tier ∈ {pro, premium, enterprise} OR site.humanGate.force === true
 *   - action is destructive OR appears in site.humanGate.actions[]
 */
function requiresHumanGate(actionName, siteConfig = {}, tier = 'free') {
  const cfg = siteConfig?.humanGate || {};
  if (!cfg.enabled) return false;
  const tierOk = ['pro', 'premium', 'enterprise'].includes(String(tier).toLowerCase()) || cfg.force === true;
  if (!tierOk) return false;
  if (Array.isArray(cfg.actions) && cfg.actions.includes(actionName)) return true;
  // Default: gate destructive verbs (reuse classification from token-scope).
  return isDestructiveAction(actionName, siteConfig);
}

// ─── challenge lifecycle ─────────────────────────────────────────────

/**
 * Create a challenge and dispatch it OOB.
 * Returns { challenge_id, expires_at, dispatched_to, status:'pending' }.
 * The plaintext code is NEVER returned to the caller path of the agent;
 * it is delivered only via the configured transport (or visible to the
 * site operator via the admin peek endpoint).
 */
async function issueChallenge(ctx, opts = {}) {
  const ttl = Math.min(Math.max(opts.ttlMs || DEFAULT_TTL_MS, 1000), MAX_TTL_MS);
  const id = _genId();
  const code = _genCode();
  const codeHash = crypto.createHash('sha256').update(code).digest('hex');
  const now = Date.now();
  const entry = {
    id,
    status: STATUS.PENDING,
    code_hash: codeHash,
    code_preview_for_admin: code, // used by admin peek only
    session_fingerprint: _fingerprint(ctx.sessionToken),
    site_id: ctx.siteId,
    actor_id: ctx.actorId || null,
    action_name: ctx.actionName,
    params_hash: _hashParams(ctx.params),
    created_at: now,
    expires_at: now + ttl,
    attempts: 0,
    rejected_reason: null,
  };
  _store.set(id, entry);
  _evictIfFull();

  let dispatchResult = { ok: true, channel: 'none' };
  const transport = opts.transport || _resolveTransport(opts.siteConfig);
  if (transport) {
    try {
      dispatchResult = await transport({
        challenge_id: id,
        code,
        site_id: ctx.siteId,
        action_name: ctx.actionName,
        actor_id: ctx.actorId || null,
        expires_at: new Date(entry.expires_at).toISOString(),
        siteConfig: opts.siteConfig || {},
      }) || { ok: true, channel: 'unknown' };
    } catch (err) {
      dispatchResult = { ok: false, channel: 'error', error: err.message };
    }
  }

  return {
    challenge_id: id,
    status: entry.status,
    expires_at: new Date(entry.expires_at).toISOString(),
    dispatched_to: dispatchResult.channel || null,
    dispatch_ok: dispatchResult.ok !== false,
  };
}

/**
 * Approve a challenge using its OOB code (called by the human's webhook
 * receiver or the operator UI). Rate-limited per challenge to 5 attempts.
 */
function approveChallenge(challengeId, code) {
  const entry = _store.get(challengeId);
  if (!entry) return { ok: false, code: 'HUMAN_GATE_NOT_FOUND' };
  if (Date.now() > entry.expires_at) {
    _store.delete(challengeId);
    return { ok: false, code: 'HUMAN_GATE_EXPIRED' };
  }
  if (entry.status !== STATUS.PENDING) {
    return { ok: false, code: 'HUMAN_GATE_BAD_STATE', message: `cannot approve: ${entry.status}` };
  }
  entry.attempts += 1;
  if (entry.attempts > 5) {
    entry.status = STATUS.REJECTED;
    entry.rejected_reason = 'too_many_attempts';
    return { ok: false, code: 'HUMAN_GATE_LOCKED' };
  }
  const supplied = crypto.createHash('sha256').update(String(code || '')).digest('hex');
  let match = false;
  try {
    match = crypto.timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(entry.code_hash, 'hex'));
  } catch { match = false; }
  if (!match) return { ok: false, code: 'HUMAN_GATE_BAD_CODE' };
  entry.status = STATUS.APPROVED;
  entry.approved_at = Date.now();
  return { ok: true, status: entry.status };
}

function rejectChallenge(challengeId, reason) {
  const entry = _store.get(challengeId);
  if (!entry) return { ok: false, code: 'HUMAN_GATE_NOT_FOUND' };
  if (entry.status !== STATUS.PENDING) {
    return { ok: false, code: 'HUMAN_GATE_BAD_STATE' };
  }
  entry.status = STATUS.REJECTED;
  entry.rejected_reason = String(reason || 'rejected_by_human').slice(0, 200);
  return { ok: true, status: entry.status };
}

/**
 * Consume an APPROVED challenge during the agent's retry. Validates
 * binding to the original (session, site, action, params). Single-use.
 */
function consumeApproved(challengeId, ctx) {
  if (!challengeId) return { ok: false, code: 'HUMAN_GATE_REQUIRED' };
  const entry = _store.get(challengeId);
  if (!entry) return { ok: false, code: 'HUMAN_GATE_NOT_FOUND' };
  if (Date.now() > entry.expires_at) {
    _store.delete(challengeId);
    return { ok: false, code: 'HUMAN_GATE_EXPIRED' };
  }
  if (entry.status === STATUS.PENDING) return { ok: false, code: 'HUMAN_GATE_PENDING' };
  if (entry.status === STATUS.REJECTED) return { ok: false, code: 'HUMAN_GATE_REJECTED', message: entry.rejected_reason || 'rejected' };
  if (entry.status === STATUS.CONSUMED) return { ok: false, code: 'HUMAN_GATE_CONSUMED' };
  if (entry.status !== STATUS.APPROVED) return { ok: false, code: 'HUMAN_GATE_BAD_STATE' };
  // Binding checks
  if (entry.session_fingerprint !== _fingerprint(ctx.sessionToken)) {
    return { ok: false, code: 'HUMAN_GATE_MISMATCH', message: 'approval issued to a different session' };
  }
  if (entry.site_id !== ctx.siteId) {
    return { ok: false, code: 'HUMAN_GATE_MISMATCH', message: 'approval issued for a different site' };
  }
  if (entry.action_name !== ctx.actionName) {
    return { ok: false, code: 'HUMAN_GATE_MISMATCH', message: 'approval issued for a different action' };
  }
  if (entry.params_hash !== _hashParams(ctx.params)) {
    return { ok: false, code: 'HUMAN_GATE_MISMATCH', message: 'parameters changed since approval' };
  }
  entry.status = STATUS.CONSUMED;
  entry.consumed_at = Date.now();
  return { ok: true, entry };
}

function getStatus(challengeId) {
  const entry = _store.get(challengeId);
  if (!entry) return null;
  return {
    challenge_id: entry.id,
    status: entry.status,
    expires_at: new Date(entry.expires_at).toISOString(),
    rejected_reason: entry.rejected_reason || undefined,
  };
}

function _resetForTests() { _store.clear(); }
function _peekForAdmin(challengeId) {
  const e = _store.get(challengeId);
  return e ? { ...e } : null;
}

module.exports = {
  STATUS,
  setTransport,
  requiresHumanGate,
  issueChallenge,
  approveChallenge,
  rejectChallenge,
  consumeApproved,
  getStatus,
  // test/admin helpers
  _resetForTests,
  _peekForAdmin,
  _hashParams,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
};
