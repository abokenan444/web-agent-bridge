#!/usr/bin/env node
/**
 * azure-dns-wab.js — enable/disable WAB DNS Discovery TXT record on Azure DNS.
 *
 * Auth: Bearer token from Azure CLI:
 *   az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv
 *
 * Usage:
 *   AZURE_TOKEN="…"  node azure-dns-wab.js enable  example.com <subscription-id> <resource-group> <zone-name>
 *   AZURE_TOKEN="…"  node azure-dns-wab.js disable example.com <subscription-id> <resource-group> <zone-name>
 *   node azure-dns-wab.js status example.com
 *
 * Required role on the DNS zone: "DNS Zone Contributor"
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();

const [,, action, domain, subId, rg, zone] = process.argv;
const TOKEN    = process.env.AZURE_TOKEN;
const WAB_BASE = process.env.WAB_BASE_URL || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT || `https://${domain}/.well-known/wab.json`;
const API_VER  = '2018-05-01';

if (!action || !domain) { console.error('Usage: node azure-dns-wab.js <enable|disable|status> <domain> [subscription-id] [resource-group] [zone-name]'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status') {
  if (!TOKEN) { console.error('Set AZURE_TOKEN (run: az account get-access-token --resource https://management.azure.com/ --query accessToken -o tsv)'); process.exit(1); }
  if (!subId || !rg || !zone) { console.error('Need <subscription-id> <resource-group> <zone-name>'); process.exit(1); }
}

const azPath = (subId, rg, zone) =>
  `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}` +
  `/providers/Microsoft.Network/dnsZones/${zone}/TXT/_wab?api-version=${API_VER}`;

async function azReq(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok && !(method === 'DELETE' && r.status === 404)) {
    throw new Error(`Azure ${method} ${r.status}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

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

  const url = azPath(subId, rg, zone);

  if (action === 'enable') {
    const txtVal = await getTpl();
    console.log(`[WAB] TXT value: ${txtVal}`);
    await azReq('PUT', url, { properties: { TTL: 3600, TXTRecords: [{ value: [txtVal] }] } });
    console.log('[Azure DNS] PUT _wab TXT record done');
    console.log('[WAB] WAB Discovery ENABLED.');
  }

  if (action === 'disable') {
    await azReq('DELETE', url);
    console.log('[Azure DNS] _wab TXT record deleted');
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
