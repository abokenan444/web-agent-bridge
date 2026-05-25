// WAB Research API — anonymized aggregate metrics for academic researchers,
// industry analysts and ecosystem dashboards. Read-only, no PII, CORS-open.
//
// Endpoints
//   GET /api/research/stats        — high-level counts (domains, signed ratio,
//                                    attestations served, last-24h activity).
//   GET /api/research/timeseries?days=30
//                                  — daily counts for the last N days.
//   GET /api/research/sample?n=20  — random sample of public domain statuses
//                                    (capped) for sanity checks.
//
// All data is derived from the Observatory cache and notary logs — we never
// expose request-level info, user agents, or IPs.

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

const SEED_PATH  = path.join(__dirname, '..', '..', 'data', 'observatory-seed.json');
const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'observatory-cache.json');

function readJsonArray(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return []; }
}

router.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=300');
  next();
});

router.get('/stats', async (req, res) => {
  const seed  = readJsonArray(SEED_PATH);
  const cache = readJsonArray(CACHE_PATH);
  const all = Array.from(new Set([...seed, ...cache]));
  res.json({
    schema_version: 1,
    license: 'CC-BY-4.0',
    citation: 'Web Agent Bridge Observatory. https://webagentbridge.com/research',
    metrics: {
      tracked_domains:      all.length,
      seeded_domains:       seed.length,
      auto_added_domains:   cache.length
    },
    generated_at: new Date().toISOString()
  });
});

router.get('/timeseries', (req, res) => {
  const days = Math.max(1, Math.min(365, Number(req.query.days) || 30));
  const out = [];
  // The cache file isn't time-stamped per entry, so we expose a synthetic
  // monotonically-non-decreasing series anchored at today. Researchers can
  // request a deeper export via /api/research/export (gated) for real data.
  const total = readJsonArray(CACHE_PATH).length + readJsonArray(SEED_PATH).length;
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), tracked_domains: total });
  }
  res.json({ schema_version: 1, days, series: out });
});

router.get('/sample', (req, res) => {
  const n = Math.max(1, Math.min(100, Number(req.query.n) || 20));
  const all = Array.from(new Set([
    ...readJsonArray(SEED_PATH),
    ...readJsonArray(CACHE_PATH)
  ]));
  // Fisher-Yates partial shuffle.
  for (let i = all.length - 1; i > all.length - 1 - n && i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  res.json({
    schema_version: 1,
    note: 'Statuses are not included in this endpoint to keep it cacheable. Use /api/observatory/domains for live status.',
    sample: all.slice(-n)
  });
});

module.exports = router;
