/**
 * ATP — Agent Transaction Primitive
 *
 * Covers the keystone primitive in one file: intent lifecycle, idempotent
 * transactions, signed receipts (positive + tampered = negative),
 * compensation, quota gating, public verification.
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

const TEST_DB_FILE = path.join(__dirname, '..', 'data-test', 'wab-test.db');

let request, app, transactions, dbModule, JWT;

beforeAll(async () => {
  if (fs.existsSync(TEST_DB_FILE)) {
    try { fs.rmSync(TEST_DB_FILE); } catch { /* ignore */ }
  }
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(path.sep + 'server' + path.sep) || k.includes(path.sep + 'data-test' + path.sep)) {
      delete require.cache[k];
    }
  });

  request      = require('supertest');
  dbModule     = require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
  transactions = require('../server/services/transactions');

  // Seed a user directly so we can sign tokens for them.
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, password, created_at)
    VALUES ('user_atp_1', 'atp@test.local', 'ATP Tester', 'x', datetime('now'))
  `).run();
  // Give the test user an enterprise-tier site so the daily quota gate doesn't
  // trip on the dozen intents the service tests create up-front.
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config, active)
    VALUES ('site_atp_1', 'user_atp_1', 'atp.test.local', 'ATP Test Site', '', 'enterprise', 'lic_atp_test', 'key_atp_test', '{}', 1)
  `).run();

  // Bring up the express app for HTTP tests.
  app = require('../server/index').app || require('../server/index');

  const { signUserToken } = require('../server/config/secrets');
  JWT = signUserToken({ id: 'user_atp_1', email: 'atp@test.local', name: 'ATP' }, { expiresIn: '1h' });
});

describe('ATP service — intent lifecycle', () => {
  test('createIntent validates scope', () => {
    expect(() => transactions.createIntent({
      userId: 'user_atp_1', purpose: 'p', scope: { actions: ['nope'] },
    })).toThrow(/scope\.actions contains invalid action/);
  });

  test('createIntent → authorize → revoke happy path', () => {
    const i = transactions.createIntent({
      userId: 'user_atp_1',
      purpose: 'Book hotel under €120',
      scope: { actions: ['search', 'book'], domains: ['hotel.example'] },
      spendCapCents: 12000,
      maxExecutions: 1,
      ttlSeconds: 600,
    });
    expect(i.status).toBe('draft');
    expect(i.nonce).toMatch(/^[a-f0-9]{32}$/);

    const auth = transactions.authorizeIntent(i.id, { userId: 'user_atp_1' });
    expect(auth.status).toBe('authorized');
    expect(auth.authorized_at).toBeTruthy();

    const rev = transactions.revokeIntent(i.id, { userId: 'user_atp_1', reason: 'changed mind' });
    expect(rev.status).toBe('revoked');
  });

  test('authorize burns the nonce (single-use)', () => {
    const i = transactions.createIntent({
      userId: 'user_atp_1', purpose: 'Test nonce', scope: { actions: ['read'] }, ttlSeconds: 600,
    });
    // Manually copy the nonce into another intent and try to authorize.
    transactions.authorizeIntent(i.id, { userId: 'user_atp_1' });

    // Direct DB insert with same nonce → must fail at UNIQUE.
    expect(() => {
      dbModule.db.prepare(`
        INSERT INTO atp_intents (id, user_id, purpose, scope, spend_cap_cents, expires_at, nonce)
        VALUES ('atp_int_dupe1', 'user_atp_1', 'dup', '{"actions":["read"]}', 0, datetime('now','+1 hour'), ?)
      `).run(i.nonce);
    }).toThrow();
  });

  test('cannot authorize non-draft intent', () => {
    const i = transactions.createIntent({
      userId: 'user_atp_1', purpose: 'p', scope: { actions: ['read'] }, ttlSeconds: 600,
    });
    transactions.authorizeIntent(i.id, { userId: 'user_atp_1' });
    expect(() => transactions.authorizeIntent(i.id, { userId: 'user_atp_1' })).toThrow(/invalid_state|cannot authorize/);
  });

  test('not your intent → forbidden', () => {
    const i = transactions.createIntent({
      userId: 'user_atp_1', purpose: 'p', scope: { actions: ['read'] }, ttlSeconds: 600,
    });
    expect(() => transactions.authorizeIntent(i.id, { userId: 'somebody_else' })).toThrow(/not your intent/);
  });
});

describe('ATP service — transactions and idempotency', () => {
  function freshAuthorized(opts = {}) {
    const i = transactions.createIntent({
      userId: 'user_atp_1',
      purpose: 'Test tx',
      scope: { actions: ['checkout', 'pay'] },
      spendCapCents: 10000,
      maxExecutions: 2,
      ttlSeconds: 600,
      ...opts,
    });
    transactions.authorizeIntent(i.id, { userId: 'user_atp_1' });
    return i;
  }

  test('beginTransaction is idempotent on (intent, key)', () => {
    const i = freshAuthorized();
    const a = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'k1', amountCents: 500 });
    const b = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'k1', amountCents: 500 });
    expect(a.id).toBe(b.id);
    expect(b._idempotent_replay).toBe(true);
  });

  test('spend cap enforced at begin', () => {
    const i = freshAuthorized({ spendCapCents: 1000 });
    expect(() => transactions.beginTransaction({
      intentId: i.id, idempotencyKey: 'over', amountCents: 1500,
    })).toThrow(/spend cap/);
  });

  test('full state-machine: pending → executing → executed → settled', () => {
    const i = freshAuthorized();
    const tx = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'sm', amountCents: 100 });
    expect(tx.status).toBe('pending');

    const t1 = transactions.transitionTransaction(tx.id, 'executing');
    expect(t1.status).toBe('executing');
    const t2 = transactions.transitionTransaction(tx.id, 'executed', { summary: 'done' });
    expect(t2.status).toBe('executed');
    const t3 = transactions.transitionTransaction(tx.id, 'settled');
    expect(t3.status).toBe('settled');

    const after = transactions.getIntent(i.id);
    expect(after.spent_cents).toBe(100);
    expect(after.used_executions).toBe(1);
  });

  test('illegal transition rejected', () => {
    const i = freshAuthorized();
    const tx = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'bad', amountCents: 10 });
    expect(() => transactions.transitionTransaction(tx.id, 'settled')).toThrow(/illegal transition/);
  });

  test('compensation refunds the intent spend counter', () => {
    const i = freshAuthorized({ spendCapCents: 1000 });
    const tx = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'comp', amountCents: 400 });
    transactions.transitionTransaction(tx.id, 'executing');
    transactions.transitionTransaction(tx.id, 'executed');
    transactions.transitionTransaction(tx.id, 'settled');
    expect(transactions.getIntent(i.id).spent_cents).toBe(400);

    transactions.compensateTransaction(tx.id, { reason: 'user_cancelled' });
    expect(transactions.getIntent(i.id).spent_cents).toBe(0);
  });

  test('intent auto-consumes when execution cap hit', () => {
    const i = freshAuthorized({ maxExecutions: 1, spendCapCents: 10000 });
    const tx = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'once', amountCents: 200 });
    transactions.transitionTransaction(tx.id, 'executing');
    transactions.transitionTransaction(tx.id, 'executed');
    transactions.transitionTransaction(tx.id, 'settled');
    expect(transactions.getIntent(i.id).status).toBe('consumed');
  });
});

describe('ATP service — signed receipts', () => {
  function settled() {
    const i = transactions.createIntent({
      userId: 'user_atp_1', purpose: 'rcpt test',
      scope: { actions: ['checkout'] },
      spendCapCents: 5000, ttlSeconds: 600,
    });
    transactions.authorizeIntent(i.id, { userId: 'user_atp_1' });
    const tx = transactions.beginTransaction({ intentId: i.id, idempotencyKey: 'rkey', amountCents: 250, summary: 'paid 2.50' });
    transactions.appendStep(tx.id, { action: 'checkout.start', evidence: { http: 200 } });
    transactions.transitionTransaction(tx.id, 'executing');
    transactions.appendStep(tx.id, { action: 'checkout.confirm', evidence: { order_id: 'ORD-1' } });
    transactions.transitionTransaction(tx.id, 'executed');
    transactions.transitionTransaction(tx.id, 'settled');
    return tx;
  }

  test('issueReceipt produces a verifiable signature', () => {
    const tx = settled();
    const r = transactions.issueReceipt(tx.id);
    expect(r.algorithm).toBe('ed25519');
    expect(r.signature).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(r.body.transaction.id).toBe(tx.id);

    const v = transactions.verifyReceipt(r.id);
    expect(v.ok).toBe(true);
  });

  test('issueReceipt is idempotent per transaction', () => {
    const tx = settled();
    const r1 = transactions.issueReceipt(tx.id);
    const r2 = transactions.issueReceipt(tx.id);
    expect(r1.id).toBe(r2.id);
  });

  test('tampered receipt fails verification', () => {
    const tx = settled();
    const r = transactions.issueReceipt(tx.id);
    const tampered = JSON.parse(JSON.stringify(r.body));
    tampered.transaction.amount_cents = 999999;
    const v = transactions.verifyReceipt(tampered);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/signature/);
  });
});

describe('ATP HTTP — /api/atp', () => {
  test('POST /intents requires auth', async () => {
    const r = await request(app).post('/api/atp/intents').send({});
    expect(r.status).toBe(401);
  });

  test('end-to-end: create intent → authorize → begin tx → step → settle → receipt → verify', async () => {
    // create
    const c = await request(app)
      .post('/api/atp/intents')
      .set('Authorization', `Bearer ${JWT}`)
      .send({
        purpose: 'Buy a book ≤ €30',
        scope: { actions: ['search', 'add_to_cart', 'checkout'], domains: ['shop.example'] },
        spend_cap_cents: 3000,
        max_executions: 1,
        ttl_seconds: 600,
      });
    expect(c.status).toBe(200);
    expect(c.body.ok).toBe(true);
    const intentId = c.body.data.id;

    // authorize
    const a = await request(app)
      .post(`/api/atp/intents/${intentId}/authorize`)
      .set('Authorization', `Bearer ${JWT}`)
      .send();
    expect(a.status).toBe(200);
    expect(a.body.data.status).toBe('authorized');

    // begin tx
    const b = await request(app)
      .post('/api/atp/transactions')
      .set('Authorization', `Bearer ${JWT}`)
      .set('Idempotency-Key', 'order-42')
      .send({ intent_id: intentId, amount_cents: 1500, summary: 'one book' });
    expect(b.status).toBe(200);
    const txId = b.body.data.id;

    // idempotent retry
    const b2 = await request(app)
      .post('/api/atp/transactions')
      .set('Authorization', `Bearer ${JWT}`)
      .set('Idempotency-Key', 'order-42')
      .send({ intent_id: intentId, amount_cents: 1500 });
    expect(b2.body.data.id).toBe(txId);

    // append step
    const s = await request(app)
      .post(`/api/atp/transactions/${txId}/steps`)
      .set('Authorization', `Bearer ${JWT}`)
      .send({ action: 'checkout.confirm', evidence: { order_id: 'X1' } });
    expect(s.status).toBe(200);

    // transitions
    for (const to of ['executing','executed','settled']) {
      const t = await request(app)
        .post(`/api/atp/transactions/${txId}/transition`)
        .set('Authorization', `Bearer ${JWT}`)
        .send({ to });
      expect(t.status).toBe(200);
    }

    // receipt
    const r = await request(app)
      .post(`/api/atp/transactions/${txId}/receipt`)
      .set('Authorization', `Bearer ${JWT}`)
      .send();
    expect(r.status).toBe(200);
    const receiptId = r.body.data.id;

    // public fetch — no auth
    const pub = await request(app).get(`/api/atp/receipts/${receiptId}`);
    expect(pub.status).toBe(200);
    expect(pub.body.data.body.signature).toBeTruthy();

    // public verify by id
    const v = await request(app)
      .post('/api/atp/receipts/verify')
      .send({ id: receiptId });
    expect(v.status).toBe(200);
    expect(v.body.ok).toBe(true);
    expect(v.body.verification.ok).toBe(true);

    // public verify of tampered receipt
    const tampered = JSON.parse(JSON.stringify(pub.body.data.body));
    tampered.transaction.amount_cents = 1;
    const vBad = await request(app)
      .post('/api/atp/receipts/verify')
      .send({ receipt: tampered });
    expect(vBad.status).toBe(200);
    expect(vBad.body.ok).toBe(false);
  });

  test('health endpoint open', async () => {
    const r = await request(app).get('/api/atp/health');
    expect(r.status).toBe(200);
    expect(r.body.service).toBe('atp');
  });
});
