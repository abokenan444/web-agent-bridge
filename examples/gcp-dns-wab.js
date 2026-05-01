#!/usr/bin/env node
/**
 * gcp-dns-wab.js — enable/disable WAB DNS Discovery TXT record on Google Cloud DNS.
 *
 * Usage:
 *   node gcp-dns-wab.js enable  example.com my-project example-com
 *   node gcp-dns-wab.js disable example.com my-project example-com
 *   node gcp-dns-wab.js status  example.com
 *
 * Auth: uses Application Default Credentials (run `gcloud auth application-default login`)
 *       or set GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
 *
 * Required: @google-cloud/dns
 *   npm install @google-cloud/dns
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();
const { DNS } = require('@google-cloud/dns');

const [,, action, domain, projectId, zoneName] = process.argv;
const WAB_BASE = process.env.WAB_BASE_URL  || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT  || `https://${domain}/.well-known/wab.json`;

if (!action || !domain) { console.error('Usage: node gcp-dns-wab.js <enable|disable|status> <domain> [projectId] [zoneName]'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status' && (!projectId || !zoneName)) { console.error('projectId and zoneName required for enable/disable'); process.exit(1); }

async function getRecordTemplate() {
  const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`)).json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  const v = j.record.value;
  return v.startsWith('"') ? v : `"${v}"`;
}

async function main() {
  console.log(`[WAB] Action: ${action} | Domain: ${domain}`);

  if (action === 'status') {
    const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`)).json();
    console.log(`[WAB] Status: ${j.status}`);
    console.log(JSON.stringify(j, null, 2));
    return;
  }

  const dns  = new DNS({ projectId });
  const zone = dns.zone(zoneName);
  const fqdn = `_wab.${domain}.`;

  const [existing] = await zone.getRecords({ type: 'TXT', name: fqdn });
  console.log(`[GCP] Existing _wab TXT records: ${existing.length}`);

  if (action === 'enable') {
    const txtVal = await getRecordTemplate();
    console.log(`[WAB] TXT value: ${txtVal}`);
    const newRecord = zone.record('txt', { name: fqdn, ttl: 3600, data: txtVal });
    if (existing.length) {
      const [change] = await zone.createChange({ delete: existing, add: newRecord });
      console.log(`[GCP] Replaced (change id=${change.id}, status=${change.metadata.status})`);
    } else {
      const [change] = await zone.createChange({ add: newRecord });
      console.log(`[GCP] Created (change id=${change.id}, status=${change.metadata.status})`);
    }
    console.log('[WAB] WAB Discovery ENABLED.');
  }

  if (action === 'disable') {
    if (!existing.length) { console.log('[GCP] No _wab record found — already disabled.'); return; }
    const [change] = await zone.createChange({ delete: existing });
    console.log(`[GCP] Deleted (change id=${change.id}, status=${change.metadata.status})`);
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
