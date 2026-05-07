/**
 * Public unsubscribe — token-based, GET so it works from email links.
 * RFC 8058 List-Unsubscribe-Post=One-Click also supports POST (no auth).
 */

'use strict';

const express = require('express');
const router = express.Router();
const { db } = require('../models/db');

function _process(token) {
  if (!token || !/^[a-f0-9]{8,64}$/i.test(token)) return { ok: false, code: 400 };
  const row = db.prepare('SELECT id, contact_email, host FROM outreach_targets WHERE unsubscribe_token = ?').get(token);
  if (!row) return { ok: false, code: 404 };
  if (row.contact_email) {
    db.prepare('INSERT OR IGNORE INTO outreach_suppression (email_or_host, reason) VALUES (?, ?)').run(String(row.contact_email).toLowerCase(), 'unsubscribe');
  }
  if (row.host) {
    db.prepare('INSERT OR IGNORE INTO outreach_suppression (email_or_host, reason) VALUES (?, ?)').run(String(row.host).toLowerCase(), 'unsubscribe');
  }
  db.prepare("UPDATE outreach_targets SET status='suppressed', updated_at=datetime('now') WHERE unsubscribe_token = ?").run(token);
  try { db.prepare('INSERT INTO outreach_log (target_id, event, details) VALUES (?, ?, ?)').run(row.id, 'unsubscribed', null); } catch { /* ignore */ }
  return { ok: true, email: row.contact_email, host: row.host };
}

const _page = (msg, color) => `<!doctype html><html><head><meta charset="utf-8"><title>Unsubscribed — Web Agent Bridge</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#0a0e1a;color:#e8eeff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
.card{background:#0f1626;border:1px solid #1f2a44;border-radius:16px;padding:36px;max-width:520px;text-align:center}
.ic{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;background:${color};display:grid;place-items:center;font-size:32px}
h1{margin:0 0 10px;font-size:22px}p{color:#8a94b0;line-height:1.6}a{color:#22d3ee}</style></head>
<body><div class="card"><div class="ic">✓</div><h1>${msg.title}</h1><p>${msg.body}</p><p style="margin-top:22px"><a href="https://www.webagentbridge.com">webagentbridge.com</a></p></div></body></html>`;

router.get('/unsubscribe', (req, res) => {
  const r = _process(req.query.token);
  if (!r.ok) {
    res.status(r.code).type('html').send(_page({ title: 'Link not valid', body: 'This unsubscribe link is invalid or has expired. Please contact support@webagentbridge.com if you continue to receive emails.' }, '#ef4444'));
    return;
  }
  res.type('html').send(_page({ title: 'You are unsubscribed', body: `${r.email || r.host} has been added to our suppression list. You will not receive further outreach from us.` }, '#22c55e'));
});

// RFC 8058 one-click POST (used by Gmail/Outlook auto-unsubscribe buttons)
router.post('/unsubscribe', express.urlencoded({ extended: false }), (req, res) => {
  const token = (req.body && req.body.token) || req.query.token;
  const r = _process(token);
  res.status(r.ok ? 200 : (r.code || 400)).json({ ok: r.ok });
});

module.exports = router;
