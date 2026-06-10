'use strict';

/**
 * Security Researchers — Hall of Fame.
 *
 * Public surface:
 *   GET  /api/security-researchers          → published (approved) entries
 *   POST /api/security-researchers/submit   → submit a new entry (goes to pending)
 *
 * Admin surface (x-wab-admin-token):
 *   GET    /api/security-researchers/pending           → list pending
 *   POST   /api/security-researchers/approve           → { id } → publish
 *   POST   /api/security-researchers/reject            → { id } → discard
 *
 * Storage: data/security-researchers.json (atomic write).
 * Submissions are NEVER auto-published — admin approval is required to keep
 * the page free of spam. Submitters are told this on the form.
 */

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const router  = express.Router();

const DATA_PATH = path.join(__dirname, '..', '..', 'data', 'security-researchers.json');

function _read() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (_) { return { researchers: [], pending: [] }; }
}
function _write(obj) {
  fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
  const tmp = DATA_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, DATA_PATH);
}

const NAME_RE   = /^[\p{L}\p{N} ._'-]{2,60}$/u;
const HANDLE_RE = /^[a-zA-Z0-9_-]{1,40}$/;
const URL_RE    = /^https:\/\/(github|twitter|x|linkedin|mastodon)\.[a-z.]+\/[\w._/-]+$/i;

function _sanitize(input) {
  const name = String(input?.name || '').trim();
  const githubHandle = String(input?.githubHandle || '').trim().replace(/^@/, '');
  const url  = String(input?.url || '').trim();
  const note = String(input?.note || '').trim().slice(0, 240);
  const severity = ['critical', 'high', 'medium', 'low'].includes(input?.severity) ? input.severity : 'medium';
  const anonymous = input?.anonymous === true;

  const errors = [];
  if (!anonymous && !NAME_RE.test(name)) errors.push('name must be 2–60 chars (letters, digits, spaces, . _ \' -)');
  if (githubHandle && !HANDLE_RE.test(githubHandle)) errors.push('githubHandle must be 1–40 chars (a–z, 0–9, _, -)');
  if (url && !URL_RE.test(url)) errors.push('url must be https://{github|twitter|x|linkedin|mastodon}/...');

  return {
    ok: errors.length === 0,
    errors,
    entry: {
      name: anonymous ? 'Anonymous' : name,
      githubHandle: anonymous ? '' : githubHandle,
      url: anonymous ? '' : url,
      note,
      severity,
      anonymous,
    },
  };
}

router.get('/', (req, res) => {
  const db = _read();
  // Public projection only — no email / IP / submitted_at-precision.
  const list = (db.researchers || []).map(r => ({
    name: r.name,
    githubHandle: r.githubHandle || null,
    url: r.url || null,
    note: r.note || '',
    severity: r.severity,
    credited_on: r.credited_on || null,
  }));
  res.set('Cache-Control', 'public, max-age=300');
  res.json({ count: list.length, researchers: list });
});

router.post('/submit', express.json({ limit: '8kb' }), (req, res) => {
  const v = _sanitize(req.body || {});
  if (!v.ok) return res.status(400).json({ error: 'invalid_input', detail: v.errors });

  // Optional contact — kept in pending only, never published. Used to notify
  // the submitter once the entry is approved (or to coordinate disclosure).
  const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 120);
  const reportRef = String(req.body?.reportRef || '').trim().slice(0, 120);

  const db = _read();
  const id = 'sub_' + crypto.randomBytes(8).toString('hex');
  db.pending = Array.isArray(db.pending) ? db.pending : [];
  db.pending.push({
    id,
    ...v.entry,
    email,             // private — admin-only
    reportRef,         // private — admin-only (e.g. internal ticket ID)
    submitted_at: new Date().toISOString(),
    submitted_ip_hash: crypto.createHash('sha256').update(String(req.ip || '')).digest('hex').slice(0, 16),
  });
  // Cap pending queue at 500 to bound abuse.
  if (db.pending.length > 500) db.pending = db.pending.slice(-500);
  _write(db);
  res.status(202).json({
    ok: true,
    id,
    status: 'pending_review',
    message: 'Thanks. Your entry is awaiting review. Genuine reports will be published on /researchers within a few days.',
  });
});

// ── Admin ────────────────────────────────────────────────────────────────
function _adminAuth(req, res, next) {
  const { safeEqual } = require('../utils/safe-compare');
  const want = process.env.WAB_ADMIN_TOKEN;
  if (!want) return res.status(503).json({ error: 'WAB_ADMIN_TOKEN not configured' });
  const got = req.headers['x-wab-admin-token'] || req.query.token;
  if (!safeEqual(got, want)) return res.status(401).json({ error: 'admin token required' });
  next();
}

router.get('/pending', _adminAuth, (req, res) => {
  const db = _read();
  res.json({ count: (db.pending || []).length, pending: db.pending || [] });
});

router.post('/approve', _adminAuth, express.json({ limit: '4kb' }), (req, res) => {
  const id = String(req.body?.id || '');
  const db = _read();
  const idx = (db.pending || []).findIndex(p => p.id === id);
  if (idx < 0) return res.status(404).json({ error: 'not_found' });
  const p = db.pending[idx];
  db.pending.splice(idx, 1);
  db.researchers = Array.isArray(db.researchers) ? db.researchers : [];
  db.researchers.push({
    name: p.name,
    githubHandle: p.githubHandle || '',
    url: p.url || '',
    note: p.note || '',
    severity: p.severity,
    credited_on: new Date().toISOString().slice(0, 10),
  });
  _write(db);
  res.json({ ok: true, published: db.researchers.length });
});

router.post('/reject', _adminAuth, express.json({ limit: '4kb' }), (req, res) => {
  const id = String(req.body?.id || '');
  const db = _read();
  const before = (db.pending || []).length;
  db.pending = (db.pending || []).filter(p => p.id !== id);
  if (db.pending.length === before) return res.status(404).json({ error: 'not_found' });
  _write(db);
  res.json({ ok: true, pending: db.pending.length });
});

module.exports = router;
