/**
 * Generate the WAB trust artifacts for a domain:
 *   - a (re-used) Ed25519 keypair
 *   - a signed /.well-known/wab.json with live SSL certificate metadata
 *   - the DNS TXT record string to paste at the registrar
 *
 * Output format matches `server/services/wab-crypto.js` so that
 * `/api/discovery/trust/:domain` (and verifyManifest) accept the signature.
 *
 * Usage:
 *   node scripts/sign-wab-domain.js [host]   # default host = www.webagentbridge.com
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ssl = require('../server/services/ssl-inspector');
const wabCrypto = require('../server/services/wab-crypto');

const HOST = process.argv[2] || 'www.webagentbridge.com';
const ROOT = path.join(__dirname, '..');
const KEY_DIR = path.join(ROOT, 'server', 'secrets');
const KEY_FILE = path.join(KEY_DIR, 'wab-signing-key.pem');
const PUB_FILE = path.join(KEY_DIR, 'wab-signing-pub.pem');
const WAB_JSON = path.join(ROOT, 'public', '.well-known', 'wab.json');

(async () => {
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

  const spkiDer = pub.export({ format: 'der', type: 'spki' });
  const rawPk = spkiDer.subarray(spkiDer.length - 32);
  const pkB64 = rawPk.toString('base64');

  const sslInfo = await ssl.inspect(HOST, 443).catch(() => ({ ok: false }));
  const sslBlock = sslInfo.ok ? {
    thumbprint:        sslInfo.fingerprint_sha256,
    expires:           sslInfo.valid_to,
    days_until_expiry: sslInfo.days_until_expiry,
    issuer:            sslInfo.issuer,
    status:            sslInfo.days_until_expiry > 0 ? 'active' : 'expired',
  } : { status: 'unknown' };

  // Flat manifest (compatible with wabCrypto.verifyManifest format used by
  // /api/discovery/trust/:domain). The full v1.3 protocol places the signing
  // metadata in a top-level `signature` OBJECT (not a string).
  const manifest = {
    version:    'wab1',
    type:       'wab.trust',
    host:       HOST,
    endpoint:   `https://${HOST}`,
    issued_at:  new Date().toISOString(),
    expires_at: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    capabilities: {
      discovery: true,
      shieldqr:  true,
      shieldlink: true,
      governance: true,
      plans_api: '/api/plans',
      scan_api:  '/api/shieldqr/scan',
    },
    pk: 'ed25519:' + pkB64,
    ssl: sslBlock,
  };

  // Derive raw 32-byte private key for wabCrypto.signManifest
  const privDer = priv.export({ type: 'pkcs8', format: 'der' });
  const rawPrivB64 = privDer.slice(privDer.length - 32).toString('base64');

  const signed = wabCrypto.signManifest(manifest, rawPrivB64, { embed_public_key: true });
  fs.writeFileSync(WAB_JSON, JSON.stringify(signed, null, 2) + '\n', 'utf8');
  console.log(`[sign] wrote ${WAB_JSON}`);

  // Self-verify so we never deploy a broken artifact.
  const verifyResult = wabCrypto.verifyManifest(signed, pkB64);
  if (!verifyResult.ok) {
    console.error('[sign] SELF-VERIFY FAILED:', verifyResult.reason);
    process.exit(2);
  }
  console.log(`[sign] self-verify OK · key_id=${verifyResult.key_id}`);

  const sslExt = sslInfo.ok
    ? `; ssl_thumbprint=${sslInfo.fingerprint_sha256}; ssl_expires=${sslInfo.valid_to}`
    : '';
  const txt = `v=wab1; endpoint=https://${HOST}/.well-known/wab.json; pk=ed25519:${pkB64}; shieldqr=enabled; shieldlink=enabled${sslExt}`;

  console.log('\n──────────────────────────────────────────────────────────────────────');
  console.log(' Add these DNS records on Cloudflare for ' + HOST.replace(/^www\./, '') + ':');
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(` 1. _wab.${HOST.replace(/^www\./, '')}    TXT   "${txt}"`);
  console.log(` 2. _wab.${HOST}                          TXT   "${txt}"`);
  console.log('──────────────────────────────────────────────────────────────────────');
  console.log(` Public key (base64-32): ${pkB64}`);
  console.log(` Key fingerprint:        ${wabCrypto.fingerprint(pkB64)}`);
  if (sslInfo.ok) {
    console.log(` SSL fingerprint:        ${sslInfo.fingerprint_sha256}`);
    console.log(` SSL expires:            ${sslInfo.valid_to} (${sslInfo.days_until_expiry} days)`);
  } else {
    console.log(` SSL inspect:            failed (${sslInfo.error || 'n/a'})`);
  }
  console.log(`         (PEM): ${PUB_FILE}`);
  console.log(' Private key (KEEP SECRET): ' + KEY_FILE);
  console.log('──────────────────────────────────────────────────────────────────────\n');
})().catch((err) => { console.error('[sign] failed:', err); process.exit(1); });
