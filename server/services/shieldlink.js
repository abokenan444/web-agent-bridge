/**
 * WAB ShieldLink — Verified Links / Anti-Phishing for premium customers.
 *
 * Trust model
 * -----------
 *   1. A site owner verifies their domain (existing DNS TXT trust model).
 *   2. They request a "Verified Brand" badge for their domain (admin reviews).
 *   3. WAB issues per-brand Ed25519 signing keys (private key encrypted at rest).
 *   4. They sign a short payload (target_url, amount, payee, expiry) → opaque token.
 *   5. The link they share is `https://www.webagentbridge.com/l/<token>`.
 *   6. Anyone (no install) opening that link gets the Trust Preview:
 *        — green:  brand verified, signature OK, not expired, no reports
 *        — yellow: signature OK but brand pending OR rate-limited reports
 *        — red:    signature failed / expired / revoked / heavily reported
 *
 * What stops impersonation?
 * -------------------------
 *   - Only the user who proved DNS ownership of `bank.example` can issue
 *     signed links carrying brand display name "Bank Example".
 *   - Display names are normalized + Levenshtein-checked against existing
 *     verified brands; lookalikes ("stcpayy" vs "stcpay") are rejected.
 *   - High-value targets (mada, paypal, stcpay, …) are pre-reserved in
 *     `shieldlink_name_holds` until the real brand claims them via DNS.
 *
 * Plan gating
 * -----------
 *   The customer routes require the `shieldlink` plan feature, granted on
 *   pro + enterprise tiers (see server/config/plans.js).
 */

'use strict';

const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const wabCrypto = require('./wab-crypto');
const { encryptOptional, decryptOptional } = require('../utils/secureFields');

// ─── DB ──────────────────────────────────────────────────────────────
const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? `wab-test-${process.env.JEST_WORKER_ID || '1'}.db` : 'wab.db';
let _db = null;
function db() {
  if (!_db) _db = new Database(path.join(DATA_DIR, DB_FILE));
  return _db;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9]/g, '');         // letters+digits only (kills spaces, punctuation, lookalike chars)
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const v0 = new Array(bl + 1);
  const v1 = new Array(bl + 1);
  for (let i = 0; i <= bl; i++) v0[i] = i;
  for (let i = 0; i < al; i++) {
    v1[0] = i + 1;
    for (let j = 0; j < bl; j++) {
      const cost = a.charCodeAt(i) === b.charCodeAt(j) ? 0 : 1;
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
    }
    for (let j = 0; j <= bl; j++) v0[j] = v1[j];
  }
  return v0[bl];
}

function genToken(bytes = 12) {
  return crypto.randomBytes(bytes).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Similarity / impersonation guard ───────────────────────────────

/**
 * Decides whether `displayName` (and `domain`) clashes with an existing
 * verified brand or a reserved name hold. Returns { ok, reason?, similarTo? }.
 *
 * Distance threshold:
 *   - Reject identical-when-normalized matches against a different domain.
 *   - Reject names within Levenshtein-distance 2 of any verified brand on
 *     a different domain.
 *   - Reject substring containment in either direction (e.g. "stcpayksa"
 *     contains "stcpay") unless the candidate IS the verified brand.
 */
function checkBrandSimilarity(displayName, domain) {
  const norm = normalizeName(displayName);
  if (norm.length < 3) return { ok: false, reason: 'display_name_too_short' };

  // 1. Hard-blocked names (banks, payment networks).
  const holds = db().prepare(`SELECT pattern, reason FROM shieldlink_name_holds WHERE pattern_kind = 'literal'`).all();
  for (const h of holds) {
    const hn = normalizeName(h.pattern);
    if (!hn) continue;
    // If candidate equals or contains a held name, the candidate must already
    // own the matching verified brand row. We let the caller (admin queue) be
    // the one to manually approve override after DNS proof.
    if (norm === hn || norm.includes(hn) || hn.includes(norm)) {
      // If a verified brand already exists on this exact domain with this
      // normalized name, that means it's the legitimate holder re-applying.
      const existing = db().prepare(
        `SELECT id FROM shieldlink_brands WHERE domain = ? AND status = 'verified'`
      ).get(domain);
      if (!existing) {
        return {
          ok: false,
          reason: 'reserved_name',
          reservedAs: h.pattern,
          note: h.reason || null,
        };
      }
    }
  }

  // 2. Existing verified brands on different domains.
  const verified = db().prepare(
    `SELECT id, domain, display_name, display_name_normalized FROM shieldlink_brands WHERE status = 'verified' AND domain != ?`
  ).all(domain);
  for (const v of verified) {
    const dist = levenshtein(norm, v.display_name_normalized);
    if (dist <= 2) {
      return {
        ok: false,
        reason: 'similar_to_verified_brand',
        similarTo: { domain: v.domain, display_name: v.display_name, distance: dist },
      };
    }
    if (norm !== v.display_name_normalized && (
      norm.includes(v.display_name_normalized) ||
      v.display_name_normalized.includes(norm)
    )) {
      return {
        ok: false,
        reason: 'name_overlap_with_verified_brand',
        similarTo: { domain: v.domain, display_name: v.display_name },
      };
    }
  }

  return { ok: true };
}

// ─── Brand lookup / keys ─────────────────────────────────────────────

function getBrandBySite(siteId) {
  return db().prepare(`SELECT * FROM shieldlink_brands WHERE site_id = ?`).get(siteId);
}

function getBrandById(id) {
  return db().prepare(`SELECT * FROM shieldlink_brands WHERE id = ?`).get(id);
}

function getBrandByDomain(domain) {
  return db().prepare(`SELECT * FROM shieldlink_brands WHERE domain = ?`).get(domain);
}

/**
 * Get or create the active signing keypair for a brand.
 * Private key is encrypted via secureFields if CREDENTIALS_ENCRYPTION_KEY is set.
 */
function getOrCreateActiveKey(brandId) {
  let row = db().prepare(
    `SELECT * FROM shieldlink_keys WHERE brand_id = ? AND active = 1 ORDER BY id DESC LIMIT 1`
  ).get(brandId);
  if (row) return row;

  const kp = wabCrypto.generateKeyPair();
  const encPriv = encryptOptional(kp.private_key) || kp.private_key;
  const info = db().prepare(
    `INSERT INTO shieldlink_keys (brand_id, public_key, private_key_enc, fingerprint, active)
     VALUES (?, ?, ?, ?, 1)`
  ).run(brandId, kp.public_key, encPriv, kp.fingerprint);
  return db().prepare(`SELECT * FROM shieldlink_keys WHERE id = ?`).get(info.lastInsertRowid);
}

function rotateKey(brandId) {
  db().prepare(`UPDATE shieldlink_keys SET active = 0, rotated_at = datetime('now') WHERE brand_id = ?`).run(brandId);
  return getOrCreateActiveKey(brandId);
}

// ─── Submit / approve / reject brand ─────────────────────────────────

function submitBrand({ siteId, domain, displayName, category, country, logoUrl }) {
  if (!siteId || !domain || !displayName) {
    return { ok: false, error: 'site_id, domain, display_name are required' };
  }
  // Block if site already has a brand
  const existing = db().prepare(`SELECT * FROM shieldlink_brands WHERE site_id = ? OR domain = ?`).get(siteId, domain);
  if (existing) {
    return { ok: false, error: 'brand_already_submitted', brand: existing };
  }
  // Similarity check
  const sim = checkBrandSimilarity(displayName, domain);
  if (!sim.ok) return { ok: false, error: sim.reason, similarTo: sim.similarTo, reservedAs: sim.reservedAs };

  const norm = normalizeName(displayName);
  const info = db().prepare(
    `INSERT INTO shieldlink_brands
       (site_id, domain, display_name, display_name_normalized, category, country, logo_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`
  ).run(siteId, String(domain).toLowerCase(), displayName, norm, category || null, country || null, logoUrl || null);
  return { ok: true, brand_id: info.lastInsertRowid };
}

function reviewBrand({ id, decision, reviewerId, notes, badgeLevel }) {
  if (!['verified', 'rejected', 'suspended', 'pending'].includes(decision)) {
    return { ok: false, error: 'invalid_decision' };
  }
  const verified_badge = decision === 'verified' ? 1 : 0;
  db().prepare(
    `UPDATE shieldlink_brands
       SET status = ?, verified_badge = ?, notes = ?, reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ?`
  ).run(decision, verified_badge, notes || null, reviewerId || null, id);

  // Pre-create a signing key on first verification so the next /sign call is fast.
  if (decision === 'verified') getOrCreateActiveKey(id);
  return { ok: true };
}

// ─── Sign / verify links ─────────────────────────────────────────────

function signLink({ siteId, purpose, targetUrl, amountCents, currency, payeeName, reference, expiresInSec, createdBy }) {
  if (!siteId) return { ok: false, error: 'site_id_required' };
  if (!['payment', 'invoice', 'login', 'generic'].includes(purpose || '')) {
    return { ok: false, error: 'invalid_purpose' };
  }
  if (!/^https?:\/\//i.test(targetUrl || '')) return { ok: false, error: 'invalid_target_url' };

  const brand = getBrandBySite(siteId);
  if (!brand) return { ok: false, error: 'brand_not_registered' };
  if (brand.status === 'suspended' || brand.status === 'rejected') {
    return { ok: false, error: 'brand_' + brand.status };
  }

  const ttl = Math.max(60, Math.min(parseInt(expiresInSec, 10) || 24 * 3600, 30 * 24 * 3600));
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const token = genToken(12);

  const payload = {
    v: 1,
    token,
    brand_id: brand.id,
    domain: brand.domain,
    display_name: brand.display_name,
    purpose,
    target_url: targetUrl,
    amount_cents: amountCents != null ? Number(amountCents) : null,
    currency: currency || null,
    payee_name: payeeName || null,
    reference: reference || null,
    expires_at: expiresAt,
  };

  const key = getOrCreateActiveKey(brand.id);
  const priv = decryptOptional(key.private_key_enc);
  const signed = wabCrypto.signManifest(payload, priv, { key_id: key.fingerprint });

  db().prepare(
    `INSERT INTO shieldlink_links
      (token, brand_id, site_id, target_url, purpose, amount_cents, currency, payee_name, reference,
       signature, key_id, payload_json, status, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    token, brand.id, siteId, targetUrl, purpose,
    payload.amount_cents, payload.currency, payload.payee_name, payload.reference,
    signed.signature.value, key.fingerprint, JSON.stringify(signed),
    expiresAt, createdBy || null
  );

  return {
    ok: true,
    token,
    url: publicLinkUrl(token),
    expires_at: expiresAt,
    key_id: key.fingerprint,
    brand: { id: brand.id, domain: brand.domain, display_name: brand.display_name, verified_badge: !!brand.verified_badge },
  };
}

function publicLinkUrl(token) {
  const base = (process.env.PUBLIC_BASE_URL || 'https://www.webagentbridge.com').replace(/\/$/, '');
  return `${base}/l/${token}`;
}

/**
 * Verify a token. Returns a structured Trust Preview record:
 *   { ok, level: 'green'|'yellow'|'red', reasons:[], brand, link, signature_valid, ... }
 */
function verifyToken(token) {
  const link = db().prepare(`SELECT * FROM shieldlink_links WHERE token = ?`).get(token);
  if (!link) return { ok: false, level: 'red', reasons: ['unknown_token'] };
  const brand = getBrandById(link.brand_id);
  if (!brand) return { ok: false, level: 'red', reasons: ['brand_missing'] };

  const reasons = [];
  let level = 'green';
  let signatureValid = false;

  // Signature check
  try {
    const payload = JSON.parse(link.payload_json);
    // Find the key that signed it (by fingerprint)
    const key = db().prepare(`SELECT public_key, fingerprint FROM shieldlink_keys WHERE brand_id = ? AND fingerprint = ?`).get(brand.id, link.key_id);
    if (!key) {
      reasons.push('signing_key_unknown');
      level = 'red';
    } else {
      const v = wabCrypto.verifyManifest(payload, key.public_key);
      signatureValid = !!v.ok;
      if (!signatureValid) {
        reasons.push('signature_invalid:' + (v.reason || 'unknown'));
        level = 'red';
      }
    }
  } catch (e) {
    reasons.push('payload_parse_error');
    level = 'red';
  }

  // Status / expiry
  if (link.status === 'revoked') { reasons.push('revoked'); level = 'red'; }
  if (link.status === 'expired' || (link.expires_at && new Date(link.expires_at).getTime() < Date.now())) {
    reasons.push('expired'); level = 'red';
  }

  // Brand status
  if (brand.status === 'suspended') { reasons.push('brand_suspended'); level = 'red'; }
  if (brand.status === 'pending') { reasons.push('brand_unverified'); if (level === 'green') level = 'yellow'; }
  if (brand.status === 'rejected') { reasons.push('brand_rejected'); level = 'red'; }

  // Reports against this link
  const reports = db().prepare(`SELECT COUNT(*) AS n FROM shieldlink_reports WHERE link_id = ? AND status IN ('open','reviewing')`).get(link.id).n;
  if (reports >= 5) { reasons.push('many_reports'); level = 'red'; }
  else if (reports > 0) { reasons.push('has_reports'); if (level === 'green') level = 'yellow'; }

  // Domain consistency between target_url and brand.domain
  let targetHost = null;
  try { targetHost = new URL(link.target_url).hostname.toLowerCase(); } catch {}
  const brandDomain = String(brand.domain || '').toLowerCase();
  const domainMatches = targetHost && (targetHost === brandDomain || targetHost.endsWith('.' + brandDomain));
  if (!domainMatches) {
    reasons.push('target_off_brand_domain');
    if (level === 'green') level = 'yellow';
  }

  return {
    ok: true,
    level,
    signature_valid: signatureValid,
    reasons,
    brand: {
      id: brand.id,
      domain: brand.domain,
      display_name: brand.display_name,
      verified_badge: !!brand.verified_badge,
      category: brand.category,
      country: brand.country,
      logo_url: brand.logo_url,
      reputation: brand.reputation,
      status: brand.status,
    },
    link: {
      token: link.token,
      purpose: link.purpose,
      target_url: link.target_url,
      target_host: targetHost,
      target_host_matches_brand: !!domainMatches,
      amount_cents: link.amount_cents,
      currency: link.currency,
      payee_name: link.payee_name,
      reference: link.reference,
      status: link.status,
      expires_at: link.expires_at,
      created_at: link.created_at,
      reports_open: reports,
    },
  };
}

function recordEvent(token, event, { ip, userAgent, ref } = {}) {
  const link = db().prepare(`SELECT id FROM shieldlink_links WHERE token = ?`).get(token);
  if (!link) return false;
  db().prepare(
    `INSERT INTO shieldlink_link_events (link_id, event, ip, user_agent, ref) VALUES (?, ?, ?, ?, ?)`
  ).run(link.id, event, ip || null, userAgent || null, ref || null);
  return true;
}

function reportLink({ token, url, reason, reporterIp, reporterId }) {
  let linkId = null;
  let resolvedUrl = url || null;
  if (token) {
    const r = db().prepare(`SELECT id, target_url FROM shieldlink_links WHERE token = ?`).get(token);
    if (r) { linkId = r.id; if (!resolvedUrl) resolvedUrl = r.target_url; }
  }
  if (!resolvedUrl) return { ok: false, error: 'url_or_token_required' };
  const info = db().prepare(
    `INSERT INTO shieldlink_reports (link_id, url, reason, reporter_ip, reporter_id) VALUES (?, ?, ?, ?, ?)`
  ).run(linkId, resolvedUrl, reason || null, reporterIp || null, reporterId || null);
  return { ok: true, id: info.lastInsertRowid };
}

function revokeLink(linkId, reason) {
  db().prepare(
    `UPDATE shieldlink_links SET status = 'revoked', revoked_at = datetime('now'), revoke_reason = ? WHERE id = ?`
  ).run(reason || null, linkId);
}

// ─── Listing helpers ────────────────────────────────────────────────

function listLinksForSite(siteId, { limit = 100, status = null } = {}) {
  const cap = Math.min(parseInt(limit, 10) || 100, 500);
  if (status) {
    return db().prepare(
      `SELECT id, token, purpose, target_url, amount_cents, currency, payee_name, reference, status, expires_at, created_at
         FROM shieldlink_links WHERE site_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(siteId, status, cap);
  }
  return db().prepare(
    `SELECT id, token, purpose, target_url, amount_cents, currency, payee_name, reference, status, expires_at, created_at
       FROM shieldlink_links WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`
  ).all(siteId, cap);
}

function listBrands({ status = null, limit = 100 } = {}) {
  const cap = Math.min(parseInt(limit, 10) || 100, 500);
  if (status) {
    return db().prepare(
      `SELECT * FROM shieldlink_brands WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(status, cap);
  }
  return db().prepare(`SELECT * FROM shieldlink_brands ORDER BY created_at DESC LIMIT ?`).all(cap);
}

function listReports({ status = null, limit = 100 } = {}) {
  const cap = Math.min(parseInt(limit, 10) || 100, 500);
  if (status) {
    return db().prepare(
      `SELECT * FROM shieldlink_reports WHERE status = ? ORDER BY created_at DESC LIMIT ?`
    ).all(status, cap);
  }
  return db().prepare(`SELECT * FROM shieldlink_reports ORDER BY created_at DESC LIMIT ?`).all(cap);
}

function getStats() {
  const D = db();
  const brands = D.prepare(`SELECT status, COUNT(*) AS n FROM shieldlink_brands GROUP BY status`).all();
  const links = D.prepare(`SELECT status, COUNT(*) AS n FROM shieldlink_links GROUP BY status`).all();
  const reports = D.prepare(`SELECT status, COUNT(*) AS n FROM shieldlink_reports GROUP BY status`).all();
  const events24h = D.prepare(`SELECT event, COUNT(*) AS n FROM shieldlink_link_events WHERE created_at >= datetime('now','-1 day') GROUP BY event`).all();
  const totalLinks = D.prepare(`SELECT COUNT(*) AS n FROM shieldlink_links`).get().n;
  return { brands, links, reports, events24h, totalLinks };
}

module.exports = {
  // brand
  submitBrand,
  reviewBrand,
  getBrandBySite,
  getBrandByDomain,
  getBrandById,
  checkBrandSimilarity,
  listBrands,
  // keys
  getOrCreateActiveKey,
  rotateKey,
  // links
  signLink,
  verifyToken,
  recordEvent,
  reportLink,
  revokeLink,
  listLinksForSite,
  listReports,
  publicLinkUrl,
  // misc
  normalizeName,
  levenshtein,
  getStats,
};
