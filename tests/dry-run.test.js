'use strict';

/**
 * Mandatory Dry-Run — comprehensive suite for SPEC §8.10.
 */

const request = require('supertest');
const dr = require('../server/security/dry-run');
const {
  requiresDryRun,
  createPlan,
  consumePlan,
  _resetForTests,
  _hashParams,
  DEFAULT_TTL_MS,
  MAX_TTL_MS,
} = dr;

beforeEach(() => _resetForTests());

// ════════════════════════════════════════════════════════════════════
// 1. requiresDryRun
// ════════════════════════════════════════════════════════════════════

describe('dry-run: requiresDryRun', () => {
  test('default destructive verbs require dry-run', () => {
    expect(requiresDryRun('deleteVolume')).toBe(true);
    expect(requiresDryRun('drop_database')).toBe(true);
    expect(requiresDryRun('purge-backups')).toBe(true);
  });

  test('non-destructive actions do not require dry-run', () => {
    expect(requiresDryRun('list-orders')).toBe(false);
    expect(requiresDryRun('click')).toBe(false);
  });

  test('site policy "off" disables dry-run universally', () => {
    expect(requiresDryRun('deleteVolume', { dryRunPolicy: 'off' })).toBe(false);
  });

  test('site policy "always" forces dry-run for everything', () => {
    expect(requiresDryRun('click', { dryRunPolicy: 'always' })).toBe(true);
    expect(requiresDryRun('list-orders', { dryRunPolicy: 'always' })).toBe(true);
  });

  test('site can extend destructive list', () => {
    expect(requiresDryRun('finalize-invoice', { destructiveActions: ['finalize-invoice'] })).toBe(true);
  });

  test('site can suppress a default destructive verb', () => {
    expect(requiresDryRun('delete-draft', { nonDestructiveActions: ['delete-draft'] })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. createPlan / consumePlan happy path
// ════════════════════════════════════════════════════════════════════

describe('dry-run: createPlan + consumePlan', () => {
  const ctx = {
    sessionToken: 'sess_abc',
    siteId: 'site_1',
    actionName: 'deleteVolume',
    params: { volumeId: 'vol-42' },
  };

  test('creates a plan with id, expires_at, and simulation', () => {
    const env = createPlan(ctx, {
      would_affect: ['vol-42', 'snapshots/vol-42'],
      side_effects: ['delete'],
      reversible: false,
      summary: 'Would delete volume vol-42',
    });
    expect(env.dry_run).toBe(true);
    expect(env.plan_id).toMatch(/^wabp_[a-f0-9]{32}$/);
    expect(new Date(env.expires_at).getTime()).toBeGreaterThan(Date.now());
    expect(env.simulated.would_affect).toContain('vol-42');
  });

  test('plan can be consumed once with matching ctx', () => {
    const env = createPlan(ctx, { would_affect: ['vol-42'] });
    const result = consumePlan(env.plan_id, ctx);
    expect(result.ok).toBe(true);
    expect(result.plan.action_name).toBe('deleteVolume');
  });

  test('plan is single-use — second consumePlan fails', () => {
    const env = createPlan(ctx, {});
    consumePlan(env.plan_id, ctx);
    const second = consumePlan(env.plan_id, ctx);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('DRY_RUN_PLAN_NOT_FOUND');
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. Plan invalidation paths
// ════════════════════════════════════════════════════════════════════

describe('dry-run: plan mismatches & expiry', () => {
  const ctx = { sessionToken: 'sess_a', siteId: 's1', actionName: 'drop', params: { table: 'users' } };

  test('missing plan_id → DRY_RUN_REQUIRED', () => {
    const r = consumePlan(null, ctx);
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DRY_RUN_REQUIRED');
  });

  test('unknown plan_id → DRY_RUN_PLAN_NOT_FOUND', () => {
    const r = consumePlan('wabp_does_not_exist', ctx);
    expect(r.code).toBe('DRY_RUN_PLAN_NOT_FOUND');
  });

  test('different session token → DRY_RUN_PLAN_MISMATCH', () => {
    const env = createPlan(ctx, {});
    const r = consumePlan(env.plan_id, { ...ctx, sessionToken: 'OTHER' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('different siteId → DRY_RUN_PLAN_MISMATCH', () => {
    const env = createPlan(ctx, {});
    const r = consumePlan(env.plan_id, { ...ctx, siteId: 's2' });
    expect(r.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('different action → DRY_RUN_PLAN_MISMATCH', () => {
    const env = createPlan(ctx, {});
    const r = consumePlan(env.plan_id, { ...ctx, actionName: 'truncate' });
    expect(r.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('drifted params → DRY_RUN_PLAN_MISMATCH', () => {
    const env = createPlan(ctx, {});
    const r = consumePlan(env.plan_id, { ...ctx, params: { table: 'admins' } });
    expect(r.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('canonical params: key order does NOT matter', () => {
    const env = createPlan({ ...ctx, params: { a: 1, b: 2 } }, {});
    const r = consumePlan(env.plan_id, { ...ctx, params: { b: 2, a: 1 } });
    expect(r.ok).toBe(true);
  });

  test('expired plan → DRY_RUN_PLAN_EXPIRED', () => {
    // TTL is clamped to 1s minimum, so we manipulate expires_at directly.
    const env = createPlan(ctx, {});
    // Reach into the store and force-expire the plan.
    const store = require('../server/security/dry-run');
    // Manual fast-forward: re-create with intentional past expiry by patching internal map.
    // Easiest path: poll Date.now via Date override is heavy — instead consume from a freshly
    // created plan whose expires_at we mutate via the test helper.
    // Use jest fake timers for determinism.
    const originalNow = Date.now;
    const fakeNow = originalNow() + 10 * 60 * 1000; // +10 min, well past 5-min default TTL
    Date.now = () => fakeNow;
    try {
      const r = store.consumePlan(env.plan_id, ctx);
      expect(r.ok).toBe(false);
      expect(r.code).toBe('DRY_RUN_PLAN_EXPIRED');
    } finally {
      Date.now = originalNow;
    }
  });

  test('TTL is hard-capped at MAX_TTL_MS', () => {
    const env = createPlan(ctx, {}, { ttlMs: MAX_TTL_MS * 10 });
    const ageMs = new Date(env.expires_at).getTime() - Date.now();
    expect(ageMs).toBeLessThanOrEqual(MAX_TTL_MS + 1000);
  });

  test('default TTL ≈ 5 minutes', () => {
    const env = createPlan(ctx, {});
    const ageMs = new Date(env.expires_at).getTime() - Date.now();
    expect(ageMs).toBeGreaterThan(DEFAULT_TTL_MS - 1000);
    expect(ageMs).toBeLessThanOrEqual(DEFAULT_TTL_MS + 1000);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. _hashParams stability
// ════════════════════════════════════════════════════════════════════

describe('dry-run: _hashParams', () => {
  test('stable across key order', () => {
    expect(_hashParams({ a: 1, b: 2 })).toBe(_hashParams({ b: 2, a: 1 }));
  });
  test('different content → different hash', () => {
    expect(_hashParams({ a: 1 })).not.toBe(_hashParams({ a: 2 }));
  });
  test('null/undefined are equivalent to {}', () => {
    expect(_hashParams(null)).toBe(_hashParams({}));
    expect(_hashParams(undefined)).toBe(_hashParams({}));
  });
  test('nested objects canonicalised', () => {
    expect(_hashParams({ x: { a: 1, b: 2 } })).toBe(_hashParams({ x: { b: 2, a: 1 } }));
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. HTTP integration
// ════════════════════════════════════════════════════════════════════

describe('dry-run: HTTP integration', () => {
  let app;
  let siteId;
  let apiKey;
  const { db } = require('../server/models/db');

  beforeAll(() => {
    app = require('../server/index');
    const id = 'dryrun-site-' + Date.now();
    const userId = 'dryrun-user-' + Date.now();
    apiKey = 'wab_dr_' + require('crypto').randomBytes(8).toString('hex');
    db.prepare(`INSERT OR IGNORE INTO users (id, email, password, name, created_at)
                VALUES (?, ?, 'x', 'dryrun', datetime('now'))`)
      .run(userId, `${userId}@example.test`);
    db.prepare(`INSERT INTO sites (id, user_id, domain, name, license_key, api_key, tier, active, config)
                VALUES (?, ?, ?, ?, ?, ?, 'free', 1, ?)`)
      .run(id, userId, 'dryrun-test.example', 'Dryrun Test', 'lic-' + id, apiKey,
        JSON.stringify({
          environment: 'production',
          agentPermissions: { click: true, deleteVolume: true, list: true },
        }));
    siteId = id;
  });

  afterAll(() => {
    try { db.prepare('DELETE FROM sites WHERE id = ?').run(siteId); } catch (_) {}
  });

  async function authenticate(scope) {
    const body = { siteId, apiKey };
    if (scope !== undefined) body.scope = scope;
    const r = await request(app).post('/api/wab/authenticate').send(body);
    return r.body.result.token;
  }

  test('non-destructive action runs immediately (no dry_run required)', async () => {
    const token = await authenticate('write');
    const r = await request(app)
      .post('/api/wab/actions/click')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { selector: '#x' } });
    expect(r.status).toBe(200);
    expect(r.body.result.success).toBe(true);
  });

  test('destructive action without dry_run → 412 DRY_RUN_REQUIRED', async () => {
    const token = await authenticate('admin');
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { volumeId: 'v1' } });
    expect(r.status).toBe(412);
    expect(r.body.error.code).toBe('DRY_RUN_REQUIRED');
  });

  test('destructive action with dry_run:true → returns plan envelope', async () => {
    const token = await authenticate('admin');
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: true, params: { volumeId: 'v2' } });
    expect(r.status).toBe(200);
    expect(r.body.result.dry_run).toBe(true);
    expect(r.body.result.plan_id).toMatch(/^wabp_/);
    expect(r.body.result.simulated.would_affect.length).toBeGreaterThan(0);
  });

  test('plan_id replays the destructive action', async () => {
    const token = await authenticate('admin');
    const dr1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: true, params: { volumeId: 'v3' } });
    const planId = dr1.body.result.plan_id;
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: false, plan_id: planId, params: { volumeId: 'v3' } });
    expect(r.status).toBe(200);
    expect(r.body.result.success).toBe(true);
  });

  test('plan with drifted params → 412 DRY_RUN_PLAN_MISMATCH', async () => {
    const token = await authenticate('admin');
    const dr1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: true, params: { volumeId: 'v4' } });
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: false, plan_id: dr1.body.result.plan_id, params: { volumeId: 'TAMPERED' } });
    expect(r.status).toBe(412);
    expect(r.body.error.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('plan from another session cannot be consumed', async () => {
    const tokenA = await authenticate('admin');
    const tokenB = await authenticate('admin');
    const dr1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({ dry_run: true, params: { volumeId: 'v5' } });
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${tokenB}`)
      .send({ dry_run: false, plan_id: dr1.body.result.plan_id, params: { volumeId: 'v5' } });
    expect(r.status).toBe(412);
    expect(r.body.error.code).toBe('DRY_RUN_PLAN_MISMATCH');
  });

  test('plan is single-use — replay → DRY_RUN_PLAN_NOT_FOUND', async () => {
    const token = await authenticate('admin');
    const dr1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: true, params: { volumeId: 'v6' } });
    const planId = dr1.body.result.plan_id;
    await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: false, plan_id: planId, params: { volumeId: 'v6' } });
    const replay = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ dry_run: false, plan_id: planId, params: { volumeId: 'v6' } });
    expect(replay.status).toBe(412);
    expect(replay.body.error.code).toBe('DRY_RUN_PLAN_NOT_FOUND');
  });
});
