/**
 * RFC 8785 — JSON Canonicalization Scheme (JCS)
 * ───────────────────────────────────────────────────────────────────────────
 * Produces a deterministic byte sequence for any JSON-serialisable value,
 * suitable for hashing or signing.  Implements:
 *
 *   • Object keys sorted lexicographically by UTF-16 code units (per RFC 8785 §3.2.3).
 *   • Numbers serialised per ES2017 ECMAScript ToString (RFC 8785 §3.2.2.2),
 *     with finite-only checks (Infinity / NaN are rejected — RFC 8259 §6).
 *   • Strings escaped with the minimal RFC 8259 §7 form (control chars + \" + \\).
 *   • Booleans / null encoded as `true` / `false` / `null`.
 *   • Arrays preserve element order.
 *
 * This is intentionally dependency-free so it can be used by signing paths,
 * audit-log HMAC chains, and ATP receipt verification without pulling extra
 * packages.  Performance is O(n log n) over object keys.
 *
 * Anti-features (deliberate):
 *   • Does NOT support `undefined`, functions, symbols, BigInt — throws.
 *   • Does NOT escape non-ASCII; output is valid UTF-8 by construction.
 *   • Does NOT pretty-print.
 */

'use strict';

const HEX = '0123456789abcdef';

function _escapeString(s) {
  // RFC 8785 §3.2.2.1 → RFC 8259 §7: minimal escaping.
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20) {
      out += '\\u00' + HEX[(c >> 4) & 0xf] + HEX[c & 0xf];
    } else {
      out += s[i];
    }
  }
  return out + '"';
}

function _serializeNumber(n) {
  // RFC 8785 §3.2.2.2: ECMAScript ToString. Reject non-finite per RFC 8259.
  if (!Number.isFinite(n)) {
    throw new TypeError(`canonical-json: non-finite number not allowed (${n})`);
  }
  if (n === 0) return '0';            // collapses -0 → "0"
  return String(n);
}

function canonicalize(value) {
  if (value === null) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'number')  return _serializeNumber(value);
  if (t === 'string')  return _escapeString(value);

  if (t === 'bigint' || t === 'function' || t === 'symbol' || t === 'undefined') {
    throw new TypeError(`canonical-json: unsupported type ${t}`);
  }

  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) out += ',';
      const v = value[i];
      out += v === undefined ? 'null' : canonicalize(v);  // align with JSON.stringify
    }
    return out + ']';
  }

  // Plain object — sort keys by UTF-16 code units (default String sort).
  if (t === 'object') {
    // Strip undefined values (per JSON spec) before sorting.
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    let out = '{';
    for (let i = 0; i < keys.length; i++) {
      if (i > 0) out += ',';
      const k = keys[i];
      out += _escapeString(k) + ':' + canonicalize(value[k]);
    }
    return out + '}';
  }

  throw new TypeError(`canonical-json: unsupported value ${value}`);
}

/** Convenience: return a SHA-256 hex digest over the canonical form. */
function canonicalDigest(value, algo = 'sha256') {
  const crypto = require('crypto');
  return crypto.createHash(algo).update(canonicalize(value), 'utf8').digest('hex');
}

module.exports = { canonicalize, canonicalDigest };
