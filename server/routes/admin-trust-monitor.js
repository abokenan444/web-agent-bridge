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
const ctMonitor = require('../services/ssl-ct-monitor');

const router = express.Router();
router.use(authenticateAdmin);

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? `wab-test-${process.env.JEST_WORKER_ID || '1'}.db` : 'wab.db';

let _db = null;
function db() { if (!_db) { _db = new Database(path.join(DATA_DIR, DB_FILE)); } return _db; }

router.get('/sites', (req, res) => {
  const rows = db().prepare(`
    SELECT host, fingerprint_sha256, issuer, valid_to, days_until_expiry,
           status, error, last_checked_at, last_alert_at,
           ct_monitor_enabled, ct_last_checked, ct_pending_resign, ct_last_thumbprint
      FROM ssl_monitor ORDER BY
      CASE status WHEN 'expired' THEN 0 WHEN 'error' THEN 1 WHEN 'expiring' THEN 2 ELSE 3 END,
      ct_pending_resign DESC,
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
  let pendingResign = 0, ctEvents = 0, ctEnabled = 0;
  try {
    pendingResign = db().prepare('SELECT COUNT(*) AS n FROM ssl_monitor WHERE ct_pending_resign = 1').get().n;
    ctEnabled     = db().prepare('SELECT COUNT(*) AS n FROM ssl_monitor WHERE ct_monitor_enabled = 1').get().n;
    ctEvents      = db().prepare("SELECT COUNT(*) AS n FROM cert_history WHERE source = 'ct_log'").get().n;
  } catch (_) { /* migration not applied yet */ }
  res.json({ total, byStatus, expiringSoon, expired, certHistory, pendingResign, ctEvents, ctEnabled,
             ctMonitorEnv: String(process.env.WAB_CT_MONITOR).toLowerCase() === 'true',
             autoResignEnv: String(process.env.WAB_AUTO_RESIGN).toLowerCase() === 'true' });
});

// ---- Certificate Transparency endpoints ----

router.post('/ct-sweep', async (req, res) => {
  try {
    const r = await ctMonitor.runCTMonitor();
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_ct_sweep', details: { count: r.count }, ip: req.ip });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ct-check', async (req, res) => {
  const host = (req.body && req.body.host || '').trim().toLowerCase();
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    const r = await ctMonitor.checkDomain(host);
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_ct_check', details: { host, changed: !!r.changed }, ip: req.ip });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ct-clear', (req, res) => {
  const host = (req.body && req.body.host || '').trim().toLowerCase();
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    const info = db().prepare('UPDATE ssl_monitor SET ct_pending_resign = 0 WHERE host = ?').run(host);
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_ct_clear', details: { host, changes: info.changes }, ip: req.ip });
    res.json({ ok: true, changes: info.changes });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ct-toggle', (req, res) => {
  const host = (req.body && req.body.host || '').trim().toLowerCase();
  const enabled = req.body && req.body.enabled ? 1 : 0;
  if (!host) return res.status(400).json({ error: 'host required' });
  try {
    db().prepare('UPDATE ssl_monitor SET ct_monitor_enabled = ? WHERE host = ?').run(enabled, host);
    auditLog({ actorType: 'admin', actorId: String(req.admin.id),
      action: 'trust_ct_toggle', details: { host, enabled }, ip: req.ip });
    res.json({ ok: true, host, enabled: !!enabled });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
