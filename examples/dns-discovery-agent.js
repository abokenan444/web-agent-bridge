#!/usr/bin/env node
'use strict';

/**
 * Official WAB DNS Discovery consumer (multi-site).
 *
 * Proves the full value chain per domain:
 *   1) discover via _wab TXT
 *   2) fetch wab.json endpoint
 *   3) call agent endpoints (/api/wab/discover, /api/wab/ping)
 *
 * Usage:
 *   node examples/dns-discovery-agent.js webagentbridge.com example.com
 */

const { verify } = require('../packages/dns-verify/src');
const { safeFetch } = require('../server/utils/safe-fetch');

function sanitizeDomain(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function parseEndpoint(record) {
  if (!record || !record.parsed) return null;
  return record.parsed.endpoint || null;
}

function logStep(ok, label, detail) {
  const icon = ok ? 'OK' : 'NO';
  const extra = detail ? ` - ${detail}` : '';
  console.log(`[${icon}] ${label}${extra}`);
}

async function runDomain(domain) {
  console.log('\n=== ' + domain + ' ===');

  const result = {
    domain,
    dns: null,
    endpoint: null,
    wabJson: null,
    discover: null,
    ping: null,
    ok: false,
  };

  const proof = await verify(domain, { timeoutMs: 6000 }).catch((err) => ({
    ok: false,
    records: [{ type: '_wab', error: err.message }],
  }));

  const wabRecord = (proof.records || []).find((r) => r.type === '_wab') || null;
  result.dns = wabRecord;
  logStep(!!(wabRecord && wabRecord.ok), 'DNS discovery', wabRecord && (wabRecord.error || wabRecord.fqdn));

  const endpoint = parseEndpoint(wabRecord);
  result.endpoint = endpoint;
  if (!endpoint) {
    logStep(false, 'wab.json endpoint', 'missing endpoint= in _wab record');
    return result;
  }
  logStep(true, 'wab.json endpoint', endpoint);

  const endpointUrl = new URL(endpoint);
  const allowList = [domain, '*.' + domain, endpointUrl.hostname, '*.' + endpointUrl.hostname]
    .filter((v, i, a) => a.indexOf(v) === i);

  try {
    const wabRes = await safeFetch(endpointUrl.toString(), { headers: { accept: 'application/json' } }, {
      requireHttps: true,
      allowList,
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json', 'application/ld+json', 'text/plain'],
    });
    const wabJson = await wabRes.json();
    result.wabJson = wabJson;
    logStep(wabRes.ok, 'Fetch wab.json', wabRes.status + ' ' + (wabJson.provider && wabJson.provider.name || 'unknown provider'));
  } catch (err) {
    logStep(false, 'Fetch wab.json', err.message);
    return result;
  }

  const origin = endpointUrl.origin;

  try {
    const discoverRes = await safeFetch(origin + '/api/wab/discover', { headers: { accept: 'application/json' } }, {
      requireHttps: true,
      allowList,
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json'],
    });
    const discoverJson = await discoverRes.json();
    result.discover = discoverJson;
    logStep(discoverRes.ok, 'Agent discover', 'GET /api/wab/discover');
  } catch (err) {
    logStep(false, 'Agent discover', err.message);
  }

  try {
    const pingRes = await safeFetch(origin + '/api/wab/ping', { headers: { accept: 'application/json' } }, {
      requireHttps: true,
      allowList,
      timeoutMs: 8000,
      maxBytes: 512 * 1024,
      allowedContentTypes: ['application/json'],
    });
    const pingJson = await pingRes.json();
    result.ping = pingJson;
    logStep(pingRes.ok, 'Agent execute', 'GET /api/wab/ping => pong=' + !!(pingJson.result && pingJson.result.pong));
  } catch (err) {
    logStep(false, 'Agent execute', err.message);
  }

  result.ok = !!(result.dns && result.dns.ok && result.wabJson && result.ping);
  return result;
}

async function main() {
  const domains = process.argv.slice(2).map(sanitizeDomain).filter(Boolean);
  if (domains.length === 0) {
    console.error('Usage: node examples/dns-discovery-agent.js <domain1> [domain2] [...]');
    process.exit(1);
  }

  const outputs = [];
  for (const domain of domains) {
    outputs.push(await runDomain(domain));
  }

  const passed = outputs.filter((o) => o.ok).length;
  console.log('\nSummary: ' + passed + '/' + outputs.length + ' domains passed full flow');

  if (passed !== outputs.length) process.exitCode = 2;
}

main().catch((err) => {
  console.error('Fatal:', err && err.stack || err);
  process.exit(1);
});
