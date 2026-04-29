'use strict';

/**
 * WAB Safety Shield — IP rate-limiter for /human-gate/approve (SPEC §8.11)
 *
 * Module 1's per-challenge 5-attempt lockout is sufficient against a
 * single attacker spamming one challenge_id. But it does NOT prevent an
 * attacker from rotating across many challenge_ids (or guessing on
 * leaked ones) at high rate. This sliding-window IP limiter caps the
 * approval rate per-IP across all challenges.
 *
 * Defaults — tuned for human use:
 *   • 30 attempts per 10 minutes per IP  (≈1 every 20s)
 *   • 5  approvals  per 10 minutes per IP (success-only sub-cap)
 *
 * Pure in-memory; safe for single-process pm2 deployment we use today.
 * For multi-process scale-out, swap the store for Redis ZSET (TODO).
 */

const DEFAULT_ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const DEFAULT_ATTEMPT_LIMIT = 30;
const DEFAULT_SUCCESS_LIMIT = 5;
const STORE_MAX_IPS = 10_000;

const _attempts = new Map();   // ip -> [timestamps]
const _successes = new Map();  // ip -> [timestamps]

let _config = {
  windowMs: DEFAULT_ATTEMPT_WINDOW_MS,
  attemptLimit: DEFAULT_ATTEMPT_LIMIT,
  successLimit: DEFAULT_SUCCESS_LIMIT,
};

function configure(opts = {}) {
  const w = Number.isFinite(opts.windowMs) ? opts.windowMs : _config.windowMs;
  const a = Number.isFinite(opts.attemptLimit) ? opts.attemptLimit : _config.attemptLimit;
  const s = Number.isFinite(opts.successLimit) ? opts.successLimit : _config.successLimit;
  _config = {
    windowMs: Math.max(10, Math.min(60 * 60 * 1000, w)),
    attemptLimit: Math.max(1, a),
    successLimit: Math.max(1, s),
  };
}

function _prune(map, ip, windowMs, now) {
  const arr = map.get(ip);
  if (!arr) return [];
  const cutoff = now - windowMs;
  const fresh = arr.filter((t) => t > cutoff);
  if (fresh.length === 0) map.delete(ip);
  else map.set(ip, fresh);
  return fresh;
}

function _evictIfFull(map) {
  if (map.size <= STORE_MAX_IPS) return;
  const drop = Math.ceil(STORE_MAX_IPS * 0.1);
  let i = 0;
  for (const k of map.keys()) {
    if (i++ >= drop) break;
    map.delete(k);
  }
}

/**
 * Returns one of:
 *   { allowed: true,  remaining_attempts, remaining_successes }
 *   { allowed: false, code: 'RATE_LIMIT_TOO_MANY_ATTEMPTS', retry_after_ms }
 *   { allowed: false, code: 'RATE_LIMIT_TOO_MANY_APPROVALS', retry_after_ms }
 *
 * Call BEFORE attempting humanGate.approveChallenge().
 */
function checkBeforeAttempt(ip) {
  if (!ip) return { allowed: true, remaining_attempts: _config.attemptLimit, remaining_successes: _config.successLimit };
  const now = Date.now();
  const attempts = _prune(_attempts, ip, _config.windowMs, now);
  const successes = _prune(_successes, ip, _config.windowMs, now);

  if (successes.length >= _config.successLimit) {
    return {
      allowed: false,
      code: 'RATE_LIMIT_TOO_MANY_APPROVALS',
      retry_after_ms: _config.windowMs - (now - successes[0]),
    };
  }
  if (attempts.length >= _config.attemptLimit) {
    return {
      allowed: false,
      code: 'RATE_LIMIT_TOO_MANY_ATTEMPTS',
      retry_after_ms: _config.windowMs - (now - attempts[0]),
    };
  }
  return {
    allowed: true,
    remaining_attempts: _config.attemptLimit - attempts.length,
    remaining_successes: _config.successLimit - successes.length,
  };
}

/**
 * Record an attempt outcome AFTER calling approveChallenge.
 *  - Always records the attempt timestamp.
 *  - Additionally records a success timestamp when ok===true.
 */
function recordAttempt(ip, ok) {
  if (!ip) return;
  const now = Date.now();
  const arr = _attempts.get(ip) || [];
  arr.push(now);
  _attempts.set(ip, arr);
  _evictIfFull(_attempts);
  if (ok) {
    const sarr = _successes.get(ip) || [];
    sarr.push(now);
    _successes.set(ip, sarr);
    _evictIfFull(_successes);
  }
}

function _resetForTests() {
  _attempts.clear();
  _successes.clear();
  _config = {
    windowMs: DEFAULT_ATTEMPT_WINDOW_MS,
    attemptLimit: DEFAULT_ATTEMPT_LIMIT,
    successLimit: DEFAULT_SUCCESS_LIMIT,
  };
}

function _stats() {
  return {
    config: { ..._config },
    ips_with_attempts: _attempts.size,
    ips_with_successes: _successes.size,
  };
}

module.exports = {
  configure,
  checkBeforeAttempt,
  recordAttempt,
  _resetForTests,
  _stats,
  DEFAULT_ATTEMPT_WINDOW_MS,
  DEFAULT_ATTEMPT_LIMIT,
  DEFAULT_SUCCESS_LIMIT,
};
