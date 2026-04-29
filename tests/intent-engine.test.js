'use strict';

/**
 * SPEC §8.12 — Intent Analysis Engine.
 */

const ie = require('../server/security/intent-engine');
const { score, _classifyVerb, _detectDangerTokens, _resetForTests } = ie;

beforeEach(() => _resetForTests());

// ────────────────────────────────────────────────────────────────────
// 1. Verb classification
// ────────────────────────────────────────────────────────────────────
describe('intent: _classifyVerb', () => {
  test.each([
    ['delete-volume', 'destructive'],
    ['drop_table', 'destructive'],
    ['destroyAccount', 'destructive'],
    ['wipe-cache', 'destructive'],
    ['purge-backups', 'destructive'],
    ['truncate-orders', 'destructive'],
    ['terminate-instance', 'destructive'],
    ['create-user', 'write'],
    ['update-profile', 'write'],
    ['publish-post', 'write'],
    ['merge-pr', 'write'],
    ['list-orders', 'read'],
    ['get-status', 'read'],
    ['fetch-page', 'read'],
  ])('%s → %s', (a, expected) => {
    expect(_classifyVerb(a)).toBe(expected);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. Danger tokens
// ────────────────────────────────────────────────────────────────────
describe('intent: _detectDangerTokens', () => {
  test('finds force in nested params', () => {
    expect(_detectDangerTokens({ opts: { force: true, dryRun: false } }))
      .toEqual(expect.arrayContaining(['force']));
  });
  test('finds permanent + cascade', () => {
    const found = _detectDangerTokens({ mode: 'permanent', sub: { recursive: true } });
    expect(found).toEqual(expect.arrayContaining(['permanent', 'recursive']));
  });
  test('benign params return empty', () => {
    expect(_detectDangerTokens({ id: 1, name: 'safe' })).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. Scoring & gate selection
// ────────────────────────────────────────────────────────────────────
describe('intent: score', () => {
  test('low: read-only on production stays low', () => {
    const r = score({ actionName: 'list-orders', env: 'production', params: {} });
    expect(r.level).toBe('low');
    expect(r.required_gate).toBeNull();
  });

  test('write on production reaches medium → dry_run', () => {
    const r = score({ actionName: 'update-profile', env: 'production', params: {} });
    expect(['medium', 'high']).toContain(r.level);
  });

  test('destructive on production → high → human_gate', () => {
    const r = score({ actionName: 'delete-volume', env: 'production', params: {} });
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.required_gate).toBe('human_gate');
  });

  test('destructive + force + production → critical → block', () => {
    const r = score({ actionName: 'delete-volume', env: 'production', params: { force: true, all: true } });
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.level).toBe('critical');
    expect(r.required_gate).toBe('block');
  });

  test('destructive on dev environment is much lower', () => {
    const prod = score({ actionName: 'delete-volume', env: 'production', params: {} }).score;
    const dev = score({ actionName: 'delete-volume', env: 'dev', params: {} }).score;
    expect(dev).toBeLessThan(prod);
  });

  test('large array bumps score', () => {
    const small = score({ actionName: 'delete-record', env: 'staging', params: { ids: [1, 2] } }).score;
    const big = score({ actionName: 'delete-record', env: 'staging', params: { ids: Array.from({ length: 30 }, (_, i) => i) } }).score;
    expect(big).toBeGreaterThan(small);
  });

  test('burst pattern: 4 destructive in a row escalates', () => {
    const ctx = { actorId: 'agent-1', actionName: 'delete-record', env: 'staging', params: {} };
    score(ctx); score(ctx); score(ctx);
    const r4 = score(ctx);
    expect(r4.reasons.some((r) => r.startsWith('burst'))).toBe(true);
  });

  test('rewrites suggested for delete-account', () => {
    const r = score({ actionName: 'delete-account', env: 'production', params: {} });
    expect(r.rewrites.length).toBeGreaterThan(0);
    expect(r.rewrites[0].to).toMatch(/^archive/);
  });

  test('site-configured custom rewrites win', () => {
    const r = score(
      { actionName: 'cancel-subscription', env: 'production', params: {} },
      { intentEngine: { rewrites: { 'cancel-subscription': 'pause-subscription' } } }
    );
    expect(r.rewrites[0].to).toBe('pause-subscription');
  });

  test('site-configured thresholds change gate', () => {
    const strict = score(
      { actionName: 'update-profile', env: 'production', params: {} },
      { intentEngine: { thresholds: { low: 5, medium: 10, high: 20 } } }
    );
    expect(strict.required_gate).toBe('block');
  });

  test('score is bounded 0..100', () => {
    const r = score({ actionName: 'delete-account-permanently-force', env: 'production', params: { force: true, permanent: true, cascade: true, all: true, ids: Array.from({ length: 100 }, (_, i) => i) } });
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  test('reasons are surfaced for transparency', () => {
    const r = score({ actionName: 'drop-table', env: 'production', params: { force: true } });
    expect(r.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/verb:destructive/)]));
    expect(r.reasons).toEqual(expect.arrayContaining([expect.stringMatching(/env:production/)]));
    expect(r.reasons.some((s) => s.startsWith('danger_tokens'))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. HTTP integration — INTENT_BLOCKED / forced gates
// ────────────────────────────────────────────────────────────────────
describe('intent engine: HTTP integration', () => {
  let app;
  let siteId;
  let apiKey;
  const request = require('supertest');
  const { db } = require('../server/models/db');

  beforeAll(() => {
    app = require('../server/index');
    const id = 'ie-site-' + Date.now();
    const userId = 'ie-user-' + Date.now();
    apiKey = 'wab_ie_' + require('crypto').randomBytes(8).toString('hex');
    db.prepare(`INSERT OR IGNORE INTO users (id, email, password, name, created_at)
                VALUES (?, ?, 'x', 'ie', datetime('now'))`)
      .run(userId, `${userId}@example.test`);
    db.prepare(`INSERT INTO sites (id, user_id, domain, name, license_key, api_key, tier, active, config)
                VALUES (?, ?, ?, ?, ?, ?, 'enterprise', 1, ?)`)
      .run(id, userId, 'ie-test.example', 'IE Test', 'lic-' + id, apiKey,
        JSON.stringify({
          environment: 'production',
          agentPermissions: { click: true, deleteVolume: true, list: true, deleteAll: true },
          // Disable other gates so we isolate the intent gate.
          dryRunPolicy: 'off',
          humanGate: { enabled: false },
          intentEngine: { enabled: true },
        }));
    siteId = id;
  });

  afterAll(() => {
    try { db.prepare('DELETE FROM sites WHERE id = ?').run(siteId); } catch (_) {}
  });

  async function authenticate(scope) {
    const r = await request(app).post('/api/wab/authenticate').send({ siteId, apiKey, scope });
    return r.body.result.token;
  }

  test('low-risk read passes through', async () => {
    const t = await authenticate('read');
    const r = await request(app)
      .post('/api/wab/actions/list')
      .set('Authorization', `Bearer ${t}`)
      .send({ params: {} });
    expect(r.status).toBe(200);
  });

  test('critical: delete + force + production → 403 INTENT_BLOCKED', async () => {
    const t = await authenticate('admin');
    const r = await request(app)
      .post('/api/wab/actions/deleteAll')
      .set('Authorization', `Bearer ${t}`)
      .send({ params: { force: true, all: true, permanent: true } });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('INTENT_BLOCKED');
    expect(r.body.error.intent.score).toBeGreaterThanOrEqual(90);
  });
});
