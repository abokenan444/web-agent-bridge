#!/usr/bin/env node
/**
 * cpanel-wab-dns.js
 * ------------------
 * CLI tool: enable or disable WAB DNS Discovery TXT record via cPanel UAPI.
 *
 * Usage:
 *   CPANEL_API_TOKEN=<token> node cpanel-wab-dns.js enable  example.com cpanel.example.com myuser
 *   CPANEL_API_TOKEN=<token> node cpanel-wab-dns.js disable example.com cpanel.example.com myuser
 *   CPANEL_API_TOKEN=<token> node cpanel-wab-dns.js status  example.com
 *
 * Optional env vars:
 *   CPANEL_PORT=2083        (default: 2083)
 *   CPANEL_PASSWORD         (used instead of API token when set; token preferred)
 *   WAB_BASE_URL            (default: https://www.webagentbridge.com)
 *   WAB_ENDPOINT            (override the wab.json endpoint URL in the TXT record)
 *   NODE_TLS_REJECT_UNAUTHORIZED=0   (set to bypass self-signed cert on test servers)
 *
 * Required: node-fetch v2 for CommonJS environments:
 *   npm install node-fetch@2
 */

'use strict';

const fetch = (() => {
  try { return require('node-fetch'); }
  catch { return globalThis.fetch; }
})();

const [,, action, domain, cpHost, cpUser] = process.argv;

const CP_PORT  = process.env.CPANEL_PORT     || '2083';
const CP_TOKEN = process.env.CPANEL_API_TOKEN;
const CP_PASS  = process.env.CPANEL_PASSWORD;
const WAB_BASE = process.env.WAB_BASE_URL    || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT    || `https://${domain}/.well-known/wab.json`;

if (!action || !domain)              { console.error('Usage: node cpanel-wab-dns.js <enable|disable|status> <domain> [cpanel-host] [username]'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status' && (!cpHost || !cpUser))     { console.error('cpanel-host and username required for enable/disable'); process.exit(1); }
if (action !== 'status' && !CP_TOKEN && !CP_PASS)    { console.error('Set CPANEL_API_TOKEN or CPANEL_PASSWORD env variable'); process.exit(1); }

function cpHeaders() {
  if (CP_TOKEN) return { Authorization: `cpanel ${cpUser}:${CP_TOKEN}` };
  const b64 = Buffer.from(`${cpUser}:${CP_PASS}`).toString('base64');
  return { Authorization: `Basic ${b64}` };
}

function cpUrl(func, params = {}) {
  const qs = new URLSearchParams({ domain, ...params }).toString();
  return `https://${cpHost}:${CP_PORT}/execute/ZoneEdit/${func}?${qs}`;
}

async function cpCall(func, params = {}) {
  const r = await fetch(cpUrl(func, params), { headers: cpHeaders() });
  const j = await r.json();
  if (j.errors && j.errors.length) throw new Error(`cPanel error: ${j.errors.join(', ')}`);
  return j;
}

async function getRecordTemplate() {
  const url = `${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`;
  const j   = await (await fetch(url)).json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  return j.record.value;
}

async function listWabRecords() {
  const j = await cpCall('fetch_zone_records', { type: 'TXT', name: `_wab.${domain}.` });
  return Array.isArray(j.data) ? j.data : [];
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

  const records  = await listWabRecords();
  const existing = records[0] || null;
  console.log(`[CP]  Existing _wab TXT records: ${records.length}`);

  if (action === 'enable') {
    const payload = { type: 'TXT', name: `_wab.${domain}.`, txtdata: txtValue, ttl: 3600 };
    if (existing) {
      const j = await cpCall('edit_zone_record', { ...payload, line: existing.line });
      console.log(`[CP]  Updated TXT record (line=${existing.line})`);
      console.log(JSON.stringify(j, null, 2));
    } else {
      const j = await cpCall('add_zone_record', payload);
      console.log('[CP]  Created TXT record');
      console.log(JSON.stringify(j, null, 2));
    }
    console.log('[WAB] WAB Discovery ENABLED. Propagation may take up to 60 s.');
  }

  if (action === 'disable') {
    if (!existing) { console.log('[CP]  No _wab record found — already disabled.'); return; }
    const j = await cpCall('remove_zone_record', { line: existing.line });
    console.log(`[CP]  Deleted TXT record (line=${existing.line})`);
    console.log(JSON.stringify(j, null, 2));
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
