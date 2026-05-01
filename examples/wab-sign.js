#!/usr/bin/env node
/**
 * wab-sign — generate Ed25519 keys and sign WAB discovery manifests.
 *
 * Usage:
 *   wab-sign keygen                            # print a new keypair (save private offline)
 *   wab-sign sign  manifest.json key.priv      # sign a manifest, write manifest.signed.json
 *   wab-sign txt   <pubkey-b64> <endpoint>     # print the matching _wab TXT line
 *
 * Examples:
 *   $ node wab-sign.js keygen > keys.json
 *   $ jq -r .private_key keys.json > key.priv
 *   $ node wab-sign.js sign wab.json key.priv
 *
 *   $ node wab-sign.js txt <(jq -r .public_key keys.json) https://example.com/.well-known/wab.json
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateKeyPair, signManifest, fingerprint } = require(
  // try the bundled service first; fall back to a local copy if invoked from a downloads/ extract
  fs.existsSync(path.join(__dirname, '..', 'server', 'services', 'wab-crypto.js'))
    ? path.join(__dirname, '..', 'server', 'services', 'wab-crypto.js')
    : './wab-crypto'
);

const [,, cmd, a1, a2] = process.argv;

function usage() {
  console.error('Usage:');
  console.error('  wab-sign keygen');
  console.error('  wab-sign sign <manifest.json> <key.priv>');
  console.error('  wab-sign txt  <public-key-b64>  <endpoint-url>');
  process.exit(1);
}

if (!cmd) usage();

if (cmd === 'keygen') {
  const kp = generateKeyPair();
  process.stdout.write(JSON.stringify(kp, null, 2) + '\n');
  process.stderr.write('\n[!] private_key is shown ONLY here. Save it offline immediately.\n');
  process.stderr.write('[!] Publish public_key in your _wab DNS TXT as: pk=ed25519:' + kp.public_key + '\n');
  process.exit(0);
}

if (cmd === 'sign') {
  if (!a1 || !a2) usage();
  const manifest = JSON.parse(fs.readFileSync(a1, 'utf8'));
  const priv = fs.readFileSync(a2, 'utf8').trim();
  const signed = signManifest(manifest, priv);
  const out = a1.replace(/\.json$/, '') + '.signed.json';
  fs.writeFileSync(out, JSON.stringify(signed, null, 2) + '\n');
  console.log(`[OK] Signed manifest written: ${out}`);
  console.log(`[OK] Signature key_id: ${signed.signature.key_id}`);
  console.log(`[OK] Upload ${out} to https://${manifest.domain || '<your-domain>'}/.well-known/wab.json`);
  process.exit(0);
}

if (cmd === 'txt') {
  if (!a1 || !a2) usage();
  const pub = a1.trim();
  const endpoint = a2.trim();
  if (!/^https:\/\//i.test(endpoint)) { console.error('endpoint must be HTTPS'); process.exit(1); }
  const fp = fingerprint(pub);
  console.log(`# _wab.${endpoint.replace(/^https?:\/\//,'').replace(/\/.*$/,'')}  TXT record:`);
  console.log(`v=wab1; endpoint=${endpoint}; pk=ed25519:${pub}`);
  console.log(`# key_id (fingerprint): ${fp}`);
  process.exit(0);
}

usage();
