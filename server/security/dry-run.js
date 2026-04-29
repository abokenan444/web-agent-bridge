'use strict';

/**
 * WAB Safety Shield — Mandatory Dry-Run
 *
 * Implements WAB SPEC §8.10. For commands the site classifies as
 * destructive (or which match the SPEC default destructive verb list,
 * see token-scope.js), the Bridge MUST refuse `dry_run: false` until a
 * preceding `dry_run: true` plan has been produced AND has not expired.
 *
 * Wire format:
 *   - Request:  body.dry_run === true | false   (default: undefined)
 *               body.plan_id   (required when dry_run === false)
 *   - Response (dry_run=true):
 *       { type:'success', result:{ dry_run:true, plan_id, expires_at,
 *         simulated:{ would_affect:[...], side_effects:[...], reversible:bool }}}
 *
 * Plan expiry:
 *   - Plans are short-lived (default 5 min, max 60 min) so an attacker
 *     who steals a session cannot replay an old plan against a changed
 *     target.
 *   - Plans are bound to (sessionToken, siteId, actionName, paramsHash)
 *     — any drift invalidates them.
 *
 * Errors:
 *   DRY_RUN_REQUIRED         — destructive action invoked without a plan
 *   DRY_RUN_PLAN_NOT_FOUND   — plan_id supplied but unknown / expired
 *   DRY_RUN_PLAN_MISMATCH    — plan exists but params/action drifted
 *   DRY_RUN_PLAN_EXPIRED     — plan past TTL
 *
 * The simulator is a pluggable function passed by the caller — this
 * module only owns the policy + plan-store. Sites/adapters provide the
 * actual "what would this do" answer.
 */

const crypto = require('crypto');
const { isDestructiveAction } = require('./token-scope');

const DEFAULT_TTL_MS = 5 * 60 * 1000;       // 5 min
const MAX_TTL_MS = 60 * 60 * 1000;          // 60 min hard cap
const PLAN_STORE_MAX = 5000;                // LRU bound

// ─── Plan store (in-memory, single-process) ──────────────────────────
// In a multi-process deployment this should be backed by Redis; the
// interface is intentionally minimal so swap-out is trivial.

const _plans = new Map();   // plan_id -> entry

function _evictIfFull() {
  if (_plans.size <= PLAN_STORE_MAX) return;
  // Evict ~10% of oldest entries.
  const drop = Math.ceil(PLAN_STORE_MAX * 0.1);
  let i = 0;
  for (const k of _plans.keys()) {
    if (i++ >= drop) break;
    _plans.delete(k);
  }
}

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

// ─── Public API ──────────────────────────────────────────────────────

/**
 * Decide whether `actionName` requires dry-run. Site config may EXPAND
 * the default destructive list (token-scope.DEFAULT_DESTRUCTIVE_VERBS)
 * via `destructiveActions[]` and may SUPPRESS via `nonDestructiveActions[]`.
 *
 * Sites can also explicitly opt OUT (rare, usually only for read-only
 * mirror/staging sandboxes) by setting `dryRunPolicy: "off"`.
 * They can opt IN universally with `dryRunPolicy: "always"`.
 */
function requiresDryRun(actionName, siteConfig = {}) {
  const policy = String(siteConfig.dryRunPolicy || 'auto').toLowerCase();
  if (policy === 'off') return false;
  if (policy === 'always') return true;
  // auto = use destructive-verb classification.
  return isDestructiveAction(actionName, siteConfig);
}

/**
 * Create a plan. Returns the plan envelope to be sent back to the agent.
 *
 * @param {object} ctx        { sessionToken, siteId, actionName, params }
 * @param {object} simulation { would_affect, side_effects, reversible, summary? }
 * @param {object} opts       { ttlMs }
 */
function createPlan(ctx, simulation, opts = {}) {
  const ttl = Math.min(Math.max(opts.ttlMs || DEFAULT_TTL_MS, 1_000), MAX_TTL_MS);
  const plan_id = 'wabp_' + crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const params_hash = _hashParams(ctx.params);
  const entry = {
    plan_id,
    session_fingerprint: _sessionFingerprint(ctx.sessionToken),
    site_id: ctx.siteId,
    action_name: ctx.actionName,
    params_hash,
    simulation: {
      would_affect: simulation.would_affect || [],
      side_effects: simulation.side_effects || [],
      reversible: simulation.reversible !== false,
      summary: simulation.summary || null,
    },
    created_at: now,
    expires_at: now + ttl,
  };
  _plans.set(plan_id, entry);
  _evictIfFull();
  return {
    dry_run: true,
    plan_id,
    expires_at: new Date(entry.expires_at).toISOString(),
    simulated: entry.simulation,
  };
}

/**
 * Validate a plan against a real (dry_run=false) request.
 *
 * Returns { ok: true, plan } on success; otherwise
 * { ok: false, code, message }.
 */
function consumePlan(planId, ctx) {
  if (!planId) return { ok: false, code: 'DRY_RUN_REQUIRED', message: 'destructive action requires a prior dry_run plan' };
  const entry = _plans.get(planId);
  if (!entry) return { ok: false, code: 'DRY_RUN_PLAN_NOT_FOUND', message: 'plan_id unknown or already consumed' };
  const now = Date.now();
  if (now > entry.expires_at) {
    _plans.delete(planId);
    return { ok: false, code: 'DRY_RUN_PLAN_EXPIRED', message: 'plan expired, please re-run dry_run' };
  }
  if (entry.session_fingerprint !== _sessionFingerprint(ctx.sessionToken)) {
    return { ok: false, code: 'DRY_RUN_PLAN_MISMATCH', message: 'plan was issued to a different session' };
  }
  if (entry.site_id !== ctx.siteId) {
    return { ok: false, code: 'DRY_RUN_PLAN_MISMATCH', message: 'plan was issued for a different site' };
  }
  if (entry.action_name !== ctx.actionName) {
    return { ok: false, code: 'DRY_RUN_PLAN_MISMATCH', message: 'plan was issued for a different action' };
  }
  if (entry.params_hash !== _hashParams(ctx.params)) {
    return { ok: false, code: 'DRY_RUN_PLAN_MISMATCH', message: 'parameters changed since plan was generated' };
  }
  // Single-use: consume.
  _plans.delete(planId);
  return { ok: true, plan: entry };
}

/** Test helper. */
function _resetForTests() {
  _plans.clear();
}

function _sessionFingerprint(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}

module.exports = {
  requiresDryRun,
  createPlan,
  consumePlan,
  // helpers exposed for tests
  _resetForTests,
  _hashParams,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
};
