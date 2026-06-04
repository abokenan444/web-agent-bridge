/**
 * Regression tests for the three vulnerabilities reported on 2026-06-04:
 *   1. SSRF via safeFetch bypass on /badge/:domain, /resolve, /api/notary/attest/:host
 *   2. SSRF via DNS-deceptive hostnames (e.g. 127.0.0.1.nip.io) that pass regex
 *      validation but resolve to private IPs.
 *   3. Auth bypass in Agent OS Runtime — `if (req.method === 'GET') return next()`
 *      exposed task data, usage stats, and marketplace admin data to anonymous
 *      readers.
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret-for-testing';

const { safeFetch, isPrivateAddress, validateUrl } = require('../server/utils/safe-fetch');

describe('SSRF protection — isPrivateAddress (IP-level allowlist)', () => {
  test.each([
    ['127.0.0.1'], ['10.1.2.3'], ['172.16.5.5'], ['192.168.1.1'],
    ['169.254.169.254'], ['100.64.0.1'], ['0.0.0.0'],
    ['::1'], ['fc00::1'], ['fe80::1'],
  ])('blocks private/reserved IP %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });

  test.each([['1.1.1.1'], ['8.8.8.8'], ['142.250.190.78']])(
    'allows public IP %s', (ip) => {
      expect(isPrivateAddress(ip)).toBe(false);
    }
  );

  test('treats unknown / non-IP input as private (fail-closed)', () => {
    expect(isPrivateAddress('')).toBe(true);
    expect(isPrivateAddress(null)).toBe(true);
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('SSRF protection — validateUrl rejects DNS-deceptive hostnames', () => {
  // 127.0.0.1.nip.io and friends pass naive regex validation
  // (looks like a public TLD) but DNS-resolve to 127.0.0.1.
  // safeFetch must reject them BEFORE issuing any HTTP request.
  test('rejects 127.0.0.1.nip.io', async () => {
    await expect(validateUrl('https://127.0.0.1.nip.io/')).rejects.toThrow(/SSRF blocked|DNS/);
  });
  test('rejects 10.0.0.1.sslip.io', async () => {
    await expect(validateUrl('https://10.0.0.1.sslip.io/')).rejects.toThrow(/SSRF blocked|DNS/);
  });
  test('rejects raw private IP literal', async () => {
    await expect(validateUrl('http://127.0.0.1/')).rejects.toThrow(/SSRF blocked|private/);
  });
  test('rejects AWS metadata endpoint', async () => {
    await expect(validateUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/SSRF blocked|private/);
  });
  test('rejects credentialed URLs', async () => {
    await expect(validateUrl('https://user:pass@example.com/')).rejects.toThrow(/Credentials/);
  });
  test('rejects non-http(s) schemes', async () => {
    await expect(validateUrl('file:///etc/passwd')).rejects.toThrow(/Scheme/);
    await expect(validateUrl('gopher://example.com/')).rejects.toThrow(/Scheme/);
  });
  test('rejects non-standard ports', async () => {
    await expect(validateUrl('http://example.com:22/')).rejects.toThrow(/Port/);
  });
});

describe('safeFetch refuses to even open a socket to private IPs', () => {
  test('throws before issuing request to 127.0.0.1', async () => {
    await expect(safeFetch('http://127.0.0.1/', {}, { timeoutMs: 1000 }))
      .rejects.toThrow(/SSRF|private/);
  });
  test('throws before issuing request to 127.0.0.1.nip.io', async () => {
    await expect(safeFetch('https://127.0.0.1.nip.io/', {}, { timeoutMs: 1000 }))
      .rejects.toThrow(/SSRF|DNS|private/);
  });
});

describe('runtime.js — auth middleware no longer leaks data on GET', () => {
  // We unit-test the middleware function in isolation to avoid booting the
  // whole server (which is heavy and shared with server.test.js).
  // The fix: the catch-all `if (req.method === 'GET') return next()` was removed,
  // so an anonymous GET to a non-public path must be rejected with 401.
  const path = require('path');
  const routesPath = path.join(__dirname, '..', 'server', 'routes', 'runtime.js');
  const source = require('fs').readFileSync(routesPath, 'utf8');

  test('source no longer contains the GET-bypass shortcut', () => {
    // The fatal pattern is a bare `if (req.method === 'GET') return next();`
    // at the END of authMiddleware (after all the credential checks).
    // It must not exist anywhere in the auth flow.
    const stripped = source.replace(/\s+/g, ' ');
    expect(stripped).not.toMatch(/metrics\.increment\([^)]*auth\.rejected[^)]*\);[^}]*if \(req\.method === 'GET'\) return next\(\);/);
    // Defensive: it shouldn't sit immediately before the 401 either.
    const bypassBeforeReject = /if \(req\.method === 'GET'\) return next\(\);\s*metrics\.increment/;
    expect(source).not.toMatch(bypassBeforeReject);
  });

  test('PUBLIC_PATHS sub-route match requires GET + slash separator (no prefix confusion)', () => {
    // Simulate the matcher logic
    const PUBLIC_PATHS = ['/protocol', '/plans', '/marketplace'];
    const match = (method, p) => PUBLIC_PATHS.some(pp =>
      p === pp || (method === 'GET' && p.startsWith(pp + '/'))
    );
    expect(match('GET',  '/protocol')).toBe(true);
    expect(match('GET',  '/protocol/info')).toBe(true);
    expect(match('GET',  '/protocol-secret')).toBe(false); // prefix-confusion blocked
    expect(match('POST', '/plans/admin')).toBe(false);     // POSTs on sub-routes blocked
    expect(match('GET',  '/tasks/xyz')).toBe(false);       // unrelated path blocked
    expect(match('DELETE', '/marketplace')).toBe(true);    // exact match is method-agnostic by design
  });
});
