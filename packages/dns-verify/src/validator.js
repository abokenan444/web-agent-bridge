/**
 * @wab/dns-verify — record validator.
 *
 * Implements WAB SPEC §4.6.2 / §4.6.3 (ABNF grammar) and §4.6.6
 * (error handling matrix) without external deps.
 */

'use strict';

const { VerifyError } = require('./doh-client');

// Conservative TXT character set — superset of §4.6.2 field-value but rejects
// control characters and quote/escape oddities that DoH emits inconsistently.
const FIELD_VALUE_RE = /^[A-Za-z0-9\-._/:+%?&=,@!*'~#$()[\] ]+$/;
const FIELD_NAME_RE = /^[A-Za-z][A-Za-z0-9\-_]*$/;
const VERSION_RE = /^wab(\d+)$/;

/**
 * Strip the leading/trailing quotes some resolvers add and merge multi-string
 * TXT records. DoH-JSON returns each string in `data` already concatenated by
 * the resolver in most cases, but be defensive.
 */
function normalizeTxt(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  // Remove surrounding quotes
  s = s.replace(/^"+/, '').replace(/"+$/, '');
  // Collapse `"foo" "bar"` → `foobar`
  s = s.replace(/"\s*"/g, '');
  return s.trim();
}

/**
 * Parse a `_wab` / `_wab-policy` record into a key/value map per §4.6.2.
 * Throws VerifyError(INVALID_FORMAT) on grammar violation.
 */
function parseWabRecord(raw, label = '_wab') {
  const text = normalizeTxt(raw);
  if (!text) throw new VerifyError('INVALID_FORMAT', `${label} record is empty`);

  // Split on `;` honouring optional whitespace around it.
  const parts = text.split(/\s*;\s*/).filter((p) => p.length > 0);
  if (parts.length === 0) throw new VerifyError('INVALID_FORMAT', `${label} record has no fields`);

  const out = {};
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const eq = part.indexOf('=');
    if (eq <= 0) throw new VerifyError('INVALID_FORMAT', `${label}: malformed field "${part}"`);
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();

    if (!FIELD_NAME_RE.test(name)) {
      throw new VerifyError('INVALID_FORMAT', `${label}: invalid field name "${name}"`);
    }
    if (!FIELD_VALUE_RE.test(value)) {
      throw new VerifyError('INVALID_FORMAT', `${label}: invalid value for "${name}"`);
    }
    // First field MUST be `v=wabN` for `_wab`. `_wab-policy` has no version requirement.
    if (i === 0 && label === '_wab') {
      if (name !== 'v') {
        throw new VerifyError('INVALID_FORMAT', `${label}: first field must be "v=", got "${name}"`);
      }
      const m = VERSION_RE.exec(value);
      if (!m) throw new VerifyError('INVALID_FORMAT', `${label}: invalid version "${value}"`);
      out._versionNumber = parseInt(m[1], 10);
    }
    if (Object.prototype.hasOwnProperty.call(out, name)) {
      // Spec doesn't forbid duplicate keys — last one wins, but flag it.
      out._warnings = out._warnings || [];
      out._warnings.push(`duplicate field "${name}"`);
    }
    out[name] = value;
  }

  // §4.6.6: endpoint MUST be HTTPS when present.
  if (label === '_wab' && out.endpoint && !/^https:\/\//i.test(out.endpoint)) {
    throw new VerifyError('INSECURE_ENDPOINT', `endpoint must be HTTPS, got "${out.endpoint}"`);
  }

  // §4.6.2: at least one of endpoint/path required for `_wab`.
  if (label === '_wab' && !out.endpoint && !out.path) {
    throw new VerifyError('INVALID_FORMAT', `${label}: must contain endpoint= or path=`);
  }

  return out;
}

/**
 * Parse a `_wab-trust` record into a key/value map per §4.6.3.
 */
function parseTrustRecord(raw) {
  const text = normalizeTxt(raw);
  if (!text) throw new VerifyError('INVALID_FORMAT', '_wab-trust record is empty');

  const parts = text.split(/\s*;\s*/).filter((p) => p.length > 0);
  const out = {};
  // SPEC §4.6.3 reserved fields. Other fields (including version tag `v=`)
  // are permitted for forward-compat but emit a warning rather than failing —
  // DNS records are extensible by nature and a strict ABNF would block future
  // protocol revisions from rolling out cleanly.
  const reserved = new Set(['trust', 'security', 'complaint', 'iodef']);

  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq <= 0) throw new VerifyError('INVALID_FORMAT', `_wab-trust: malformed field "${part}"`);
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!FIELD_NAME_RE.test(name)) {
      throw new VerifyError('INVALID_FORMAT', `_wab-trust: invalid field name "${name}"`);
    }
    if (!reserved.has(name)) {
      out._warnings = out._warnings || [];
      out._warnings.push(`unknown field "${name}" (forward-compat)`);
      out[name] = value;
      continue;
    }
    if (!/^https:\/\//i.test(value) && !/^mailto:/i.test(value)) {
      throw new VerifyError('INVALID_FORMAT', `_wab-trust: ${name} must be https:// or mailto:`);
    }
    out[name] = value;
  }
  return out;
}

module.exports = {
  parseWabRecord,
  parseTrustRecord,
  normalizeTxt,
  FIELD_VALUE_RE,
  FIELD_NAME_RE,
  VERSION_RE,
};
