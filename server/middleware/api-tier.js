// ═══════════════════════════════════════════════════════════════════════════
// WAB Trust Graph — API tier middleware
//
//   Reads X-API-Key (or ?api_key=) and enforces:
//     • per-key per-minute rate limit
//     • per-key per-month quota
//     • scope check (each route declares required scope)
//
//   When no key is presented, the request is treated as anonymous "free" with
//   a low public allowance — keeping the API explorable but unattractive for
//   abuse. Routes that require a specific scope must use enforceScope().
//
//   Usage record is best-effort: write failures never block requests.
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const crypto = require('crypto');
const { db } = require('../models/db');

const ANON_TIER = Object.freeze({
  key_id:        null,
  tier:          'anonymous',
  monthly_quota: 200,
  rate_per_min:  10,
  scopes:        ['trust:read']
});

// In-process rate buckets — sliding window (one minute).
const buckets = new Map();
function rateOk(keyId, rate) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const arr = buckets.get(keyId) || [];
  const pruned = arr.filter(t => t > cutoff);
  if (pruned.length >= rate) {
    buckets.set(keyId, pruned);
    return false;
  }
  pruned.push(now);
  buckets.set(keyId, pruned);
  return true;
}

function hashKey(secret) {
  return crypto.createHash('sha256').update(String(secret), 'utf8').digest('hex');
}

function extractKey(req) {
  const h = req.headers['x-api-key'];
  if (typeof h === 'string' && h.length >= 24) return h.trim();
  if (typeof req.query.api_key === 'string' && req.query.api_key.length >= 24) return req.query.api_key.trim();
  return null;
}

function loadKey(secret) {
  if (!secret) return null;
  try {
    return db.prepare(`
      SELECT key_id, tier, monthly_quota, rate_per_min, scopes, status
      FROM wab_api_keys WHERE key_hash = ?
    `).get(hashKey(secret));
  } catch { return null; }
}

function monthOf(d = new Date()) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}
function dayOf(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function monthUsage(keyId) {
  if (!keyId) return 0;
  const since = monthOf() + '-01';
  try {
    const row = db.prepare(`SELECT COALESCE(SUM(count),0) AS n FROM wab_api_usage WHERE key_id = ? AND day >= ?`).get(keyId, since);
    return row ? row.n : 0;
  } catch { return 0; }
}

function recordUsage(keyId, endpoint, bytesOut) {
  if (!keyId) return;
  try {
    db.prepare(`
      INSERT INTO wab_api_usage (key_id, day, endpoint, count, bytes_out)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(key_id, day, endpoint) DO UPDATE SET
        count = count + 1,
        bytes_out = bytes_out + excluded.bytes_out
    `).run(keyId, dayOf(), endpoint.slice(0, 120), Math.max(0, bytesOut|0));
    db.prepare(`UPDATE wab_api_keys SET last_used_at = datetime('now') WHERE key_id = ?`).run(keyId);
  } catch { /* swallow */ }
}

function apiTierMiddleware(req, res, next) {
  const secret = extractKey(req);
  let tierInfo;
  if (secret) {
    const row = loadKey(secret);
    if (!row) {
      return res.status(401).json({ error: 'invalid_api_key' });
    }
    if (row.status !== 'active') {
      return res.status(403).json({ error: 'api_key_' + row.status });
    }
    let scopes;
    try { scopes = JSON.parse(row.scopes); } catch { scopes = []; }
    tierInfo = {
      key_id: row.key_id,
      tier: row.tier,
      monthly_quota: row.monthly_quota,
      rate_per_min: row.rate_per_min,
      scopes: Array.isArray(scopes) ? scopes : []
    };
  } else {
    tierInfo = { ...ANON_TIER };
  }

  // Rate
  const bucketId = tierInfo.key_id || ('anon:' + (req.ip || 'unknown'));
  if (!rateOk(bucketId, tierInfo.rate_per_min)) {
    res.set('Retry-After', '60');
    return res.status(429).json({ error: 'rate_limited', tier: tierInfo.tier, rate_per_min: tierInfo.rate_per_min });
  }

  // Quota (skip for anonymous — IP-rate is enough; quota requires identity)
  if (tierInfo.key_id) {
    const used = monthUsage(tierInfo.key_id);
    if (used >= tierInfo.monthly_quota) {
      return res.status(402).json({
        error: 'quota_exceeded',
        tier: tierInfo.tier,
        monthly_quota: tierInfo.monthly_quota,
        used,
        upgrade: 'https://www.webagentbridge.com/trust-graph-api'
      });
    }
    res.set('X-WAB-Quota-Used', String(used));
    res.set('X-WAB-Quota-Limit', String(tierInfo.monthly_quota));
  }

  req.apiTier = tierInfo;
  res.set('X-WAB-Tier', tierInfo.tier);

  // Record on response finish (best-effort)
  res.once('finish', () => {
    const bytes = parseInt(res.get('content-length') || '0', 10) || 0;
    recordUsage(tierInfo.key_id, (req.baseUrl || '') + (req.path || req.url || ''), bytes);
  });

  next();
}

function enforceScope(requiredScope) {
  return function (req, res, next) {
    const tier = req.apiTier || ANON_TIER;
    if (!tier.scopes.includes(requiredScope)) {
      return res.status(403).json({
        error: 'scope_required',
        required: requiredScope,
        granted: tier.scopes,
        tier: tier.tier
      });
    }
    next();
  };
}

module.exports = { apiTierMiddleware, enforceScope, hashKey, _internals: { rateOk, monthUsage } };
