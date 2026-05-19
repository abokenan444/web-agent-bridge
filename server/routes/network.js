'use strict';

/**
 * Network-effect public endpoints (v3.14.0 + signed snapshots v3.15.0).
 *
 *   GET /api/trusted-domains.json — signed snapshot of currently-attested,
 *     non-revoked WAB sites. Cached 1 hour. Designed for agent bootstrap
 *     and third-party crawlers building "verified web" indexes.
 *   GET /api/trusted-domains.txt  — same data, newline-separated domains.
 *   GET /api/trusted-domains/archive.json — manifest of available daily snapshots.
 *   GET /api/trusted-domains/:date.json    — historical signed snapshot.
 *   GET /api/transparency/feed.json — JSON Feed 1.1 of the transparency log.
 *   GET /api/transparency/feed.xml  — Atom 1.0 of the transparency log.
 *   GET /api/operator-key.json — operator Ed25519 public key (b64 + JWK).
 *
 * Mounted at /api in server/index.js.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();
const { db } = require('../models/db');
const { canonicalize } = require('../services/canonical-json');
const signer = require('../services/operator-signer');

const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1h
const ARCHIVE_DIR = process.env.WAB_SNAPSHOT_DIR ||
  path.join(__dirname, '..', '..',
    (process.env.NODE_ENV === 'test' ? 'data-test' : 'data'),
    'snapshots');

let _snapshotCache = { ts: 0, data: null };

function _ensureArchiveDir() {
  try { fs.mkdirSync(ARCHIVE_DIR, { recursive: true }); } catch (_) { /* ignore */ }
}

function _todayUtc() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function buildSnapshot() {
  // Active sites that have no active blocking revocation.
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT s.id, s.domain, s.name, s.description, s.tier, s.created_at
      FROM sites s
      WHERE s.active = 1
        AND NOT EXISTS (
          SELECT 1 FROM site_revocations r
          WHERE r.site_id = s.id
            AND r.status IN ('pending_appeal', 'appealed', 'final')
            AND r.type IN ('suspended', 'revoked')
        )
      ORDER BY s.created_at ASC
    `).all();
  } catch (_) {
    rows = db.prepare(`
      SELECT id, domain, name, description, tier, created_at
      FROM sites WHERE active = 1 ORDER BY created_at ASC
    `).all();
  }

  const generated_at = new Date().toISOString();
  const date = generated_at.slice(0, 10);
  const payload = {
    schema: 'wab-trusted-domains/v1',
    generated_at,
    date,
    total: rows.length,
    domains: rows.map(r => ({
      domain: r.domain,
      name: r.name,
      tier: r.tier || 'free',
      registered_at: r.created_at,
      discovery_url: 'https://' + r.domain + '/.well-known/wab.json',
      badge_url: 'https://webagentbridge.com/api/discovery/badge/' + r.domain + '.svg'
    }))
  };

  // Hash + sign over the canonical bytes of `payload` (without signature fields).
  const canonical = canonicalize(payload);
  const content_hash = 'sha256:' + crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  const signature = signer.sign(payload);

  const out = Object.assign({}, payload, {
    content_hash,
    signature: signature
      ? { alg: signer.ALGORITHM, value: signature, key_url: '/api/operator-key.json' }
      : null,
  });

  // Persist today's snapshot to disk for time-machine queries (idempotent overwrite).
  try {
    _ensureArchiveDir();
    const file = path.join(ARCHIVE_DIR, date + '.json');
    fs.writeFileSync(file, JSON.stringify(out, null, 2) + '\n', 'utf8');
  } catch (e) {
    console.warn('[network] snapshot archive write failed (non-fatal):', e.message);
  }

  return out;
}

function getSnapshot() {
  const now = Date.now();
  if (_snapshotCache.data && (now - _snapshotCache.ts) < SNAPSHOT_TTL_MS) {
    return _snapshotCache.data;
  }
  const snap = buildSnapshot();
  _snapshotCache = { ts: now, data: snap };
  return snap;
}

router.get('/trusted-domains.json', (req, res) => {
  const snap = getSnapshot();
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.set('X-WAB-Snapshot-Schema', snap.schema);
  res.set('X-WAB-Snapshot-Hash', snap.content_hash);
  if (snap.signature) res.set('X-WAB-Snapshot-Signature', snap.signature.value);
  res.json(snap);
});

router.get('/trusted-domains.txt', (req, res) => {
  const snap = getSnapshot();
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.type('text/plain; charset=utf-8');
  res.send(snap.domains.map(d => d.domain).join('\n') + '\n');
});

// ── Daily archive ────────────────────────────────────────────────────

function _listArchiveDates() {
  try {
    _ensureArchiveDir();
    return fs.readdirSync(ARCHIVE_DIR)
      .filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .map(f => f.replace(/\.json$/, ''))
      .sort();
  } catch (_) { return []; }
}

router.get('/trusted-domains/archive.json', (req, res) => {
  // Touch today's snapshot to ensure at least today is archived.
  getSnapshot();
  const dates = _listArchiveDates();
  const manifest = {
    schema: 'wab-trusted-domains-archive/v1',
    generated_at: new Date().toISOString(),
    total: dates.length,
    snapshots: dates.map(d => ({
      date: d,
      url: '/api/trusted-domains/' + d + '.json',
    })),
  };
  const sig = signer.sign(manifest);
  if (sig) manifest.signature = { alg: signer.ALGORITHM, value: sig, key_url: '/api/operator-key.json' };
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.json(manifest);
});

router.get('/trusted-domains/:date.json', (req, res) => {
  const date = req.params.date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'invalid_date', hint: 'Use YYYY-MM-DD.' });
  }
  // Serve today live (so a fresh boot doesn't return 404 before the first snapshot).
  if (date === _todayUtc()) {
    return res.json(getSnapshot());
  }
  _ensureArchiveDir();
  const file = path.join(ARCHIVE_DIR, date + '.json');
  if (!fs.existsSync(file)) {
    return res.status(404).json({ error: 'snapshot_not_found', date });
  }
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable');
  res.type('application/json; charset=utf-8');
  res.send(fs.readFileSync(file, 'utf8'));
});

// ── Operator public key ──────────────────────────────────────────────

router.get('/operator-key.json', (req, res) => {
  const pub = signer.publicKey();
  if (!pub) {
    return res.status(503).json({ error: 'signing_not_configured' });
  }
  res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400');
  res.json({
    schema: 'wab-operator-key/v1',
    alg: signer.ALGORITHM,
    public_key_b64: pub.b64,
    jwk: pub.jwk,
    issued_at: new Date().toISOString(),
    notice: 'Use this key to verify signatures on /api/trusted-domains.json and /api/trusted-domains/*.json.',
  });
});


// ── Revocation feeds ─────────────────────────────────────────────────

function listRecentRevocations(limit) {
  try {
    return db.prepare(`
      SELECT id, domain, type, reason_code, reason_text,
             decided_at, appeal_deadline, status, updated_at
      FROM site_revocations
      WHERE type IN ('suspended', 'revoked')
      ORDER BY decided_at DESC
      LIMIT ?
    `).all(limit);
  } catch (_) { return []; }
}

function escapeXml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

router.get('/transparency/feed.json', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const items = listRecentRevocations(limit);
  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.json({
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Web Agent Bridge — Revocations Transparency Log',
    home_page_url: 'https://webagentbridge.com/revocations.html',
    feed_url: 'https://webagentbridge.com/api/transparency/feed.json',
    description: 'Live feed of WAB site revocations and suspensions.',
    language: 'en',
    items: items.map(r => ({
      id: r.id,
      url: 'https://webagentbridge.com/revocations.html#' + r.id,
      title: '[' + r.type.toUpperCase() + '] ' + r.domain + ' — ' + (r.reason_code || 'unknown'),
      content_text: (r.reason_text || '') +
        (r.appeal_deadline ? '\nAppeal deadline: ' + r.appeal_deadline : '') +
        '\nStatus: ' + r.status,
      date_published: r.decided_at,
      date_modified: r.updated_at || r.decided_at,
      tags: [r.type, r.reason_code, r.status].filter(Boolean),
      _wab: {
        domain: r.domain,
        type: r.type,
        reason_code: r.reason_code,
        status: r.status,
        appeal_deadline: r.appeal_deadline
      }
    }))
  });
});

router.get('/transparency/feed.xml', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const items = listRecentRevocations(limit);
  const updated = items[0] && items[0].decided_at
    ? new Date(items[0].decided_at).toISOString()
    : new Date().toISOString();

  const entries = items.map(r => {
    const url = 'https://webagentbridge.com/revocations.html#' + r.id;
    const published = new Date(r.decided_at).toISOString();
    const mod = new Date(r.updated_at || r.decided_at).toISOString();
    const title = '[' + r.type.toUpperCase() + '] ' + r.domain + ' — ' + (r.reason_code || 'unknown');
    const summary = (r.reason_text || '') +
      (r.appeal_deadline ? ' Appeal deadline: ' + r.appeal_deadline + '.' : '') +
      ' Status: ' + r.status + '.';
    return [
      '  <entry>',
      '    <id>tag:webagentbridge.com,2026:' + r.id + '</id>',
      '    <title>' + escapeXml(title) + '</title>',
      '    <link rel="alternate" href="' + url + '"/>',
      '    <published>' + published + '</published>',
      '    <updated>' + mod + '</updated>',
      '    <category term="' + escapeXml(r.type) + '"/>',
      '    <category term="' + escapeXml(r.reason_code || '') + '"/>',
      '    <summary>' + escapeXml(summary) + '</summary>',
      '  </entry>'
    ].join('\n');
  }).join('\n');

  const xml = '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<feed xmlns="http://www.w3.org/2005/Atom">\n' +
    '  <id>https://webagentbridge.com/api/transparency/feed.xml</id>\n' +
    '  <title>Web Agent Bridge — Revocations Transparency Log</title>\n' +
    '  <updated>' + updated + '</updated>\n' +
    '  <link rel="self" href="https://webagentbridge.com/api/transparency/feed.xml"/>\n' +
    '  <link rel="alternate" href="https://webagentbridge.com/revocations.html"/>\n' +
    (entries ? entries + '\n' : '') +
    '</feed>\n';

  res.set('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.type('application/atom+xml; charset=utf-8');
  res.send(xml);
});

module.exports = router;
module.exports._buildSnapshot = buildSnapshot;
module.exports._listRecentRevocations = listRecentRevocations;
module.exports.__resetCache = function () { _snapshotCache = { ts: 0, data: null }; };
