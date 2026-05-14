/**
 * Admin ShieldLink — review brand requests, monitor reports, suspend abuse.
 *   GET  /api/admin/shieldlink/brands?status=pending
 *   PUT  /api/admin/shieldlink/brands/:id        { decision, notes, badge_level }
 *   GET  /api/admin/shieldlink/links?status=&domain=
 *   POST /api/admin/shieldlink/links/:id/suspend
 *   GET  /api/admin/shieldlink/reports?status=open
 *   PUT  /api/admin/shieldlink/reports/:id       { status }
 *   GET  /api/admin/shieldlink/stats
 *   POST /api/admin/shieldlink/holds              { pattern, reason }
 *   DELETE /api/admin/shieldlink/holds/:id
 */
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { auditLog } = require('../services/security');
const sl = require('../services/shieldlink');

const router = express.Router();
router.use(authenticateAdmin);

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';
let _db = null;
function db() { if (!_db) _db = new Database(path.join(DATA_DIR, DB_FILE)); return _db; }

const VALID_BRAND_STATUSES = new Set(['pending', 'verified', 'rejected', 'suspended']);
const VALID_REPORT_STATUSES = new Set(['open', 'reviewing', 'resolved', 'rejected']);

router.get('/brands', (req, res) => {
  const status = VALID_BRAND_STATUSES.has(req.query.status) ? req.query.status : null;
  res.json({ brands: sl.listBrands({ status, limit: req.query.limit }) });
});

router.put('/brands/:id', express.json({ limit: '8kb' }), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body || {};
  if (!Number.isFinite(id) || !VALID_BRAND_STATUSES.has(body.decision)) {
    return res.status(400).json({ error: 'invalid_id_or_decision' });
  }
  const r = sl.reviewBrand({
    id,
    decision: body.decision,
    reviewerId: String(req.admin.id),
    notes: body.notes || null,
    badgeLevel: body.badge_level || null,
  });
  if (!r.ok) return res.status(400).json(r);
  auditLog({
    actorType: 'admin', actorId: String(req.admin.id),
    action: 'shieldlink_brand_review',
    details: { id, decision: body.decision }, ip: req.ip,
  });
  res.json({ ok: true });
});

router.get('/links', (req, res) => {
  const D = db();
  const where = []; const params = [];
  if (req.query.status) { where.push('l.status = ?'); params.push(req.query.status); }
  if (req.query.domain) { where.push('b.domain = ?'); params.push(String(req.query.domain).toLowerCase()); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const sql = `SELECT l.id, l.token, l.purpose, l.target_url, l.amount_cents, l.currency, l.payee_name,
                      l.status, l.expires_at, l.created_at, b.domain, b.display_name, b.status AS brand_status
                 FROM shieldlink_links l
                 JOIN shieldlink_brands b ON b.id = l.brand_id
                 ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY l.created_at DESC LIMIT ?`;
  res.json({ links: D.prepare(sql).all(...params, limit) });
});

router.post('/links/:id/suspend', express.json({ limit: '4kb' }), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  sl.revokeLink(id, (req.body && req.body.reason) || 'admin_suspended');
  auditLog({
    actorType: 'admin', actorId: String(req.admin.id),
    action: 'shieldlink_link_suspend',
    details: { id, reason: (req.body && req.body.reason) || null }, ip: req.ip,
  });
  res.json({ ok: true });
});

router.get('/reports', (req, res) => {
  const status = VALID_REPORT_STATUSES.has(req.query.status) ? req.query.status : null;
  res.json({ reports: sl.listReports({ status, limit: req.query.limit }) });
});

router.put('/reports/:id', express.json({ limit: '4kb' }), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const status = req.body && req.body.status;
  if (!Number.isFinite(id) || !VALID_REPORT_STATUSES.has(status)) {
    return res.status(400).json({ error: 'invalid_id_or_status' });
  }
  const resolvedAt = (status === 'resolved' || status === 'rejected') ? `datetime('now')` : 'NULL';
  db().prepare(`UPDATE shieldlink_reports SET status = ?, resolved_at = ${resolvedAt} WHERE id = ?`).run(status, id);
  auditLog({
    actorType: 'admin', actorId: String(req.admin.id),
    action: 'shieldlink_report_update',
    details: { id, status }, ip: req.ip,
  });
  res.json({ ok: true });
});

router.get('/stats', (req, res) => res.json(sl.getStats()));

router.post('/holds', express.json({ limit: '4kb' }), (req, res) => {
  const body = req.body || {};
  const pattern = String(body.pattern || '').trim();
  if (!pattern) return res.status(400).json({ error: 'pattern_required' });
  try {
    const info = db().prepare(
      `INSERT OR IGNORE INTO shieldlink_name_holds (pattern, pattern_kind, reason, created_by) VALUES (?, ?, ?, ?)`
    ).run(pattern, body.pattern_kind === 'regex' ? 'regex' : 'literal', body.reason || null, String(req.admin.id));
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'shieldlink_hold_add', details: { pattern }, ip: req.ip });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/holds/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad_id' });
  db().prepare(`DELETE FROM shieldlink_name_holds WHERE id = ?`).run(id);
  auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'shieldlink_hold_remove', details: { id }, ip: req.ip });
  res.json({ ok: true });
});

router.get('/holds', (req, res) => {
  res.json({ holds: db().prepare(`SELECT * FROM shieldlink_name_holds ORDER BY created_at DESC`).all() });
});

module.exports = router;
