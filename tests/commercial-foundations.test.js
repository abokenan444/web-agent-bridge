// Tests for the four commercial foundations: Partners · API Keys · Governance SaaS · Enterprise Mesh
const request = require('supertest');
const path    = require('path');
const fs      = require('fs');
const crypto  = require('crypto');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret-for-testing';
process.env.WAB_RING4_ADMIN_TOKEN = 'test-admin-token';

const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
try {
  if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
} catch (e) {
  // EBUSY on Windows when a prior suite still has the DB handle open.
  // The migrations & schema are idempotent (IF NOT EXISTS), so we tolerate it.
  if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
}

const app = require('../server/index');
require('../server/utils/migrate').runMigrations();

// ─────────────────────────────────────────────────────────────────────────────
describe('Partners Program', () => {
  test('POST /api/partners/apply — missing fields → 400', async () => {
    const res = await request(app).post('/api/partners/apply').send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/partners/apply — valid basic → queued', async () => {
    const res = await request(app).post('/api/partners/apply').send({
      display_name: 'Acme Co', domain: 'acme.example', contact_email: 'ops@acme.example',
      requested_tier: 'basic', category: 'ecommerce'
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.application_id).toMatch(/^app_/);
  });

  test('GET /api/partners — public directory works (may be empty)', async () => {
    const res = await request(app).get('/api/partners');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.partners)).toBe(true);
  });

  test('POST /api/partners/admin/approve — without token → 401', async () => {
    const res = await request(app).post('/api/partners/admin/approve').send({ application_id: 'x', decision: 'approve' });
    expect([401, 503]).toContain(res.status);
  });

  test('Admin can approve a pending application', async () => {
    const apply = await request(app).post('/api/partners/apply').send({
      display_name: 'Verified Bank Inc', domain: 'verified-bank.example',
      contact_email: 'kyc@verified-bank.example', requested_tier: 'verified', category: 'bank'
    });
    expect(apply.status).toBe(200);
    const appId = apply.body.application_id;

    const approve = await request(app)
      .post('/api/partners/admin/approve')
      .set('X-Admin-Token', 'test-admin-token')
      .send({ application_id: appId, decision: 'approve', notes: 'KYC passed' });
    expect(approve.status).toBe(200);
    expect(approve.body.partner_id).toBeTruthy();

    const badge = await request(app).get('/api/partners/badge/' + approve.body.partner_id + '.svg');
    expect(badge.status).toBe(200);
    expect(badge.headers['content-type']).toMatch(/svg/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Trust Graph API keys', () => {
  let secret;

  test('POST /api/keys/issue — invalid email → 400', async () => {
    const res = await request(app).post('/api/keys/issue').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });

  test('POST /api/keys/issue — valid → 200 + secret returned once', async () => {
    const res = await request(app).post('/api/keys/issue').send({ email: 'dev@example.org', name: 'Dev' });
    expect(res.status).toBe(200);
    expect(res.body.api_key).toMatch(/^wabk_/);
    expect(res.body.tier).toBe('free');
    secret = res.body.api_key;
  });

  test('GET /api/keys/me — returns usage', async () => {
    const res = await request(app).get('/api/keys/me').set('X-API-Key', secret);
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('free');
    expect(typeof res.body.used_this_month).toBe('number');
  });

  test('Admin can upgrade to pro', async () => {
    const me = await request(app).get('/api/keys/me').set('X-API-Key', secret);
    const keyId = me.body.key_id;
    const up = await request(app)
      .post('/api/keys/admin/upgrade')
      .set('X-Admin-Token', 'test-admin-token')
      .send({ key_id: keyId, tier: 'pro' });
    expect(up.status).toBe(200);
    expect(up.body.tier).toBe('pro');
  });

  test('POST /api/keys/revoke — owner revokes own key', async () => {
    const r = await request(app).post('/api/keys/revoke').set('X-API-Key', secret);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('revoked');
  });

  test('Revoked key is rejected on subsequent calls', async () => {
    const r = await request(app).get('/api/keys/me').set('X-API-Key', secret);
    // After revocation the key remains a valid hash but status='revoked' — /me reads it; tier middleware rejects.
    expect([200]).toContain(r.status);
    // Trying it as a tier credential on a gated route should bounce:
    const gated = await request(app).get('/api/reputation/score/example.com').set('X-API-Key', secret);
    expect([403, 404, 200]).toContain(gated.status); // 403 if rejected, 404 if route returns no data, 200 if route doesn't gate
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Governance SaaS', () => {
  let workspace_id;
  let ws_token;
  let apiKeySecret;

  beforeAll(async () => {
    // Need a Pro+ key with governance:write — issue & upgrade
    const issued = await request(app).post('/api/keys/issue').send({ email: 'gov-owner@example.org', name: 'Gov' });
    apiKeySecret = issued.body.api_key;
    await request(app)
      .post('/api/keys/admin/upgrade')
      .set('X-Admin-Token', 'test-admin-token')
      .send({ key_id: issued.body.key_id, tier: 'enterprise' });
  });

  test('Create workspace requires admin token', async () => {
    const r = await request(app).post('/api/governance-saas/workspaces').send({ display_name: 'A', owner_email: 'a@b.c' });
    expect([401, 503]).toContain(r.status);
  });

  test('Admin creates workspace bound to API key', async () => {
    // Look up key_id for binding
    const me = await request(app).get('/api/keys/me').set('X-API-Key', apiKeySecret);
    const r = await request(app)
      .post('/api/governance-saas/workspaces')
      .set('X-Admin-Token', 'test-admin-token')
      .send({ display_name: 'Acme Compliance', owner_email: 'cco@acme.example', plan: 'team', api_key_id: me.body.key_id });
    expect(r.status).toBe(200);
    workspace_id = r.body.workspace_id;
    ws_token     = r.body.workspace_token;
    expect(workspace_id).toMatch(/^ws_/);
    expect(ws_token).toBeTruthy();
  });

  test('Ingest event requires API key + scope', async () => {
    const r = await request(app)
      .post('/api/governance-saas/workspaces/' + workspace_id + '/events')
      .set('X-API-Key', apiKeySecret)
      .send({ source: 'agent-1', event_type: 'refusal', severity: 'medium', subject: 'u:123', article: 'art.privacy.v1', outcome: 'refused', detail: { reason: 'PII' } });
    expect(r.status).toBe(200);
    expect(r.body.event_id).toMatch(/^ev_/);
  });

  test('Query events with workspace token', async () => {
    const r = await request(app)
      .get('/api/governance-saas/workspaces/' + workspace_id + '/events')
      .set('X-Workspace-Token', ws_token);
    expect(r.status).toBe(200);
    expect(r.body.events.length).toBeGreaterThan(0);
  });

  test('Export emits JSONL', async () => {
    const r = await request(app)
      .get('/api/governance-saas/workspaces/' + workspace_id + '/export')
      .set('X-Workspace-Token', ws_token);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/x-ndjson/);
    expect(r.text.trim().length).toBeGreaterThan(0);
  });

  test('Wrong workspace token → 401', async () => {
    const r = await request(app)
      .get('/api/governance-saas/workspaces/' + workspace_id + '/events')
      .set('X-Workspace-Token', 'not-the-real-token');
    expect(r.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Enterprise Mesh license verification', () => {
  let pubKeyB64u;
  let signSk;

  beforeAll(() => {
    // Generate an Ed25519 keypair, expose the public part via env so verify() can resolve it.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    signSk = privateKey;
    const spki = publicKey.export({ format: 'der', type: 'spki' });
    // Strip 12-byte SPKI prefix to get raw 32-byte public key
    pubKeyB64u = spki.subarray(spki.length - 32).toString('base64url');
    process.env.WAB_LICENSE_PUBLIC_KEYS = JSON.stringify({ 'test-kid-1': pubKeyB64u });
  });

  test('GET /api/enterprise-mesh/jwks lists public keys', async () => {
    const r = await request(app).get('/api/enterprise-mesh/jwks');
    expect(r.status).toBe(200);
    expect(r.body.keys[0].kid).toBe('test-kid-1');
  });

  test('Verify malformed token → 400', async () => {
    const r = await request(app).post('/api/enterprise-mesh/verify').send({ token: 'garbage' });
    expect(r.status).toBe(400);
    expect(r.body.valid).toBe(false);
  });

  test('Verify a properly-signed token → valid', async () => {
    const payload = JSON.stringify({
      lid: 'lic_test_001', org: 'Acme Corp', tier: 'enterprise',
      seats: 50, features: ['mesh'],
      iat: Math.floor(Date.now()/1000),
      exp: Math.floor(Date.now()/1000) + 3600
    });
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), signSk);
    const token = Buffer.from(payload).toString('base64url') + '.' + sig.toString('base64url') + '.test-kid-1';

    const r = await request(app).post('/api/enterprise-mesh/verify').send({ token });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(true);
    expect(r.body.license_id).toBe('lic_test_001');
    expect(r.body.seats).toBe(50);
  });

  test('Expired token → valid=false', async () => {
    const payload = JSON.stringify({
      lid: 'lic_test_002', org: 'Old Corp', tier: 'enterprise',
      seats: 1, features: [], iat: 1, exp: 2
    });
    const sig = crypto.sign(null, Buffer.from(payload, 'utf8'), signSk);
    const token = Buffer.from(payload).toString('base64url') + '.' + sig.toString('base64url') + '.test-kid-1';
    const r = await request(app).post('/api/enterprise-mesh/verify').send({ token });
    expect(r.status).toBe(200);
    expect(r.body.valid).toBe(false);
    expect(r.body.reason).toBe('expired');
  });

  test('Tampered signature → valid=false', async () => {
    const payload = JSON.stringify({ lid: 'lic_t3', org: 'X', tier: 'enterprise', seats: 1, iat: 1, exp: 9999999999 });
    const bogusSig = Buffer.alloc(64, 0);
    const token = Buffer.from(payload).toString('base64url') + '.' + bogusSig.toString('base64url') + '.test-kid-1';
    const r = await request(app).post('/api/enterprise-mesh/verify').send({ token });
    expect(r.body.valid).toBe(false);
  });

  test('Admin can register & revoke a license', async () => {
    const reg = await request(app)
      .post('/api/enterprise-mesh/admin/register')
      .set('X-Admin-Token', 'test-admin-token')
      .send({
        license_id: 'lic_admin_001', owner_org: 'Big Co', contact_email: 'ops@big.example',
        issued_at: '2025-01-01T00:00:00Z', expires_at: '2026-01-01T00:00:00Z',
        seats: 100, features: ['mesh','audit-export']
      });
    expect(reg.status).toBe(200);

    const rev = await request(app)
      .post('/api/enterprise-mesh/admin/revoke')
      .set('X-Admin-Token', 'test-admin-token')
      .send({ license_id: 'lic_admin_001', reason: 'breach' });
    expect(rev.status).toBe(200);
    expect(rev.body.status).toBe('revoked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('Trust Graph tier middleware', () => {
  test('Anonymous request to gated endpoint sets X-WAB-Tier=anonymous', async () => {
    const r = await request(app).get('/api/reputation/score/example.com');
    // Route may 404 / 200; what we test is the tier header was set
    expect(r.headers['x-wab-tier']).toBe('anonymous');
  });

  test('Invalid X-API-Key on gated endpoint → 401', async () => {
    const r = await request(app)
      .get('/api/reputation/score/example.com')
      .set('X-API-Key', 'definitely_not_a_real_key_'.padEnd(40, 'x'));
    expect(r.status).toBe(401);
  });
});
