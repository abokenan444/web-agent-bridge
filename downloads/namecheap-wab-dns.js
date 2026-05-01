#!/usr/bin/env node
/**
 * namecheap-wab-dns.js — enable/disable WAB DNS Discovery TXT record on Namecheap.
 *
 * IMPORTANT: Namecheap's setHosts API replaces ALL DNS records. This script first
 * fetches the existing host list, then adds/removes the _wab TXT entry, then
 * reposts the FULL list. Other records are preserved.
 *
 * Prerequisites:
 *   1. Enable API access at https://ap.www.namecheap.com/settings/tools/apiaccess/
 *   2. Whitelist your public IP (current IP only — see https://api.whatismyip.com/)
 *   3. Domain must use Namecheap BasicDNS or PremiumDNS (not third-party DNS)
 *
 * Usage:
 *   NAMECHEAP_USER=…  NAMECHEAP_API_KEY=…  NAMECHEAP_CLIENT_IP=1.2.3.4 \
 *     node namecheap-wab-dns.js enable example.com
 *
 *   NAMECHEAP_USER=…  NAMECHEAP_API_KEY=…  NAMECHEAP_CLIENT_IP=1.2.3.4 \
 *     node namecheap-wab-dns.js disable example.com
 *
 *   node namecheap-wab-dns.js status example.com
 *
 * Required: node-fetch@2, fast-xml-parser
 *   npm install node-fetch@2 fast-xml-parser
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();
let XMLParser;
try { XMLParser = require('fast-xml-parser').XMLParser; }
catch { console.error('Install fast-xml-parser:  npm install fast-xml-parser'); process.exit(1); }

const [,, action, domain] = process.argv;
const USER     = process.env.NAMECHEAP_USER;
const API_KEY  = process.env.NAMECHEAP_API_KEY;
const CLIENT_IP= process.env.NAMECHEAP_CLIENT_IP;
const WAB_BASE = process.env.WAB_BASE_URL || 'https://www.webagentbridge.com';
const ENDPOINT = process.env.WAB_ENDPOINT || `https://${domain}/.well-known/wab.json`;

if (!action || !domain) { console.error('Usage: node namecheap-wab-dns.js <enable|disable|status> <domain>'); process.exit(1); }
if (!['enable','disable','status'].includes(action)) { console.error('Action must be: enable | disable | status'); process.exit(1); }
if (action !== 'status' && (!USER || !API_KEY || !CLIENT_IP)) {
  console.error('Set NAMECHEAP_USER, NAMECHEAP_API_KEY, NAMECHEAP_CLIENT_IP'); process.exit(1);
}

const NC_BASE = 'https://api.namecheap.com/xml.response';

function authParams(command) {
  return new URLSearchParams({
    ApiUser: USER, UserName: USER, ApiKey: API_KEY, ClientIp: CLIENT_IP, Command: command,
  });
}

function splitDomain(d) {
  const parts = d.split('.');
  if (parts.length < 2) throw new Error('Invalid domain');
  return { sld: parts[0], tld: parts.slice(1).join('.') };
}

async function ncCall(command, extra) {
  const p = authParams(command);
  for (const [k, v] of Object.entries(extra || {})) p.append(k, v);
  const r = await fetch(`${NC_BASE}?${p.toString()}`);
  const xml = await r.text();
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
  const resp = parsed.ApiResponse;
  if (!resp || resp['@_Status'] !== 'OK') {
    const errs = resp && resp.Errors ? JSON.stringify(resp.Errors) : xml.slice(0, 400);
    throw new Error(`Namecheap ${command} failed: ${errs}`);
  }
  return resp.CommandResponse;
}

async function getHosts(sld, tld) {
  const cr = await ncCall('namecheap.domains.dns.getHosts', { SLD: sld, TLD: tld });
  const list = cr.DomainDNSGetHostsResult && cr.DomainDNSGetHostsResult.host;
  const arr = Array.isArray(list) ? list : (list ? [list] : []);
  return arr.map(h => ({
    Name: h['@_Name'],
    Type: h['@_Type'],
    Address: h['@_Address'],
    MXPref: h['@_MXPref'] || '10',
    TTL: h['@_TTL'] || '1800',
  }));
}

function setHostsParams(sld, tld, hosts) {
  const p = authParams('namecheap.domains.dns.setHosts');
  p.append('SLD', sld); p.append('TLD', tld);
  hosts.forEach((h, i) => {
    const n = i + 1;
    p.append(`HostName${n}`, h.Name);
    p.append(`RecordType${n}`, h.Type);
    p.append(`Address${n}`, h.Address);
    p.append(`MXPref${n}`, h.MXPref || '10');
    p.append(`TTL${n}`, h.TTL || '1800');
  });
  return p;
}

async function setHosts(sld, tld, hosts) {
  const p = setHostsParams(sld, tld, hosts);
  const r = await fetch(NC_BASE, { method: 'POST', body: p });
  const xml = await r.text();
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
  if (!parsed.ApiResponse || parsed.ApiResponse['@_Status'] !== 'OK') {
    throw new Error(`setHosts failed: ${xml.slice(0, 400)}`);
  }
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

  const { sld, tld } = splitDomain(domain);
  console.log('[Namecheap] Fetching existing host records (must preserve all)...');
  const existing = await getHosts(sld, tld);
  const others = existing.filter(h => !(h.Type === 'TXT' && h.Name === '_wab'));
  console.log(`[Namecheap] Preserving ${others.length} existing record(s).`);

  let next;
  if (action === 'enable') {
    const txtVal = await getTpl();
    console.log(`[WAB] TXT value: ${txtVal}`);
    next = [...others, { Name: '_wab', Type: 'TXT', Address: txtVal, MXPref: '10', TTL: '1800' }];
  } else {
    next = others;
  }

  await setHosts(sld, tld, next);
  console.log(`[Namecheap] setHosts done — ${next.length} record(s) posted.`);
  console.log(`[WAB] WAB Discovery ${action === 'enable' ? 'ENABLED' : 'DISABLED'}.`);
}

main().catch(err => { console.error('[ERROR]', err.message); process.exit(1); });
