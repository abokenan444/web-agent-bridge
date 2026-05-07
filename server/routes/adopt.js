/**
 * /api/adopt — Adoption Agent endpoints.
 *
 * POST /api/adopt/suggest   { url } -> { wab_json, dns_txt, deploy, ssl, stack }
 * GET  /api/adopt/suggest?url=
 * GET  /api/adopt/wab.json?url=     -> raw wab.json (Content-Type: application/json)
 *
 * Public, lightly rate-limited via apiLimiter at mount site.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { suggest } = require('../services/adoption-agent');

function _isValidPublicUrl(s) {
  try {
    const u = new URL(s.match(/^https?:\/\//i) ? s : `https://${s}`);
    if (!u.hostname || u.hostname.length < 3) return false;
    if (/^localhost$|\.local$|^127\.|^10\.|^192\.168\.|^169\.254\./.test(u.hostname)) return false;
    return true;
  } catch { return false; }
}

router.post('/suggest', async (req, res) => {
  const url = req.body && req.body.url;
  if (!_isValidPublicUrl(url)) return res.status(400).json({ ok: false, error: 'invalid_or_private_url' });
  try {
    const out = await suggest(url, { timeoutMs: 9000 });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/suggest', async (req, res) => {
  const url = req.query.url;
  if (!_isValidPublicUrl(url)) return res.status(400).json({ ok: false, error: 'invalid_or_private_url' });
  try {
    const out = await suggest(url, { timeoutMs: 9000 });
    res.json(out);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

router.get('/wab.json', async (req, res) => {
  const url = req.query.url;
  if (!_isValidPublicUrl(url)) return res.status(400).json({ ok: false, error: 'invalid_or_private_url' });
  try {
    const out = await suggest(url, { timeoutMs: 9000, includeTls: false });
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="wab.json"`);
    res.end(JSON.stringify(out.wab_json, null, 2) + '\n');
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
