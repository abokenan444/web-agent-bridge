/**
 * Admin ShieldQR — moderate user-submitted reports + browse recent scans.
 *   GET  /api/admin/shieldqr/reports?status=open
 *   PUT  /api/admin/shieldqr/reports/:id   { status }
 *   GET  /api/admin/shieldqr/scans?host=&level=&limit=
 *   GET  /api/admin/shieldqr/stats
 */
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { auditLog } = require('../services/security');

const router = express.Router();
router.use(authenticateAdmin);

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? `wab-test-${process.env.JEST_WORKER_ID || '1'}.db` : 'wab.db';

let _db = null;
function db() {
  if (!_db) { _db = new Database(path.join(DATA_DIR, DB_FILE)); }
  return _db;
}

const VALID_STATUSES = new Set(['open', 'reviewing', 'resolved', 'rejected']);
const VALID_LEVELS = new Set(['green', 'yellow', 'red']);

router.get('/reports', (req, res) => {
  const status = req.query.status && VALID_STATUSES.has(req.query.status) ? req.query.status : null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const sql = status
    ? `SELECT r.*, s.level, s.score, s.host
         FROM shieldqr_reports r
         LEFT JOIN shieldqr_scans s ON s.id = r.scan_id
        WHERE r.status = ? ORDER BY r.created_at DESC LIMIT ?`
    : `SELECT r.*, s.level, s.score, s.host
         FROM shieldqr_reports r
         LEFT JOIN shieldqr_scans s ON s.id = r.scan_id
        ORDER BY r.created_at DESC LIMIT ?`;
  const rows = status ? db().prepare(sql).all(status, limit) : db().prepare(sql).all(limit);
  res.json({ reports: rows, count: rows.length });
});

router.put('/reports/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = req.body && req.body.status;
  if (!Number.isFinite(id) || !VALID_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid id or status' });
  }
  const info = db().prepare('UPDATE shieldqr_reports SET status = ? WHERE id = ?').run(status, id);
  if (info.changes === 0) { return res.status(404).json({ error: 'report not found' }); }
  auditLog({
    actorType: 'admin', actorId: String(req.admin.id),
    action: 'shieldqr_report_update',
    details: { id, status }, ip: req.ip,
  });
  res.json({ ok: true, id, status });
});

router.get('/scans', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const where = []; const params = [];
  if (req.query.host) { where.push('host = ?'); params.push(String(req.query.host).toLowerCase()); }
  if (req.query.level && VALID_LEVELS.has(req.query.level)) {
    where.push('level = ?'); params.push(req.query.level);
  }
  const sql = `SELECT id, url, host, level, score, trust_ok, ssl_ok, created_at
                 FROM shieldqr_scans
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC LIMIT ?`;
  const rows = db().prepare(sql).all(...params, limit);
  res.json({ scans: rows, count: rows.length });
});

router.get('/stats', (req, res) => {
  const totalScans = db().prepare('SELECT COUNT(*) AS n FROM shieldqr_scans').get().n;
  const byLevel = db().prepare('SELECT level, COUNT(*) AS n FROM shieldqr_scans GROUP BY level').all();
  const reportsByStatus = db().prepare('SELECT status, COUNT(*) AS n FROM shieldqr_reports GROUP BY status').all();
  const recent24h = db().prepare(
    "SELECT COUNT(*) AS n FROM shieldqr_scans WHERE created_at >= datetime('now','-1 day')"
  ).get().n;
  res.json({ totalScans, recent24h, byLevel, reportsByStatus });
});

module.exports = router;
