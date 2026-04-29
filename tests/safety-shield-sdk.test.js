'use strict';

/**
 * SDK SafetyShieldClient — wraps the SPEC §8.10–§8.13 2-phase protocol.
 *
 * Uses an in-memory mock fetch to verify that:
 *  • dryRun() POSTs the right body
 *  • confirmAction() reuses plan_id
 *  • HUMAN_GATE_REQUIRED triggers an approve round-trip
 *  • errors raise typed Error objects
 */

const { SafetyShieldClient } = require('../sdk/safety-shield');

function mockFetch(handler) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const body = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, method: opts.method || 'GET', headers: opts.headers, body });
    const r = await handler({ url, method: opts.method || 'GET', headers: opts.headers, body, callIndex: calls.length - 1 });
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body || '');
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => text,
    };
  };
  fn.calls = calls;
  return fn;
}

const baseOpts = {
  baseUrl: 'https://example.test',
  sessionToken: 'tok_abc',
};

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: constructor', () => {
  test('throws without baseUrl', () => {
    expect(() => new SafetyShieldClient({ sessionToken: 't' })).toThrow(/baseUrl/);
  });
  test('throws without sessionToken', () => {
    expect(() => new SafetyShieldClient({ baseUrl: 'x' })).toThrow(/sessionToken/);
  });
  test('throws if no fetch implementation', () => {
    const orig = globalThis.fetch;
    delete globalThis.fetch;
    try {
      expect(() => new SafetyShieldClient(baseOpts)).toThrow(/fetch/);
    } finally {
      if (orig) globalThis.fetch = orig;
    }
  });
  test('strips trailing slash from baseUrl', () => {
    const c = new SafetyShieldClient({ ...baseOpts, baseUrl: 'https://x.test/', fetchImpl: () => {} });
    expect(c.baseUrl).toBe('https://x.test');
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: dryRun', () => {
  test('POSTs dry_run:true and returns plan envelope', async () => {
    const fetchImpl = mockFetch(({ url, body }) => {
      expect(url).toBe('https://example.test/api/wab/actions/deleteUser');
      expect(body.dry_run).toBe(true);
      expect(body.params).toEqual({ id: 42 });
      return {
        status: 200,
        body: {
          type: 'response',
          result: {
            plan_id: 'wabp_123',
            simulation: { reversible: false, summary: 'would delete user 42' },
            expires_at: '2099-01-01T00:00:00Z',
          },
        },
      };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const plan = await client.dryRun('deleteUser', { id: 42 });
    expect(plan.plan_id).toBe('wabp_123');
    expect(plan.action).toBe('deleteUser');
    expect(plan.params).toEqual({ id: 42 });
    expect(plan.simulation.reversible).toBe(false);
  });

  test('sends Bearer token', async () => {
    const fetchImpl = mockFetch(() => ({ status: 200, body: { result: { plan_id: 'p' } } }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await client.dryRun('x');
    expect(fetchImpl.calls[0].headers.Authorization).toBe('Bearer tok_abc');
  });

  test('throws on HTTP error', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 403,
      body: { error: { code: 'permission_denied', message: 'no perm' } },
    }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await expect(client.dryRun('x')).rejects.toThrow(/no perm/);
  });

  test('throws if response lacks plan_id', async () => {
    const fetchImpl = mockFetch(() => ({ status: 200, body: { result: {} } }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await expect(client.dryRun('x')).rejects.toMatchObject({ code: 'dry_run_no_plan' });
  });

  test('URL-encodes action name', async () => {
    const fetchImpl = mockFetch(() => ({ status: 200, body: { result: { plan_id: 'p' } } }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await client.dryRun('weird name/with slash');
    expect(fetchImpl.calls[0].url).toContain('weird%20name%2Fwith%20slash');
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: confirmAction (no human-gate)', () => {
  test('POSTs dry_run:false + plan_id and returns body', async () => {
    const fetchImpl = mockFetch(({ body }) => {
      expect(body.dry_run).toBe(false);
      expect(body.plan_id).toBe('wabp_xyz');
      return { status: 200, body: { type: 'response', result: { ok: true } } };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const plan = { action: 'deleteUser', params: { id: 1 }, plan_id: 'wabp_xyz' };
    const out = await client.confirmAction(plan);
    expect(out.result.ok).toBe(true);
  });

  test('throws if plan is missing', async () => {
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl: () => {} });
    await expect(client.confirmAction(null)).rejects.toThrow(/plan/);
    await expect(client.confirmAction({})).rejects.toThrow(/plan/);
  });

  test('surfaces plan-mismatch errors with typed code', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 412,
      body: { error: { code: 'DRY_RUN_PLAN_MISMATCH', message: 'params changed' } },
    }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const plan = { action: 'a', plan_id: 'p' };
    await expect(client.confirmAction(plan)).rejects.toMatchObject({
      code: 'DRY_RUN_PLAN_MISMATCH',
      status: 412,
    });
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: confirmAction (human-gate)', () => {
  test('returns pending envelope when challenge issued and no code provided', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 202,
      body: {
        error: {
          code: 'HUMAN_GATE_REQUIRED',
          message: 'approval required',
          challenge_id: 'wabh_77',
          expires_at: '2099-01-01T00:00:00Z',
          dispatched_to: 'admin@example.test',
        },
      },
    }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const plan = { action: 'deleteUser', plan_id: 'p1' };
    const out = await client.confirmAction(plan);
    expect(out.status).toBe('pending_human_gate');
    expect(out.challenge_id).toBe('wabh_77');
    expect(out.dispatched_to).toBe('admin@example.test');
    expect(out.plan).toBe(plan);
  });

  test('approves with code and retries execution automatically', async () => {
    let phase = 0;
    const fetchImpl = mockFetch(({ url, body }) => {
      phase++;
      if (phase === 1) {
        // First execute attempt → human-gate required
        expect(url).toContain('/api/wab/actions/deleteUser');
        expect(body.dry_run).toBe(false);
        return {
          status: 202,
          body: {
            error: {
              code: 'HUMAN_GATE_REQUIRED',
              message: 'approval required',
              challenge_id: 'wabh_88',
            },
          },
        };
      }
      if (phase === 2) {
        // Approve call
        expect(url).toContain('/api/wab/human-gate/approve');
        expect(body.challenge_id).toBe('wabh_88');
        expect(body.code).toBe('123456');
        return { status: 200, body: { result: { confirmation_id: 'wabhc_99' } } };
      }
      if (phase === 3) {
        // Retry execute with confirmation_id
        expect(url).toContain('/api/wab/actions/deleteUser');
        expect(body.confirmation_id).toBe('wabhc_99');
        expect(body.plan_id).toBe('p1');
        return { status: 200, body: { type: 'response', result: { deleted: 1 } } };
      }
      throw new Error(`unexpected phase ${phase}`);
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const plan = { action: 'deleteUser', plan_id: 'p1' };
    const out = await client.confirmAction(plan, { code: '123456' });
    expect(out.result.deleted).toBe(1);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  test('throws if approve returns 401 (bad code)', async () => {
    let phase = 0;
    const fetchImpl = mockFetch(() => {
      phase++;
      if (phase === 1) {
        return {
          status: 202,
          body: { error: { code: 'HUMAN_GATE_REQUIRED', challenge_id: 'wabh_x' } },
        };
      }
      return {
        status: 401,
        body: { error: { code: 'HUMAN_GATE_BAD_CODE', message: 'wrong code' } },
      };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await expect(
      client.confirmAction({ action: 'a', plan_id: 'p' }, { code: '000000' })
    ).rejects.toMatchObject({ code: 'human_gate_approve_failed' });
  });

  test('reads challenge_id from error.details if not at top level', async () => {
    let phase = 0;
    const fetchImpl = mockFetch(() => {
      phase++;
      if (phase === 1) {
        return {
          status: 202,
          body: { error: { code: 'HUMAN_GATE_REQUIRED', details: { challenge_id: 'wabh_d' } } },
        };
      }
      if (phase === 2) {
        return { status: 200, body: { result: { confirmation_id: 'wabhc_d' } } };
      }
      return { status: 200, body: { result: { ok: true } } };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const out = await client.confirmAction({ action: 'a', plan_id: 'p' }, { code: '111111' });
    expect(out.result.ok).toBe(true);
  });

  test('throws if HUMAN_GATE_REQUIRED missing challenge_id', async () => {
    const fetchImpl = mockFetch(() => ({
      status: 202,
      body: { error: { code: 'HUMAN_GATE_REQUIRED' } },
    }));
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    await expect(
      client.confirmAction({ action: 'a', plan_id: 'p' }, { code: '111111' })
    ).rejects.toMatchObject({ code: 'human_gate_malformed' });
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: safeExecute', () => {
  test('chains dryRun + confirmAction in one call', async () => {
    let phase = 0;
    const fetchImpl = mockFetch(({ body }) => {
      phase++;
      if (phase === 1) {
        expect(body.dry_run).toBe(true);
        return { status: 200, body: { result: { plan_id: 'p_chain', simulation: {} } } };
      }
      expect(body.dry_run).toBe(false);
      expect(body.plan_id).toBe('p_chain');
      return { status: 200, body: { result: { ok: true } } };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const out = await client.safeExecute('act', { x: 1 });
    expect(out.result.ok).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: humanGateStatus', () => {
  test('GETs the status endpoint', async () => {
    const fetchImpl = mockFetch(({ url, method }) => {
      expect(method).toBe('GET');
      expect(url).toContain('/api/wab/human-gate/wabh_55/status');
      return { status: 404, body: { error: { code: 'HUMAN_GATE_NOT_FOUND' } } };
    });
    const client = new SafetyShieldClient({ ...baseOpts, fetchImpl });
    const out = await client.humanGateStatus('wabh_55');
    expect(out.error.code).toBe('HUMAN_GATE_NOT_FOUND');
  });
});

// ────────────────────────────────────────────────────────────────────
describe('SafetyShieldClient: SDK integration', () => {
  test('exported from sdk index', () => {
    const sdk = require('../sdk');
    expect(typeof sdk.SafetyShieldClient).toBe('function');
  });
});
