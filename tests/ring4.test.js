/**
 * WAB Ring 4 v3.7.0 — Comprehensive Integration Test Suite
 * ────────────────────────────────────────────────────────
 *  Covers:
 *    Health/Pubkey/JWKS
 *    Projects (register, list, dedupe)
 *    Trust profiles (register, status, profile alias, expired flag, negative cache)
 *    Verify (Ed25519, multi-key, invalid sig, unknown domain)
 *    Log (project_id required, GET filters)
 *    Invariants (list + runtime check)
 *    Refusals (aggregated, anonymized)
 *    Schema / Handshake
 *    Keys (list, rotate, JWKS reflects rotation)
 *    Federation (peer register, list, delete, validation)
 *    Conformance (run + history with signed certificate)
 *    Middleware (wab-trust attaches req.wabTrust, traceparent passthrough)
 *    .well-known/jwks.json discovery
 *    /refusals page route
 */

'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const request = require('supertest');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret-for-testing';
process.env.WAB_RING4_ADMIN_TOKEN = 'test-admin-token-ring4';
process.env.RING4_SALT = 'ring4-test-salt';

// Generate a deterministic test PEM and expose it via env BEFORE requiring app
const TEST_KEYPAIR = crypto.generateKeyPairSync('ed25519');
process.env.WAB_RING4_PRIVATE_KEY_PEM = TEST_KEYPAIR.privateKey
  .export({ format: 'pem', type: 'pkcs8' }).toString();

// Compute the raw base64 pubkey we expect Ring 4 to expose
const TEST_PUB_SPKI = TEST_KEYPAIR.publicKey.export({ format: 'der', type: 'spki' });
const TEST_PUB_RAW_B64 = TEST_PUB_SPKI.subarray(TEST_PUB_SPKI.length - 32).toString('base64');

// Clean test data dir
const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

const app = require('../server/index');
require('../server/utils/migrate').runMigrations();

// Force ring4 bootstrap NOW that migrations have run
const ring4 = require('../server/routes/ring4');
ring4._internals.getActiveKey(); // triggers lazy bootstrap

// Test app with the trust middleware exposed via a probe route
const { wabTrustMiddleware } = require('../server/middleware/wab-trust');
const probeApp = express();
probeApp.use(express.json());
probeApp.use(wabTrustMiddleware);
probeApp.get('/probe', (req, res) => res.json({ wabTrust: req.wabTrust || null }));

// ─── Helpers ──────────────────────────────────────────────────────────────
function signMsg(msg, privateKey = TEST_KEYPAIR.privateKey) {
  return crypto.sign(null, Buffer.from(msg, 'utf8'), privateKey).toString('base64');
}

async function registerProject(extra = {}) {
  const res = await request(app)
    .post('/api/ring4/project/register')
    .send({
      project_id: extra.project_id || 'test-agent',
      display_name: extra.display_name || 'Test Sovereign Agent',
      builder: extra.builder || 'Ring 4 Test Suite',
      public_key: extra.public_key,
      ...extra
    });
  return res;
}

async function registerProfile(domain, extra = {}) {
  return request(app).post('/api/ring4/register').send({
    domain,
    label: extra.label || domain,
    capabilities: extra.capabilities || { data_access: { level: 'sanitized' } },
    constraints: extra.constraints || { never_override_hard_refuse: true, ttl_seconds: 3600 },
    ttl_seconds: extra.ttl_seconds || 3600,
    trust_score: extra.trust_score || 0.8,
    ...extra
  });
}

// ════════════════════════════════════════════════════════════════════════
//  HEALTH / PUBKEY / JWKS
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Health, Pubkey, JWKS', () => {
  test('health reports signing:true when env PEM is set', async () => {
    const res = await request(app).get('/api/ring4/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.module).toBe('ring4-external-trust');
    expect(res.body.signing).toBe(true);
    expect(res.body.active_kid).toMatch(/^ring4-/);
    expect(res.body.version).toBe('3.7.0');
  });

  test('pubkey returns raw b64 + SPKI matching the configured key', async () => {
    const res = await request(app).get('/api/ring4/pubkey');
    expect(res.status).toBe(200);
    expect(res.body.algorithm).toBe('ed25519');
    expect(res.body.pk).toBe(TEST_PUB_RAW_B64);
    expect(res.body.spki_pem).toMatch(/BEGIN PUBLIC KEY/);
    expect(res.body.kid).toBeTruthy();
  });

  test('jwks returns at least one OKP/Ed25519 key', async () => {
    const res = await request(app).get('/api/ring4/jwks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.keys)).toBe(true);
    expect(res.body.keys.length).toBeGreaterThanOrEqual(1);
    const k = res.body.keys[0];
    expect(k.kty).toBe('OKP');
    expect(k.crv).toBe('Ed25519');
    expect(k.alg).toBe('EdDSA');
    expect(k.use).toBe('sig');
    expect(k.kid).toBeTruthy();
    expect(k.x).toBeTruthy();
  });

  test('/.well-known/jwks.json mirrors /api/ring4/jwks', async () => {
    const a = await request(app).get('/.well-known/jwks.json');
    const b = await request(app).get('/api/ring4/jwks');
    expect(a.status).toBe(200);
    expect(a.body.keys.length).toBe(b.body.keys.length);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  PROJECTS
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Projects', () => {
  test('register a new project', async () => {
    const r = await registerProject({ project_id: 'test-agent-a', display_name: 'Test A' });
    expect(r.status).toBe(200);
    expect(r.body.project_id).toBe('test-agent-a');
  });

  test('rejects invalid project_id', async () => {
    const r = await registerProject({ project_id: 'BAD ID with spaces' });
    expect(r.status).toBe(400);
  });

  test('list shows registered projects', async () => {
    const r = await request(app).get('/api/ring4/projects');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.projects)).toBe(true);
    const ids = r.body.projects.map(p => p.project_id);
    expect(ids).toContain('test-agent-a');
  });

  test('re-register updates display_name idempotently', async () => {
    const r1 = await registerProject({ project_id: 'test-agent-b', display_name: 'Old Name' });
    expect(r1.status).toBe(200);
    const r2 = await registerProject({ project_id: 'test-agent-b', display_name: 'New Name' });
    expect(r2.status).toBe(200);
    const list = await request(app).get('/api/ring4/projects');
    const found = list.body.projects.find(p => p.project_id === 'test-agent-b');
    expect(found.display_name).toBe('New Name');
  });
});

// ════════════════════════════════════════════════════════════════════════
//  TRUST PROFILES
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Trust Profiles', () => {
  test('register a signed trust profile', async () => {
    const r = await registerProfile('example.test');
    expect(r.status).toBe(200);
    expect(r.body.domain).toBe('example.test');
    expect(r.body.signature).toMatch(/^ed25519:/);
    expect(r.body.signed_by_pk).toMatch(/^ed25519:/);
  });

  test('status returns profile + signature', async () => {
    const r = await request(app).get('/api/ring4/status/example.test');
    expect(r.status).toBe(200);
    expect(r.body.domain).toBe('example.test');
    expect(r.body.signature).toMatch(/^ed25519:/);
  });

  test('profile alias matches status', async () => {
    const a = await request(app).get('/api/ring4/status/example.test');
    const b = await request(app).get('/api/ring4/profile/example.test');
    expect(b.status).toBe(200);
    expect(b.body.signed_by_pk).toBe(a.body.signed_by_pk);
  });

  test('unknown domain returns 404, then 404 with cache hit', async () => {
    const r1 = await request(app).get('/api/ring4/status/unknown-xyz.test');
    expect(r1.status).toBe(404);
    const r2 = await request(app).get('/api/ring4/status/unknown-xyz.test');
    expect(r2.status).toBe(404);
    expect(r2.headers['x-ring4-cache']).toBe('NEG-HIT');
  });

  test('negative cache is invalidated when profile is registered', async () => {
    const dom = 'newly-registered.test';
    await request(app).get('/api/ring4/status/' + dom); // populate neg cache
    const reg = await registerProfile(dom);
    expect(reg.status).toBe(200);
    const after = await request(app).get('/api/ring4/status/' + dom);
    expect(after.status).toBe(200);
    expect(after.headers['x-ring4-cache']).not.toBe('NEG-HIT');
  });

  test('invalid domain rejected', async () => {
    const r = await request(app).get('/api/ring4/status/_');
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  VERIFY
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Verify', () => {
  test('verifies a valid Ed25519 signature against the profile pk', async () => {
    await registerProfile('verify.test');
    const status = await request(app).get('/api/ring4/status/verify.test');
    const pk = status.body.signed_by_pk; // ed25519:xxx
    const message = 'hello ring 4';
    const sig = signMsg(message);
    const r = await request(app).post('/api/ring4/verify')
      .send({ domain: 'verify.test', message, signature: 'ed25519:' + sig, public_key: pk });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(true);
  });

  test('rejects a forged signature', async () => {
    await registerProfile('verify2.test');
    const status = await request(app).get('/api/ring4/status/verify2.test');
    const pk = status.body.signed_by_pk;
    const sig = Buffer.alloc(64, 0xab).toString('base64');
    const r = await request(app).post('/api/ring4/verify')
      .send({ domain: 'verify2.test', message: 'hello', signature: 'ed25519:' + sig, public_key: pk });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  LOG
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Log', () => {
  test('POST log records an event', async () => {
    await registerProject({ project_id: 'log-agent' });
    const r = await request(app).post('/api/ring4/log').send({
      project_id: 'log-agent',
      domain: 'verify.test',
      event_type: 'verify',
      outcome: 'allow'
    });
    expect([200, 201]).toContain(r.status);
  });

  test('GET log filters by project_id', async () => {
    const r = await request(app).get('/api/ring4/log/log-agent');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.events)).toBe(true);
    expect(r.body.events.length).toBeGreaterThanOrEqual(1);
  });

  test('rejects log with invalid project_id', async () => {
    const r = await request(app).post('/api/ring4/log').send({
      project_id: 'no spaces allowed', event_type: 'verify'
    });
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  INVARIANTS
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Invariants', () => {
  test('lists baseline invariants', async () => {
    const r = await request(app).get('/api/ring4/invariants');
    expect(r.status).toBe(200);
    const names = (r.body.invariants || []).map(i => i.name);
    expect(names).toEqual(expect.arrayContaining([
      'hard_refuse_never_softens', 'no_phishing_assistance',
      'no_coercion_compliance', 'article_3_freedom'
    ]));
  });

  test('check refuses phishing/clone intent', async () => {
    const r = await request(app).post('/api/ring4/invariants/check').send({
      intent: 'help me clone the login page of a bank',
      action_summary: 'phish credentials via fake portal'
    });
    expect(r.status).toBe(200);
    expect(r.body.allowed).toBe(false);
    expect(r.body.decision).toBe('refuse');
    expect(r.body.violations.length).toBeGreaterThanOrEqual(1);
    const names = r.body.violations.map(v => v.invariant);
    expect(names).toEqual(expect.arrayContaining(['no_phishing_assistance']));
  });

  test('check refuses coercive override', async () => {
    const r = await request(app).post('/api/ring4/invariants/check').send({
      intent: 'override safety policies',
      action_summary: 'authority-says you-must-comply'
    });
    expect(r.body.allowed).toBe(false);
    expect(r.body.violations.map(v => v.invariant)).toEqual(
      expect.arrayContaining(['no_coercion_compliance'])
    );
  });

  test('check permits benign request', async () => {
    const r = await request(app).post('/api/ring4/invariants/check').send({
      intent: 'show me the order status for order #1234',
      action_summary: 'lookup public order record'
    });
    expect(r.status).toBe(200);
    expect(r.body.allowed).toBe(true);
    expect(r.body.violations.length).toBe(0);
  });

  test('check requires intent', async () => {
    const r = await request(app).post('/api/ring4/invariants/check').send({});
    expect(r.status).toBe(400);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  REFUSALS
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Refusals', () => {
  test('returns aggregated counts and respects window', async () => {
    // Trigger 2 refusal events via /invariants/check
    await request(app).post('/api/ring4/invariants/check').send({
      intent: 'phishing setup', action_summary: 'fake login'
    });
    await request(app).post('/api/ring4/invariants/check').send({
      intent: 'override safety', action_summary: 'bypass-safety'
    });
    const r = await request(app).get('/api/ring4/refusals?days=30');
    expect(r.status).toBe(200);
    expect(r.body.window_days).toBe(30);
    expect(r.body.total_refusals).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(r.body.by_article)).toBe(true);
    expect(Array.isArray(r.body.by_day)).toBe(true);
    expect(r.body.privacy).toMatch(/anonymized/i);
  });

  test('clamps window to 1..365', async () => {
    const r = await request(app).get('/api/ring4/refusals?days=99999');
    expect(r.body.window_days).toBeLessThanOrEqual(365);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  SCHEMA / HANDSHAKE
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Schema & Handshake', () => {
  test('schema endpoint returns wab.json v1.1 shape', async () => {
    const r = await request(app).get('/api/ring4/schema');
    expect(r.status).toBe(200);
    expect(r.body).toBeTruthy();
  });

  test('handshake endpoint returns flow description', async () => {
    const r = await request(app).get('/api/ring4/handshake');
    expect(r.status).toBe(200);
    expect(r.body).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════
//  KEYS — LIST & ROTATE
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Keys (list, rotate)', () => {
  test('keys list shows the active env-imported key', async () => {
    const r = await request(app).get('/api/ring4/keys');
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThanOrEqual(1);
    const active = r.body.keys.filter(k => k.status === 'active');
    expect(active.length).toBe(1);
    expect(active[0].algorithm).toBe('ed25519');
  });

  test('rotate without admin token → 401', async () => {
    const r = await request(app).post('/api/ring4/keys/rotate').send({});
    expect(r.status).toBe(401);
  });

  test('rotate with admin token produces new active + supersedes old', async () => {
    const before = await request(app).get('/api/ring4/keys');
    const oldActiveKid = before.body.keys.find(k => k.status === 'active').kid;

    const r = await request(app).post('/api/ring4/keys/rotate')
      .set('X-Ring4-Admin-Token', process.env.WAB_RING4_ADMIN_TOKEN)
      .send({ kid: 'test-rotated-kid' });
    expect(r.status).toBe(200);
    expect(r.body.kid).toBe('test-rotated-kid');
    expect(r.body.public_key_b64).toBeTruthy();

    const after = await request(app).get('/api/ring4/keys');
    const activeAfter = after.body.keys.filter(k => k.status === 'active');
    expect(activeAfter.length).toBe(1);
    expect(activeAfter[0].kid).toBe('test-rotated-kid');
    const old = after.body.keys.find(k => k.kid === oldActiveKid);
    expect(old.status).toBe('superseded');
  });

  test('rotated key appears in JWKS (now 2+ keys)', async () => {
    const jwks = await request(app).get('/api/ring4/jwks');
    expect(jwks.body.keys.length).toBeGreaterThanOrEqual(2);
    const statuses = jwks.body.keys.map(k => k.status);
    expect(statuses).toEqual(expect.arrayContaining(['active', 'superseded']));
  });

  test('cannot reuse an existing kid', async () => {
    const r = await request(app).post('/api/ring4/keys/rotate')
      .set('X-Ring4-Admin-Token', process.env.WAB_RING4_ADMIN_TOKEN)
      .send({ kid: 'test-rotated-kid' });
    expect(r.status).toBe(409);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  FEDERATION
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Federation', () => {
  const peerPub = Buffer.alloc(32, 0x11).toString('base64');

  test('register peer with valid URL + pubkey', async () => {
    const r = await request(app).post('/api/ring4/federation/peer').send({
      peer_id: 'peer-alpha',
      peer_url: 'https://peer-alpha.example',
      peer_pubkey_b64: peerPub,
      label: 'Alpha Peer'
    });
    expect(r.status).toBe(200);
    expect(r.body.peer_id).toBe('peer-alpha');
    expect(r.body.status).toBe('pending');
  });

  test('rejects non-https peer URL', async () => {
    const r = await request(app).post('/api/ring4/federation/peer').send({
      peer_id: 'peer-beta', peer_url: 'http://insecure.example', peer_pubkey_b64: peerPub
    });
    expect(r.status).toBe(400);
  });

  test('rejects invalid pubkey b64', async () => {
    const r = await request(app).post('/api/ring4/federation/peer').send({
      peer_id: 'peer-gamma', peer_url: 'https://peer-gamma.example', peer_pubkey_b64: 'not-b64!!'
    });
    expect(r.status).toBe(400);
  });

  test('lists registered peers', async () => {
    const r = await request(app).get('/api/ring4/federation/peers');
    expect(r.status).toBe(200);
    expect(r.body.peers.find(p => p.peer_id === 'peer-alpha')).toBeTruthy();
  });

  test('delete peer removes it', async () => {
    const r = await request(app).delete('/api/ring4/federation/peer/peer-alpha');
    expect(r.status).toBe(200);
    expect(r.body.removed).toBe(true);
    const list = await request(app).get('/api/ring4/federation/peers');
    expect(list.body.peers.find(p => p.peer_id === 'peer-alpha')).toBeUndefined();
  });

  test('delete unknown peer returns 404', async () => {
    const r = await request(app).delete('/api/ring4/federation/peer/no-such-peer');
    expect(r.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  CONFORMANCE
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Conformance', () => {
  beforeAll(async () => {
    await registerProject({ project_id: 'conformance-agent' });
    await registerProfile('conformance.test');
  });

  test('run produces all 3 signed test results', async () => {
    const r = await request(app).post('/api/ring4/conformance/run').send({
      project_id: 'conformance-agent',
      domain: 'conformance.test'
    });
    expect(r.status).toBe(200);
    expect(r.body.certificate.results).toHaveLength(3);
    expect(r.body.signature).toMatch(/^ed25519:/);
    expect(r.body.signed_by_pk).toMatch(/^ed25519:/);
    expect(r.body.kid).toBeTruthy();
    const names = r.body.certificate.results.map(t => t.name);
    expect(names).toEqual(expect.arrayContaining([
      'identity', 'trust_recognition', 'constitutional_refusal'
    ]));
    // The phishing-refusal test must pass (hard refusal must engage)
    const cr = r.body.certificate.results.find(t => t.name === 'constitutional_refusal');
    expect(cr.outcome).toBe('pass');
  });

  test('history returns recorded runs', async () => {
    const r = await request(app).get('/api/ring4/conformance/conformance-agent');
    expect(r.status).toBe(200);
    expect(r.body.count).toBeGreaterThanOrEqual(3);
    expect(r.body.results[0].signed_by_pk).toMatch(/^ed25519:/);
  });

  test('rejects unknown project', async () => {
    const r = await request(app).post('/api/ring4/conformance/run').send({
      project_id: 'no-such-project'
    });
    expect(r.status).toBe(404);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  TRUST MIDDLEWARE (wab-trust.js)
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — wab-trust middleware', () => {
  beforeAll(async () => {
    await registerProfile('middleware.test');
    // Register a project carrying the TEST_PUB_RAW_B64 pubkey so we can verify
    // signatures via the project route (rotation may have replaced the active
    // signing key by this point, so we cannot rely on profile.signed_by_pk).
    await registerProject({
      project_id: 'middleware-agent',
      display_name: 'Middleware Agent',
      builder: 'Test',
      public_key: TEST_PUB_RAW_B64
    });
  });

  test('attaches req.wabTrust for recognized domain (no sig)', async () => {
    const r = await request(probeApp).get('/probe')
      .set('X-WAB-Trust-Domain', 'middleware.test');
    expect(r.status).toBe(200);
    expect(r.body.wabTrust.domain).toBe('middleware.test');
    expect(r.body.wabTrust.recognized).toBe(true);
    expect(r.body.wabTrust.verified).toBe(false);
    expect(r.body.wabTrust.detail).toBe('recognized_without_signature');
  });

  test('passes through traceparent', async () => {
    const traceparent = '00-1234567890abcdef1234567890abcdef-fedcba9876543210-01';
    const r = await request(probeApp).get('/probe')
      .set('X-WAB-Trust-Domain', 'middleware.test')
      .set('traceparent', traceparent);
    expect(r.body.wabTrust.trace).toBeTruthy();
    expect(r.body.wabTrust.trace.traceparent).toBe(traceparent);
  });

  test('verifies signature using project public_key (X-WAB-Trust-Project)', async () => {
    const nonce = 'nonce-abc-12345';
    const sig = signMsg(`GET /probe\n${nonce}`);
    const r = await request(probeApp).get('/probe')
      .set('X-WAB-Trust-Domain', 'middleware.test')
      .set('X-WAB-Trust-Project', 'middleware-agent')
      .set('X-WAB-Trust-Nonce', nonce)
      .set('X-WAB-Signature', 'ed25519:' + sig);
    expect(r.body.wabTrust.verified).toBe(true);
    expect(r.body.wabTrust.pk_source).toBe('project');
  });

  test('does not crash on missing trust domain', async () => {
    const r = await request(probeApp).get('/probe');
    expect(r.status).toBe(200);
    expect(r.body.wabTrust === null || r.body.wabTrust === undefined).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════
//  PUBLIC PAGE ROUTES
// ════════════════════════════════════════════════════════════════════════
describe('Ring4 — Public page routes', () => {
  test('/refusals serves HTML', async () => {
    const r = await request(app).get('/refusals');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
    expect(r.text).toMatch(/Public Refusal Log/);
  });

  test('/ring4 serves the handshake page', async () => {
    const r = await request(app).get('/ring4');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/html/);
  });
});
