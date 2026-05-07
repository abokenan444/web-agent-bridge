/**
 * WAB ShieldQR — public verification API
 *   POST /api/shieldqr/scan   { url }       -> { level, score, signals, ... }
 *   POST /api/shieldqr/report { url, reason }
 *   GET  /api/shieldqr/recent ?limit=50     (public, redacted)
 */
'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const path = require('path');

const shieldqr = require('../services/shieldqr');

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';

let _db = null;
function db() {
  if (!_db) { _db = new Database(path.join(DATA_DIR, DB_FILE)); }
  return _db;
}

const scanLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 60 * 60_000, max: 10, standardHeaders: true, legacyHeaders: false });

router.post('/scan', scanLimiter, async (req, res) => {
  const url = (req.body && (req.body.url || req.body.qr || req.body.text)) || '';
  if (!url || typeof url !== 'string' || url.length > 2048) {
    return res.status(400).json({ error: 'url required (string, ≤2048 chars)' });
  }
  try {
    const result = await shieldqr.scan(url);
    try {
      db().prepare(`INSERT INTO shieldqr_scans (url, host, level, score, signals_json, trust_ok, ssl_ok, user_id, ip, user_agent)
                    VALUES (?,?,?,?,?,?,?,?,?,?)`)
        .run(
          result.url || url,
          result.host || null,
          result.level,
          result.score,
          JSON.stringify(result.signals || []),
          result.trust && result.trust.ok ? 1 : 0,
          result.ssl && result.ssl.ok ? 1 : 0,
          (req.user && req.user.id) || null,
          req.ip || null,
          (req.headers['user-agent'] || '').slice(0, 200),
        );
    } catch (e) { /* table may not exist in some test contexts */ }
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message || 'scan failed' });
  }
});

router.post('/report', reportLimiter, (req, res) => {
  const url = (req.body && req.body.url) || '';
  const reason = ((req.body && req.body.reason) || '').slice(0, 500);
  if (!url || typeof url !== 'string') { return res.status(400).json({ error: 'url required' }); }
  try {
    const info = db().prepare(`INSERT INTO shieldqr_reports (url, reason, reporter_id, reporter_ip)
                               VALUES (?,?,?,?)`)
      .run(url, reason, (req.user && req.user.id) || null, req.ip || null);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/recent', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  try {
    const rows = db().prepare(`SELECT id, host, level, score, created_at
                               FROM shieldqr_scans ORDER BY id DESC LIMIT ?`).all(limit);
    res.json({ scans: rows });
  } catch (e) {
    res.json({ scans: [] });
  }
});

module.exports = router;
