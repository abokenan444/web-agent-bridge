/**
 * Public ShieldLink endpoints — no authentication required.
 *   GET  /api/shieldlink/verify?token=...      → Trust Preview verification result
 *   POST /api/shieldlink/report                 → report a phishing link
 *   GET  /api/shieldlink/recent                 → recent verified-brand activity (redacted)
 *   POST /api/shieldlink/event                  → record open/confirm/cancel for a token
 */
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const sl = require('../services/shieldlink');

const router = express.Router();

const verifyLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });
const reportLimiter = rateLimit({ windowMs: 60 * 60_000, max: 20, standardHeaders: true, legacyHeaders: false });

router.get('/verify', verifyLimiter, (req, res) => {
  const token = String(req.query.token || '').trim();
  if (!token) return res.status(400).json({ error: 'token required' });
  const result = sl.verifyToken(token);
  if (!result.ok && result.reasons && result.reasons[0] === 'unknown_token') {
    return res.status(404).json(result);
  }
  res.json(result);
});

router.post('/event', verifyLimiter, express.json({ limit: '8kb' }), (req, res) => {
  const token = String((req.body && req.body.token) || req.query.token || '').trim();
  const event = String((req.body && req.body.event) || '').trim();
  if (!token || !['open', 'confirm', 'cancel', 'flag', 'verify_fail'].includes(event)) {
    return res.status(400).json({ error: 'token + event required' });
  }
  const ok = sl.recordEvent(token, event, {
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    ref: req.headers.referer || null,
  });
  res.json({ ok });
});

router.post('/report', reportLimiter, express.json({ limit: '8kb' }), (req, res) => {
  const body = req.body || {};
  const r = sl.reportLink({
    token: body.token || null,
    url: body.url || null,
    reason: body.reason || null,
    reporterIp: req.ip,
    reporterId: req.user && req.user.id ? String(req.user.id) : null,
  });
  if (!r.ok) return res.status(400).json(r);
  res.json(r);
});

router.get('/recent', verifyLimiter, (req, res) => {
  // Surface only minimal redacted info — domain + display name + status + count.
  const stats = sl.getStats();
  const verified = sl.listBrands({ status: 'verified', limit: 20 }).map(b => ({
    domain: b.domain,
    display_name: b.display_name,
    category: b.category,
    country: b.country,
    verified_badge: !!b.verified_badge,
    since: b.reviewed_at,
  }));
  res.json({ verified_brands: verified, stats });
});

module.exports = router;
