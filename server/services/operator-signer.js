'use strict';

/**
 * Operator signing service — Ed25519 + RFC 8785.
 *
 * Loads WAB_OPERATOR_ED25519_PRIV (PKCS8 base64-DER) once and exposes:
 *   sign(payload)        — returns base64 Ed25519 signature over canonicalize(payload).
 *   publicKey()          — returns the operator's public key as {b64, jwk} (raw 32-byte b64 + JWK).
 *   isConfigured()       — whether a signing key is available.
 *   ALGORITHM            — 'ed25519' constant.
 *
 * The same private key is already used by services/revocations.js to sign revocation
 * decisions; this module unifies usage so other surfaces (snapshots, manifests) can
 * sign with the same identity.
 */

const crypto = require('crypto');
const { canonicalize } = require('./canonical-json');

const ALGORITHM = 'ed25519';
const PRIV_B64 = process.env.WAB_OPERATOR_ED25519_PRIV || '';

let _priv = null;
let _pub = null;

function _load() {
  if (_priv || !PRIV_B64) return;
  try {
    const der = Buffer.from(PRIV_B64, 'base64');
    _priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const pubKey = crypto.createPublicKey(_priv);
    const rawDer = pubKey.export({ format: 'der', type: 'spki' });
    // SPKI for Ed25519 is 44 bytes; raw key is the last 32.
    const raw = rawDer.slice(-32);
    _pub = {
      b64: raw.toString('base64'),
      jwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: raw.toString('base64url'),
        alg: 'EdDSA',
        use: 'sig',
      },
    };
  } catch (e) {
    console.warn('[operator-signer] key load failed (non-fatal):', e.message);
  }
}

function isConfigured() {
  _load();
  return !!_priv;
}

function sign(payload) {
  _load();
  if (!_priv) return null;
  try {
    const sig = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), _priv);
    return sig.toString('base64');
  } catch (e) {
    console.warn('[operator-signer] sign failed:', e.message);
    return null;
  }
}

function publicKey() {
  _load();
  return _pub;
}

/**
 * Verify a signature against a payload using the operator's public key.
 * Returns true/false. Convenience helper for tests and self-verification.
 */
function verify(payload, signatureB64) {
  _load();
  if (!_pub) return false;
  try {
    const der = Buffer.from(PRIV_B64, 'base64');
    const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
    const pubKey = crypto.createPublicKey(priv);
    return crypto.verify(
      null,
      Buffer.from(canonicalize(payload), 'utf8'),
      pubKey,
      Buffer.from(signatureB64, 'base64')
    );
  } catch (_) { return false; }
}

module.exports = {
  ALGORITHM,
  sign,
  verify,
  publicKey,
  isConfigured,
};
