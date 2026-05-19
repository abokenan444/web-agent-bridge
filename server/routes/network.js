'use strict';

/**
 * Network-effect public endpoints (v3.14.0).
 *
 *   GET /api/trusted-domains.json — snapshot of currently-attested,
 *     non-revoked WAB sites. Cached 1 hour. Designed for agent bootstrap
 *     and third-party crawlers building "verified web" indexes.
 *   GET /api/trusted-domains.txt  — same data, newline-separated domains.
 *   GET /api/revocations/feed.json — JSON Feed 1.1 of the transparency log.
 *   GET /api/revocations/feed.xml  — Atom 1.0 of the transparency log.
 *
 * Mounted at /api in server/index.js.
 */

const express = require('express');
const router = express.Router();
const { db } = require('../models/db');

const SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1h
let _snapshotCache = { ts: 0, data: null };

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
    // site_revocations may not yet exist on a very first boot
    rows = db.prepare(`
      SELECT id, domain, name, description, tier, created_at
      FROM sites WHERE active = 1 ORDER BY created_at ASC
    `).all();
  }

  return {
    schema: 'wab-trusted-domains/v1',
    generated_at: new Date().toISOString(),
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
  res.json(snap);
});

router.get('/trusted-domains.txt', (req, res) => {
  const snap = getSnapshot();
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=3600');
  res.type('text/plain; charset=utf-8');
  res.send(snap.domains.map(d => d.domain).join('\n') + '\n');
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
