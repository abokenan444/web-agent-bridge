/**
 * Webhook Subscriptions tests (v3.16.0 — Phase 4)
 */
const http = require('http');
const crypto = require('crypto');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = process.env.JWT_SECRET_ADMIN || 'test-admin-secret-for-testing';

// Ed25519 operator key so the dispatcher signs every event envelope (v3.17.0).
if (!process.env.WAB_OPERATOR_ED25519_PRIV) {
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.WAB_OPERATOR_ED25519_PRIV = privateKey
    .export({ format: 'der', type: 'pkcs8' })
    .toString('base64');
}

const app = require('../server/index');
const { db } = require('../server/models/db');
require('../server/utils/migrate').runMigrations();
const webhooks = require('../server/services/webhooks');
const revocations = require('../server/services/revocations');

// Tiny in-process HTTP receiver for delivery tests.
function startReceiver(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => handler(req, body, res));
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, url: `http://127.0.0.1:${port}/hook`, port });
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let userToken;
let userId;
const SITE_ID = 's-wh-test-1';
const SITE_DOMAIN = 'wh-test.example.com';

beforeAll(async () => {
  // Register a user to get a JWT.
  const reg = await request(app).post('/api/auth/register').send({
    email: `wh-${Date.now()}@example.com`,
    password: 'password123',
    name: 'WH Tester',
  });
  expect(reg.status).toBe(201);
  userToken = reg.body.token;
  userId = reg.body.user.id;

  // Seed a site owned by the user so revocation hooks have a target.
  db.prepare(`
    INSERT OR REPLACE INTO sites (id, user_id, domain, name, license_key, active, created_at)
    VALUES (?, ?, ?, 'WH Test', 'lic_wh_test', 1, datetime('now'))
  `).run(SITE_ID, userId, SITE_DOMAIN);
});

afterAll(() => {
  db.prepare(`DELETE FROM webhook_deliveries WHERE subscription_id IN (SELECT id FROM webhook_subscriptions WHERE user_id = ?)`).run(userId);
  db.prepare(`DELETE FROM webhook_subscriptions WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM site_revocations WHERE site_id = ?`).run(SITE_ID);
  db.prepare(`DELETE FROM sites WHERE id = ?`).run(SITE_ID);
});

describe('Webhooks API (Phase 4)', () => {
  test('GET /api/webhooks/events lists supported event types', async () => {
    const res = await request(app).get('/api/webhooks/events');
    expect(res.status).toBe(200);
    expect(res.body.data.events).toEqual(
      expect.arrayContaining(['revocation.opened', 'revocation.reinstated', 'revocation.appeal_decided']),
    );
  });

  test('POST /api/webhooks rejects non-https url in non-test would fail; allowed in test', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'http://127.0.0.1:1/hook' });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toMatch(/^whsub_/);
    expect(res.body.data.secret).toBeDefined();
    // clean up
    await request(app).delete(`/api/webhooks/${res.body.data.id}`).set('Authorization', `Bearer ${userToken}`);
  });

  test('POST /api/webhooks rejects invalid url', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'not-a-url' });
    expect(res.status).toBe(400);
  });

  test('POST /api/webhooks rejects unknown event', async () => {
    const res = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'http://127.0.0.1:1/hook', events: ['bogus.event'] });
    expect(res.status).toBe(400);
  });

  test('CRUD: create, list, get, patch, delete', async () => {
    const create = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'http://127.0.0.1:1/hook', description: 'crud' });
    expect(create.status).toBe(200);
    const subId = create.body.data.id;

    const list = await request(app).get('/api/webhooks').set('Authorization', `Bearer ${userToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.some((s) => s.id === subId)).toBe(true);
    // secret never returned on list
    expect(list.body.data.find((s) => s.id === subId).secret).toBeUndefined();

    const get1 = await request(app).get(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${userToken}`);
    expect(get1.status).toBe(200);
    expect(get1.body.data.secret).toBeUndefined();

    const patch = await request(app)
      .patch(`/api/webhooks/${subId}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ active: false, events: ['revocation.opened'] });
    expect(patch.status).toBe(200);
    expect(patch.body.data.active).toBe(false);
    expect(patch.body.data.events).toEqual(['revocation.opened']);

    const del = await request(app).delete(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${userToken}`);
    expect(del.status).toBe(200);
  });

  test('Dispatch: revocation.opened pushes to receiver with valid HMAC', async () => {
    let captured = null;
    const recv = await startReceiver((req, body, res) => {
      captured = { headers: req.headers, body };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });

    const create = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: recv.url, events: ['revocation.opened'] });
    expect(create.status).toBe(200);
    const subId = create.body.data.id;
    const secret = create.body.data.secret;

    // Trigger an event via the service (uses our existing site).
    revocations.openRevocation({
      siteId: SITE_ID,
      type: 'suspended',
      reasonCode: 'abuse',
      reasonText: 'Webhook dispatch test reason',
      decidedBy: 'system:test',
    });

    // Wait for setImmediate + fetch to complete.
    let waited = 0;
    while (!captured && waited < 3000) { await sleep(50); waited += 50; }
    recv.server.close();

    expect(captured).not.toBeNull();
    expect(captured.headers['x-wab-webhook-event']).toBe('revocation.opened');
    expect(captured.headers['x-wab-webhook-signature']).toMatch(/^t=\d+,v1=[a-f0-9]+$/);
    const parsed = JSON.parse(captured.body);
    expect(parsed.type).toBe('revocation.opened');
    expect(parsed.data.revocation.domain).toBe(SITE_DOMAIN);

    // Verify the signature with the public verifier.
    const ok = webhooks.verifySignature({
      secret,
      header: captured.headers['x-wab-webhook-signature'],
      body: captured.body,
    });
    expect(ok).toBe(true);

    // Wrong secret must fail.
    const bad = webhooks.verifySignature({
      secret: crypto.randomBytes(32).toString('base64'),
      header: captured.headers['x-wab-webhook-signature'],
      body: captured.body,
    });
    expect(bad).toBe(false);

    // v3.17.0: operator (Ed25519) signature header + embedded envelope signature.
    expect(captured.headers['x-wab-operator-signature']).toBeTruthy();
    expect(captured.headers['x-wab-operator-key-url']).toBe('/api/operator-key.json');
    expect(parsed.signature).toBeDefined();
    expect(parsed.signature.alg).toBe('ed25519');
    expect(parsed.signature.canonicalization).toBe('RFC8785');
    // Header value must match the value embedded in the envelope.
    expect(captured.headers['x-wab-operator-signature']).toBe(parsed.signature.value);

    // Fetch the operator public key from the API and verify the envelope.
    const keyRes = await request(app).get('/api/operator-key.json');
    expect(keyRes.status).toBe(200);
    const pubB64 = keyRes.body.public_key_b64;
    const opOk = webhooks.verifyOperatorSignature({ body: captured.body, publicKeyB64: pubB64 });
    expect(opOk).toBe(true);

    // Tampering with the data must break the operator signature.
    const tampered = JSON.parse(captured.body);
    tampered.data.revocation.domain = 'evil.test';
    const tamperedOk = webhooks.verifyOperatorSignature({
      body: JSON.stringify(tampered),
      publicKeyB64: pubB64,
    });
    expect(tamperedOk).toBe(false);

    // Delivery row recorded as success.
    const deliveries = webhooks.listDeliveries({ subscriptionId: subId, userId });
    expect(deliveries.length).toBeGreaterThanOrEqual(1);
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].event_type).toBe('revocation.opened');

    // Cleanup: reinstate site for further tests.
    db.prepare(`UPDATE sites SET active = 1 WHERE id = ?`).run(SITE_ID);
    db.prepare(`DELETE FROM site_revocations WHERE site_id = ?`).run(SITE_ID);
    await request(app).delete(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${userToken}`);
  });

  test('Inactive subscription is not dispatched', async () => {
    let called = false;
    const recv = await startReceiver((req, body, res) => {
      called = true;
      res.writeHead(200); res.end();
    });
    const create = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: recv.url, events: ['revocation.opened'] });
    await request(app)
      .patch(`/api/webhooks/${create.body.data.id}`)
      .set('Authorization', `Bearer ${userToken}`)
      .send({ active: false });

    const emitted = webhooks.emit('revocation.opened', { revocation: { domain: 'x.test' } });
    // Emit returns the number of *matching active* subs — should not include the inactive one.
    expect(emitted).toBe(0);
    await sleep(150);
    recv.server.close();
    expect(called).toBe(false);

    await request(app).delete(`/api/webhooks/${create.body.data.id}`).set('Authorization', `Bearer ${userToken}`);
  });

  test('Failed delivery records error and schedules retry', async () => {
    const recv = await startReceiver((req, body, res) => {
      res.writeHead(500); res.end('boom');
    });
    const create = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: recv.url, events: ['revocation.opened'] });
    const subId = create.body.data.id;

    webhooks.emit('revocation.opened', { revocation: { domain: 'fail.test' } });
    let waited = 0;
    while (waited < 2000) {
      const d = webhooks.listDeliveries({ subscriptionId: subId, userId });
      if (d.length && d[0].attempts >= 1) break;
      await sleep(50); waited += 50;
    }
    recv.server.close();

    const deliveries = webhooks.listDeliveries({ subscriptionId: subId, userId });
    expect(deliveries[0].last_status_code).toBe(500);
    expect(deliveries[0].status).toBe('pending'); // still has retries left
    expect(deliveries[0].attempts).toBeGreaterThanOrEqual(1);

    await request(app).delete(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${userToken}`);
  });

  test('Forbidden when accessing another user\'s subscription', async () => {
    // Create as user A.
    const create = await request(app)
      .post('/api/webhooks')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ url: 'http://127.0.0.1:1/hook' });
    const subId = create.body.data.id;

    // Register a second user.
    const reg = await request(app).post('/api/auth/register').send({
      email: `wh2-${Date.now()}@example.com`,
      password: 'password123',
      name: 'WH Tester 2',
    });
    const otherToken = reg.body.token;

    const res = await request(app).get(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${otherToken}`);
    expect(res.status).toBe(403);

    await request(app).delete(`/api/webhooks/${subId}`).set('Authorization', `Bearer ${userToken}`);
  });
});
