/**
 * Admin Trust Monitor — SSL health + cert history (Extended Trust Layer).
 *   GET  /api/admin/trust-monitor/sites      — list ssl_monitor rows
 *   POST /api/admin/trust-monitor/check      { host } — re-check one host
 *   POST /api/admin/trust-monitor/sweep      — re-check every site
 *   GET  /api/admin/trust-monitor/history    ?host= — cert_history rows
 *   GET  /api/admin/trust-monitor/stats
 */
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { auditLog } = require('../services/security');
const monitor = require('../services/ssl-monitor');

const router = express.Router();
router.use(authenticateAdmin);

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';

let _db = null;
function db() { if (!_db) { _db = new Database(path.join(DATA_DIR, DB_FILE)); } return _db; }

router.get('/sites', (req, res) => {
  const rows = db().prepare(`
    SELECT host, fingerprint_sha256, issuer, valid_to, days_until_expiry,
           status, error, last_checked_at, last_alert_at
      FROM ssl_monitor ORDER BY
      CASE status WHEN 'expired' THEN 0 WHEN 'error' THEN 1 WHEN 'expiring' THEN 2 ELSE 3 END,
      days_until_expiry ASC
  `).all();
  res.json({ sites: rows, count: rows.length });
});

router.post('/check', async (req, res) => {
  const host = (req.body && req.body.host || '').trim().toLowerCase();
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    const r = await monitor.checkHost(host, { source: 'admin' });
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_check', details: { host, status: r.status }, ip: req.ip });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/sweep', async (req, res) => {
  try {
    const rs = await monitor.runSweep();
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_sweep', details: { count: rs.length }, ip: req.ip });
    res.json({ count: rs.length, results: rs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', (req, res) => {
  const host = (req.query.host || '').toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const sql = host
    ? `SELECT * FROM cert_history WHERE host = ? ORDER BY observed_at DESC LIMIT ?`
    : `SELECT * FROM cert_history ORDER BY observed_at DESC LIMIT ?`;
  const rows = host ? db().prepare(sql).all(host, limit) : db().prepare(sql).all(limit);
  res.json({ history: rows, count: rows.length });
});

router.get('/stats', (req, res) => {
  const total = db().prepare('SELECT COUNT(*) AS n FROM ssl_monitor').get().n;
  const byStatus = db().prepare('SELECT status, COUNT(*) AS n FROM ssl_monitor GROUP BY status').all();
  const expiringSoon = db().prepare(
    "SELECT COUNT(*) AS n FROM ssl_monitor WHERE status = 'expiring'"
  ).get().n;
  const expired = db().prepare(
    "SELECT COUNT(*) AS n FROM ssl_monitor WHERE status = 'expired'"
  ).get().n;
  const certHistory = db().prepare('SELECT COUNT(*) AS n FROM cert_history').get().n;
  res.json({ total, byStatus, expiringSoon, expired, certHistory });
});

module.exports = router;
