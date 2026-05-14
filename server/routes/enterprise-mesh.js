// ═══════════════════════════════════════════════════════════════════════════
// WAB Enterprise Mesh — license verification (open-source side)
//
//   The issuance / signing service is operated separately and ships only to
//   paying enterprise customers. This module performs *verification only*:
//
//   POST  /api/enterprise-mesh/verify        — verify a signed Ed25519 license token
//   GET   /api/enterprise-mesh/jwks          — public verification keys
//   POST  /api/enterprise-mesh/heartbeat     — record a node heartbeat (telemetry)
//   POST  /api/enterprise-mesh/admin/register — admin records an issued license
//   POST  /api/enterprise-mesh/admin/revoke   — admin marks a license revoked
//
//   License format (compact, base64url chunks):  payload.signature.kid
//   payload = { lid, org, tier, seats, features, iat, exp }
//   signature = Ed25519(payload, WAB_LICENSE_SIGN_SK)   ← signing happens elsewhere
//
//   Public keys come from WAB_LICENSE_PUBLIC_KEYS env (JSON map kid→PEM/raw-b64u).
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../models/db');

const router = express.Router();

function adminGate(req, res, next) {
  const expected = process.env.WAB_LICENSE_ADMIN_TOKEN || process.env.WAB_RING4_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  if ((req.headers['x-admin-token'] || '') !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function loadPublicKeys() {
  const raw = process.env.WAB_LICENSE_PUBLIC_KEYS;
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function b64uDecode(s) { return Buffer.from(String(s).replace(/-/g,'+').replace(/_/g,'/'), 'base64'); }

function fingerprint(payloadStr) {
  return crypto.createHash('sha256').update(payloadStr).digest('hex');
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'malformed' };
  const parts = token.split('.');
  const [payloadB64, sigB64, kid] = parts;
  if (!payloadB64 || !sigB64) return { ok: false, reason: 'malformed' };
  const keys = loadPublicKeys();
  let candidates;
  if (kid && keys[kid]) candidates = [{ kid, pem: keys[kid] }];
  else candidates = Object.entries(keys).map(([k,v]) => ({ kid: k, pem: v }));
  if (candidates.length === 0) return { ok: false, reason: 'no_public_keys_configured' };

  let payloadStr;
  try { payloadStr = b64uDecode(payloadB64).toString('utf8'); }
  catch { return { ok: false, reason: 'payload_decode_failed' }; }
  let payload;
  try { payload = JSON.parse(payloadStr); }
  catch { return { ok: false, reason: 'payload_json_failed' }; }
  const sig = b64uDecode(sigB64);

  for (const c of candidates) {
    try {
      let pubKey;
      const pem = c.pem;
      if (typeof pem === 'string' && pem.startsWith('-----BEGIN')) {
        pubKey = crypto.createPublicKey(pem);
      } else {
        const raw = b64uDecode(pem);
        // SPKI prefix for Ed25519 (RFC 8410)
        pubKey = crypto.createPublicKey({
          key: Buffer.concat([Buffer.from('302a300506032b6570032100','hex'), raw]),
          format: 'der', type: 'spki'
        });
      }
      if (crypto.verify(null, Buffer.from(payloadStr, 'utf8'), pubKey, sig)) {
        return { ok: true, payload, kid: c.kid, fingerprint: fingerprint(payloadStr) };
      }
    } catch { /* try next */ }
  }
  return { ok: false, reason: 'signature_invalid' };
}

// ─────────────────────────────────────────────────────────────────────────────
router.post('/verify', (req, res) => {
  const token = (req.body || {}).token;
  const v = verifyToken(token);
  if (!v.ok) return res.status(400).json({ valid: false, reason: v.reason });
  const p = v.payload;
  const now = Math.floor(Date.now()/1000);
  if (p.exp && now > p.exp) return res.json({ valid: false, reason: 'expired', exp: p.exp });
  if (p.lid) {
    const row = db.prepare(`SELECT status, revoked_reason FROM wab_licenses WHERE license_id = ?`).get(p.lid);
    if (row && row.status === 'revoked') return res.json({ valid: false, reason: 'revoked', revoked_reason: row.revoked_reason });
  }
  res.json({
    valid: true,
    license_id: p.lid,
    org: p.org,
    tier: p.tier,
    seats: p.seats,
    features: p.features || [],
    issued_at: p.iat,
    expires_at: p.exp,
    fingerprint: v.fingerprint,
    kid: v.kid
  });
});

router.get('/jwks', (req, res) => {
  const keys = loadPublicKeys();
  res.json({
    keys: Object.entries(keys).map(([kid, val]) => ({
      kid, kty: 'OKP', crv: 'Ed25519', use: 'sig',
      x: typeof val === 'string' && val.startsWith('-----BEGIN') ? undefined : val,
      pem: typeof val === 'string' && val.startsWith('-----BEGIN') ? val : undefined
    }))
  });
});

router.post('/heartbeat', (req, res) => {
  const token = (req.body || {}).token;
  const v = verifyToken(token);
  if (!v.ok) return res.status(401).json({ ok: false, reason: v.reason });
  const p = v.payload;
  if (!p.lid) return res.status(400).json({ ok: false, reason: 'lid_missing' });
  try {
    db.prepare(`
      INSERT INTO wab_licenses (license_id, fingerprint, tier, owner_org, contact_email, seats, features, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(license_id) DO NOTHING
    `).run(p.lid, v.fingerprint, p.tier || 'enterprise', p.org || 'unknown', 'noc@local',
           p.seats || 1, JSON.stringify(p.features || []),
           new Date((p.iat||0)*1000).toISOString(), new Date((p.exp||0)*1000).toISOString());
  } catch { /* ignore */ }
  res.json({ ok: true, license_id: p.lid, at: new Date().toISOString() });
});

router.post('/admin/register', adminGate, (req, res) => {
  const b = req.body || {};
  if (!b.license_id || !b.owner_org || !b.contact_email || !b.issued_at || !b.expires_at) {
    return res.status(400).json({ error: 'license_id + owner_org + contact_email + issued_at + expires_at required' });
  }
  try {
    db.prepare(`
      INSERT INTO wab_licenses (license_id, fingerprint, tier, owner_org, contact_email, seats, features, issued_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(b.license_id, b.fingerprint || 'unknown', String(b.tier || 'enterprise'),
           b.owner_org, b.contact_email, parseInt(b.seats,10) || 1,
           JSON.stringify(b.features || []), b.issued_at, b.expires_at);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'license_already_registered' });
    return res.status(500).json({ error: 'register_failed', detail: e.message });
  }
  res.json({ ok: true, license_id: b.license_id });
});

router.post('/admin/revoke', adminGate, (req, res) => {
  const { license_id, reason } = req.body || {};
  if (!license_id) return res.status(400).json({ error: 'license_id required' });
  const r = db.prepare(`UPDATE wab_licenses SET status='revoked', revoked_at=datetime('now'), revoked_reason=? WHERE license_id=?`).run(String(reason||'').slice(0,200), license_id);
  if (r.changes === 0) return res.status(404).json({ error: 'license_not_found' });
  res.json({ ok: true, license_id, status: 'revoked' });
});

module.exports = router;
