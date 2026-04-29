/**
 * @wab/dns-verify — comprehensive test suite.
 *
 * Run with: node --test test/
 *
 * Covers:
 *   • ABNF grammar (validator.js)
 *   • DoH client (failover, timeouts, malformed responses)
 *   • End-to-end verify() orchestration with mocked fetch
 *   • Error-handling matrix from SPEC §4.6.6
 *   • CLI exit codes via spawn
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const { parseWabRecord, parseTrustRecord, normalizeTxt } = require('../src/validator.js');
const { dohQuery, VerifyError } = require('../src/doh-client.js');
const { verify } = require('../src/index.js');

// ─── 1. validator.js ────────────────────────────────────────────────────────

test('validator: parses canonical _wab record', () => {
  const r = parseWabRecord('v=wab1; endpoint=https://example.com/.well-known/wab.json');
  assert.equal(r.v, 'wab1');
  assert.equal(r._versionNumber, 1);
  assert.equal(r.endpoint, 'https://example.com/.well-known/wab.json');
});

test('validator: handles DoH-quoted form', () => {
  const r = parseWabRecord('"v=wab1; endpoint=https://example.com/wab.json"');
  assert.equal(r.v, 'wab1');
  assert.equal(r.endpoint, 'https://example.com/wab.json');
});

test('validator: handles split-quote form (DoH multi-string)', () => {
  const r = parseWabRecord('"v=wab1; " "endpoint=https://example.com/wab.json"');
  assert.equal(r.v, 'wab1');
  assert.equal(r.endpoint, 'https://example.com/wab.json');
});

test('validator: tolerates trailing semicolon and whitespace', () => {
  const r = parseWabRecord(' v=wab1 ; endpoint=https://example.com/wab.json ; ');
  assert.equal(r.endpoint, 'https://example.com/wab.json');
});

test('validator: parses fingerprint and capability_ttl', () => {
  const r = parseWabRecord('v=wab1; endpoint=https://x.com/w.json; fingerprint=sha256:abcdef; capability_ttl=7200');
  assert.equal(r.fingerprint, 'sha256:abcdef');
  assert.equal(r.capability_ttl, '7200');
});

test('validator: rejects empty record', () => {
  assert.throws(() => parseWabRecord(''), { code: 'INVALID_FORMAT' });
  assert.throws(() => parseWabRecord('   '), { code: 'INVALID_FORMAT' });
});

test('validator: rejects missing version field', () => {
  assert.throws(() => parseWabRecord('endpoint=https://example.com/wab.json'), { code: 'INVALID_FORMAT' });
});

test('validator: rejects unparseable version', () => {
  assert.throws(() => parseWabRecord('v=foo; endpoint=https://x/wab.json'), { code: 'INVALID_FORMAT' });
});

test('validator: rejects non-HTTPS endpoint (INSECURE_ENDPOINT per §4.6.6)', () => {
  assert.throws(
    () => parseWabRecord('v=wab1; endpoint=http://example.com/wab.json'),
    { code: 'INSECURE_ENDPOINT' },
  );
});

test('validator: rejects malformed key=value pair', () => {
  assert.throws(() => parseWabRecord('v=wab1; =foo'), { code: 'INVALID_FORMAT' });
  assert.throws(() => parseWabRecord('v=wab1; foo'), { code: 'INVALID_FORMAT' });
});

test('validator: requires endpoint or path', () => {
  assert.throws(() => parseWabRecord('v=wab1; status=active'), { code: 'INVALID_FORMAT' });
});

test('validator: accepts path= alternative', () => {
  const r = parseWabRecord('v=wab1; path=/agent.json');
  assert.equal(r.path, '/agent.json');
});

test('validator: flags duplicate fields as warning (not fatal)', () => {
  const r = parseWabRecord('v=wab1; endpoint=https://a.com/w.json; endpoint=https://b.com/w.json');
  assert.equal(r.endpoint, 'https://b.com/w.json');
  assert.ok(Array.isArray(r._warnings));
});

test('validator: parses _wab-trust record', () => {
  const r = parseTrustRecord('trust=https://x.com/trust.json; security=https://x.com/.well-known/security.txt; iodef=mailto:abuse@x.com');
  assert.equal(r.trust, 'https://x.com/trust.json');
  assert.equal(r.security, 'https://x.com/.well-known/security.txt');
  assert.equal(r.iodef, 'mailto:abuse@x.com');
});

test('validator: warns on unknown fields in _wab-trust (forward-compat)', () => {
  const r = parseTrustRecord('v=wab1; trust=https://x.com/.well-known/wab-trust.json');
  assert.equal(r.trust, 'https://x.com/.well-known/wab-trust.json');
  assert.equal(r.v, 'wab1');
  assert.ok(Array.isArray(r._warnings));
  assert.ok(r._warnings[0].includes('unknown field'));
});

test('validator: rejects non-https/non-mailto values in _wab-trust', () => {
  assert.throws(() => parseTrustRecord('trust=ftp://x.com/'), { code: 'INVALID_FORMAT' });
});

test('validator: parses _wab-policy without version', () => {
  const r = parseWabRecord('rate=60; concurrency=5; commission=0%', '_wab-policy');
  assert.equal(r.rate, '60');
  assert.equal(r.concurrency, '5');
  assert.equal(r.commission, '0%');
});

test('validator: normalizeTxt collapses split strings', () => {
  assert.equal(normalizeTxt('"foo" "bar"'), 'foobar');
  assert.equal(normalizeTxt('"hello"'), 'hello');
  assert.equal(normalizeTxt('  raw  '), 'raw');
});

// ─── 2. doh-client.js ───────────────────────────────────────────────────────

function makeFetchMock(scriptedResponses) {
  let callCount = 0;
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const idx = Math.min(callCount, scriptedResponses.length - 1);
    const r = scriptedResponses[callCount];
    callCount++;
    if (typeof r === 'function') return r(url, init);
    if (r instanceof Error) throw r;
    return r;
  };
  fetchFn.calls = calls;
  return fetchFn;
}

function makeOk(body) {
  return { ok: true, status: 200, json: async () => body };
}
function makeErr(status) {
  return { ok: false, status, json: async () => ({}) };
}

test('doh-client: returns parsed answer on success', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ name: '_wab.example.com', type: 16, data: '"v=wab1; endpoint=https://example.com/wab.json"' }] }),
  ]);
  const r = await dohQuery('_wab.example.com', 'TXT', { fetch: f });
  assert.equal(r.Status, 0);
  assert.equal(r.AD, true);
  assert.equal(r.Answer.length, 1);
  assert.match(f.calls[0].url, /do=1/);
  assert.match(f.calls[0].url, /name=_wab\.example\.com/);
});

test('doh-client: filters by RR type', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: false, Answer: [
      { type: 16, data: 'wanted' },
      { type: 1, data: '1.2.3.4' },
    ]}),
  ]);
  const r = await dohQuery('x.com', 'TXT', { fetch: f });
  assert.equal(r.Answer.length, 1);
  assert.equal(r.Answer[0].data, 'wanted');
});

test('doh-client: fails over to second resolver on 5xx', async () => {
  const f = makeFetchMock([
    makeErr(503),
    makeOk({ Status: 0, AD: false, Answer: [] }),
  ]);
  const r = await dohQuery('x.com', 'TXT', {
    fetch: f,
    resolver: ['https://r1.test/dns-query', 'https://r2.test/dns-query'],
  });
  assert.equal(r.attempts, 2);
  assert.equal(r.resolver, 'https://r2.test/dns-query');
});

test('doh-client: throws DOH_REQUEST_REJECTED on 400', async () => {
  const f = makeFetchMock([makeErr(400)]);
  await assert.rejects(
    () => dohQuery('x.com', 'TXT', { fetch: f, resolver: 'https://r.test/dns-query' }),
    { code: 'DOH_REQUEST_REJECTED' },
  );
});

test('doh-client: retries on 429 (treated as transient)', async () => {
  const f = makeFetchMock([
    makeErr(429),
    makeOk({ Status: 0, AD: false, Answer: [] }),
  ]);
  const r = await dohQuery('x.com', 'TXT', {
    fetch: f,
    resolver: ['https://r1.test/dns-query', 'https://r2.test/dns-query'],
  });
  assert.equal(r.attempts, 2);
});

test('doh-client: throws DOH_UNREACHABLE when all resolvers fail', async () => {
  const f = makeFetchMock([new Error('boom1'), new Error('boom2'), new Error('boom3')]);
  await assert.rejects(
    () => dohQuery('x.com', 'TXT', { fetch: f }),
    { code: 'DOH_UNREACHABLE' },
  );
});

// ─── 3. verify() orchestration ──────────────────────────────────────────────

test('verify: passes for healthy WAB-enabled domain', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/wab.json' }] }),
  ]);
  const r = await verify('example.com', { fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.dnssec, 'verified');
  assert.equal(r.records.length, 1);
  assert.equal(r.records[0].parsed.endpoint, 'https://example.com/wab.json');
});

test('verify: NXDOMAIN on _wab returns ok=false with code', async () => {
  const f = makeFetchMock([makeOk({ Status: 3, AD: false, Answer: [] })]);
  const r = await verify('no-wab.test', { fetch: f });
  assert.equal(r.ok, false);
  assert.equal(r.records[0].code, 'NXDOMAIN');
});

test('verify: SERVFAIL bubbles up as code', async () => {
  const f = makeFetchMock([makeOk({ Status: 2, AD: false })]);
  const r = await verify('servfail.test', { fetch: f });
  assert.equal(r.ok, false);
  assert.equal(r.records[0].code, 'SERVFAIL');
});

test('verify: DNSSEC unverified is a warning by default', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: false, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
  ]);
  const r = await verify('example.com', { fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.dnssec, 'unverified');
  assert.ok(r.summary.warnings.some((w) => /DNSSEC/.test(w)));
});

test('verify: --strict + AD=0 fails the run', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: false, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
  ]);
  const r = await verify('example.com', { fetch: f, strict: true });
  assert.equal(r.ok, false);
  assert.equal(r.records[0].code, 'DNSSEC_REQUIRED');
});

test('verify: malformed _wab record fails with INVALID_FORMAT', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'garbage; no-version' }] }),
  ]);
  const r = await verify('bad.test', { fetch: f });
  assert.equal(r.ok, false);
  assert.equal(r.records[0].code, 'INVALID_FORMAT');
});

test('verify: insecure (http) endpoint fails with INSECURE_ENDPOINT', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=http://example.com/w.json' }] }),
  ]);
  const r = await verify('example.com', { fetch: f });
  assert.equal(r.ok, false);
  assert.equal(r.records[0].code, 'INSECURE_ENDPOINT');
});

test('verify: with --trust queries _wab-trust in parallel', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'trust=https://example.com/trust.json; security=https://example.com/.well-known/security.txt' }] }),
  ]);
  const r = await verify('example.com', { fetch: f, trust: true });
  assert.equal(r.ok, true);
  assert.equal(r.records.length, 2);
  assert.equal(r.records[1].parsed.security, 'https://example.com/.well-known/security.txt');
});

test('verify: with --policy parses _wab-policy fields', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'rate=120; concurrency=10; commission=0%' }] }),
  ]);
  const r = await verify('example.com', { fetch: f, policy: true });
  assert.equal(r.ok, true);
  assert.equal(r.records[1].parsed.rate, '120');
  assert.equal(r.records[1].parsed.commission, '0%');
});

test('verify: optional record absent (NXDOMAIN) does not fail run', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
    makeOk({ Status: 3, AD: false, Answer: [] }),
  ]);
  const r = await verify('example.com', { fetch: f, trust: true });
  assert.equal(r.ok, true);
  assert.equal(r.records[1].code, 'NXDOMAIN_OPTIONAL');
});

test('verify: domain normalization strips scheme and path', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [{ type: 16, data: 'v=wab1; endpoint=https://example.com/w.json' }] }),
  ]);
  const r = await verify('https://EXAMPLE.com/path', { fetch: f });
  assert.equal(r.domain, 'example.com');
});

test('verify: rejects missing domain', async () => {
  await assert.rejects(() => verify(''), /domain is required/);
});

test('verify: picks highest version when multiple _wab returned', async () => {
  const f = makeFetchMock([
    makeOk({ Status: 0, AD: true, Answer: [
      { type: 16, data: 'v=wab1; endpoint=https://example.com/v1.json' },
      { type: 16, data: 'v=wab2; endpoint=https://example.com/v2.json' },
    ]}),
  ]);
  const r = await verify('example.com', { fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.records[0].parsed.endpoint, 'https://example.com/v2.json');
});

// ─── 4. CLI exit codes ──────────────────────────────────────────────────────

const CLI = path.join(__dirname, '..', 'bin', 'wab-dns.js');

test('cli: --help exits 0', () => {
  const r = spawnSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /wab-dns/);
});

test('cli: no domain exits 2 (usage)', () => {
  const r = spawnSync(process.execPath, [CLI], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('cli: unknown flag exits 2', () => {
  const r = spawnSync(process.execPath, [CLI, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
});

test('cli: --version prints semver-ish string', () => {
  const r = spawnSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test('cli: --json on unreachable resolver emits JSON and exit 3', () => {
  const r = spawnSync(
    process.execPath,
    [CLI, 'definitely-not-a-real-domain.test.invalid', '--json',
     '--resolver', 'https://127.0.0.1:1/dns-query',
     '--timeout', '300'],
    { encoding: 'utf8', timeout: 30000 },
  );
  // Exit code 3 (unreachable) or 1 (verification failed) acceptable depending on local stack.
  assert.ok(r.status === 3 || r.status === 1, 'expected exit 1 or 3, got ' + r.status);
  // stdout should be JSON when --json set
  if (r.stdout.trim()) {
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
  }
});
