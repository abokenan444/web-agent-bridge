/**
 * /api/admin/outreach — Outreach Agent management.
 *
 * STRICTLY admin-protected. All sending requires explicit per-target approval.
 *
 *   POST /scan          { urls: string[] }            — analyze + draft (status='pending')
 *   GET  /list          ?status=pending|sent|failed   — list targets
 *   GET  /:id                                          — single target with draft
 *   PUT  /:id           { draft_subject?, draft_body_html?, contact_email?, status? }
 *   POST /:id/approve                                  — set status='approved'
 *   POST /:id/send                                     — send approved draft now
 *   POST /send-batch    { ids?, limit?, dryRun? }      — send N approved drafts
 *   POST /suppress      { email_or_host, reason? }
 *   GET  /stats
 */

'use strict';

const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { db, getSmtpSettings, logNotification } = require('../models/db');
const { analyzeSite } = require('../services/outreach-agent');

// ─── Throttle: max 50 sends/hour, 1 per recipient/30d ────────────────
const HOURLY_CAP = parseInt(process.env.OUTREACH_HOURLY_CAP || '50', 10);
const PER_RECIPIENT_COOLDOWN_DAYS = 30;

function _isPublicUrl(s) {
  try {
    if (!s) return false;
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (!u.hostname || u.hostname.length < 3) return false;
    if (/^localhost$|\.local$|^127\.|^10\.|^192\.168\.|^169\.254\.|^0\./.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

function _isSuppressed(emailOrHost) {
  if (!emailOrHost) return false;
  const row = db.prepare('SELECT 1 FROM outreach_suppression WHERE lower(email_or_host) = lower(?)').get(emailOrHost);
  return !!row;
}

function _hourlyCount() {
  return db.prepare("SELECT COUNT(*) AS n FROM outreach_targets WHERE status='sent' AND sent_at >= datetime('now','-1 hour')").get().n || 0;
}

function _recentlyEmailed(email) {
  if (!email) return false;
  const row = db.prepare(`SELECT 1 FROM outreach_targets WHERE lower(contact_email)=lower(?) AND status='sent' AND sent_at >= datetime('now','-${PER_RECIPIENT_COOLDOWN_DAYS} days')`).get(email);
  return !!row;
}

function _logEvent(targetId, event, details) {
  try { db.prepare('INSERT INTO outreach_log (target_id, event, details) VALUES (?, ?, ?)').run(targetId, event, details ? String(details).slice(0, 1000) : null); } catch { /* ignore */ }
}

// ─── Scan: analyze URLs and store drafts ─────────────────────────────
router.post('/scan', authenticateAdmin, async (req, res) => {
  const urls = Array.isArray(req.body && req.body.urls) ? req.body.urls : [];
  if (!urls.length) return res.status(400).json({ ok: false, error: 'urls[] required' });
  if (urls.length > 25) return res.status(400).json({ ok: false, error: 'max 25 urls per scan' });

  const out = [];
  for (const raw of urls) {
    const url = String(raw || '').trim();
    if (!_isPublicUrl(url)) { out.push({ url, ok: false, error: 'invalid_or_private_url' }); continue; }
    try {
      const r = await analyzeSite(url, { timeoutMs: 9000 });
      if (!r.ok) { out.push({ url, ok: false, error: r.error }); continue; }
      const suppressed = _isSuppressed(r.host) || (r.contact_email && _isSuppressed(r.contact_email));
      const status = suppressed ? 'suppressed' : 'pending';
      const info = db.prepare(`
        INSERT INTO outreach_targets
          (site_url, host, contact_email, detected_lang, site_kind, signals_json, suggested_features_json,
           draft_subject, draft_body_html, draft_body_text, status, unsubscribe_token)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        r.site_url, r.host, r.contact_email,
        r.detected_lang, r.site_kind,
        JSON.stringify(r.signals || []),
        JSON.stringify(r.suggested_features || []),
        r.draft.subject, r.draft.html, r.draft.text,
        status, r.unsubscribe_token
      );
      _logEvent(info.lastInsertRowid, 'scanned', `kind=${r.site_kind} lang=${r.detected_lang} email=${r.contact_email || 'none'}`);
      out.push({ url, ok: true, id: info.lastInsertRowid, host: r.host, lang: r.detected_lang, kind: r.site_kind, contact_email: r.contact_email, status });
    } catch (e) {
      out.push({ url, ok: false, error: e.message });
    }
  }
  res.json({ ok: true, count: out.length, results: out });
});

// ─── List ────────────────────────────────────────────────────────────
router.get('/list', authenticateAdmin, (req, res) => {
  const status = req.query.status || null;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const where = status ? 'WHERE status = ?' : '';
  const params = status ? [status] : [];
  const rows = db.prepare(`
    SELECT id, site_url, host, contact_email, detected_lang, site_kind, status, draft_subject, sent_at, created_at, error_message
    FROM outreach_targets ${where} ORDER BY id DESC LIMIT ?
  `).all(...params, limit);
  res.json({ ok: true, count: rows.length, items: rows });
});

router.get('/stats', authenticateAdmin, (req, res) => {
  const counts = db.prepare("SELECT status, COUNT(*) AS n FROM outreach_targets GROUP BY status").all();
  const langs = db.prepare("SELECT detected_lang AS lang, COUNT(*) AS n FROM outreach_targets GROUP BY detected_lang").all();
  const sentLastHour = _hourlyCount();
  const sentLast24h = db.prepare("SELECT COUNT(*) AS n FROM outreach_targets WHERE status='sent' AND sent_at >= datetime('now','-1 day')").get().n || 0;
  const suppressed = db.prepare("SELECT COUNT(*) AS n FROM outreach_suppression").get().n || 0;
  res.json({ ok: true, counts, langs, sent_last_hour: sentLastHour, sent_last_24h: sentLast24h, hourly_cap: HOURLY_CAP, suppressed });
});

// ─── Single target ───────────────────────────────────────────────────
router.get('/:id', authenticateAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  res.json({ ok: true, target: row });
});

router.put('/:id', authenticateAdmin, (req, res) => {
  const allowed = ['draft_subject', 'draft_body_html', 'draft_body_text', 'contact_email', 'status', 'detected_lang'];
  const sets = []; const vals = [];
  for (const k of allowed) if (k in (req.body || {})) { sets.push(`${k} = ?`); vals.push(req.body[k]); }
  if (!sets.length) return res.status(400).json({ ok: false, error: 'no_fields' });
  sets.push("updated_at = datetime('now')");
  vals.push(req.params.id);
  db.prepare(`UPDATE outreach_targets SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
  _logEvent(req.params.id, 'edited', sets.join(','));
  res.json({ ok: true });
});

router.post('/:id/approve', authenticateAdmin, (req, res) => {
  const row = db.prepare('SELECT * FROM outreach_targets WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!row.contact_email) return res.status(400).json({ ok: false, error: 'no_contact_email' });
  db.prepare("UPDATE outreach_targets SET status='approved', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  _logEvent(req.params.id, 'approved', null);
  res.json({ ok: true });
});

// ─── Send ────────────────────────────────────────────────────────────
async function _sendOne(row) {
  const settings = getSmtpSettings();
  if (!settings || !settings.enabled || !settings.host) return { ok: false, error: 'SMTP not configured' };
  if (!row.contact_email) return { ok: false, error: 'no_contact_email' };
  if (_isSuppressed(row.contact_email) || _isSuppressed(row.host)) {
    db.prepare("UPDATE outreach_targets SET status='suppressed' WHERE id=?").run(row.id);
    _logEvent(row.id, 'suppressed', 'on suppression list');
    return { ok: false, error: 'suppressed' };
  }
  if (_recentlyEmailed(row.contact_email)) {
    db.prepare("UPDATE outreach_targets SET status='skipped', error_message='cooldown' WHERE id=?").run(row.id);
    _logEvent(row.id, 'skipped', 'recipient cooldown');
    return { ok: false, error: 'recipient_cooldown' };
  }
  const transport = nodemailer.createTransport({
    host: settings.host, port: settings.port || 587, secure: !!settings.secure,
    auth: { user: settings.username, pass: settings.password }
  });
  db.prepare("UPDATE outreach_targets SET status='sending', updated_at=datetime('now') WHERE id=?").run(row.id);
  try {
    const fromName = settings.from_name || 'Web Agent Bridge';
    const fromEmail = settings.from_email;
    const unsubUrl = `https://www.webagentbridge.com/unsubscribe?token=${row.unsubscribe_token || ''}`;
    await transport.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: row.contact_email,
      subject: row.draft_subject,
      html: row.draft_body_html,
      text: row.draft_body_text,
      headers: {
        'List-Unsubscribe': `<${unsubUrl}>, <mailto:${fromEmail}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        'X-Mailer': 'WAB-OutreachAgent/1.0',
        'Auto-Submitted': 'auto-generated'
      }
    });
    db.prepare("UPDATE outreach_targets SET status='sent', sent_at=datetime('now'), updated_at=datetime('now'), error_message=NULL WHERE id=?").run(row.id);
    _logEvent(row.id, 'sent', row.contact_email);
    try { logNotification({ emailTo: row.contact_email, template: 'outreach', subject: row.draft_subject, status: 'sent' }); } catch { /* ignore */ }
    return { ok: true };
  } catch (e) {
    db.prepare("UPDATE outreach_targets SET status='failed', error_message=?, updated_at=datetime('now') WHERE id=?").run(String(e.message).slice(0, 500), row.id);
    _logEvent(row.id, 'failed', e.message);
    return { ok: false, error: e.message };
  }
}

router.post('/:id/send', authenticateAdmin, async (req, res) => {
  const row = db.prepare('SELECT * FROM outreach_targets WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  if (!['approved', 'pending'].includes(row.status)) return res.status(409).json({ ok: false, error: 'invalid_status', status: row.status });
  if (_hourlyCount() >= HOURLY_CAP) return res.status(429).json({ ok: false, error: 'hourly_cap_reached', cap: HOURLY_CAP });
  const r = await _sendOne(row);
  res.json({ ok: r.ok, error: r.error });
});

router.post('/send-batch', authenticateAdmin, async (req, res) => {
  const { ids = null, limit = 10, dryRun = false } = req.body || {};
  let rows;
  if (Array.isArray(ids) && ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    rows = db.prepare(`SELECT * FROM outreach_targets WHERE id IN (${placeholders}) AND status IN ('approved','pending')`).all(...ids);
  } else {
    rows = db.prepare("SELECT * FROM outreach_targets WHERE status='approved' ORDER BY id LIMIT ?").all(Math.min(limit, 50));
  }
  const results = [];
  for (const row of rows) {
    if (_hourlyCount() >= HOURLY_CAP) { results.push({ id: row.id, ok: false, error: 'hourly_cap_reached' }); break; }
    if (dryRun) { results.push({ id: row.id, ok: true, dryRun: true, to: row.contact_email, subject: row.draft_subject }); continue; }
    const r = await _sendOne(row);
    results.push({ id: row.id, ...r });
    // small delay to avoid burst
    await new Promise((r) => setTimeout(r, 800));
  }
  res.json({ ok: true, attempted: results.length, dry_run: !!dryRun, results });
});

// ─── Suppression list ────────────────────────────────────────────────
router.get('/suppress/list', authenticateAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM outreach_suppression ORDER BY id DESC LIMIT 500').all();
  res.json({ ok: true, items: rows });
});
router.post('/suppress', authenticateAdmin, (req, res) => {
  const { email_or_host, reason } = req.body || {};
  if (!email_or_host) return res.status(400).json({ ok: false, error: 'email_or_host required' });
  try {
    db.prepare('INSERT OR IGNORE INTO outreach_suppression (email_or_host, reason) VALUES (?, ?)').run(String(email_or_host).toLowerCase(), reason || 'manual');
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

module.exports = router;
