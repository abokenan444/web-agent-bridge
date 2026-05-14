// ═══════════════════════════════════════════════════════════════════════════
// WAB Trust Graph API — key issuance & administration
//
//   POST  /api/keys/issue            — self-serve Free tier (rate-limited)
//   GET   /api/keys/me               — show usage for the presented key
//   POST  /api/keys/revoke           — owner-side revocation
//   POST  /api/keys/admin/upgrade    — admin upgrades a key tier (Pro/Enterprise)
//   GET   /api/keys/admin/list       — admin index
//
//   Secret format: "wabk_<keyId>_<random>" — only the sha256 hash is stored.
//   A presented secret is rejected unless its hash matches a row marked active.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../models/db');
const { hashKey } = require('../middleware/api-tier');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TIER_DEFAULTS = {
  free:       { monthly_quota: 1_000,    rate_per_min: 30,  scopes: ['trust:read'] },
  pro:        { monthly_quota: 100_000,  rate_per_min: 120, scopes: ['trust:read','trust:history','reputation:read'] },
  enterprise: { monthly_quota: 5_000_000,rate_per_min: 600, scopes: ['trust:read','trust:history','reputation:read','governance:write','sla:priority'] }
};

// Issuance rate guard — 5 free keys per IP per hour to prevent abuse.
const issueLog = new Map();
function issueOk(ip) {
  const now = Date.now();
  const arr = (issueLog.get(ip) || []).filter(t => t > now - 3_600_000);
  if (arr.length >= 5) return false;
  arr.push(now); issueLog.set(ip, arr); return true;
}

function adminGate(req, res, next) {
  const expected = process.env.WAB_API_KEYS_ADMIN_TOKEN || process.env.WAB_RING4_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  if ((req.headers['x-admin-token'] || '') !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function newKey(tier) {
  const keyId = 'k_' + crypto.randomBytes(6).toString('base64url');
  const secret = `wabk_${keyId}_${crypto.randomBytes(24).toString('base64url')}`;
  const d = TIER_DEFAULTS[tier] || TIER_DEFAULTS.free;
  return { keyId, secret, ...d };
}

// ─────────────────────────────────────────────────────────────────────────────
router.post('/issue', (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const name  = String((req.body || {}).name  || '').slice(0, 80);
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid email' });
  if (!issueOk(req.ip || 'unknown')) return res.status(429).json({ error: 'too_many_requests' });

  // One active free key per email is enough; soft-cap at 3.
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM wab_api_keys WHERE owner_email = ? AND tier = 'free' AND status = 'active'`).get(email);
  if (existing.n >= 3) return res.status(409).json({ error: 'too_many_keys_for_email', max: 3 });

  const k = newKey('free');
  try {
    db.prepare(`
      INSERT INTO wab_api_keys (key_id, key_hash, owner_email, owner_name, tier, monthly_quota, rate_per_min, scopes)
      VALUES (?, ?, ?, ?, 'free', ?, ?, ?)
    `).run(k.keyId, hashKey(k.secret), email, name, k.monthly_quota, k.rate_per_min, JSON.stringify(k.scopes));
  } catch (e) { return res.status(500).json({ error: 'issue_failed', detail: e.message }); }

  res.json({
    ok: true,
    key_id: k.keyId,
    api_key: k.secret,           // shown ONCE — client must store
    tier: 'free',
    monthly_quota: k.monthly_quota,
    rate_per_min: k.rate_per_min,
    scopes: k.scopes,
    notice: 'Store this secret now — it cannot be retrieved later.'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', (req, res) => {
  const secret = (req.headers['x-api-key'] || '').toString();
  if (!secret) return res.status(401).json({ error: 'missing X-API-Key' });
  const row = db.prepare(`SELECT key_id, owner_email, tier, monthly_quota, rate_per_min, scopes, status, last_used_at, created_at FROM wab_api_keys WHERE key_hash = ?`).get(hashKey(secret));
  if (!row) return res.status(401).json({ error: 'invalid_api_key' });
  const month = new Date().toISOString().slice(0,7) + '-01';
  const usage = db.prepare(`SELECT COALESCE(SUM(count),0) AS used FROM wab_api_usage WHERE key_id = ? AND day >= ?`).get(row.key_id, month);
  res.json({ ...row, scopes: JSON.parse(row.scopes), used_this_month: usage.used });
});

// ─────────────────────────────────────────────────────────────────────────────
router.post('/revoke', (req, res) => {
  const secret = (req.headers['x-api-key'] || '').toString();
  if (!secret) return res.status(401).json({ error: 'missing X-API-Key' });
  const row = db.prepare(`SELECT key_id FROM wab_api_keys WHERE key_hash = ? AND status = 'active'`).get(hashKey(secret));
  if (!row) return res.status(404).json({ error: 'not_found_or_inactive' });
  db.prepare(`UPDATE wab_api_keys SET status='revoked', revoked_at=datetime('now') WHERE key_id = ?`).run(row.key_id);
  res.json({ ok: true, key_id: row.key_id, status: 'revoked' });
});

// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/upgrade', adminGate, (req, res) => {
  const { key_id, tier, scopes, monthly_quota, rate_per_min } = req.body || {};
  if (!key_id || !TIER_DEFAULTS[tier]) return res.status(400).json({ error: 'key_id + valid tier required' });
  const defaults = TIER_DEFAULTS[tier];
  const q = Number.isFinite(+monthly_quota) ? +monthly_quota : defaults.monthly_quota;
  const r = Number.isFinite(+rate_per_min)  ? +rate_per_min  : defaults.rate_per_min;
  const s = Array.isArray(scopes) ? scopes.filter(x => typeof x === 'string').slice(0, 20) : defaults.scopes;
  const result = db.prepare(`UPDATE wab_api_keys SET tier=?, monthly_quota=?, rate_per_min=?, scopes=? WHERE key_id=?`).run(tier, q, r, JSON.stringify(s), key_id);
  if (result.changes === 0) return res.status(404).json({ error: 'key_not_found' });
  res.json({ ok: true, key_id, tier, monthly_quota: q, rate_per_min: r, scopes: s });
});

router.get('/admin/list', adminGate, (req, res) => {
  const tier = req.query.tier && TIER_DEFAULTS[req.query.tier] ? String(req.query.tier) : null;
  const rows = tier
    ? db.prepare(`SELECT key_id, owner_email, tier, monthly_quota, status, last_used_at, created_at FROM wab_api_keys WHERE tier = ? ORDER BY created_at DESC LIMIT 500`).all(tier)
    : db.prepare(`SELECT key_id, owner_email, tier, monthly_quota, status, last_used_at, created_at FROM wab_api_keys ORDER BY created_at DESC LIMIT 500`).all();
  res.json({ keys: rows });
});

module.exports = router;
