/**
 * WAB ShieldQR — verification service
 * --------------------------------------------------------------
 * Given a URL extracted from a QR code (or any short link), verify whether
 * it's safe to open.  Layered checks:
 *
 *   1. Heuristic risk score (shorteners, brand-new TLDs, IP literals, etc.)
 *   2. DNS Discovery — TXT lookup on  _wab.{domain}  and  _wab-trust.{domain}
 *   3. Cryptographic Trust  — fetch /.well-known/wab.json and verify
 *      Ed25519 signature against the public key advertised in the TXT record.
 *   4. SSL/TLS health — fetch the cert, compare thumbprint, check expiry.
 *
 * The result is a *level* (green / yellow / red) plus a structured
 * `signals[]` array so a UI can show a human-readable explanation.
 *
 * No third-party deps — only Node built-ins (`dns/promises`, `tls`,
 * `crypto`, `https`).
 */
'use strict';

const dns = require('node:dns').promises;
const tls = require('node:tls');
const crypto = require('node:crypto');
const https = require('node:https');
const http = require('node:http');

const SHORTENER_HOSTS = new Set([
  'bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly',
  'cutt.ly', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'rb.gy', 'lnkd.in',
]);

const FETCH_TIMEOUT_MS = 4000;
const MAX_BODY_BYTES = 64 * 1024;

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Inspect a single URL.  Always resolves; never throws.
 * @param {string} input  raw URL or string from a QR scan
 * @returns {Promise<{level:'green'|'yellow'|'red', score:number, url:string|null,
 *   host:string|null, signals:Array, dns:any, trust:any, ssl:any, generated_at:string}>}
 */
async function scan(input) {
  const t0 = Date.now();
  const out = {
    level: 'yellow',
    score: 50,
    url: null,
    host: null,
    signals: [],
    dns: null,
    trust: null,
    ssl: null,
    generated_at: new Date().toISOString(),
    elapsed_ms: 0,
  };

  const parsed = parseUrl(input);
  if (!parsed) {
    out.level = 'red';
    out.score = 0;
    out.signals.push({ id: 'invalid_url', severity: 'high', message: 'Cannot parse a URL from input' });
    out.elapsed_ms = Date.now() - t0;
    return out;
  }
  out.url = parsed.href;
  out.host = parsed.hostname;

  // 1. Static heuristics
  applyHeuristics(parsed, out);

  // 2. DNS Discovery (parallel TXT lookups)
  const [discovery, trust] = await Promise.all([
    safeTxt(`_wab.${parsed.hostname}`),
    safeTxt(`_wab-trust.${parsed.hostname}`),
  ]);
  out.dns = { discovery, trust };
  if (discovery.records.length) {
    out.signals.push({ id: 'wab_dns', severity: 'good', message: `_wab TXT record found at ${parsed.hostname}` });
  }
  if (trust.records.length) {
    out.signals.push({ id: 'wab_trust_dns', severity: 'good', message: `_wab-trust TXT record found` });
  }

  // 3. Cryptographic trust  (only if DNS announced a key)
  const wabFields = parseWabTxt(discovery.records.concat(trust.records));
  if (wabFields.pk || wabFields.endpoint) {
    out.trust = await verifyTrust(parsed, wabFields).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (out.trust.ok) {
      out.signals.push({ id: 'signature_ok', severity: 'good', message: 'Ed25519 signature verified against DNS public key' });
    } else if (out.trust && out.trust.error) {
      out.signals.push({ id: 'signature_fail', severity: 'high', message: `Trust check failed: ${out.trust.error}` });
    }
  }

  // 4. SSL/TLS — only over HTTPS hosts
  if (parsed.protocol === 'https:') {
    out.ssl = await inspectSsl(parsed.hostname, parsed.port ? Number(parsed.port) : 443).catch((e) => ({ ok: false, error: String(e?.message || e) }));
    if (out.ssl.ok) {
      const daysLeft = out.ssl.days_until_expiry;
      if (daysLeft != null && daysLeft < 0) {
        out.signals.push({ id: 'ssl_expired', severity: 'high', message: `SSL certificate expired ${-daysLeft}d ago` });
      } else if (daysLeft != null && daysLeft < 7) {
        out.signals.push({ id: 'ssl_expiring', severity: 'medium', message: `SSL certificate expires in ${daysLeft} days` });
      }
      if (wabFields.ssl_thumbprint && out.ssl.fingerprint_sha256 &&
          wabFields.ssl_thumbprint.toLowerCase() !== out.ssl.fingerprint_sha256.toLowerCase()) {
        out.signals.push({ id: 'ssl_thumbprint_mismatch', severity: 'high',
          message: 'SSL fingerprint does not match the value advertised via _wab DNS' });
      }
    }
  }

  // 5. Final level — combine signals
  const verdict = computeLevel(out.signals, !!out.trust?.ok);
  out.level = verdict.level;
  out.score = verdict.score;
  out.elapsed_ms = Date.now() - t0;
  return out;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseUrl(input) {
  if (!input || typeof input !== 'string') { return null; }
  let s = input.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { s = 'https://' + s; }
  try { return new URL(s); } catch { return null; }
}

function applyHeuristics(parsed, out) {
  const host = parsed.hostname.toLowerCase();
  // IP-literal hosts are suspicious
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    out.signals.push({ id: 'ip_literal_host', severity: 'high', message: 'URL points to a raw IP address' });
  }
  if (SHORTENER_HOSTS.has(host)) {
    out.signals.push({ id: 'shortener', severity: 'medium', message: `URL uses a shortener domain (${host})` });
  }
  if (parsed.protocol === 'http:') {
    out.signals.push({ id: 'plain_http', severity: 'medium', message: 'URL uses plain HTTP (no TLS)' });
  }
  // Punycode / homoglyph hint
  if (host.includes('xn--')) {
    out.signals.push({ id: 'punycode', severity: 'medium', message: 'Hostname uses Punycode (possible homoglyph attack)' });
  }
  // Excessive subdomains
  if (host.split('.').length > 5) {
    out.signals.push({ id: 'deep_subdomain', severity: 'low', message: 'Hostname has unusually many subdomain levels' });
  }
}

async function safeTxt(name) {
  try {
    const records = await dns.resolveTxt(name);
    return { name, records: records.map((parts) => parts.join('')), error: null };
  } catch (err) {
    return { name, records: [], error: err.code || String(err.message || err) };
  }
}

/**
 * Parse `key=value;` style fields out of TXT records that begin with `v=wab1`.
 * Returns merged object with at least:
 *   v, endpoint, pk, ssl_thumbprint, ssl_expires, shieldqr
 */
function parseWabTxt(rawRecords) {
  const out = {};
  for (const rec of rawRecords) {
    if (!/v\s*=\s*wab1/i.test(rec)) { continue; }
    const parts = rec.split(';').map((p) => p.trim()).filter(Boolean);
    for (const p of parts) {
      const eq = p.indexOf('=');
      if (eq < 0) { continue; }
      const k = p.slice(0, eq).trim().toLowerCase();
      const v = p.slice(eq + 1).trim();
      if (k && v && !out[k]) { out[k] = v; }
    }
  }
  return out;
}

async function verifyTrust(parsed, wabFields) {
  const base = wabFields.endpoint && /^https?:\/\//i.test(wabFields.endpoint)
    ? wabFields.endpoint
    : `${parsed.origin}/.well-known/wab.json`;
  const wabJsonUrl = wabFields.endpoint && wabFields.endpoint.endsWith('.json')
    ? wabFields.endpoint
    : (base.endsWith('/') ? base + '.well-known/wab.json' : base + '/.well-known/wab.json');

  const fetched = await fetchSmall(wabJsonUrl);
  if (!fetched.ok) { return { ok: false, error: `cannot fetch wab.json (${fetched.error || fetched.status})` }; }

  let doc;
  try { doc = JSON.parse(fetched.body); } catch { return { ok: false, error: 'wab.json is not valid JSON' }; }

  // signature is over the canonical JSON of `doc.payload`
  const sig = doc.signature;
  const pkRaw = wabFields.pk || (doc.trust && doc.trust.pk);
  if (!sig || !pkRaw || !doc.payload) {
    return { ok: false, error: 'wab.json missing payload/signature/pk' };
  }
  const pk = pkRaw.replace(/^ed25519:/i, '');

  let pkBytes;
  try { pkBytes = Buffer.from(pk, 'base64'); } catch { return { ok: false, error: 'invalid base64 pk' }; }
  if (pkBytes.length !== 32) { return { ok: false, error: `pk has wrong length (${pkBytes.length} bytes, want 32)` }; }
  let sigBytes;
  try { sigBytes = Buffer.from(sig.replace(/^ed25519:/i, ''), 'base64'); } catch { return { ok: false, error: 'invalid base64 signature' }; }

  // Wrap raw 32-byte Ed25519 public key in DER (SubjectPublicKeyInfo)
  const der = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    pkBytes,
  ]);
  let pubKey;
  try { pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); }
  catch (e) { return { ok: false, error: 'cannot import Ed25519 pk: ' + e.message }; }

  const message = Buffer.from(canonicalJson(doc.payload), 'utf8');
  const ok = crypto.verify(null, message, pubKey, sigBytes);

  return { ok, payload: doc.payload, signed_with: pk };
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') { return JSON.stringify(obj); }
  if (Array.isArray(obj)) { return '[' + obj.map(canonicalJson).join(',') + ']'; }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

function fetchSmall(url) {
  return new Promise((resolve) => {
    let mod;
    try { mod = url.startsWith('https:') ? https : http; } catch { return resolve({ ok: false, error: 'bad url' }); }
    const req = mod.get(url, { timeout: FETCH_TIMEOUT_MS, headers: { 'User-Agent': 'WAB-ShieldQR/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ ok: false, status: res.statusCode, error: 'redirect_not_followed' });
      }
      let bytes = 0;
      const chunks = [];
      res.on('data', (c) => {
        bytes += c.length;
        if (bytes > MAX_BODY_BYTES) { req.destroy(); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.on('error', (e) => resolve({ ok: false, error: e.message }));
  });
}

function inspectSsl(host, port) {
  return new Promise((resolve) => {
    const socket = tls.connect({ host, port, servername: host, timeout: FETCH_TIMEOUT_MS, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate(true);
      socket.end();
      if (!cert || !cert.valid_to) { return resolve({ ok: false, error: 'no certificate returned' }); }
      const expiry = new Date(cert.valid_to);
      const days = Math.floor((expiry.getTime() - Date.now()) / 86400000);
      const fp = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
      resolve({
        ok: true,
        issuer: cert.issuer && (cert.issuer.O || cert.issuer.CN) || null,
        subject: cert.subject && cert.subject.CN || null,
        valid_to: cert.valid_to,
        valid_from: cert.valid_from,
        days_until_expiry: days,
        fingerprint_sha256: fp,
        authorized: socket.authorized,
        protocol: socket.getProtocol && socket.getProtocol(),
      });
    });
    socket.on('error', (e) => resolve({ ok: false, error: e.message }));
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, error: 'timeout' }); });
  });
}

function computeLevel(signals, signedOk) {
  let score = 60; // neutral start
  for (const s of signals) {
    if (s.severity === 'good')   { score += 20; }
    else if (s.severity === 'low')    { score -= 5; }
    else if (s.severity === 'medium') { score -= 18; }
    else if (s.severity === 'high')   { score -= 40; }
  }
  if (signedOk) { score = Math.max(score, 90); }
  score = Math.max(0, Math.min(100, score));
  let level = 'yellow';
  if (score >= 75 && signedOk) { level = 'green'; }
  else if (score >= 65)        { level = 'yellow'; }
  else if (score < 35)         { level = 'red'; }
  else                          { level = 'yellow'; }
  // Hard-fail on any high-severity signal unless we have a verified signature
  if (signals.some((s) => s.severity === 'high') && !signedOk) { level = 'red'; }
  return { level, score };
}

module.exports = { scan, parseWabTxt, canonicalJson };
