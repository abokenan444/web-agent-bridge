#!/usr/bin/env node

/**
 * wab-dns — CLI entry point for @wab/dns-verify.
 *
 * Usage:
 *   wab-dns <domain> [--trust] [--policy] [--json] [--strict]
 *           [--resolver <url>] [--timeout <ms>] [--quiet]
 *
 * Exit codes (designed for CI):
 *   0  — all required checks passed
 *   1  — verification failed (record missing, malformed, insecure)
 *   2  — usage / argument error
 *   3  — network / resolver unreachable
 */

'use strict';

const { verify } = require('../src/index.js');

// Tiny ANSI helpers — no chalk dep so the package stays zero-dep.
const isTTY = process.stdout && process.stdout.isTTY;
const c = {
  green: (s) => (isTTY ? '\x1b[32m' + s + '\x1b[0m' : s),
  red: (s) => (isTTY ? '\x1b[31m' + s + '\x1b[0m' : s),
  yellow: (s) => (isTTY ? '\x1b[33m' + s + '\x1b[0m' : s),
  cyan: (s) => (isTTY ? '\x1b[36m' + s + '\x1b[0m' : s),
  dim: (s) => (isTTY ? '\x1b[2m' + s + '\x1b[0m' : s),
  bold: (s) => (isTTY ? '\x1b[1m' + s + '\x1b[0m' : s),
};

function usage() {
  process.stdout.write(`
${c.bold('wab-dns')} — verify a domain's WAB DNS Discovery records.

${c.bold('Usage:')}
  wab-dns <domain> [options]

${c.bold('Options:')}
  --trust              Also verify _wab-trust record.
  --policy             Also verify _wab-policy record.
  --strict             Fail when DNSSEC AD flag is missing.
  --json               Emit machine-readable JSON to stdout (no colors).
  --quiet              Print errors only.
  --resolver <url>     Override DoH resolver (repeatable).
  --timeout <ms>       Per-resolver timeout (default 5000).
  -v, --version        Print version.
  -h, --help           Show this help.

${c.bold('Exit codes:')}  0 OK · 1 verification failed · 2 usage error · 3 unreachable

${c.bold('Examples:')}
  wab-dns example.com
  wab-dns example.com --trust --policy --json
  wab-dns example.com --strict --resolver https://dns.quad9.net/dns-query

${c.bold('Spec:')}  https://github.com/abokenan444/web-agent-bridge/blob/master/docs/SPEC.md#46-dns-discovery-protocol-ddp
`);
}

function parseArgs(argv) {
  const opts = {
    domain: null,
    trust: false,
    policy: false,
    strict: false,
    json: false,
    quiet: false,
    resolver: [],
    timeoutMs: 5000,
    showHelp: false,
    showVersion: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--trust': opts.trust = true; break;
      case '--policy': opts.policy = true; break;
      case '--strict': opts.strict = true; break;
      case '--json': opts.json = true; break;
      case '--quiet': opts.quiet = true; break;
      case '--resolver': opts.resolver.push(argv[++i]); break;
      case '--timeout': opts.timeoutMs = parseInt(argv[++i], 10); break;
      case '-h':
      case '--help': opts.showHelp = true; break;
      case '-v':
      case '--version': opts.showVersion = true; break;
      default:
        if (a && a.startsWith('-')) {
          process.stderr.write(c.red(`Unknown option: ${a}\n`));
          process.exit(2);
        }
        if (!opts.domain) opts.domain = a;
        else {
          process.stderr.write(c.red('Multiple domains given — pass only one.\n'));
          process.exit(2);
        }
    }
  }
  return opts;
}

function printHuman(result, opts) {
  const { ok, domain, records, dnssec, summary } = result;
  if (opts.quiet && ok) return;

  process.stdout.write('\n' + c.bold('🔍 WAB DNS Discovery') + ' for ' + c.cyan(domain) + '\n');
  process.stdout.write('  ' + c.dim('─'.repeat(58)) + '\n');

  for (const r of records) {
    if (r.ok && r.present) {
      process.stdout.write('  ' + c.green('✓') + ' ' + c.bold(r.type.padEnd(12)) + ' ' + c.dim(r.fqdn) + '\n');
      if (r.parsed) {
        for (const k of Object.keys(r.parsed)) {
          if (k.startsWith('_')) continue;
          const v = String(r.parsed[k]);
          process.stdout.write('       ' + c.dim(k + ':') + ' ' + (v.length > 80 ? v.slice(0, 77) + '…' : v) + '\n');
        }
      }
    } else if (r.ok && !r.present && r.code === 'NXDOMAIN_OPTIONAL') {
      process.stdout.write('  ' + c.dim('·') + ' ' + c.bold(r.type.padEnd(12)) + ' ' + c.dim('not present (optional)') + '\n');
    } else {
      process.stdout.write('  ' + c.red('✗') + ' ' + c.bold(r.type.padEnd(12)) + ' ' + c.red((r.code || '') + ' ' + (r.error || '')) + '\n');
    }
  }

  process.stdout.write('  ' + c.dim('─'.repeat(58)) + '\n');
  if (dnssec === 'verified') {
    process.stdout.write('  ' + c.green('✓ DNSSEC') + ' ' + c.dim('AD flag set — answer was authenticated') + '\n');
  } else if (dnssec === 'unverified') {
    process.stdout.write('  ' + c.yellow('⚠ DNSSEC') + ' ' + c.dim('AD flag missing — enable DS at registrar') + '\n');
  }
  for (const w of summary.warnings) {
    process.stdout.write('  ' + c.yellow('⚠') + ' ' + w + '\n');
  }
  process.stdout.write('  ' + (ok ? c.green('✅ ') : c.red('❌ ')) + summary.passed + '/' + summary.checked + ' record(s) ok\n\n');
}

(async function main() {
  const argv = process.argv.slice(2);
  const opts = parseArgs(argv);

  if (opts.showHelp || (!opts.domain && !opts.showVersion)) { usage(); process.exit(opts.showHelp ? 0 : 2); }
  if (opts.showVersion) {
    const pkg = require('../package.json');
    process.stdout.write(pkg.version + '\n');
    process.exit(0);
  }

  let result;
  try {
    result = await verify(opts.domain, {
      trust: opts.trust,
      policy: opts.policy,
      strict: opts.strict,
      resolver: opts.resolver.length > 0 ? opts.resolver : undefined,
      timeoutMs: opts.timeoutMs,
    });
  } catch (err) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ ok: false, error: String(err.message || err), code: err.code || 'INTERNAL_ERROR' }) + '\n');
    } else {
      process.stderr.write(c.red('🔥 ' + (err.message || err)) + '\n');
    }
    process.exit(err && err.code === 'DOH_UNREACHABLE' ? 3 : 1);
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    printHuman(result, opts);
  }
  process.exit(result.ok ? 0 : 1);
})();
