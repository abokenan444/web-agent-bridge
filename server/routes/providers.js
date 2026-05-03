/**
 * /api/providers — user-facing provider account management.
 *
 * Lets a logged-in user connect their managed-DNS provider (Cloudflare,
 * Route 53, Azure, GCP, cPanel, Plesk, GoDaddy, Namecheap), test the
 * connection, sync zones into provider_domains, and toggle WAB Discovery
 * (`_wab` TXT record) per domain — all server-side, no browser CORS dance.
 *
 * Credentials are AES-256-GCM encrypted at rest via secureFields.
 */

'use strict';

const crypto = require('crypto');
const express = require('express');
const router = express.Router();

const { db } = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const { encryptOptional, decryptOptional } = require('../utils/secureFields');
const { getAdapter, listProviders } = require('../services/provider-clients');

/* ───── helpers ─────────────────────────────────────────────────────── */

function newId(prefix = 'pa') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function loadAccount(id, userId) {
  const row = db.prepare(
    `SELECT * FROM provider_accounts WHERE id = ? AND user_id = ?`
  ).get(id, userId);
  if (!row) return null;
  let creds = null;
  if (row.credentials) {
    const dec = decryptOptional(row.credentials);
    try { creds = dec ? JSON.parse(dec) : null; } catch { creds = null; }
  }
  let config = {};
  try { config = row.config ? JSON.parse(row.config) : {}; } catch { config = {}; }
  return { row, creds, config };
}

function publicAccount(row) {
  let config = {};
  try { config = row.config ? JSON.parse(row.config) : {}; } catch { config = {}; }
  return {
    id: row.id,
    provider_type: row.provider_type,
    label: row.label,
    config,
    status: row.status,
    last_test_at: row.last_test_at,
    last_test_ok: !!row.last_test_ok,
    last_test_error: row.last_test_error,
    last_sync_at: row.last_sync_at,
    domains_count: row.domains_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function logAction(account_id, domain, action, status, duration_ms, detail) {
  try {
    db.prepare(`INSERT INTO provider_action_log
      (account_id, domain, action, status, duration_ms, detail)
      VALUES (?, ?, ?, ?, ?, ?)`).run(
      account_id, domain || null, action, status, duration_ms || null,
      detail ? String(detail).slice(0, 1000) : null
    );
  } catch (e) {
    console.warn('[providers] log failed:', e.message);
  }
}

function ensureEncryptionKey(res) {
  if (!process.env.CREDENTIALS_ENCRYPTION_KEY || String(process.env.CREDENTIALS_ENCRYPTION_KEY).length < 8) {
    res.status(500).json({
      error: 'Server is missing CREDENTIALS_ENCRYPTION_KEY env var; refusing to store credentials in plaintext.',
    });
    return false;
  }
  return true;
}

/* ───── GET /api/providers/types — public catalog ─────────────────────── */

router.get('/types', (_req, res) => {
  res.json({ providers: listProviders() });
});

/* ───── account CRUD ─────────────────────────────────────────────────── */

router.get('/accounts', authenticateToken, (req, res) => {
  const rows = db.prepare(
    `SELECT * FROM provider_accounts WHERE user_id = ? ORDER BY created_at DESC`
  ).all(req.user.id);
  res.json({ accounts: rows.map(publicAccount) });
});

router.get('/accounts/:id', authenticateToken, (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  res.json({ account: publicAccount(acc.row) });
});

router.post('/accounts', authenticateToken, (req, res) => {
  if (!ensureEncryptionKey(res)) return;
  const { provider_type, label, credentials, config } = req.body || {};
  if (!provider_type || !credentials || typeof credentials !== 'object') {
    return res.status(400).json({ error: 'provider_type and credentials object required' });
  }

  let adapter;
  try { adapter = getAdapter(provider_type); }
  catch (e) { return res.status(400).json({ error: e.message }); }

  for (const f of adapter.credential_fields || []) {
    if (f.required && !credentials[f.key]) {
      return res.status(400).json({ error: `Missing required credential: ${f.key}` });
    }
  }
  for (const f of adapter.config_fields || []) {
    if (f.required && !(config && config[f.key])) {
      return res.status(400).json({ error: `Missing required config: ${f.key}` });
    }
  }

  const id = newId();
  const encCreds = encryptOptional(JSON.stringify(credentials));
  db.prepare(`INSERT INTO provider_accounts
    (id, user_id, provider_type, label, credentials, config, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`).run(
    id, req.user.id, provider_type, label || adapter.label, encCreds,
    JSON.stringify(config || {})
  );
  logAction(id, null, 'create', 'ok', null, `provider=${provider_type}`);
  const row = db.prepare(`SELECT * FROM provider_accounts WHERE id = ?`).get(id);
  res.status(201).json({ account: publicAccount(row) });
});

router.put('/accounts/:id', authenticateToken, (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const { label, credentials, config } = req.body || {};

  const updates = [`updated_at = datetime('now')`];
  const args = [];
  if (typeof label === 'string') { updates.push('label = ?'); args.push(label); }
  if (credentials && typeof credentials === 'object') {
    if (!ensureEncryptionKey(res)) return;
    updates.push('credentials = ?'); args.push(encryptOptional(JSON.stringify(credentials)));
    updates.push(`status = 'pending'`);
  }
  if (config && typeof config === 'object') {
    updates.push('config = ?'); args.push(JSON.stringify(config));
  }
  args.push(req.params.id);
  db.prepare(`UPDATE provider_accounts SET ${updates.join(', ')} WHERE id = ?`).run(...args);
  logAction(req.params.id, null, 'update', 'ok', null, null);
  const row = db.prepare(`SELECT * FROM provider_accounts WHERE id = ?`).get(req.params.id);
  res.json({ account: publicAccount(row) });
});

router.delete('/accounts/:id', authenticateToken, (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  db.prepare(`DELETE FROM provider_accounts WHERE id = ?`).run(req.params.id);
  res.json({ ok: true });
});

/* ───── actions: test / sync / toggle ────────────────────────────────── */

router.post('/accounts/:id/test', authenticateToken, async (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const adapter = getAdapter(acc.row.provider_type);
  const t0 = Date.now();
  try {
    const r = await adapter.testCredentials(acc.creds, acc.config);
    db.prepare(`UPDATE provider_accounts
      SET status='active', last_test_at=datetime('now'), last_test_ok=1, last_test_error=NULL, updated_at=datetime('now')
      WHERE id = ?`).run(acc.row.id);
    logAction(acc.row.id, null, 'test', 'ok', Date.now() - t0, r.detail);
    res.json({ ok: true, detail: r.detail });
  } catch (e) {
    db.prepare(`UPDATE provider_accounts
      SET status='error', last_test_at=datetime('now'), last_test_ok=0, last_test_error=?, updated_at=datetime('now')
      WHERE id = ?`).run(String(e.message).slice(0, 500), acc.row.id);
    logAction(acc.row.id, null, 'test', 'error', Date.now() - t0, e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/accounts/:id/sync', authenticateToken, async (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const adapter = getAdapter(acc.row.provider_type);
  const t0 = Date.now();
  try {
    const zones = await adapter.listDomains(acc.creds, acc.config);
    const upsert = db.prepare(`INSERT INTO provider_domains
      (account_id, domain, zone_id, updated_at)
      VALUES (?, ?, ?, datetime('now'))
      ON CONFLICT(account_id, domain) DO UPDATE SET
        zone_id = excluded.zone_id,
        updated_at = excluded.updated_at`);
    const tx = db.transaction((items) => {
      for (const z of items) upsert.run(acc.row.id, z.domain, z.zone_id || null);
    });
    tx(zones);
    db.prepare(`UPDATE provider_accounts
      SET last_sync_at=datetime('now'), domains_count=?, status='active', updated_at=datetime('now')
      WHERE id = ?`).run(zones.length, acc.row.id);
    logAction(acc.row.id, null, 'sync', 'ok', Date.now() - t0, `${zones.length} domains`);
    res.json({ ok: true, count: zones.length, domains: zones });
  } catch (e) {
    logAction(acc.row.id, null, 'sync', 'error', Date.now() - t0, e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/accounts/:id/domains', authenticateToken, (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const rows = db.prepare(
    `SELECT * FROM provider_domains WHERE account_id = ? ORDER BY domain ASC`
  ).all(acc.row.id);
  res.json({ domains: rows });
});

function buildWabTxtValue(_userId, domain) {
  return `v=wab1;manifest=https://${domain}/.well-known/wab.json`;
}

// Build a `_wab` TXT value that includes a `pk=` field when a public key
// is supplied — required for Trust Layer v1.3 (signed manifest verification).
function buildWabTxtValueWithKey(domain, publicKeyB64) {
  const base = `v=wab1;manifest=https://${domain}/.well-known/wab.json`;
  if (!publicKeyB64) return base;
  return `${base};pk=ed25519:${publicKeyB64}`;
}

// Build a minimal but production-shaped wab.json starter manifest.
function buildStarterManifest(domain) {
  return {
    wab_version: '1.3',
    name: domain,
    description: `WAB-enabled site at ${domain}`,
    endpoint: `https://${domain}/.well-known/wab.json`,
    capabilities: {
      discovery: true,
      read: true,
      execute: false,
    },
    actions: [
      {
        id: 'home',
        name: 'Home page',
        method: 'GET',
        url: `https://${domain}/`,
        readonly: true,
      },
    ],
    contact: { type: 'web', url: `https://${domain}/` },
    issued_at: new Date().toISOString(),
  };
}

router.post('/accounts/:id/domains/:domain/enable-wab', authenticateToken, async (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const domain = req.params.domain;
  const adapter = getAdapter(acc.row.provider_type);
  const txtValue = (req.body && req.body.txt_value) || buildWabTxtValue(req.user.id, domain);
  const t0 = Date.now();

  const dom = db.prepare(`SELECT * FROM provider_domains WHERE account_id = ? AND domain = ?`).get(acc.row.id, domain);
  const opts = dom && dom.zone_id ? { zone_id: dom.zone_id } : {};

  try {
    const r = await adapter.enableWAB(acc.creds, acc.config, domain, txtValue, opts);
    db.prepare(`INSERT INTO provider_domains
        (account_id, domain, zone_id, wab_enabled, wab_record_value, last_action, last_action_at, last_action_status, updated_at)
      VALUES (?, ?, ?, 1, ?, 'enable', datetime('now'), 'ok', datetime('now'))
      ON CONFLICT(account_id, domain) DO UPDATE SET
        wab_enabled = 1,
        wab_record_value = excluded.wab_record_value,
        last_action = 'enable',
        last_action_at = datetime('now'),
        last_action_status = 'ok',
        last_action_error = NULL,
        updated_at = datetime('now')`)
      .run(acc.row.id, domain, (dom && dom.zone_id) || null, txtValue);
    logAction(acc.row.id, domain, 'enable-wab', 'ok', Date.now() - t0, r.detail);
    res.json({ ok: true, detail: r.detail, txt_value: txtValue });
  } catch (e) {
    db.prepare(`INSERT INTO provider_domains
        (account_id, domain, last_action, last_action_at, last_action_status, last_action_error, updated_at)
      VALUES (?, ?, 'enable', datetime('now'), 'error', ?, datetime('now'))
      ON CONFLICT(account_id, domain) DO UPDATE SET
        last_action = 'enable',
        last_action_at = datetime('now'),
        last_action_status = 'error',
        last_action_error = excluded.last_action_error,
        updated_at = datetime('now')`)
      .run(acc.row.id, domain, String(e.message).slice(0, 500));
    logAction(acc.row.id, domain, 'enable-wab', 'error', Date.now() - t0, e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.post('/accounts/:id/domains/:domain/disable-wab', authenticateToken, async (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const domain = req.params.domain;
  const adapter = getAdapter(acc.row.provider_type);
  const t0 = Date.now();
  try {
    const r = await adapter.disableWAB(acc.creds, acc.config, domain);
    db.prepare(`UPDATE provider_domains SET
        wab_enabled = 0,
        last_action = 'disable',
        last_action_at = datetime('now'),
        last_action_status = 'ok',
        last_action_error = NULL,
        updated_at = datetime('now')
      WHERE account_id = ? AND domain = ?`).run(acc.row.id, domain);
    logAction(acc.row.id, domain, 'disable-wab', 'ok', Date.now() - t0, r.detail);
    res.json({ ok: true, detail: r.detail });
  } catch (e) {
    logAction(acc.row.id, domain, 'disable-wab', 'error', Date.now() - t0, e.message);
    res.status(400).json({ ok: false, error: e.message });
  }
});

router.get('/accounts/:id/log', authenticateToken, (req, res) => {
  const acc = loadAccount(req.params.id, req.user.id);
  if (!acc) return res.status(404).json({ error: 'Account not found' });
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const rows = db.prepare(
    `SELECT id, domain, action, status, duration_ms, detail, created_at
     FROM provider_action_log WHERE account_id = ?
     ORDER BY created_at DESC LIMIT ?`
  ).all(acc.row.id, limit);
  res.json({ log: rows });
});

/* ───── Provider Kit (Phase 19) ──────────────────────────────────────
 *
 * GET /api/providers/kit/:provider?domain=example.com
 *
 * Returns a self-contained "Enable AI Access (WAB)" kit for any provider:
 *   - DNS template (record name, type, value, TTL)
 *   - wab.json starter (3 templates: messaging | booking | generic)
 *   - keypair generation script (Node + browser-friendly)
 *   - validation curl/script
 *   - provider-specific UI copy + integration hints (panel/CLI/API)
 *
 * Public — no auth — so providers can preview before integrating. The
 * actual record push still goes through /quick-enable (auth + adapter).
 */
const PROVIDER_KIT_HINTS = {
  cloudflare: {
    label: 'Cloudflare',
    panel_path: 'DNS → Records → Add record',
    cli: 'wrangler dns record create',
    api_doc: 'https://developers.cloudflare.com/api/operations/dns-records-for-a-zone-create-dns-record',
    button_label: 'Enable AI Access (WAB)',
    integration_hint: 'Add a one-click action to the DNS dashboard that POSTs to /api/providers/quick-enable. Surface the resulting WAB Score badge on the domain summary card.',
  },
  godaddy:    { label: 'GoDaddy',     panel_path: 'My Products → DNS → Records → Add', cli: null, api_doc: 'https://developer.godaddy.com/doc/endpoint/domains', button_label: 'Enable AI Access (WAB)' },
  namecheap:  { label: 'Namecheap',   panel_path: 'Domain List → Manage → Advanced DNS → Add New Record', cli: null, api_doc: 'https://www.namecheap.com/support/api/methods/', button_label: 'Enable AI Access (WAB)' },
  route53:    { label: 'AWS Route 53', panel_path: 'Hosted zones → Create record', cli: 'aws route53 change-resource-record-sets', api_doc: 'https://docs.aws.amazon.com/Route53/latest/APIReference/', button_label: 'Enable AI Access (WAB)' },
  azure:      { label: 'Azure DNS',    panel_path: 'DNS zones → Recordsets → +Recordset', cli: 'az network dns record-set txt', api_doc: 'https://learn.microsoft.com/en-us/rest/api/dns/', button_label: 'Enable AI Access (WAB)' },
  gcp:        { label: 'Google Cloud DNS', panel_path: 'Network services → Cloud DNS → Zone → Add record set', cli: 'gcloud dns record-sets create', api_doc: 'https://cloud.google.com/dns/docs/reference/rest/v1', button_label: 'Enable AI Access (WAB)' },
  cpanel:     { label: 'cPanel',       panel_path: 'Zone Editor → Add Record (TXT)', cli: 'cpanel-uapi DNS add_zone_record', api_doc: 'https://api.docs.cpanel.net/', button_label: 'Enable AI Access (WAB)' },
  plesk:      { label: 'Plesk',        panel_path: 'Domains → DNS Settings → Add Record (TXT)', cli: 'plesk bin dns --add', api_doc: 'https://docs.plesk.com/en-US/obsidian/api-rpc/', button_label: 'Enable AI Access (WAB)' },
  hostinger:  { label: 'Hostinger',    panel_path: 'hPanel → Domains → DNS / Nameservers → Manage DNS records → Add record (TXT)', cli: null, api_doc: 'https://developers.hostinger.com/', button_label: 'Enable AI Access (WAB)' },
  generic:    { label: 'Generic DNS', panel_path: 'DNS / Zone editor → Add TXT record', cli: null, api_doc: null, button_label: 'Enable AI Access (WAB)' },
};

function buildManifestTemplate(domain, kind) {
  const base = {
    wab_version: '1.3',
    name: domain,
    description: `WAB-enabled site at ${domain}`,
    endpoint: `https://${domain}/.well-known/wab.json`,
    contact: { type: 'web', url: `https://${domain}/` },
  };
  if (kind === 'messaging') {
    return { ...base, capabilities: { discovery: true, read: true, execute: true },
      actions: [
        { id: 'send_message', name: 'Send a direct message', method: 'POST', url: `https://${domain}/api/messages`, params: [{ name: 'to', type: 'string', required: true }, { name: 'body', type: 'string', required: true }] },
        { id: 'list_inbox', name: 'List recent messages', method: 'GET', url: `https://${domain}/api/messages`, readonly: true },
      ] };
  }
  if (kind === 'booking') {
    return { ...base, capabilities: { discovery: true, read: true, execute: true },
      actions: [
        { id: 'list_slots', name: 'List available slots', method: 'GET', url: `https://${domain}/api/availability`, readonly: true, params: [{ name: 'date', type: 'string', required: true }] },
        { id: 'book', name: 'Book a slot', method: 'POST', url: `https://${domain}/api/bookings`, params: [{ name: 'slot_id', type: 'string', required: true }, { name: 'name', type: 'string', required: true }, { name: 'email', type: 'string', required: true }] },
      ] };
  }
  return { ...base, capabilities: { discovery: true, read: true, execute: false },
    actions: [{ id: 'home', name: 'Home page', method: 'GET', url: `https://${domain}/`, readonly: true }] };
}

router.get('/kit/:provider', (req, res) => {
  const provider = String(req.params.provider || '').toLowerCase();
  const hints = PROVIDER_KIT_HINTS[provider] || PROVIDER_KIT_HINTS.generic;

  const rawDomain = String(req.query.domain || 'example.com');
  const domain = sanitizeDomainQuick(rawDomain) || 'example.com';
  const kind = ['messaging', 'booking', 'generic'].includes(req.query.kind) ? req.query.kind : 'generic';

  // Placeholder values — operator should swap these for their own.
  const samplePk = 'BASE64_PUBLIC_KEY_REPLACE_ME';
  const txt = `v=wab1;manifest=https://${domain}/.well-known/wab.json;pk=ed25519:${samplePk}`;

  const dns = {
    name: `_wab.${domain}`,
    type: 'TXT',
    value: txt,
    ttl: 300,
    instructions: hints.panel_path,
  };

  const manifest = buildManifestTemplate(domain, kind);

  // Self-contained Node generator script the operator can run locally.
  const generatorScript =
`#!/usr/bin/env node
// One-shot Ed25519 keypair + signed wab.json + DNS TXT line.
// Save as wab-enable.js and run:  node wab-enable.js ${domain}
const crypto = require('crypto');
const fs = require('fs');
const domain = process.argv[2] || '${domain}';
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubB64  = publicKey.export({ type: 'spki', format: 'der' }).slice(-32).toString('base64');
const privB64 = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32).toString('base64');
const manifest = ${JSON.stringify(manifest, null, 2)};
manifest.endpoint = 'https://' + domain + '/.well-known/wab.json';
const canonical = Buffer.from(JSON.stringify(manifest));
const sig = crypto.sign(null, canonical, privateKey).toString('base64');
manifest.signature = { algorithm: 'ed25519', value: sig, key_id: crypto.createHash('sha256').update(pubB64).digest('base64').slice(0, 16), signed_at: new Date().toISOString() };
fs.writeFileSync('wab.json', JSON.stringify(manifest, null, 2));
fs.writeFileSync('wab-private.key', privB64);
console.log('wab.json written. Upload to https://' + domain + '/.well-known/wab.json');
console.log('Add DNS TXT record:');
console.log('  Name:  _wab.' + domain);
console.log('  Type:  TXT');
console.log('  Value: v=wab1;manifest=https://' + domain + '/.well-known/wab.json;pk=ed25519:' + pubB64);
console.log('Keep wab-private.key safe — it is your signing identity.');
`;

  // Validation snippet — runs against the WAB API.
  const validateScript =
`# Verify trust + score after publishing:
curl -s https://webagentbridge.com/api/discovery/trust/${domain} | jq
curl -s https://webagentbridge.com/api/discovery/score/${domain} | jq
curl -s 'https://webagentbridge.com/api/discovery/compliance/${domain}?policy=standard' | jq
`;

  res.json({
    wab_version: '1.3.0',
    provider,
    provider_label: hints.label,
    domain,
    kit_kind: kind,
    button: {
      label: hints.button_label,
      action_url: `https://webagentbridge.com/api/providers/quick-enable`,
      integration_hint: hints.integration_hint || 'Bind this button to a single POST to /api/providers/quick-enable with the user\'s domain. Show the returned wab.json + DNS record in a confirmation modal, then push it via your existing DNS code path.',
    },
    dns,
    manifest,
    manifest_alternatives: ['messaging', 'booking', 'generic'],
    scripts: {
      generator_node: generatorScript,
      validate_bash: validateScript,
    },
    provider_panel: {
      path: hints.panel_path,
      cli: hints.cli,
      api_doc: hints.api_doc,
    },
    next_steps: [
      `Save scripts.generator_node as wab-enable.js and run: node wab-enable.js ${domain}`,
      `Place the resulting wab.json at https://${domain}/.well-known/wab.json (HTTPS, application/json).`,
      `Add the DNS TXT record shown in dns.value to ${dns.name}.`,
      `Verify with scripts.validate_bash — expect trust_score ≥ 80 and signature_valid:true.`,
      `Embed the badge: <img src="https://webagentbridge.com/badge/${domain}.svg">`,
    ],
    score_badge: `https://webagentbridge.com/badge/${domain}.svg`,
    compliance_endpoint: `https://webagentbridge.com/api/discovery/compliance/${domain}`,
  });
});

router.get('/kit', (_req, res) => {
  res.json({
    wab_version: '1.3.0',
    providers: Object.keys(PROVIDER_KIT_HINTS).map(k => ({
      provider: k,
      label: PROVIDER_KIT_HINTS[k].label,
      kit_url: `/api/providers/kit/${k}?domain=example.com`,
    })),
    note: 'Pass ?domain=<yourdomain>&kind=messaging|booking|generic to customise.',
  });
});

/* ───── Zero-Friction Quick-Enable (Phase 18) ────────────────────────
 * One call, one round-trip:
 *   1. Generate fresh Ed25519 keypair (server never persists private key).
 *   2. Build a starter wab.json manifest signed with that key.
 *   3. Build the `_wab` TXT value with embedded pk=.
 *   4. (Optional) push the TXT record live via the provider adapter.
 *   5. Return everything the operator needs to drop into their site.
 *
 * If `account_id` is omitted, this acts as a stateless generator — useful
 * for sites that don't use a managed-DNS provider integration.
 *
 * Body:
 *   { domain, account_id?, push?, manifest_overrides? }
 *
 * Response:
 *   {
 *     ok, domain,
 *     keys: { public_key, private_key, fingerprint },   // SAVE the private!
 *     dns: { name, type, value, ttl },
 *     manifest: { ... signed wab.json ... },
 *     pushed: boolean,
 *     push_detail: string|null,
 *     instructions: { ... }
 *   }
 */
const wabCryptoLazy = (() => {
  let mod = null;
  return () => (mod = mod || require('../services/wab-crypto'));
})();

function sanitizeDomainQuick(s) {
  if (!s || typeof s !== 'string') return null;
  const d = s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(d) ? d : null;
}

router.post('/quick-enable', authenticateToken, async (req, res) => {
  const body = req.body || {};
  const domain = sanitizeDomainQuick(body.domain);
  if (!domain) return res.status(400).json({ ok: false, error: 'invalid_domain' });

  const wabCrypto = wabCryptoLazy();
  const t0 = Date.now();

  // 1. Generate keypair (stateless — caller is responsible for storing private key)
  let kp;
  try {
    kp = wabCrypto.generateKeyPair();
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'keygen_failed', details: e.message });
  }

  // 2. Build manifest, merge any caller overrides, then sign
  const baseManifest = buildStarterManifest(domain);
  const manifest = {
    ...baseManifest,
    ...(body.manifest_overrides && typeof body.manifest_overrides === 'object' ? body.manifest_overrides : {}),
    name: (body.manifest_overrides && body.manifest_overrides.name) || baseManifest.name,
    endpoint: baseManifest.endpoint, // never let overrides hijack endpoint
    wab_version: baseManifest.wab_version,
    issued_at: baseManifest.issued_at,
  };
  let signedManifest;
  try {
    signedManifest = wabCrypto.signManifest(manifest, kp.private_key, { key_id: kp.fingerprint });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'sign_failed', details: e.message });
  }

  // 3. Build the DNS TXT value (with pk=)
  const txtValue = buildWabTxtValueWithKey(domain, kp.public_key);
  const dns = { name: `_wab.${domain}`, type: 'TXT', value: txtValue, ttl: 300 };

  // 4. Optionally push to provider
  let pushed = false;
  let pushDetail = null;
  let pushError = null;
  if (body.push && body.account_id) {
    const acc = loadAccount(body.account_id, req.user.id);
    if (!acc) {
      pushError = 'account_not_found';
    } else {
      const adapter = getAdapter(acc.row.provider_type);
      const dom = db.prepare(`SELECT * FROM provider_domains WHERE account_id = ? AND domain = ?`)
        .get(acc.row.id, domain);
      const opts = dom && dom.zone_id ? { zone_id: dom.zone_id } : {};
      try {
        const r = await adapter.enableWAB(acc.creds, acc.config, domain, txtValue, opts);
        pushed = true;
        pushDetail = r && r.detail;
        db.prepare(`INSERT INTO provider_domains
            (account_id, domain, zone_id, wab_enabled, wab_record_value, last_action, last_action_at, last_action_status, updated_at)
          VALUES (?, ?, ?, 1, ?, 'enable', datetime('now'), 'ok', datetime('now'))
          ON CONFLICT(account_id, domain) DO UPDATE SET
            wab_enabled = 1,
            wab_record_value = excluded.wab_record_value,
            last_action = 'enable',
            last_action_at = datetime('now'),
            last_action_status = 'ok',
            last_action_error = NULL,
            updated_at = datetime('now')`)
          .run(acc.row.id, domain, (dom && dom.zone_id) || null, txtValue);
        logAction(acc.row.id, domain, 'quick-enable', 'ok', Date.now() - t0, pushDetail);
      } catch (e) {
        pushError = String(e.message || e).slice(0, 500);
        logAction(acc.row.id, domain, 'quick-enable', 'error', Date.now() - t0, pushError);
      }
    }
  }

  res.json({
    ok: true,
    domain,
    keys: {
      algorithm: 'ed25519',
      public_key: kp.public_key,
      private_key: kp.private_key,
      fingerprint: kp.fingerprint,
      created_at: kp.created_at,
      warning: 'Store private_key securely. WAB does NOT persist it server-side.',
    },
    dns,
    manifest: signedManifest,
    pushed,
    push_detail: pushDetail,
    push_error: pushError,
    instructions: {
      step_1: `Save the wab.json manifest at: https://${domain}/.well-known/wab.json (publicly readable, served as application/json over HTTPS).`,
      step_2: `Add a DNS TXT record. Name: _wab.${domain}  Value: ${txtValue}  TTL: 300`,
      step_3: 'Verify the setup with: GET /api/discovery/trust/' + domain,
      step_4: 'Check your WAB Score with: GET /api/discovery/score/' + domain,
      step_5: 'Embed your trust badge: <img src="https://webagentbridge.com/badge/' + domain + '.svg">',
      private_key_warning: 'Keep your private_key offline (e.g. password manager / HSM). Use it only to re-sign your manifest when capabilities change.',
    },
    elapsed_ms: Date.now() - t0,
  });
});

module.exports = router;
