/**
 * WAB Agent Governance — Full Security + Integration Test
 * ────────────────────────────────────────────────────────
 *  Security tests:
 *    S1  unknown agent_id → 401
 *    S2  wrong token → 401
 *    S3  kill switch blocks subsequent actions
 *    S4  killed agent cannot resurrect via approval
 *    S5  HMAC chain detects tampering
 *    S6  param redaction strips secrets/passwords/tokens
 *    S7  token is sha256-hashed at rest (never plaintext)
 *    S8  agent A token cannot manage agent B
 *    S9  one-time token: cannot retrieve after creation
 *    S10 deny-by-default when no policy matches
 *
 *  Operational tests:
 *    O1  policy CRUD round-trip
 *    O2  per-call max_amount enforced
 *    O3  daily_cap rolling window enforced
 *    O4  per_call_rate enforced
 *    O5  approval gate: pending → approved → allowed
 *    O6  approval rejected → guard fails
 *    O7  audit log captures every check + execute + decision
 *    O8  policy specificity: exact-scope > scope-null
 *    O9  expired policy ignored
 *    O10 status endpoint reflects 24h stats
 *
 *  Programmatic tests:
 *    P1  SDK WABGovernance.register() → register flow
 *    P2  SDK gov.guard() happy path
 *    P3  SDK gov.guard() with approval callback
 *    P4  SDK verifyAudit returns ok=true
 */

'use strict';

const path = require('path');
const fs = require('fs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret-for-testing';
process.env.WAB_GOV_AUDIT_SECRET = 'gov-test-audit-secret';

const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

const app = require('../server/index');
const gov = require('../server/services/governance');
const { db } = require('../server/models/db');
const { WABGovernance } = require('../sdk');

// Apply migrations
require('../server/utils/migrate').runMigrations();

// ────────────────────── shared helpers ────
async function registerAgent(displayName = 'test') {
  const res = await request(app)
    .post('/api/governance/agents')
    .send({ display_name: displayName });
  expect(res.status).toBe(201);
  expect(res.body.agent_id).toBeTruthy();
  expect(res.body.agent_token).toMatch(/^wabag_/);
  return res.body;
}

function authHeader(token) { return { Authorization: 'Bearer ' + token }; }

// ════════════════════════════════════════ SECURITY TESTS ════
describe('Governance — Security', () => {

  test('S1 unknown agent_id rejected', async () => {
    const r = await request(app)
      .post('/api/governance/agents/agent_does_not_exist/check')
      .set(authHeader('wabag_anything'))
      .send({ resource: 'x', action: 'read' });
    expect(r.status).toBe(401);
  });

  test('S2 wrong token rejected', async () => {
    const a = await registerAgent('s2');
    const r = await request(app)
      .post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader('wabag_wrong_token_xxx'))
      .send({ resource: 'x', action: 'read' });
    expect(r.status).toBe(401);
  });

  test('S3 kill switch blocks all actions', async () => {
    const a = await registerAgent('s3');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'read' }).expect(201);

    // verify it works first
    const before = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'read' });
    expect(before.body.decision).toBe('allow');

    // kill
    await request(app).post(`/api/governance/agents/${a.agent_id}/kill`)
      .set(authHeader(a.agent_token)).send({ reason: 'test' }).expect(200);

    // now denied
    const after = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'read' });
    expect(after.body.decision).toBe('deny');
    expect(after.body.reason).toMatch(/agent_killed/);
  });

  test('S4 killed agent: pending approvals cancelled (no resurrection)', async () => {
    const a = await registerAgent('s4');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'big',
        max_amount: 5000, requires_approval: true }).expect(201);

    // request approval
    const ar = await request(app).post(`/api/governance/agents/${a.agent_id}/approvals`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'big', amount: 100 });
    expect(ar.body.status).toBe('pending');

    // kill
    await request(app).post(`/api/governance/agents/${a.agent_id}/kill`)
      .set(authHeader(a.agent_token)).send({ reason: 'compromised' });

    // pending approval should be cancelled
    const got = await request(app).get(`/api/governance/approvals/${ar.body.requestId}`);
    expect(got.body.status).toBe('cancelled');
  });

  test('S5 HMAC audit chain detects tampering', () => {
    const r = gov.registerAgent({ displayName: 's5' });
    gov.appendAudit({ agentId: r.agentId, eventType: 'execute', resource: 'a', decision: 'allow' });
    gov.appendAudit({ agentId: r.agentId, eventType: 'execute', resource: 'b', decision: 'allow' });
    gov.appendAudit({ agentId: r.agentId, eventType: 'execute', resource: 'c', decision: 'allow' });

    const v1 = gov.verifyAuditChain(r.agentId);
    expect(v1.ok).toBe(true);

    // Simulate tamper: change a row directly
    db.prepare(
      "UPDATE gov_audit SET resource = 'TAMPERED' WHERE agent_id = ? AND resource = 'b'"
    ).run(r.agentId);

    const v2 = gov.verifyAuditChain(r.agentId);
    expect(v2.ok).toBe(false);
    expect(v2.broken_at).toBeGreaterThan(0);
  });

  test('S6 param redaction strips secrets', () => {
    const out = gov._internals.redact({
      user: 'alice',
      password: 'hunter2',
      api_key: 'sk_live_abc',
      nested: { token: 'bearer-xyz', email: 'a@b.com', cookie: 'sid=...' },
      bigString: 'x'.repeat(3000),
    });
    expect(out.password).toBe('[redacted]');
    expect(out.api_key).toBe('[redacted]');
    expect(out.nested.token).toBe('[redacted]');
    expect(out.nested.cookie).toBe('[redacted]');
    expect(out.user).toBe('alice');
    expect(out.nested.email).toBe('a@b.com');
    expect(out.bigString.length).toBeLessThan(3000);
  });

  test('S7 token is hashed at rest, never plaintext', async () => {
    const a = await registerAgent('s7');
    const row = db.prepare('SELECT token_hash FROM gov_agents WHERE agent_id = ?').get(a.agent_id);
    expect(row.token_hash).not.toBe(a.agent_token);
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);   // sha256 hex
    // Schema must NOT have a plaintext token column
    const cols = db.prepare("PRAGMA table_info(gov_agents)").all().map(c => c.name);
    expect(cols).not.toContain('token');
    expect(cols).not.toContain('agent_token');
  });

  test('S8 agent A token cannot manage agent B', async () => {
    const a = await registerAgent('s8a');
    const b = await registerAgent('s8b');
    const r = await request(app).post(`/api/governance/agents/${b.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'x', action: 'read' });
    expect(r.status).toBe(401);
  });

  test('S9 token cannot be retrieved after creation', async () => {
    const a = await registerAgent('s9');
    // status endpoint must not return the token
    const s = await request(app).get(`/api/governance/agents/${a.agent_id}/status`)
      .set(authHeader(a.agent_token));
    expect(s.status).toBe(200);
    const json = JSON.stringify(s.body);
    expect(json).not.toContain(a.agent_token);
    expect(json).not.toContain('token_hash');
  });

  test('S10 deny by default when no policy matches', async () => {
    const a = await registerAgent('s10');
    const r = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'unknown_resource', action: 'write' });
    expect(r.body.decision).toBe('deny');
    expect(r.body.reason).toBe('no_policy');
  });
});

// ════════════════════════════════════════ OPERATIONAL TESTS ════
describe('Governance — Operational', () => {

  test('O1 policy CRUD round-trip', async () => {
    const a = await registerAgent('o1');
    const c = await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'gmail', action: 'read', scope: 'inbox' });
    expect(c.status).toBe(201);
    const list = await request(app).get(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token));
    expect(list.body.policies.length).toBe(1);
    const del = await request(app).delete(`/api/governance/agents/${a.agent_id}/policies/${c.body.id}`)
      .set(authHeader(a.agent_token));
    expect(del.body.ok).toBe(true);
    const after = await request(app).get(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token));
    expect(after.body.policies.length).toBe(0);
  });

  test('O2 max_amount per-call enforced', async () => {
    const a = await registerAgent('o2');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r', max_amount: 50 });
    const ok = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r', amount: 49.99 });
    expect(ok.body.decision).toBe('allow');
    const no = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r', amount: 50.01 });
    expect(no.body.decision).toBe('deny');
    expect(no.body.reason).toBe('over_max_amount');
  });

  test('O3 daily_cap rolling window', async () => {
    const a = await registerAgent('o3');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r',
        max_amount: 100, daily_cap: 150 });

    // first execute: $80
    await request(app).post(`/api/governance/agents/${a.agent_id}/execute`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r', amount: 80 });
    // second check: $80 + $80 = $160 > $150
    const r = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'r', amount: 80 });
    expect(r.body.decision).toBe('deny');
    expect(r.body.reason).toBe('over_daily_cap');
  });

  test('O4 per_call_rate enforced', async () => {
    const a = await registerAgent('o4');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'clickup', action: 'write', scope: 't', per_call_rate: 3 });
    const calls = [];
    for (let i = 0; i < 5; i++) {
      calls.push(await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
        .set(authHeader(a.agent_token))
        .send({ resource: 'clickup', action: 'write', scope: 't' }));
    }
    const allows = calls.filter(c => c.body.decision === 'allow').length;
    const denies = calls.filter(c => c.body.decision === 'deny' &&
      c.body.reason === 'rate_limit').length;
    expect(allows).toBeLessThanOrEqual(3);
    expect(denies).toBeGreaterThanOrEqual(2);
  });

  test('O5 approval gate: pending → approved → allowed', async () => {
    const a = await registerAgent('o5');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'big',
        max_amount: 5000, requires_approval: true });

    // check returns approval_required
    const c = await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'big', amount: 1000 });
    expect(c.body.decision).toBe('approval_required');

    // request approval
    const ar = await request(app).post(`/api/governance/agents/${a.agent_id}/approvals`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'stripe', action: 'write', scope: 'big', amount: 1000 });
    expect(ar.body.status).toBe('pending');

    // human approves
    const dec = await request(app).post(`/api/governance/approvals/${ar.body.requestId}/decide`)
      .set(authHeader(a.agent_token))
      .send({ decision: 'approved', note: 'test_human' });
    expect(dec.body.status).toBe('approved');

    // re-fetch
    const got = await request(app).get(`/api/governance/approvals/${ar.body.requestId}`);
    expect(got.body.status).toBe('approved');
    expect(got.body.decided_note).toBe('test_human');
  });

  test('O6 approval rejected → final state rejected', async () => {
    const a = await registerAgent('o6');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 's', action: 'w', requires_approval: true });
    const ar = await request(app).post(`/api/governance/agents/${a.agent_id}/approvals`)
      .set(authHeader(a.agent_token))
      .send({ resource: 's', action: 'w' });
    const dec = await request(app).post(`/api/governance/approvals/${ar.body.requestId}/decide`)
      .set(authHeader(a.agent_token))
      .send({ decision: 'rejected', note: 'risky' });
    expect(dec.body.status).toBe('rejected');
    // Cannot decide twice
    const dec2 = await request(app).post(`/api/governance/approvals/${ar.body.requestId}/decide`)
      .set(authHeader(a.agent_token))
      .send({ decision: 'approved' });
    expect(dec2.status).toBe(409);
  });

  test('O7 audit captures all events', async () => {
    const a = await registerAgent('o7');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'g', action: 'r' });
    await request(app).post(`/api/governance/agents/${a.agent_id}/check`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'g', action: 'r' });
    await request(app).post(`/api/governance/agents/${a.agent_id}/execute`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'g', action: 'r', decision: 'allow' });
    const audit = await request(app).get(`/api/governance/agents/${a.agent_id}/audit`)
      .set(authHeader(a.agent_token));
    const types = audit.body.audit.map(x => x.event_type);
    expect(types).toContain('execute');
    expect(types).toContain('check');
    expect(types).toContain('policy_change');
    // Verify the chain returned by API
    const v = await request(app).get(`/api/governance/agents/${a.agent_id}/audit/verify`)
      .set(authHeader(a.agent_token));
    expect(v.body.ok).toBe(true);
  });

  test('O8 policy specificity: exact-scope wins over null-scope', () => {
    const r = gov.registerAgent({ displayName: 'o8' });
    gov.definePolicy({ agentId: r.agentId, resource: 's', action: 'w', maxAmount: 1000 });
    gov.definePolicy({ agentId: r.agentId, resource: 's', action: 'w', scope: 'tight', maxAmount: 10 });
    // scope 'tight' must apply the tighter cap
    const tight = gov.check({ agentId: r.agentId, resource: 's', action: 'w', scope: 'tight', amount: 50 });
    expect(tight.decision).toBe('deny');
    expect(tight.reason).toBe('over_max_amount');
    // null scope falls back to broad policy
    const broad = gov.check({ agentId: r.agentId, resource: 's', action: 'w', amount: 50 });
    expect(broad.decision).toBe('allow');
  });

  test('O9 expired policy is ignored', () => {
    const r = gov.registerAgent({ displayName: 'o9' });
    gov.definePolicy({
      agentId: r.agentId, resource: 'x', action: 'r',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),  // 1 min ago
    });
    const v = gov.check({ agentId: r.agentId, resource: 'x', action: 'r' });
    expect(v.decision).toBe('deny');
    expect(v.reason).toBe('no_policy');
  });

  test('O10 status reflects 24h stats', async () => {
    const a = await registerAgent('o10');
    await request(app).post(`/api/governance/agents/${a.agent_id}/policies`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'x', action: 'r' });
    await request(app).post(`/api/governance/agents/${a.agent_id}/execute`)
      .set(authHeader(a.agent_token))
      .send({ resource: 'x', action: 'r', decision: 'allow' });
    const s = await request(app).get(`/api/governance/agents/${a.agent_id}/status`)
      .set(authHeader(a.agent_token));
    expect(s.body.status).toBe('alive');
    expect(s.body.stats_24h.allow).toBeGreaterThanOrEqual(1);
    expect(s.body.stats_24h.total).toBeGreaterThanOrEqual(2);
  });
});

// ════════════════════════════════════════ SDK TESTS ════
describe('Governance — SDK (programmatic)', () => {
  // Boot a real HTTP server so SDK can fetch.
  let server, base;
  beforeAll((done) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      base = `http://127.0.0.1:${port}`;
      done();
    });
  });
  afterAll((done) => { server && server.close(done); });

  test('P1 WABGovernance.register() returns id + token', async () => {
    const r = await WABGovernance.register({
      apiBase: base, displayName: 'sdk-p1',
    });
    expect(r.agent_id).toBeTruthy();
    expect(r.agent_token).toMatch(/^wabag_/);
  });

  test('P2 gov.guard() happy path', async () => {
    const reg = await WABGovernance.register({ apiBase: base, displayName: 'sdk-p2' });
    const g = new WABGovernance({ apiBase: base, agentId: reg.agent_id, agentToken: reg.agent_token });
    await g.definePolicy({ resource: 'gmail', action: 'read', scope: 'inbox' });
    const out = await g.guard(
      { resource: 'gmail', action: 'read', scope: 'inbox' },
      async () => ({ messages: 3 }),
    );
    expect(out.result.messages).toBe(3);
    expect(out.elapsed_ms).toBeGreaterThanOrEqual(0);
  });

  test('P3 gov.guard() with approval callback auto-approves', async () => {
    const reg = await WABGovernance.register({ apiBase: base, displayName: 'sdk-p3' });
    const g = new WABGovernance({
      apiBase: base, agentId: reg.agent_id, agentToken: reg.agent_token,
      onApprovalRequired: async () => 'approved',
      approvalTimeoutMs: 5000, approvalPollMs: 200,
    });
    await g.definePolicy({
      resource: 'stripe', action: 'write', scope: 'big',
      max_amount: 5000, requires_approval: true,
    });
    const out = await g.guard(
      { resource: 'stripe', action: 'write', scope: 'big', amount: 200,
        params: { charge: 'ch_x', password: 'should_be_redacted' } },
      async () => ({ refund_id: 're_test' }),
    );
    expect(out.result.refund_id).toBe('re_test');
  });

  test('P4 gov.guard() denies when over cap', async () => {
    const reg = await WABGovernance.register({ apiBase: base, displayName: 'sdk-p4' });
    const g = new WABGovernance({ apiBase: base, agentId: reg.agent_id, agentToken: reg.agent_token });
    await g.definePolicy({ resource: 's', action: 'w', max_amount: 10 });
    await expect(g.guard(
      { resource: 's', action: 'w', amount: 999 },
      async () => 'x',
    )).rejects.toThrow(/Governance denied/);
  });

  test('P5 verifyAudit returns ok=true', async () => {
    const reg = await WABGovernance.register({ apiBase: base, displayName: 'sdk-p5' });
    const g = new WABGovernance({ apiBase: base, agentId: reg.agent_id, agentToken: reg.agent_token });
    await g.definePolicy({ resource: 'a', action: 'r' });
    await g.guard({ resource: 'a', action: 'r' }, async () => 1);
    await g.guard({ resource: 'a', action: 'r' }, async () => 2);
    const v = await g.verifyAudit();
    expect(v.ok).toBe(true);
    expect(v.count).toBeGreaterThan(2);
  });

  test('P6 SDK redacts password before sending to audit', async () => {
    const reg = await WABGovernance.register({ apiBase: base, displayName: 'sdk-p6' });
    const g = new WABGovernance({ apiBase: base, agentId: reg.agent_id, agentToken: reg.agent_token });
    await g.definePolicy({ resource: 'a', action: 'r' });
    await g.reportExecute({
      resource: 'a', action: 'r', decision: 'allow',
      params: { user: 'x', password: 'topsecret', api_key: 'sk_x' },
    });
    const audit = await g.getAudit({ limit: 5 });
    const exec = audit.audit.find(e => e.event_type === 'execute');
    expect(exec.params_json).toBeTruthy();
    expect(exec.params_json).not.toContain('topsecret');
    expect(exec.params_json).not.toContain('sk_x');
    expect(exec.params_json).toContain('[redacted]');
  });
});
