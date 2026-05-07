#!/usr/bin/env node
/**
 * Dogfood demo: WAB uses its own SDK to discover itself.
 *
 *   node examples/self-discovery.js                 # runs against webagentbridge.com
 *   node examples/self-discovery.js https://acme.com
 *
 * Demonstrates:
 *   • discover() — pulls /.well-known/wab.json (preferred) or falls back to
 *     JSON-LD / OpenGraph / sitemap.xml / robots.txt.
 *   • Trust validation via the published Ed25519 signature + DNS pin.
 *   • SSL fingerprint comparison.
 */

const { discover } = require('../sdk/auto-discovery');
const tls = require('node:tls');
const dns = require('node:dns').promises;
const crypto = require('node:crypto');

const target = process.argv[2] || 'https://www.webagentbridge.com';

function pad(s, n) { return String(s).padEnd(n); }

async function fetchTlsFingerprint(host) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate(false);
      sock.end();
      const fp = (cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
      resolve({ fp, valid_to: cert.valid_to, issuer: cert.issuer && cert.issuer.O });
    });
    sock.on('error', () => resolve({ fp: null }));
    sock.setTimeout(8000, () => { sock.destroy(); resolve({ fp: null }); });
  });
}

async function dnsTxt(host) {
  try { return (await dns.resolveTxt(`_wab.${host}`)).map((r) => r.join('')); }
  catch { return []; }
}

function verifyEd25519(payload, signatureB64, pkB64) {
  try {
    const pkRaw = Buffer.from(pkB64, 'base64');
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pkRaw]);
    const pk = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
    const canon = canonicalJson(payload);
    return crypto.verify(null, Buffer.from(canon, 'utf8'), pk, Buffer.from(signatureB64, 'base64'));
  } catch (e) { return false; }
}

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

(async () => {
  console.log(`\n  Web Agent Bridge — Self-Discovery Demo`);
  console.log(`  Target: ${target}\n`);

  const env = await discover(target);

  console.log(`  ${pad('source', 14)} ${env.source}`);
  console.log(`  ${pad('site', 14)} ${env.site && env.site.name}`);
  console.log(`  ${pad('description', 14)} ${(env.site && env.site.description) || '—'}`);
  console.log(`  ${pad('actions', 14)} ${env.actions.length}`);
  for (const a of env.actions.slice(0, 6)) console.log(`     • ${a.name} — ${a.description || ''}`);
  console.log(`  ${pad('sitemap urls', 14)} ${env.sitemap.length}`);

  // Signed wab.json branch
  if (env.source === 'wab.json' && env.raw) {
    const { payload, signature } = env.raw;
    if (payload && signature) {
      const host = new URL(target).hostname;
      const txt = (await dnsTxt(host))[0] || (await dnsTxt(host.replace(/^www\./, '')))[0] || '';
      const pkMatch = txt.match(/pk=ed25519:([A-Za-z0-9+/=]+)/);
      const sslDnsMatch = txt.match(/ssl_thumbprint=([0-9a-f]+)/i);
      const pkB64 = pkMatch ? pkMatch[1] : (payload.trust && payload.trust.pk || '').replace(/^ed25519:/, '');
      const sigB64 = String(signature).replace(/^ed25519:/, '');

      const sigOk = verifyEd25519(payload, sigB64, pkB64);
      console.log(`\n  Trust:`);
      console.log(`     ed25519 signature  ${sigOk ? 'VALID ✓' : 'INVALID ✗'}`);
      console.log(`     dns pk source      ${pkMatch ? '_wab DNS TXT' : 'wab.json'}`);

      // SSL pin check
      const live = await fetchTlsFingerprint(host);
      const pinned = (payload.trust && payload.trust.ssl && payload.trust.ssl.thumbprint) || sslDnsMatch && sslDnsMatch[1];
      if (live.fp) {
        const match = pinned && live.fp.toLowerCase() === pinned.toLowerCase();
        console.log(`     ssl fingerprint    ${match ? 'PINNED MATCH ✓' : (pinned ? 'MISMATCH ✗' : 'no pin')}`);
        console.log(`        live           ${live.fp.slice(0, 32)}…`);
        if (pinned) console.log(`        pinned         ${pinned.slice(0, 32)}…`);
        if (live.valid_to) console.log(`        valid_to       ${live.valid_to}`);
      }
    }
  } else {
    console.log(`\n  No /.well-known/wab.json found — auto-discovery returned a normalized envelope.`);
    if (env.products && env.products.length) console.log(`     ${env.products.length} schema.org Product nodes detected`);
    if (env.meta && env.meta.og && env.meta.og.site_name) console.log(`     OpenGraph site_name: ${env.meta.og.site_name}`);
  }

  console.log('');
})().catch((e) => { console.error('demo failed:', e); process.exit(1); });
