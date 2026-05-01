/**
 * WAB Crypto v1.3 — Ed25519 signing + canonical JSON.
 *
 * Trust model:
 *   1. Domain owner generates Ed25519 keypair (offline).
 *   2. Public key published as `pk=ed25519:BASE64KEY` in `_wab` TXT record.
 *      DNSSEC protects the key from tampering at the resolver level.
 *   3. The discovery manifest (wab.json) is signed with the private key.
 *      Agents fetch the manifest, fetch the pubkey from DNS, and verify.
 *   4. No CA required. Trust root = DNS + DNSSEC + TLS — already universal.
 */

'use strict';

const crypto = require('crypto');

/** Generate a fresh Ed25519 keypair encoded as base64 (raw 32-byte form). */
function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  // Export raw public key (last 32 bytes of DER)
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPub = pubDer.slice(pubDer.length - 32);
  // Export raw private key (last 32 bytes of DER PKCS#8)
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const rawPriv = privDer.slice(privDer.length - 32);
  return {
    public_key: rawPub.toString('base64'),
    private_key: rawPriv.toString('base64'),
    algorithm: 'ed25519',
    fingerprint: fingerprint(rawPub.toString('base64')),
    created_at: new Date().toISOString(),
  };
}

/** SHA-256(public_key) base64, first 16 chars — short, stable identifier. */
function fingerprint(publicKeyB64) {
  const raw = Buffer.from(publicKeyB64, 'base64');
  return crypto.createHash('sha256').update(raw).digest('base64').slice(0, 16);
}

/** Wrap a 32-byte raw Ed25519 key in DER for Node's crypto API. */
function rawToPublicKey(rawB64) {
  const raw = Buffer.from(rawB64, 'base64');
  if (raw.length !== 32) throw new Error('public key must be 32 raw bytes (base64)');
  // SPKI prefix for Ed25519
  const prefix = Buffer.from('302a300506032b6570032100', 'hex');
  const der = Buffer.concat([prefix, raw]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

function rawToPrivateKey(rawB64) {
  const raw = Buffer.from(rawB64, 'base64');
  if (raw.length !== 32) throw new Error('private key must be 32 raw bytes (base64)');
  // PKCS#8 prefix for Ed25519
  const prefix = Buffer.from('302e020100300506032b657004220420', 'hex');
  const der = Buffer.concat([prefix, raw]);
  return crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
}

/**
 * RFC 8785-style JSON canonicalization (subset sufficient for WAB):
 *   - object keys sorted lexicographically (UTF-16 code units)
 *   - no insignificant whitespace
 *   - numbers serialized as JS Number → JSON.stringify default
 *   - the `signature` field at the top level is excluded from canonical form
 */
function canonicalize(value, excludeKeys = ['signature']) {
  const seen = new WeakSet();
  function walk(v, depth) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (seen.has(v)) throw new Error('canonicalize: cycle detected');
    seen.add(v);
    if (Array.isArray(v)) return '[' + v.map(x => walk(x, depth + 1)).join(',') + ']';
    const keys = Object.keys(v).filter(k => v[k] !== undefined);
    // Only the top-level signature field is excluded.
    const filtered = depth === 0 ? keys.filter(k => !excludeKeys.includes(k)) : keys;
    filtered.sort();
    return '{' + filtered.map(k => JSON.stringify(k) + ':' + walk(v[k], depth + 1)).join(',') + '}';
  }
  return walk(value, 0);
}

/**
 * Sign a manifest. Mutates a shallow copy by adding a `signature` block:
 *   { algorithm: 'ed25519', value: '<b64>', key_id: '<fp>', signed_at: 'ISO' }
 */
function signManifest(manifest, privateKeyB64, opts = {}) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest must be an object');
  const priv = rawToPrivateKey(privateKeyB64);

  // Derive public key from private to compute key_id deterministically.
  const pubObj = crypto.createPublicKey(priv);
  const pubDer = pubObj.export({ type: 'spki', format: 'der' });
  const pubB64 = pubDer.slice(pubDer.length - 32).toString('base64');

  const toSign = { ...manifest };
  delete toSign.signature;
  const canonical = canonicalize(toSign);
  const sig = crypto.sign(null, Buffer.from(canonical, 'utf8'), priv);

  return {
    ...toSign,
    signature: {
      algorithm: 'ed25519',
      value: sig.toString('base64'),
      key_id: opts.key_id || fingerprint(pubB64),
      public_key: opts.embed_public_key ? pubB64 : undefined,
      signed_at: new Date().toISOString(),
    },
  };
}

/**
 * Verify a signed manifest. Returns { ok, reason?, key_id?, signed_at?, age_seconds? }.
 */
function verifyManifest(manifest, publicKeyB64, opts = {}) {
  if (!manifest || typeof manifest !== 'object') return { ok: false, reason: 'manifest must be an object' };
  const sig = manifest.signature;
  if (!sig) return { ok: false, reason: 'no signature field' };
  if (sig.algorithm !== 'ed25519') return { ok: false, reason: `unsupported algorithm: ${sig.algorithm}` };
  if (!sig.value) return { ok: false, reason: 'signature.value missing' };

  // Use embedded key only if caller didn't pin one.
  const keyB64 = publicKeyB64 || sig.public_key;
  if (!keyB64) return { ok: false, reason: 'no public key supplied (DNS pk= or embedded)' };

  let pub;
  try { pub = rawToPublicKey(keyB64); }
  catch (err) { return { ok: false, reason: 'invalid public key: ' + err.message }; }

  const expectedFp = fingerprint(keyB64);
  if (sig.key_id && sig.key_id !== expectedFp) {
    return { ok: false, reason: `key_id mismatch: signature claims ${sig.key_id}, key fingerprint is ${expectedFp}` };
  }

  const canonical = canonicalize(manifest);
  let okSig = false;
  try {
    okSig = crypto.verify(null, Buffer.from(canonical, 'utf8'), pub, Buffer.from(sig.value, 'base64'));
  } catch (err) {
    return { ok: false, reason: 'verify error: ' + err.message };
  }
  if (!okSig) return { ok: false, reason: 'signature does not match' };

  // Freshness check (optional)
  let age_seconds = null;
  if (sig.signed_at) {
    const t = Date.parse(sig.signed_at);
    if (!isNaN(t)) age_seconds = Math.max(0, Math.floor((Date.now() - t) / 1000));
  }
  if (opts.max_age_seconds && age_seconds !== null && age_seconds > opts.max_age_seconds) {
    return { ok: false, reason: `signature too old (${age_seconds}s > ${opts.max_age_seconds}s)`, age_seconds };
  }

  return { ok: true, key_id: expectedFp, signed_at: sig.signed_at, age_seconds };
}

/**
 * Parse the `pk=ed25519:BASE64KEY` field from a parsed _wab record.
 * Returns { algorithm, public_key } or null.
 */
function parsePkField(pkValue) {
  if (!pkValue || typeof pkValue !== 'string') return null;
  const m = /^([a-z0-9]+):([A-Za-z0-9+/=_-]+)$/.exec(pkValue.trim());
  if (!m) return null;
  return { algorithm: m[1], public_key: m[2].replace(/-/g, '+').replace(/_/g, '/') };
}

module.exports = {
  generateKeyPair,
  fingerprint,
  canonicalize,
  signManifest,
  verifyManifest,
  parsePkField,
  rawToPublicKey,
  rawToPrivateKey,
};
