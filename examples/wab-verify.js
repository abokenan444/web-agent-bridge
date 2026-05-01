#!/usr/bin/env node
/**
 * wab-verify — full trust check on a domain's WAB DNS Discovery setup.
 *
 * Usage:
 *   wab-verify <domain>                  # full DNS + DNSSEC + signature trust report
 *   wab-verify --json <domain>           # JSON output (for CI / scripts)
 *   wab-verify --strict <domain>         # exit non-zero unless trust_score == 100
 *
 * Hits the public WAB Trust API at /api/discovery/trust/:domain.
 * Override base URL with WAB_BASE_URL=https://your-instance.example.com
 */

'use strict';

const fetch = (() => { try { return require('node-fetch'); } catch { return globalThis.fetch; } })();

const args = process.argv.slice(2);
const json   = args.includes('--json');
const strict = args.includes('--strict');
const domain = args.find(a => !a.startsWith('--'));
const BASE   = process.env.WAB_BASE_URL || 'https://www.webagentbridge.com';

if (!domain) {
  console.error('Usage: wab-verify [--json] [--strict] <domain>');
  process.exit(2);
}

(async () => {
  const r = await fetch(`${BASE}/api/discovery/trust/${encodeURIComponent(domain)}`);
  if (!r.ok) { console.error(`HTTP ${r.status}`); process.exit(2); }
  const data = await r.json();

  if (json) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    const c = data.checks || {};
    const tick = (b) => b ? '✓' : '✗';
    console.log(`\nWAB Trust Report — ${data.domain}`);
    console.log('═'.repeat(50));
    console.log(`  Trust Score:   ${data.trust_score}/100   [${data.trust_label.toUpperCase()}]`);
    console.log('  ──────────────────────────────────────────────');
    console.log(`  ${tick(c.dns_resolved)}  DNS _wab record present`);
    console.log(`  ${tick(c.dnssec_verified)}  DNSSEC verified (AD flag)`);
    console.log(`  ${tick(c.has_public_key)}  Public key in DNS (pk=${c.pk_algorithm || '—'})`);
    console.log(`  ${tick(c.https_endpoint && c.manifest_fetched)}  HTTPS manifest reachable`);
    console.log(`  ${tick(c.signature_valid)}  Manifest signature valid`);
    console.log('  ──────────────────────────────────────────────');
    if (data.public_key) console.log(`  Key ID: ${data.public_key.fingerprint}  (ed25519)`);
    if (data.endpoint)   console.log(`  Endpoint: ${data.endpoint}`);
    if (data.findings && data.findings.length) {
      console.log('\n  Findings:');
      for (const f of data.findings) console.log('    • ' + f);
    }
    console.log('');
  }

  if (strict && data.trust_score < 100) process.exit(1);
  process.exit(0);
})().catch(err => { console.error('[ERROR]', err.message); process.exit(2); });
