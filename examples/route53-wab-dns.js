#!/usr/bin/env node
/**
 * route53-wab-dns.js
 * -------------------
 * CLI tool: enable or disable WAB DNS Discovery TXT record on AWS Route 53.
 *
 * Usage:
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
 *     node route53-wab-dns.js enable  example.com [HOSTED_ZONE_ID]
 *
 *   AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
 *     node route53-wab-dns.js disable example.com [HOSTED_ZONE_ID]
 *
 *   node route53-wab-dns.js status example.com
 *
 * Optional env vars:
 *   AWS_REGION          (default: us-east-1)
 *   WAB_BASE_URL        (default: https://www.webagentbridge.com)
 *   WAB_ENDPOINT        (override the wab.json URL in the TXT record)
 *
 * Required: @aws-sdk/client-route-53
 *   npm install @aws-sdk/client-route-53
 */

'use strict';

const {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListHostedZonesByNameCommand,
  ListResourceRecordSetsCommand,
} = require('@aws-sdk/client-route-53');

const fetch = (() => {
  try { return require('node-fetch'); }
  catch { return globalThis.fetch; }
})();

const [,, action, domain, zoneIdArg] = process.argv;

const REGION   = process.env.AWS_REGION    || 'us-east-1';
const WAB_BASE = process.env.WAB_BASE_URL  || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT  || `https://${domain}/.well-known/wab.json`;

if (!action || !domain) {
  console.error('Usage: node route53-wab-dns.js <enable|disable|status> <domain> [zone-id]');
  process.exit(1);
}
if (!['enable','disable','status'].includes(action)) {
  console.error('Action must be: enable | disable | status');
  process.exit(1);
}
if (action !== 'status' && (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY)) {
  console.error('Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env variables');
  process.exit(1);
}

const client = new Route53Client({ region: REGION });

async function getRecordTemplate() {
  const url = `${WAB_BASE}/api/discovery/provider/record-template?domain=${encodeURIComponent(domain)}&endpoint=${encodeURIComponent(ENDPOINT)}`;
  const j   = await (await fetch(url)).json();
  if (!j.record || !j.record.value) throw new Error('Could not fetch WAB record template');
  // Route 53 requires double-quoted TXT value
  const v = j.record.value;
  return v.startsWith('"') ? v : `"${v}"`;
}

async function resolveZoneId() {
  if (zoneIdArg) return zoneIdArg;
  console.log(`[R53] Resolving hosted zone for ${domain}…`);
  const r = await client.send(new ListHostedZonesByNameCommand({ DNSName: domain, MaxItems: '1' }));
  const zone = (r.HostedZones || []).find(z => z.Name === `${domain}.`);
  if (!zone) throw new Error(`No hosted zone found for "${domain}"`);
  return zone.Id.replace('/hostedzone/', '');
}

async function getCurrentRecord(zoneId) {
  const r = await client.send(new ListResourceRecordSetsCommand({
    HostedZoneId: zoneId,
    StartRecordName: `_wab.${domain}`,
    StartRecordType: 'TXT',
    MaxItems: '1',
  }));
  return (r.ResourceRecordSets || []).find(
    rr => rr.Name === `_wab.${domain}.` && rr.Type === 'TXT'
  ) || null;
}

async function main() {
  console.log(`[WAB] Action: ${action} | Domain: ${domain}`);

  if (action === 'status') {
    const j = await (await fetch(`${WAB_BASE}/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`)).json();
    console.log(`[WAB] Status: ${j.status}`);
    console.log(JSON.stringify(j, null, 2));
    return;
  }

  const zoneId  = await resolveZoneId();
  console.log(`[R53] Zone ID: ${zoneId}`);

  if (action === 'enable') {
    const txtVal = await getRecordTemplate();
    console.log(`[WAB] TXT value: ${txtVal}`);

    await client.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Comment: 'WAB DNS Discovery enable',
        Changes: [{
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: `_wab.${domain}`,
            Type: 'TXT',
            TTL:  3600,
            ResourceRecords: [{ Value: txtVal }],
          },
        }],
      },
    }));
    console.log('[R53] UPSERT applied');
    console.log('[WAB] WAB Discovery ENABLED. Propagation may take up to 60 s.');
  }

  if (action === 'disable') {
    const existing = await getCurrentRecord(zoneId);
    if (!existing) {
      console.log('[R53] No _wab TXT record found — already disabled.');
      return;
    }
    await client.send(new ChangeResourceRecordSetsCommand({
      HostedZoneId: zoneId,
      ChangeBatch: {
        Comment: 'WAB DNS Discovery disable',
        Changes: [{ Action: 'DELETE', ResourceRecordSet: existing }],
      },
    }));
    console.log('[R53] Record deleted');
    console.log('[WAB] WAB Discovery DISABLED.');
  }
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
