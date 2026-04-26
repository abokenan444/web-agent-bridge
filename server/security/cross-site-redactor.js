'use strict';

/**
 * Cross-Site Redactor — prevents PII / payment data from leaking between sites
 * via the agent mesh, multi-agent orchestration, or shared knowledge stores.
 *
 * Defense strategy:
 *   1. **Detect** common sensitive value patterns in any string field
 *      (credit cards via Luhn, IBANs, emails, phone numbers, JWTs, API keys,
 *      government IDs, addresses).
 *   2. **Strip** keys that look sensitive (`password`, `card`, `secret`, ...).
 *   3. **Hash** cross-site identifiers when they MUST cross a boundary
 *      (HMAC-SHA256 with a per-tenant pepper) so reverse engineering them is
 *      computationally hard.
 *   4. **Audit** every cross-site transfer in `cross_site_transfers` so a
 *      tenant admin can review what their agent shared.
 *
 * Use this whenever payload `(site_a, agent) → (site_b)` would carry
 * user-controlled fields. Specifically:
 *   - agent-mesh.shareKnowledge / shareTactic
 *   - multi-agent orchestration handoffs
 *   - cross-tenant analytics exports
 */

const crypto = require('crypto');
const { db } = require('../models/db');

const SECRET_FIELDS = new Set([
  'password', 'pass', 'pwd', 'secret', 'token', 'jwt',
  'api_key', 'apikey', 'auth', 'authorization',
  'card', 'card_number', 'cardnumber', 'cvv', 'cvc', 'pan',
  'ssn', 'national_id', 'passport', 'iban', 'bban',
  'session', 'cookie', 'private_key', 'privatekey',
  'recovery', 'mnemonic', 'seed_phrase',
]);

const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const RE_PHONE = /\+?\d[\d\s().-]{7,}\d/g;
const RE_JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const RE_LONG_HEX = /\b[a-f0-9]{32,}\b/gi;       // generic long secrets/hashes
const RE_PAN_CANDIDATE = /\b(?:\d[ -]?){12,19}\b/g;
const RE_IBAN = /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/g;
const RE_API_KEY = /\b(?:wab|sk|pk|sk_live|sk_test)[_-][a-z0-9_]{16,}\b/gi;

function _luhn(num) {
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 12 || digits.length > 19) return false;
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function _redactString(s) {
  if (typeof s !== 'string') return { value: s, hits: [] };
  const hits = [];
  let out = s;

  out = out.replace(RE_JWT, () => { hits.push('jwt'); return '[REDACTED:JWT]'; });
  out = out.replace(RE_API_KEY, () => { hits.push('api_key'); return '[REDACTED:KEY]'; });
  out = out.replace(RE_IBAN, () => { hits.push('iban'); return '[REDACTED:IBAN]'; });
  out = out.replace(RE_PAN_CANDIDATE, (m) => {
    if (_luhn(m)) { hits.push('card'); return '[REDACTED:CARD]'; }
    return m;
  });
  out = out.replace(RE_EMAIL, () => { hits.push('email'); return '[REDACTED:EMAIL]'; });
  out = out.replace(RE_PHONE, () => { hits.push('phone'); return '[REDACTED:PHONE]'; });
  out = out.replace(RE_LONG_HEX, () => { hits.push('hex_secret'); return '[REDACTED:HEX]'; });

  return { value: out, hits };
}

function _isSecretKey(key) {
  if (typeof key !== 'string') return false;
  const k = key.toLowerCase().replace(/[\s_-]+/g, '_');
  if (SECRET_FIELDS.has(k)) return true;
  for (const f of SECRET_FIELDS) {
    if (k.includes(f)) return true;
  }
  return false;
}

/**
 * Deeply redact an object. Returns { value, hits } where hits lists the
 * categories that were detected/redacted.
 */
function redact(input, depth = 0, hits = []) {
  if (depth > 6 || input == null) return { value: input, hits };
  if (typeof input === 'string') {
    const r = _redactString(input);
    hits.push(...r.hits);
    return { value: r.value, hits };
  }
  if (Array.isArray(input)) {
    return {
      value: input.map((v) => redact(v, depth + 1, hits).value),
      hits,
    };
  }
  if (typeof input === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      if (_isSecretKey(k)) {
        hits.push(`field:${k}`);
        out[k] = '[REDACTED]';
        continue;
      }
      out[k] = redact(v, depth + 1, hits).value;
    }
    return { value: out, hits };
  }
  return { value: input, hits };
}

// ─── Cross-tenant identifier hashing ─────────────────────────────────

const _peppers = new Map(); // tenantId → buffer
function _peppers_get(tenantId) {
  let p = _peppers.get(tenantId || '__default__');
  if (!p) {
    const seed = process.env.WAB_TENANT_PEPPER_SEED || crypto.randomBytes(32).toString('hex');
    p = crypto.createHmac('sha256', seed).update(String(tenantId || '__default__')).digest();
    _peppers.set(tenantId || '__default__', p);
  }
  return p;
}

/**
 * Produce a deterministic but non-reversible identifier for cross-site use.
 * Same id within a tenant maps to same hash; different tenants produce
 * different hashes for the same input.
 */
function pseudonymize(value, tenantId) {
  const pep = _peppers_get(tenantId);
  return 'wabp_' + crypto.createHmac('sha256', pep).update(String(value)).digest('hex').slice(0, 24);
}

// ─── Audit ───────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS cross_site_transfers (
    id TEXT PRIMARY KEY,
    from_site TEXT,
    to_site TEXT,
    agent_id TEXT,
    purpose TEXT,
    payload_hash TEXT,
    redaction_hits TEXT DEFAULT '[]',
    blocked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_cst_from_to ON cross_site_transfers(from_site, to_site);
  CREATE INDEX IF NOT EXISTS idx_cst_blocked ON cross_site_transfers(blocked);
`);

/**
 * Audit + redact a cross-site payload. Use this at every boundary.
 * Returns the safe-to-forward payload. If `blockOnSensitive` is true and
 * highly sensitive hits (card/iban/jwt/api_key) are detected, returns null.
 */
function auditAndRedact(opts) {
  const { fromSite, toSite, agentId, purpose, payload, blockOnSensitive } = opts;
  const { value, hits } = redact(payload);
  const dangerous = hits.some((h) => /^(card|iban|jwt|api_key|field:)/.test(h));
  const blocked = !!(blockOnSensitive && dangerous);

  const payloadHash = crypto.createHash('sha256').update(JSON.stringify(payload || null)).digest('hex');

  db.prepare(`INSERT INTO cross_site_transfers
    (id, from_site, to_site, agent_id, purpose, payload_hash, redaction_hits, blocked)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), fromSite || null, toSite || null, agentId || null,
    purpose || null, payloadHash, JSON.stringify([...new Set(hits)]),
    blocked ? 1 : 0
  );

  return blocked ? null : value;
}

function getRecentTransfers(limit = 100, fromSite) {
  if (fromSite) {
    return db.prepare(`SELECT * FROM cross_site_transfers WHERE from_site = ? ORDER BY rowid DESC LIMIT ?`).all(fromSite, limit);
  }
  return db.prepare(`SELECT * FROM cross_site_transfers ORDER BY rowid DESC LIMIT ?`).all(limit);
}

module.exports = {
  redact,
  auditAndRedact,
  pseudonymize,
  getRecentTransfers,
};
