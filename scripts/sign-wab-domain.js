/**
 * Generate the WAB trust artifacts for webagentbridge.com:
 *   - a fresh Ed25519 keypair
 *   - a signed /.well-known/wab.json
 *   - the DNS TXT record string to paste into Cloudflare
 *
 * Outputs:
 *   public/.well-known/wab.json           (committed; served publicly)
 *   server/secrets/wab-signing-key.pem    (PRIVATE; gitignored)
 *   stdout: the DNS TXT record line
 *
 * Usage (idempotent — won't overwrite an existing key):
 *   node scripts/sign-wab-domain.js [host]   # default host = www.webagentbridge.com
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = process.argv[2] || 'www.webagentbridge.com';
const ROOT = path.join(__dirname, '..');
const KEY_DIR = path.join(ROOT, 'server', 'secrets');
const KEY_FILE = path.join(KEY_DIR, 'wab-signing-key.pem');
const PUB_FILE = path.join(KEY_DIR, 'wab-signing-pub.pem');
const WAB_JSON = path.join(ROOT, 'public', '.well-known', 'wab.json');

function canonicalJson(obj) {
  if (obj === null || typeof obj !== 'object') { return JSON.stringify(obj); }
  if (Array.isArray(obj)) { return '[' + obj.map(canonicalJson).join(',') + ']'; }
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJson(obj[k])).join(',') + '}';
}

fs.mkdirSync(KEY_DIR, { recursive: true });
fs.mkdirSync(path.dirname(WAB_JSON), { recursive: true });

let priv, pub;
if (fs.existsSync(KEY_FILE) && fs.existsSync(PUB_FILE)) {
  console.log(`[sign] reusing existing key at ${KEY_FILE}`);
  priv = crypto.createPrivateKey(fs.readFileSync(KEY_FILE));
  pub  = crypto.createPublicKey(fs.readFileSync(PUB_FILE));
} else {
  console.log('[sign] generating new Ed25519 keypair…');
  const kp = crypto.generateKeyPairSync('ed25519');
  priv = kp.privateKey; pub = kp.publicKey;
  fs.writeFileSync(KEY_FILE, priv.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  fs.writeFileSync(PUB_FILE, pub.export({ format: 'pem', type: 'spki' }));
}

// Raw 32-byte public key (last 32 bytes of SPKI DER)
const spkiDer = pub.export({ format: 'der', type: 'spki' });
const rawPk = spkiDer.subarray(spkiDer.length - 32);
const pkB64 = rawPk.toString('base64');

const issuedAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

const payload = {
  version: 'wab1',
  type: 'wab.trust',
  host: HOST,
  endpoint: 'https://www.webagentbridge.com',
  issued_at: issuedAt,
  expires_at: expiresAt,
  capabilities: {
    discovery: true,
    shieldqr: true,
    governance: true,
    plans_api: '/api/plans',
    scan_api:  '/api/shieldqr/scan',
  },
  trust: { pk: 'ed25519:' + pkB64 },
};

const message = Buffer.from(canonicalJson(payload), 'utf8');
const sig = crypto.sign(null, message, priv);
const sigB64 = sig.toString('base64');

const doc = { payload, signature: 'ed25519:' + sigB64 };
fs.writeFileSync(WAB_JSON, JSON.stringify(doc, null, 2) + '\n', 'utf8');
console.log(`[sign] wrote ${WAB_JSON}`);

const txt = `v=wab1; endpoint=https://www.webagentbridge.com/.well-known/wab.json; pk=ed25519:${pkB64}; shieldqr=enabled`;

console.log('\n──────────────────────────────────────────────────────────────────────');
console.log(' Add these DNS records on Cloudflare for webagentbridge.com:');
console.log('──────────────────────────────────────────────────────────────────────');
console.log(` 1. _wab.${HOST.replace(/^www\./, '')}    TXT   "${txt}"`);
console.log(` 2. _wab.${HOST}                          TXT   "${txt}"`);
console.log('──────────────────────────────────────────────────────────────────────');
console.log(` Public key (base64-32): ${pkB64}`);
console.log(`         (PEM): ${PUB_FILE}`);
console.log(' Private key (KEEP SECRET): ' + KEY_FILE);
console.log('──────────────────────────────────────────────────────────────────────\n');
