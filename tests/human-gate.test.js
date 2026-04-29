'use strict';

/**
 * SPEC §8.11 — Out-of-Band Human Gate.
 */

const request = require('supertest');
const hg = require('../server/security/human-gate');
const {
  requiresHumanGate,
  issueChallenge,
  approveChallenge,
  rejectChallenge,
  consumeApproved,
  getStatus,
  setTransport,
  _resetForTests,
  _peekForAdmin,
  _hashParams,
  STATUS,
  MAX_TTL_MS,
} = hg;

beforeEach(() => _resetForTests());

// ────────────────────────────────────────────────────────────────────
// 1. requiresHumanGate policy
// ────────────────────────────────────────────────────────────────────
describe('human-gate: requiresHumanGate', () => {
  test('returns false when site has not enabled the gate', () => {
    expect(requiresHumanGate('deleteVolume', {}, 'pro')).toBe(false);
  });
  test('returns false on free tier even when enabled', () => {
    expect(requiresHumanGate('deleteVolume', { humanGate: { enabled: true } }, 'free')).toBe(false);
  });
  test('returns true on pro tier for destructive verb', () => {
    expect(requiresHumanGate('deleteVolume', { humanGate: { enabled: true } }, 'pro')).toBe(true);
  });
  test('returns true on premium', () => {
    expect(requiresHumanGate('drop_table', { humanGate: { enabled: true } }, 'premium')).toBe(true);
  });
  test('force=true overrides tier', () => {
    expect(requiresHumanGate('deleteVolume', { humanGate: { enabled: true, force: true } }, 'free')).toBe(true);
  });
  test('site-listed action gates non-destructive verbs', () => {
    expect(requiresHumanGate('publish', { humanGate: { enabled: true, actions: ['publish'] } }, 'pro')).toBe(true);
  });
  test('non-destructive verb on enabled site is NOT gated by default', () => {
    expect(requiresHumanGate('click', { humanGate: { enabled: true } }, 'pro')).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// 2. Challenge lifecycle (PENDING → APPROVED → CONSUMED)
// ────────────────────────────────────────────────────────────────────
describe('human-gate: challenge lifecycle', () => {
  const ctx = { sessionToken: 'sess_h', siteId: 's1', actionName: 'deleteVolume', params: { id: 1 } };

  test('issueChallenge returns id + status pending; code never leaked to caller', async () => {
    const env = await issueChallenge(ctx);
    expect(env.challenge_id).toMatch(/^wabh_[a-f0-9]{32}$/);
    expect(env.status).toBe('pending');
    expect(env).not.toHaveProperty('code');
    expect(new Date(env.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  test('approveChallenge with correct code → APPROVED', async () => {
    const env = await issueChallenge(ctx);
    const peeked = _peekForAdmin(env.challenge_id);
    const r = approveChallenge(env.challenge_id, peeked.code_preview_for_admin);
    expect(r.ok).toBe(true);
    expect(r.status).toBe('approved');
  });

  test('approveChallenge with wrong code → HUMAN_GATE_BAD_CODE', async () => {
    const env = await issueChallenge(ctx);
    const r = approveChallenge(env.challenge_id, '000000');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('HUMAN_GATE_BAD_CODE');
  });

  test('5+ wrong attempts → LOCKED', async () => {
    const env = await issueChallenge(ctx);
    for (let i = 0; i < 5; i++) approveChallenge(env.challenge_id, '000000');
    const r = approveChallenge(env.challenge_id, '000000');
    expect(r.code).toBe('HUMAN_GATE_LOCKED');
    // Subsequent valid code also rejected because state is rejected.
    const peek = _peekForAdmin(env.challenge_id);
    const r2 = approveChallenge(env.challenge_id, peek.code_preview_for_admin);
    expect(r2.ok).toBe(false);
  });

  test('rejectChallenge moves to REJECTED', async () => {
    const env = await issueChallenge(ctx);
    const r = rejectChallenge(env.challenge_id, 'not me');
    expect(r.ok).toBe(true);
    expect(r.status).toBe('rejected');
  });

  test('consumeApproved fails when status=PENDING', async () => {
    const env = await issueChallenge(ctx);
    const r = consumeApproved(env.challenge_id, ctx);
    expect(r.code).toBe('HUMAN_GATE_PENDING');
  });

  test('consumeApproved fails when status=REJECTED', async () => {
    const env = await issueChallenge(ctx);
    rejectChallenge(env.challenge_id);
    const r = consumeApproved(env.challenge_id, ctx);
    expect(r.code).toBe('HUMAN_GATE_REJECTED');
  });

  test('full happy path: issue → approve → consume', async () => {
    const env = await issueChallenge(ctx);
    const peek = _peekForAdmin(env.challenge_id);
    approveChallenge(env.challenge_id, peek.code_preview_for_admin);
    const r = consumeApproved(env.challenge_id, ctx);
    expect(r.ok).toBe(true);
    // Single-use
    const replay = consumeApproved(env.challenge_id, ctx);
    expect(replay.ok).toBe(false);
    expect(replay.code).toBe('HUMAN_GATE_CONSUMED');
  });

  test('binding mismatches → HUMAN_GATE_MISMATCH', async () => {
    const env = await issueChallenge(ctx);
    const peek = _peekForAdmin(env.challenge_id);
    approveChallenge(env.challenge_id, peek.code_preview_for_admin);
    expect(consumeApproved(env.challenge_id, { ...ctx, sessionToken: 'OTHER' }).code).toBe('HUMAN_GATE_MISMATCH');

    // Re-issue & re-approve for next case (since previous attempt didn't consume)
    expect(consumeApproved(env.challenge_id, { ...ctx, siteId: 's2' }).code).toBe('HUMAN_GATE_MISMATCH');
    expect(consumeApproved(env.challenge_id, { ...ctx, actionName: 'drop' }).code).toBe('HUMAN_GATE_MISMATCH');
    expect(consumeApproved(env.challenge_id, { ...ctx, params: { id: 99 } }).code).toBe('HUMAN_GATE_MISMATCH');
  });

  test('expired challenge → HUMAN_GATE_EXPIRED', async () => {
    const env = await issueChallenge(ctx);
    const peek = _peekForAdmin(env.challenge_id);
    approveChallenge(env.challenge_id, peek.code_preview_for_admin);
    const realNow = Date.now;
    Date.now = () => realNow() + MAX_TTL_MS + 1000;
    try {
      const r = consumeApproved(env.challenge_id, ctx);
      expect(r.code).toBe('HUMAN_GATE_EXPIRED');
    } finally { Date.now = realNow; }
  });

  test('null/missing challenge_id on consume → HUMAN_GATE_REQUIRED', () => {
    expect(consumeApproved(null, ctx).code).toBe('HUMAN_GATE_REQUIRED');
    expect(consumeApproved(undefined, ctx).code).toBe('HUMAN_GATE_REQUIRED');
  });
});

// ────────────────────────────────────────────────────────────────────
// 3. Transport plug-in
// ────────────────────────────────────────────────────────────────────
describe('human-gate: transport', () => {
  test('custom transport receives code and identity', async () => {
    let captured;
    setTransport('test-tg', async (payload) => {
      captured = payload;
      return { ok: true, channel: 'telegram:9999' };
    });
    const env = await issueChallenge(
      { sessionToken: 'sess_t', siteId: 's1', actionName: 'wipe', params: {} },
      { siteConfig: { humanGate: { transport: 'test-tg' } } }
    );
    expect(captured.code).toMatch(/^[0-9]{6}$/);
    expect(captured.challenge_id).toBe(env.challenge_id);
    expect(env.dispatched_to).toBe('telegram:9999');
  });
});

// ────────────────────────────────────────────────────────────────────
// 4. HTTP integration
// ────────────────────────────────────────────────────────────────────
describe('human-gate: HTTP integration', () => {
  let app;
  let siteId;
  let apiKey;
  const { db } = require('../server/models/db');

  beforeAll(() => {
    app = require('../server/index');
    const id = 'hg-site-' + Date.now();
    const userId = 'hg-user-' + Date.now();
    apiKey = 'wab_hg_' + require('crypto').randomBytes(8).toString('hex');
    db.prepare(`INSERT OR IGNORE INTO users (id, email, password, name, created_at)
                VALUES (?, ?, 'x', 'hg', datetime('now'))`)
      .run(userId, `${userId}@example.test`);
    db.prepare(`INSERT INTO sites (id, user_id, domain, name, license_key, api_key, tier, active, config)
                VALUES (?, ?, ?, ?, ?, ?, 'pro', 1, ?)`)
      .run(id, userId, 'hg-test.example', 'HG Test', 'lic-' + id, apiKey,
        JSON.stringify({
          environment: 'production',
          agentPermissions: { click: true, deleteVolume: true },
          humanGate: { enabled: true, transport: 'null' },
          // Skip dry-run for these tests so we can isolate the human-gate path.
          dryRunPolicy: 'off',
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

  test('destructive call without confirmation_id → 202 + challenge_id', async () => {
    const token = await authenticate('admin');
    const r = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 1 } });
    expect(r.status).toBe(202);
    expect(r.body.error.code).toBe('HUMAN_GATE_REQUIRED');
    expect(r.body.error.challenge_id).toMatch(/^wabh_/);
  });

  test('approve via /human-gate/approve then retry succeeds', async () => {
    const token = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 2 } });
    const cid = r1.body.error.challenge_id;
    const peek = _peekForAdmin(cid);
    expect(peek).toBeTruthy();
    const ap = await request(app).post('/api/wab/human-gate/approve')
      .send({ challenge_id: cid, code: peek.code_preview_for_admin });
    expect(ap.status).toBe(200);
    const r2 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 2 }, confirmation_id: cid });
    expect(r2.status).toBe(200);
    expect(r2.body.result.success).toBe(true);
  });

  test('rejected challenge → 403 HUMAN_GATE_REJECTED', async () => {
    const token = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 3 } });
    const cid = r1.body.error.challenge_id;
    await request(app).post('/api/wab/human-gate/reject').send({ challenge_id: cid, reason: 'nope' });
    const r2 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 3 }, confirmation_id: cid });
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe('HUMAN_GATE_REJECTED');
  });

  test('pending challenge retry → 425 HUMAN_GATE_PENDING', async () => {
    const token = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 4 } });
    const cid = r1.body.error.challenge_id;
    const r2 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 4 }, confirmation_id: cid });
    expect(r2.status).toBe(425);
    expect(r2.body.error.code).toBe('HUMAN_GATE_PENDING');
  });

  test('approval cannot be replayed across sessions', async () => {
    const tA = await authenticate('admin');
    const tB = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${tA}`)
      .send({ params: { v: 5 } });
    const cid = r1.body.error.challenge_id;
    const peek = _peekForAdmin(cid);
    await request(app).post('/api/wab/human-gate/approve')
      .send({ challenge_id: cid, code: peek.code_preview_for_admin });
    const r2 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${tB}`)
      .send({ params: { v: 5 }, confirmation_id: cid });
    expect(r2.status).toBe(403);
    expect(r2.body.error.code).toBe('HUMAN_GATE_MISMATCH');
  });

  test('GET /human-gate/:id/status reveals only safe metadata', async () => {
    const token = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 6 } });
    const cid = r1.body.error.challenge_id;
    const r2 = await request(app).get(`/api/wab/human-gate/${cid}/status`);
    expect(r2.status).toBe(200);
    expect(r2.body.result.status).toBe('pending');
    expect(r2.body.result).not.toHaveProperty('code_preview_for_admin');
    expect(r2.body.result).not.toHaveProperty('code_hash');
  });

  test('approve with wrong code → 401', async () => {
    const token = await authenticate('admin');
    const r1 = await request(app)
      .post('/api/wab/actions/deleteVolume')
      .set('Authorization', `Bearer ${token}`)
      .send({ params: { v: 7 } });
    const cid = r1.body.error.challenge_id;
    const ap = await request(app).post('/api/wab/human-gate/approve')
      .send({ challenge_id: cid, code: '000000' });
    expect(ap.status).toBe(401);
    expect(ap.body.error.code).toBe('HUMAN_GATE_BAD_CODE');
  });

  test('approve unknown challenge → 404', async () => {
    const ap = await request(app).post('/api/wab/human-gate/approve')
      .send({ challenge_id: 'wabh_nope', code: '123456' });
    expect(ap.status).toBe(404);
  });
});
