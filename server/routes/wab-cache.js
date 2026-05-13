/**
 * server/routes/wab-cache.js
 * WAB Memory Cache Layer + Offline Mode + Sync
 *
 * Mounted at /api/cache and /api/offline
 *
 * Memory Cache Layer:
 *   GET  /api/cache/manifest/:domain          — Versioned manifest fetch with ETag
 *   POST /api/cache/validate                  — Batch-validate cached domains
 *   GET  /api/cache/status/:domain            — Single-domain freshness check
 *   POST /api/cache/store                     — Agent pushes a manifest to cache registry
 *
 * Offline Mode + Sync:
 *   GET  /api/offline/status/:domain          — Check if cached version is stale
 *   POST /api/offline/sync                    — Bulk sync: send {domains:[...], cached_etags:{}}
 *   GET  /api/offline/bundle                  — Download offline bundle (JSON) for given domains
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const cacheRouter   = express.Router();
const offlineRouter = express.Router();
const { db }  = require('../models/db');
const { safeFetch } = require('../utils/safe-fetch');

// ─── Schema bootstrap ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS manifest_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    etag TEXT NOT NULL, manifest_json TEXT NOT NULL, content_hash TEXT NOT NULL,
    key_id TEXT, issued_at TEXT, expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_manifest_ver_domain ON manifest_versions(domain, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_manifest_ver_etag ON manifest_versions(domain, etag);
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normDomain(d) {
  return String(d || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}
function validDomain(d) {
  return /^[a-z0-9.-]{3,253}$/.test(d) && d.includes('.');
}

function etag(json) {
  return crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
}

function isFresh(row) {
  if (!row) return false;
  // Check expires_at from manifest
  if (row.expires_at) {
    return new Date(row.expires_at) > new Date();
  }
  // Default freshness: 24 hours from cache time
  return (Date.now() - new Date(row.created_at).getTime()) < 24 * 3600 * 1000;
}

/**
 * Fetch wab.json from a live domain and store a versioned snapshot.
 * Returns { row, fresh, fetched } or null on error.
 */
async function fetchAndStoreManifest(domain) {
  const urls = [
    `https://${domain}/.well-known/wab.json`,
    `https://www.${domain}/.well-known/wab.json`,
  ];
  for (const url of urls) {
    try {
      const resp = await safeFetch(url, { timeout: 8000 });
      if (!resp.ok) continue;
      const text = await resp.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch (_) { continue; }
      const json = JSON.stringify(parsed);
      const hash = crypto.createHash('sha256').update(json).digest('hex');
      const tag  = hash.slice(0, 16);

      const existing = db.prepare(`SELECT id FROM manifest_versions WHERE domain=? AND etag=?`).get(domain, tag);
      if (!existing) {
        db.prepare(`INSERT OR IGNORE INTO manifest_versions (domain, etag, manifest_json, content_hash, key_id, issued_at, expires_at) VALUES (?,?,?,?,?,?,?)`)
          .run(domain, tag, json, hash, parsed.signature?.key_id || null, parsed.issued_at || null, parsed.expires_at || null);
      }

      const row = db.prepare(`SELECT * FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
      return { row, fresh: true, fetched: true };
    } catch (_) {}
  }
  return null;
}

// ─── Cache endpoints ──────────────────────────────────────────────────────────

// GET /api/cache/manifest/:domain
cacheRouter.get('/manifest/:domain', async (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  const force = req.query.force === '1';
  let row = db.prepare(`SELECT * FROM manifest_versions WHERE domain = ? ORDER BY created_at DESC LIMIT 1`).get(domain);

  if (!row || !isFresh(row) || force) {
    const fetched = await fetchAndStoreManifest(domain);
    if (fetched) row = fetched.row;
  }

  if (!row) return res.status(404).json({ error: 'manifest_not_found', domain, hint: 'Domain has no registered WAB manifest.' });

  // ETag + conditional GET support
  const clientEtag = req.headers['if-none-match'];
  if (clientEtag && clientEtag === `"${row.etag}"`) {
    return res.status(304).end();
  }

  res.setHeader('ETag', `"${row.etag}"`);
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-WAB-Cache-Version', row.id);
  res.setHeader('X-WAB-Cached-At', row.created_at);

  let manifest;
  try { manifest = JSON.parse(row.manifest_json); } catch (_) { return res.status(500).json({ error: 'parse_error' }); }

  return res.json({
    domain, etag: row.etag, content_hash: row.content_hash,
    cached_at: row.created_at, expires_at: row.expires_at,
    fresh: isFresh(row), manifest,
  });
});

// POST /api/cache/validate — batch ETag validation
cacheRouter.post('/validate', express.json({ limit: '16kb' }), async (req, res) => {
  const { domains } = req.body || {};
  if (!Array.isArray(domains) || domains.length === 0)
    return res.status(400).json({ error: 'domains must be a non-empty array' });
  if (domains.length > 50) return res.status(400).json({ error: 'max 50 domains per request' });

  const results = {};
  for (const entry of domains) {
    const domain = normDomain(typeof entry === 'string' ? entry : entry.domain);
    const cachedEtag = typeof entry === 'object' ? entry.etag : null;
    if (!validDomain(domain)) { results[domain] = { valid: false, error: 'invalid_domain' }; continue; }

    const row = db.prepare(`SELECT etag, created_at, expires_at, content_hash FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
    if (!row) {
      results[domain] = { valid: false, reason: 'not_cached', fresh: false };
      continue;
    }
    const fresh = isFresh(row);
    const match = cachedEtag ? (cachedEtag === row.etag) : true;
    results[domain] = { valid: true, fresh, etag_match: match, etag: row.etag, cached_at: row.created_at, expires_at: row.expires_at };
  }

  return res.json({ results, validated_at: new Date().toISOString() });
});

// GET /api/cache/status/:domain
cacheRouter.get('/status/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const row = db.prepare(`SELECT etag, content_hash, created_at, expires_at FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
  if (!row) return res.json({ domain, cached: false, fresh: false });

  const fresh = isFresh(row);
  const ageMs = Date.now() - new Date(row.created_at).getTime();
  return res.json({ domain, cached: true, fresh, etag: row.etag, content_hash: row.content_hash, cached_at: row.created_at, expires_at: row.expires_at, age_seconds: Math.floor(ageMs / 1000) });
});

// POST /api/cache/store — Agent pushes a manifest they fetched
cacheRouter.post('/store', express.json({ limit: '64kb' }), (req, res) => {
  const { domain, manifest } = req.body || {};
  if (!domain || !manifest || typeof manifest !== 'object')
    return res.status(400).json({ error: 'missing fields: domain, manifest' });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });

  const json = JSON.stringify(manifest);
  const hash = crypto.createHash('sha256').update(json).digest('hex');
  const tag  = hash.slice(0, 16);

  db.prepare(`INSERT OR IGNORE INTO manifest_versions (domain, etag, manifest_json, content_hash, key_id, issued_at, expires_at) VALUES (?,?,?,?,?,?,?)`)
    .run(d, tag, json, hash, manifest.signature?.key_id || null, manifest.issued_at || null, manifest.expires_at || null);

  return res.status(201).json({ ok: true, domain: d, etag: tag, content_hash: hash });
});

// ─── Offline Mode + Sync ──────────────────────────────────────────────────────

// GET /api/offline/status/:domain
offlineRouter.get('/status/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const row = db.prepare(`SELECT etag, created_at, expires_at FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
  if (!row) return res.json({ domain, offline_ready: false, reason: 'no_cached_manifest' });

  const fresh = isFresh(row);
  const expiresIn = row.expires_at ? Math.floor((new Date(row.expires_at) - Date.now()) / 1000) : null;
  return res.json({
    domain, offline_ready: true, fresh, etag: row.etag,
    cached_at: row.created_at, expires_at: row.expires_at,
    expires_in_seconds: expiresIn,
    should_sync: !fresh,
    checked_at: new Date().toISOString(),
  });
});

// POST /api/offline/sync — bulk sync check
offlineRouter.post('/sync', express.json({ limit: '16kb' }), async (req, res) => {
  const { domains = [], cached_etags = {} } = req.body || {};
  if (!Array.isArray(domains) || domains.length === 0)
    return res.status(400).json({ error: 'domains must be a non-empty array' });
  if (domains.length > 30) return res.status(400).json({ error: 'max 30 domains per sync' });

  const updates = [];
  const upToDate = [];
  const notFound = [];

  for (const rawDomain of domains) {
    const domain = normDomain(rawDomain);
    if (!validDomain(domain)) continue;

    const row = db.prepare(`SELECT * FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
    if (!row) { notFound.push(domain); continue; }

    const clientEtag = cached_etags[domain] || cached_etags[rawDomain];
    if (clientEtag && clientEtag === row.etag && isFresh(row)) {
      upToDate.push(domain);
    } else {
      // Need to update: return new manifest
      let manifest;
      try { manifest = JSON.parse(row.manifest_json); } catch (_) { manifest = null; }
      updates.push({ domain, etag: row.etag, cached_at: row.created_at, expires_at: row.expires_at, manifest });
    }
  }

  return res.json({
    synced_at: new Date().toISOString(),
    updates,
    up_to_date: upToDate,
    not_found: notFound,
    summary: { updates: updates.length, up_to_date: upToDate.length, not_found: notFound.length },
  });
});

// GET /api/offline/bundle?domains=a.com,b.com — downloadable JSON bundle
offlineRouter.get('/bundle', async (req, res) => {
  const raw = String(req.query.domains || '');
  if (!raw) return res.status(400).json({ error: 'domains query param required' });
  const domainList = raw.split(',').slice(0, 20).map(normDomain).filter(validDomain);
  if (!domainList.length) return res.status(400).json({ error: 'no valid domains' });

  const bundle = {
    wab_bundle_version: '1.0',
    generated_at: new Date().toISOString(),
    domains: {},
  };

  for (const domain of domainList) {
    let row = db.prepare(`SELECT * FROM manifest_versions WHERE domain=? ORDER BY created_at DESC LIMIT 1`).get(domain);
    if (!row) {
      // Try live fetch
      const fetched = await fetchAndStoreManifest(domain);
      if (fetched) row = fetched.row;
    }
    if (row) {
      let manifest;
      try { manifest = JSON.parse(row.manifest_json); } catch (_) { manifest = null; }
      bundle.domains[domain] = { etag: row.etag, cached_at: row.created_at, expires_at: row.expires_at, fresh: isFresh(row), manifest };
    } else {
      bundle.domains[domain] = { error: 'not_found' };
    }
  }

  res.setHeader('Content-Disposition', 'attachment; filename="wab-offline-bundle.json"');
  res.setHeader('Content-Type', 'application/json');
  return res.json(bundle);
});

module.exports = { cacheRouter, offlineRouter };
