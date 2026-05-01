#!/usr/bin/env node
/**
 * godaddy-wab-dns.js — enable/disable WAB DNS Discovery TXT record on GoDaddy.
 *
 * Usage:
 *   GODADDY_API_KEY=… GODADDY_API_SECRET=… node godaddy-wab-dns.js enable  example.com
 *   GODADDY_API_KEY=… GODADDY_API_SECRET=… node godaddy-wab-dns.js disable example.com
 *   node godaddy-wab-dns.js status example.com
 *
 * Optional:
 *   WAB_BASE_URL (default: https://www.webagentbridge.com)
 *
 * Required: node-fetch@2 (npm install node-fetch@2)
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();

const [,, action, domain] = process.argv;
const KEY      = process.env.GODADDY_API_KEY;
const SECRET   = process.env.GODADDY_API_SECRET;
const WAB_BASE = process.env.WAB_BASE_URL || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT || `https://${domain}/.well-known/wab.json`;

if (!action || !domain) { console.error('Usage: node godaddy-wab-dns.js <enable|disable|status> <domain>'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status' && (!KEY || !SECRET)) { console.error('Set GODADDY_API_KEY and GODADDY_API_SECRET'); process.exit(1); }

const auth = () => ({ 'Authorization': `sso-key ${KEY}:${SECRET}`, 'Content-Type': 'application/json' });
const base = `https://api.godaddy.com/v1/domains/${domain}/records/TXT/_wab`;

async function getTpl() {
  const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`)).json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  return j.record.value;
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
    const txtVal = await getTpl();
    console.log(`[WAB] TXT value: ${txtVal}`);
    const r = await fetch(base, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify([{ data: txtVal, ttl: 3600 }]),
    });
    if (!r.ok) throw new Error(`GoDaddy ${r.status}: ${await r.text()}`);
    console.log('[GoDaddy] PUT _wab TXT record done');
    console.log('[WAB] WAB Discovery ENABLED.');
  }

  if (action === 'disable') {
    // GoDaddy treats PUT with empty array as record-set deletion
    const r = await fetch(base, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify([]),
    });
    if (!r.ok) throw new Error(`GoDaddy ${r.status}: ${await r.text()}`);
    console.log('[GoDaddy] _wab TXT record cleared');
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
