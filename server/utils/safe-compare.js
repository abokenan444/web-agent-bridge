'use strict';

const crypto = require('crypto');

/**
 * Constant-time comparison for secrets / bearer tokens.
 *
 * Both operands are hashed to a fixed-length SHA-256 digest before the
 * timing-safe compare, so this never throws on length mismatch and does not
 * leak the secret length through early termination. Non-string inputs (missing
 * headers, undefined env vars) return false instead of throwing.
 *
 * Use this for ALL static-token / shared-secret equality checks instead of
 * `a === b` / `a !== b`, which short-circuit on the first differing byte and
 * are therefore vulnerable to remote timing analysis.
 */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length === 0 || b.length === 0) {
    return false;
  }
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { safeEqual };
