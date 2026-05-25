// WAB Observatory — public registry of known WAB-enabled domains.
//
// Sources (cheap, additive):
//   1. data/observatory-seed.json — manual seed list (curated).
//   2. data/observatory-cache.json — domains that have hit /api/notary,
//      /badge/:domain, or /check at least once.
//
// Both files are JSON arrays of host strings. We deduplicate and re-probe
// each host every 30 minutes via the Notary attestation cache so the
// "verified / enabled / missing" status stays fresh.

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const router = express.Router();

const SEED_PATH  = path.join(__dirname, '..', '..', 'data', 'observatory-seed.json');
const CACHE_PATH = path.join(__dirname, '..', '..', 'data', 'observatory-cache.json');
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

function readJsonArray(p) {
  try {
    if (!fs.existsSync(p)) return [];
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return Array.isArray(j) ? j.filter(h => typeof h === 'string' && HOST_RE.test(h)) : [];
  } catch (_) { return []; }
}

function writeJsonArray(p, arr) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(arr, null, 2));
  } catch (_) {}
}

// In-memory status cache (host -> { status, signed, observed_at, exp })
const _status = new Map();
const TTL = 30 * 60 * 1000;

async function probe(host) {
  const cached = _status.get(host);
  if (cached && cached.exp > Date.now()) return cached;
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), 3500);
  let status = 'missing', signed = false;
  try {
    const r = await fetch(`https://${host}/.well-known/wab.json`, { signal: ac.signal, redirect: 'follow' });
    if (r.ok) {
      const j = await r.json().catch(() => null);
      if (j) {
        signed = !!(j.signature || (j.trust && j.trust.signed));
        status = signed ? 'verified' : 'enabled';
      } else { status = 'invalid'; }
    }
  } catch (_) {}
  finally { clearTimeout(t); }
  const rec = { host, status, signed, observed_at: new Date().toISOString(), exp: Date.now() + TTL };
  _status.set(host, rec);
  return rec;
}

function knownHosts() {
  const seed  = readJsonArray(SEED_PATH);
  const cache = readJsonArray(CACHE_PATH);
  return Array.from(new Set([...seed, ...cache])).sort();
}

router.post('/track', express.json({ limit: '1kb' }), (req, res) => {
  const host = String(req.body && req.body.host || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) return res.status(400).json({ error: 'invalid_host' });
  const cache = readJsonArray(CACHE_PATH);
  if (!cache.includes(host)) {
    cache.push(host);
    writeJsonArray(CACHE_PATH, cache);
  }
  res.json({ tracked: true, host });
});

router.get('/domains', async (req, res) => {
  const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));
  const hosts = knownHosts().slice(0, limit);
  const results = await Promise.all(hosts.map(h => probe(h).catch(() => ({ host: h, status: 'missing', signed: false }))));
  res.set('Cache-Control', 'public, max-age=120');
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    count: results.length,
    generated_at: new Date().toISOString(),
    domains: results.map(({ exp, ...r }) => r)
  });
});

router.get('/stats', async (req, res) => {
  const hosts = knownHosts();
  const results = await Promise.all(hosts.map(h => probe(h).catch(() => ({ status: 'missing', signed: false }))));
  const by = { verified: 0, enabled: 0, missing: 0, invalid: 0 };
  for (const r of results) by[r.status] = (by[r.status] || 0) + 1;
  res.set('Cache-Control', 'public, max-age=120');
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    total: results.length,
    signed: results.filter(r => r.signed).length,
    by_status: by,
    generated_at: new Date().toISOString()
  });
});

module.exports = router;
