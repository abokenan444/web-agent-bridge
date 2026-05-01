#!/usr/bin/env node
/**
 * cloudflare-wab-dns.js
 * ---------------------
 * CLI tool: enable or disable WAB DNS Discovery TXT record on Cloudflare.
 *
 * Usage:
 *   CF_API_TOKEN=<token> node cloudflare-wab-dns.js enable  example.com
 *   CF_API_TOKEN=<token> node cloudflare-wab-dns.js disable example.com
 *   CF_API_TOKEN=<token> node cloudflare-wab-dns.js status  example.com
 *
 * Optional: set WAB_ENDPOINT env var to override the endpoint URL in the TXT record.
 *
 * Required npm package: node-fetch (v2 for CommonJS):
 *   npm install node-fetch@2
 */

'use strict';

const fetch = (() => {
  try { return require('node-fetch'); }
  catch { return globalThis.fetch; }
})();

const CF_TOKEN   = process.env.CF_API_TOKEN;
const [,, action, domain] = process.argv;

if (!CF_TOKEN) { console.error('Error: CF_API_TOKEN env variable is required.'); process.exit(1); }
if (!action || !domain) {
  console.error('Usage: node cloudflare-wab-dns.js <enable|disable|status> <domain>');
  process.exit(1);
}
if (!['enable', 'disable', 'status'].includes(action)) {
  console.error('Action must be one of: enable, disable, status');
  process.exit(1);
}

const CF_BASE  = 'https://api.cloudflare.com/client/v4';
const WAB_BASE = process.env.WAB_BASE_URL || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT || `https://${domain}/.well-known/wab.json`;

function cfHeaders() {
  return { 'Authorization': `Bearer ${CF_TOKEN}`, 'Content-Type': 'application/json' };
}

async function cfGet(path) {
  const r = await fetch(`${CF_BASE}${path}`, { headers: cfHeaders() });
  const j = await r.json();
  if (!j.success) throw new Error(`CF API error: ${JSON.stringify(j.errors)}`);
  return j;
}

async function getZoneId() {
  const j = await cfGet(`/zones?name=${encodeURIComponent(domain)}`);
  if (!j.result[0]) throw new Error(`Zone not found for domain "${domain}"`);
  return j.result[0].id;
}

async function getRecordTemplate() {
  const url = `${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`;
  const r   = await fetch(url);
  const j   = await r.json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  return j.record.value;
}

async function findExistingRecord(zoneId) {
  const j = await cfGet(`/zones/${zoneId}/dns_records?type=TXT&name=_wab.${domain}`);
  return j.result && j.result[0] ? j.result[0] : null;
}

async function main() {
  console.log(`[WAB] Action: ${action} | Domain: ${domain}`);

  if (action === 'status') {
    const url = `${WAB_BASE}/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`;
    const j   = await (await fetch(url)).json();
    console.log(`[WAB] Status: ${j.status}`);
    console.log(JSON.stringify(j, null, 2));
    return;
  }

  const txtValue = await getRecordTemplate();
  console.log(`[WAB] TXT value: ${txtValue}`);

  const zoneId   = await getZoneId();
  console.log(`[CF]  Zone ID:   ${zoneId}`);

  const existing = await findExistingRecord(zoneId);
  const recBase  = `${CF_BASE}/zones/${zoneId}/dns_records`;

  if (action === 'enable') {
    const body = JSON.stringify({ type: 'TXT', name: `_wab.${domain}`, content: txtValue, ttl: 3600 });
    if (existing) {
      const r = await fetch(`${recBase}/${existing.id}`, { method: 'PUT', headers: cfHeaders(), body });
      const j = await r.json();
      if (!j.success) throw new Error(`PUT failed: ${JSON.stringify(j.errors)}`);
      console.log(`[CF]  Updated TXT record (id=${existing.id})`);
    } else {
      const r = await fetch(recBase, { method: 'POST', headers: cfHeaders(), body });
      const j = await r.json();
      if (!j.success) throw new Error(`POST failed: ${JSON.stringify(j.errors)}`);
      console.log(`[CF]  Created TXT record (id=${j.result.id})`);
    }
    console.log('[WAB] WAB Discovery ENABLED. Verification may take up to 60 s for DNS propagation.');
  }

  if (action === 'disable') {
    if (!existing) {
      console.log('[CF]  No _wab TXT record found. Already disabled.');
      return;
    }
    const r = await fetch(`${recBase}/${existing.id}`, { method: 'DELETE', headers: cfHeaders() });
    const j = await r.json();
    if (!j.success) throw new Error(`DELETE failed: ${JSON.stringify(j.errors)}`);
    console.log(`[CF]  Deleted TXT record (id=${existing.id})`);
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
