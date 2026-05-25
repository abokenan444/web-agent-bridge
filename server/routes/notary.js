// WAB Notary — neutral third-party attestation service.
//
// Anyone can POST { host } and receive a server-signed JSON receipt stating
// what the notary observed at `https://<host>/.well-known/wab.json` at a
// given instant. Receipts are deterministic over (host, manifest bytes,
// observed_at minute) and cached so repeated calls are cheap.
//
// Receipts include:
//   - status: "verified" | "enabled" | "missing" | "invalid"
//   - manifest_sha256
//   - signed:    boolean (manifest carried an Ed25519 signature)
//   - observed_at: ISO8601
//   - notary:    fingerprint of the server signing key
//   - signature: Ed25519 signature over canonicalized payload
//
// The notary's signing key is generated on first use and persisted to
// `data/.notary-key.json`. The PUBLIC key is exposed at GET /api/notary/key
// and at /.well-known/wab-notary.json so clients can verify offline.

const express = require('express');
const crypto  = require('crypto');
const fs      = require('fs');
const path    = require('path');
const wabCrypto = require('../services/wab-crypto');

const router = express.Router();
const KEY_PATH    = path.join(__dirname, '..', '..', 'data', '.notary-key.json');     // legacy single-key (kept for migration)
const KEYS_PATH   = path.join(__dirname, '..', '..', 'data', '.notary-keys.json');    // key history (rotation)
const PEERS_PATH  = path.join(__dirname, '..', '..', 'data', 'notary-peers.json');    // web-of-trust peer notaries
const ADMIN_TOKEN = process.env.WAB_NOTARY_ADMIN_TOKEN || '';

function safeReadJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return fallback; }
}
function safeWriteJson(p, value, mode) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(value, null, 2), mode ? { mode } : undefined);
}

function loadKeys() {
  // Migrate legacy single-key file → new history file on first load.
  let keys = safeReadJson(KEYS_PATH, null);
  if (Array.isArray(keys) && keys.length) return keys;
  const legacy = safeReadJson(KEY_PATH, null);
  if (legacy && legacy.private_key && legacy.public_key) {
    keys = [{
      id: 'k1',
      public_key:  legacy.public_key,
      private_key: legacy.private_key,
      created_at:  new Date().toISOString(),
      retired_at:  null
    }];
  } else {
    const kp = wabCrypto.generateKeyPair();
    keys = [{
      id: 'k1',
      public_key:  kp.public_key,
      private_key: kp.private_key,
      created_at:  new Date().toISOString(),
      retired_at:  null
    }];
  }
  safeWriteJson(KEYS_PATH, keys, 0o600);
  return keys;
}
function activeKey(keys) { return keys.find(k => !k.retired_at) || keys[0]; }
function keyById(keys, id) { return keys.find(k => k.id === id) || null; }

let KEYS = loadKeys();
function CURRENT() { return activeKey(KEYS); }
function FP_OF(pub) { return wabCrypto.fingerprint(pub); }

function canon(obj) {
  // RFC 8785 -ish: stable key order, no whitespace.
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canon).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canon(obj[k])).join(',') + '}';
}

function signPayload(payload) {
  const k = CURRENT();
  const priv = wabCrypto.rawToPrivateKey(k.private_key);
  const sig  = crypto.sign(null, Buffer.from(canon(payload)), priv);
  return sig.toString('base64');
}

const _cache = new Map();
const HOST_RE = /^[a-z0-9.-]+\.[a-z]{2,}$/i;

async function observe(host) {
  const cached = _cache.get(host);
  if (cached && cached.exp > Date.now()) return cached.attestation;
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), 4500);
  let status = 'missing', signed = false, manifest_sha256 = null, manifest_size = 0;
  try {
    const r = await fetch(`https://${host}/.well-known/wab.json`, { signal: ac.signal, redirect: 'follow' });
    if (r.ok) {
      const body = await r.text();
      manifest_size = body.length;
      manifest_sha256 = crypto.createHash('sha256').update(body).digest('hex');
      let j = null;
      try { j = JSON.parse(body); } catch (_) {}
      if (j) {
        signed = !!(j.signature || (j.trust && j.trust.signed));
        status = signed ? 'verified' : 'enabled';
      } else {
        status = 'invalid';
      }
    } else {
      status = 'missing';
    }
  } catch (_) { status = 'missing'; }
  finally { clearTimeout(t); }
  const observed_at = new Date().toISOString();
  const k = CURRENT();
  const payload = { host, status, signed, manifest_sha256, manifest_size, observed_at, notary: FP_OF(k.public_key), key_id: k.id, version: 1 };
  const attestation = { ...payload, algorithm: 'ed25519', signature: signPayload(payload) };
  _cache.set(host, { attestation, exp: Date.now() + 5 * 60 * 1000 });
  return attestation;
}

router.get('/key', (req, res) => {
  const k = CURRENT();
  res.json({
    algorithm: 'ed25519',
    key_id: k.id,
    public_key: k.public_key,
    fingerprint: FP_OF(k.public_key),
    verify_hint: 'sig = ed25519_sign(canonicalize(payload), notary_private_key); canonicalize = sorted keys, no whitespace.'
  });
});

// All keys (active + retired). Clients keep this list to verify historical
// attestations after the notary rotates. Public — never exposes private bytes.
router.get('/keys', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    algorithm: 'ed25519',
    keys: KEYS.map(k => ({
      key_id:      k.id,
      public_key:  k.public_key,
      fingerprint: FP_OF(k.public_key),
      created_at:  k.created_at,
      retired_at:  k.retired_at || null,
      active:      !k.retired_at
    }))
  });
});

// Admin: rotate to a fresh key. Gated by WAB_NOTARY_ADMIN_TOKEN. The previous
// active key is marked `retired_at = now` so it stays available for
// verification of past receipts but is no longer used for signing.
router.post('/admin/rotate', express.json({ limit: '1kb' }), (req, res) => {
  if (!ADMIN_TOKEN || req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const now = new Date().toISOString();
  for (const k of KEYS) if (!k.retired_at) k.retired_at = now;
  const kp = wabCrypto.generateKeyPair();
  const next = {
    id: `k${KEYS.length + 1}`,
    public_key:  kp.public_key,
    private_key: kp.private_key,
    created_at:  now,
    retired_at:  null
  };
  KEYS.push(next);
  safeWriteJson(KEYS_PATH, KEYS, 0o600);
  _cache.clear();
  res.json({
    rotated: true,
    new_key_id: next.id,
    new_fingerprint: FP_OF(next.public_key),
    retired_count: KEYS.length - 1
  });
});

router.post('/attest', express.json({ limit: '4kb' }), async (req, res) => {
  const host = String(req.body && req.body.host || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) return res.status(400).json({ error: 'invalid_host' });
  try {
    const att = await observe(host);
    res.set('Cache-Control', 'public, max-age=60');
    return res.json(att);
  } catch (e) {
    return res.status(500).json({ error: 'attest_failed', detail: e.message });
  }
});

router.get('/attest/:host', async (req, res) => {
  const host = String(req.params.host || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) return res.status(400).json({ error: 'invalid_host' });
  try {
    const att = await observe(host);
    res.set('Cache-Control', 'public, max-age=60');
    res.set('Access-Control-Allow-Origin', '*');
    return res.json(att);
  } catch (e) {
    return res.status(500).json({ error: 'attest_failed', detail: e.message });
  }
});

router.post('/verify', express.json({ limit: '16kb' }), (req, res) => {
  const att = req.body && req.body.attestation;
  if (!att || !att.signature) return res.status(400).json({ error: 'missing_attestation' });
  try {
    const { signature, algorithm, ...payload } = att;
    // Look up the signing key by key_id (preferred) or by notary fingerprint
    // (fallback for older receipts that didn't include key_id).
    let k = null;
    if (payload.key_id) k = keyById(KEYS, payload.key_id);
    if (!k && payload.notary) k = KEYS.find(x => FP_OF(x.public_key) === payload.notary);
    if (!k) return res.status(404).json({ valid: false, error: 'unknown_key_id', key_id: payload.key_id || null });
    const pub = wabCrypto.rawToPublicKey(k.public_key);
    const ok  = crypto.verify(null, Buffer.from(canon(payload)), pub, Buffer.from(signature, 'base64'));
    return res.json({ valid: ok, key_id: k.id, notary: FP_OF(k.public_key), retired_at: k.retired_at || null, payload });
  } catch (e) {
    return res.status(400).json({ error: 'verify_failed', detail: e.message });
  }
});

// ── Web of trust: cross-attestation across multiple notaries ─────────────
// `data/notary-peers.json` is an array of peer notary base URLs (e.g.
// "https://notary.other-example.org/api/notary"). POST /cross-attest fans out
// to each peer's /attest/:host (or /attest with JSON body), collects the
// signed receipts, and returns them alongside our own. The caller verifies
// each receipt independently using the matching notary's public key (which
// each peer publishes at <base>/keys).
async function fetchPeerAttestation(base, host) {
  const ac = new AbortController();
  const t  = setTimeout(() => ac.abort(), 5000);
  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/attest/${encodeURIComponent(host)}`, {
      signal: ac.signal,
      headers: { accept: 'application/json' }
    });
    clearTimeout(t);
    if (!r.ok) return { peer: base, error: `http_${r.status}` };
    const j = await r.json();
    return { peer: base, attestation: j };
  } catch (e) {
    return { peer: base, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

router.post('/cross-attest', express.json({ limit: '4kb' }), async (req, res) => {
  const host = String(req.body && req.body.host || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(host)) return res.status(400).json({ error: 'invalid_host' });
  const peers = safeReadJson(PEERS_PATH, []);
  const own = await observe(host).catch(e => ({ error: e.message }));
  const peerResults = peers.length
    ? await Promise.all(peers.map(p => fetchPeerAttestation(p, host)))
    : [];
  // Consensus: how many notaries (including us) agree on status + sha256.
  const all = [own, ...peerResults.filter(p => p.attestation).map(p => p.attestation)];
  const buckets = new Map();
  for (const a of all) {
    if (!a || !a.status) continue;
    const k = `${a.status}|${a.manifest_sha256 || ''}`;
    buckets.set(k, (buckets.get(k) || 0) + 1);
  }
  let consensus = null, top = 0;
  for (const [k, n] of buckets) if (n > top) { top = n; consensus = k; }
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    host,
    own: own,
    peers: peerResults,
    consensus: consensus ? {
      status: consensus.split('|')[0],
      manifest_sha256: consensus.split('|')[1] || null,
      votes: top,
      total: all.length
    } : null,
    generated_at: new Date().toISOString()
  });
});

// Admin: list / replace peer list. Public GET shows just the URLs.
router.get('/peers', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.json({ peers: safeReadJson(PEERS_PATH, []) });
});
router.put('/admin/peers', express.json({ limit: '8kb' }), (req, res) => {
  if (!ADMIN_TOKEN || req.get('x-admin-token') !== ADMIN_TOKEN) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const peers = Array.isArray(req.body && req.body.peers) ? req.body.peers : null;
  if (!peers) return res.status(400).json({ error: 'expected_peers_array' });
  const clean = peers
    .filter(p => typeof p === 'string' && /^https?:\/\//i.test(p))
    .slice(0, 50);
  safeWriteJson(PEERS_PATH, clean);
  res.json({ saved: clean.length, peers: clean });
});

module.exports = router;
module.exports.currentPublicKey = () => CURRENT().public_key;
module.exports.currentFingerprint = () => FP_OF(CURRENT().public_key);
