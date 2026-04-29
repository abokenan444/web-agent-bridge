'use strict';

/**
 * SPEC §8.11 — Human-Gate transports (webhook + email + console).
 */

const crypto = require('crypto');
const transports = require('../server/security/human-gate-transports');

function makeChallenge(extra = {}) {
  return {
    challenge_id: 'wabh_test',
    code: '123456',
    site_id: 'site_x',
    action_name: 'deleteUser',
    actor_id: 'agent_a',
    expires_at: '2099-01-01T00:00:00Z',
    siteConfig: extra.siteConfig || {},
  };
}

// ────────────────────────────────────────────────────────────────────
describe('webhookTransport', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('returns error when url missing', async () => {
    const r = await transports.webhookTransport(makeChallenge());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_or_invalid_webhook_url');
  });

  test('returns error for non-http url', async () => {
    const r = await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'ftp://x.com' } } },
    }));
    expect(r.ok).toBe(false);
  });

  test('POSTs JSON payload to configured url', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = { url, opts };
      return { ok: true, status: 200 };
    };
    const r = await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://hooks.test/x' } } },
    }));
    expect(r.ok).toBe(true);
    expect(r.channel).toBe('webhook');
    expect(captured.url).toBe('https://hooks.test/x');
    expect(captured.opts.method).toBe('POST');
    const payload = JSON.parse(captured.opts.body);
    expect(payload.type).toBe('wab.human_gate.challenge');
    expect(payload.code).toBe('123456');
    expect(payload.action_name).toBe('deleteUser');
  });

  test('signs payload with HMAC when secret provided', async () => {
    let captured = null;
    globalThis.fetch = async (url, opts) => {
      captured = opts;
      return { ok: true, status: 200 };
    };
    const secret = 's3cr3t';
    await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://hooks.test/x', secret } } },
    }));
    const sig = captured.headers['X-WAB-Signature'];
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(captured.body).digest('hex');
    expect(sig).toBe(expected);
  });

  test('forwards extra static headers', async () => {
    let captured = null;
    globalThis.fetch = async (_, opts) => { captured = opts; return { ok: true, status: 200 }; };
    await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://h/', headers: { 'X-Custom': 'yes' } } } },
    }));
    expect(captured.headers['X-Custom']).toBe('yes');
    expect(captured.headers['Content-Type']).toBe('application/json');
  });

  test('returns http_<status> error on non-2xx', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500 });
    const r = await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://h/' } } },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('http_500');
  });

  test('returns network_error on thrown fetch', async () => {
    globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
    const r = await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://h/' } } },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ECONNREFUSED');
  });

  test('detects no fetch available', async () => {
    delete globalThis.fetch;
    const r = await transports.webhookTransport(makeChallenge({
      siteConfig: { humanGate: { webhook: { url: 'https://h/' } } },
    }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_fetch_available');
  });
});

// ────────────────────────────────────────────────────────────────────
describe('emailTransport', () => {
  test('returns missing_email_to without to', async () => {
    const r = await transports.emailTransport(makeChallenge());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('missing_email_to');
  });

  test('returns no_smtp_host when no SMTP configured', async () => {
    // We don't want to actually require nodemailer in CI if it's missing.
    // If nodemailer isn't installed, the error will be 'nodemailer_not_installed';
    // either way the function returns ok:false.
    const r = await transports.emailTransport(makeChallenge({
      siteConfig: { humanGate: { email: { to: 'admin@x.test' } } },
    }));
    expect(r.ok).toBe(false);
    expect(['nodemailer_not_installed', 'no_smtp_host']).toContain(r.error);
  });
});

// ────────────────────────────────────────────────────────────────────
describe('consoleTransport', () => {
  test('writes challenge metadata to stderr and returns ok', async () => {
    const orig = process.stderr.write;
    let captured = '';
    process.stderr.write = (s) => { captured += s; return true; };
    try {
      const r = await transports.consoleTransport(makeChallenge());
      expect(r.ok).toBe(true);
      expect(r.channel).toBe('console');
      expect(captured).toContain('wabh_test');
      expect(captured).toContain('deleteUser');
      expect(captured).toContain('123456');
    } finally {
      process.stderr.write = orig;
    }
  });
});

// ────────────────────────────────────────────────────────────────────
describe('registerAll', () => {
  test('registers webhook/email/console on humanGate instance', () => {
    const calls = [];
    const fakeHumanGate = { setTransport: (name, fn) => calls.push({ name, fn }) };
    transports.registerAll(fakeHumanGate);
    const names = calls.map((c) => c.name).sort();
    expect(names).toEqual(['console', 'email', 'webhook']);
    for (const c of calls) {
      expect(typeof c.fn).toBe('function');
    }
  });
});

// ────────────────────────────────────────────────────────────────────
describe('integration with human-gate module', () => {
  test('webhook transport delivers via humanGate.issueChallenge', async () => {
    const humanGate = require('../server/security/human-gate');
    humanGate._resetForTests();
    transports.registerAll(humanGate);

    let captured = null;
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      captured = JSON.parse(opts.body);
      return { ok: true, status: 200 };
    };
    try {
      const out = await humanGate.issueChallenge(
        { sessionToken: 't', siteId: 's', actionName: 'a', params: {} },
        {
          siteConfig: {
            humanGate: { transport: 'webhook', webhook: { url: 'https://h/' } },
          },
        }
      );
      expect(out.dispatched_to).toBe('webhook');
      expect(out.dispatch_ok).toBe(true);
      expect(captured.code).toMatch(/^\d{6}$/);
      expect(captured.challenge_id).toBe(out.challenge_id);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
