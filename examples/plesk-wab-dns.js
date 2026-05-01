#!/usr/bin/env node
/**
 * plesk-wab-dns.js — enable/disable WAB DNS Discovery TXT record via Plesk REST API.
 *
 * Usage:
 *   PLESK_API_KEY=… node plesk-wab-dns.js enable  example.com plesk.host.com
 *   PLESK_API_KEY=… node plesk-wab-dns.js disable example.com plesk.host.com
 *   node plesk-wab-dns.js status example.com
 *
 * Optional env vars:
 *   PLESK_PORT=8443
 *   PLESK_USER + PLESK_PASS (basic auth instead of API key)
 *   WAB_BASE_URL (default: https://www.webagentbridge.com)
 *   NODE_TLS_REJECT_UNAUTHORIZED=0 (for self-signed cert)
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();

const [,, action, domain, host] = process.argv;
const PORT     = process.env.PLESK_PORT    || '8443';
const APIKEY   = process.env.PLESK_API_KEY;
const USER     = process.env.PLESK_USER;
const PASS     = process.env.PLESK_PASS;
const WAB_BASE = process.env.WAB_BASE_URL  || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT  || `https://${domain}/.well-known/wab.json`;

if (!action || !domain) { console.error('Usage: node plesk-wab-dns.js <enable|disable|status> <domain> [plesk-host]'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status' && !host) { console.error('plesk-host required for enable/disable'); process.exit(1); }
if (action !== 'status' && !APIKEY && !(USER && PASS)) { console.error('Set PLESK_API_KEY or PLESK_USER + PLESK_PASS'); process.exit(1); }

function headers() {
  const h = { 'Content-Type': 'application/json' };
  if (APIKEY) h['X-API-Key'] = APIKEY;
  else h['Authorization'] = 'Basic ' + Buffer.from(`${USER}:${PASS}`).toString('base64');
  return h;
}

const base = () => `https://${host}:${PORT}/api/v2`;

async function pkReq(method, path, body) {
  const opts = { method, headers: headers() };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`${base()}${path}`, opts);
  const t = await r.text();
  if (!r.ok) throw new Error(`Plesk ${r.status}: ${t.slice(0, 300)}`);
  try { return JSON.parse(t); } catch { return t; }
}

async function getRecordTemplate() {
  const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`)).json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  return j.record.value;
}

async function listWab() {
  const all = await pkReq('GET', `/dns/records?domain=${encodeURIComponent(domain)}&type=TXT`);
  return (all || []).filter(r => {
    const h = (r.host || '').replace(/\.$/, '');
    return h === `_wab.${domain}` || h === '_wab';
  });
}

async function main() {
  console.log(`[WAB] Action: ${action} | Domain: ${domain}`);

  if (action === 'status') {
    const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`)).json();
    console.log(`[WAB] Status: ${j.status}`);
    console.log(JSON.stringify(j, null, 2));
    return;
  }

  if (action === 'enable') {
    const txtVal = await getRecordTemplate();
    console.log(`[WAB] TXT value: ${txtVal}`);
    const existing = await listWab();
    for (const rec of existing) {
      console.log(`[Plesk] Deleting old record id=${rec.id}`);
      await pkReq('DELETE', `/dns/records/${rec.id}`);
    }
    const out = await pkReq('POST', '/dns/records', {
      domain, type: 'TXT', host: `_wab.${domain}`, value: txtVal,
    });
    console.log('[Plesk] Created TXT record');
    console.log(JSON.stringify(out, null, 2));
    console.log('[WAB] WAB Discovery ENABLED.');
  }

  if (action === 'disable') {
    const existing = await listWab();
    if (!existing.length) { console.log('[Plesk] No _wab record found — already disabled.'); return; }
    for (const rec of existing) {
      console.log(`[Plesk] Deleting record id=${rec.id}`);
      await pkReq('DELETE', `/dns/records/${rec.id}`);
    }
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
