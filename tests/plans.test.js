/**
 * Plans management — service + admin API + public API.
 * One DB across all describes (Windows can't unlink an open SQLite file).
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');
const request = require('supertest');

const TEST_DB_FILE = path.join(__dirname, '..', 'data-test', 'wab-test.db');

beforeAll(() => {
  if (fs.existsSync(TEST_DB_FILE)) {
    try { fs.rmSync(TEST_DB_FILE); } catch { /* in-use; ok */ }
  }
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(path.sep + 'server' + path.sep) || k.includes(path.sep + 'data-test' + path.sep)) {
      delete require.cache[k];
    }
  });
  require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
});

describe('plans service (DB-backed)', () => {
  let plans;
  beforeAll(() => { plans = require('../server/services/plans'); });

  test('seed migration creates four canonical plans', () => {
    const all = plans.listPlans({ includeArchived: true });
    const ids = all.map(p => p.id);
    expect(ids).toEqual(expect.arrayContaining(['business','enterprise','free','pro']));
    const free = plans.getPlan('free');
    expect(free.price_cents).toBe(0);
    expect(free.currency).toBe('EUR');
    expect(free.features.protocol).toBe(true);
    expect(free.features.workspace).toBeFalsy();

    const pro = plans.getPlan('pro');
    expect(pro.price_cents).toBe(1000);
    expect(pro.features.workspace).toBe(true);
    expect(pro.features.hostedRuntime).toBeFalsy();

    const business = plans.getPlan('business');
    expect(business.price_cents).toBe(2900);
    expect(business.features.hostedRuntime).toBe(true);
    expect(business.features.swarmExecution).toBe(true);
    expect(business.features.enterpriseSecurity).toBeFalsy();

    const ent = plans.getPlan('enterprise');
    expect(ent.billing_period).toBe('custom');
    expect(ent.cta_type).toBe('contact');
    expect(ent.features.enterpriseSecurity).toBe(true);
    expect(ent.features.sla).toBe(true);
  });

  test('listPlans publicOnly filters out archived plans', () => {
    plans.updatePlan('free', { is_archived: true });
    const pub = plans.listPlans({ publicOnly: true }).map(p => p.id);
    expect(pub).not.toContain('free');
    plans.updatePlan('free', { is_archived: false });
  });

  test('createPlan + setPlanFeature + updatePlan round-trip', () => {
    if (!plans.getPlan('team')) {
      plans.createPlan({ id: 'team', name: 'Team', price_cents: 1500, currency: 'EUR', features: {} });
    }
    const after = plans.setPlanFeature('team', 'workspace', true);
    expect(after.features.workspace).toBe(true);
    const off = plans.setPlanFeature('team', 'workspace', false);
    expect(off.features.workspace).toBeFalsy();
    const renamed = plans.updatePlan('team', { name: 'Team+', highlight: true });
    expect(renamed.name).toBe('Team+');
    expect(renamed.highlight).toBe(true);
  });

  test('createPlan rejects bad slug and duplicate id', () => {
    expect(() => plans.createPlan({ id: 'BAD ID', name: 'x' })).toThrow();
    expect(() => plans.createPlan({ id: 'free', name: 'x' })).toThrow(/already exists/);
  });

  test('feature catalog exposes open-source flag and categories', () => {
    const catalog = plans.listFeatures();
    expect(catalog.length).toBeGreaterThan(20);
    const proto = catalog.find(f => f.key === 'protocol');
    expect(proto.is_open_source).toBe(true);
    const ent = catalog.find(f => f.key === 'enterpriseSecurity');
    expect(ent.is_open_source).toBe(false);
    expect(ent.category).toBe('enterprise');
  });
});

describe('public /api/plans', () => {
  let app;
  beforeAll(() => { app = require('../server/index'); });

  test('GET /api/plans returns only public, non-archived plans', async () => {
    const r = await request(app).get('/api/plans').expect(200);
    expect(Array.isArray(r.body.plans)).toBe(true);
    expect(r.body.plans.length).toBeGreaterThanOrEqual(4);
    expect(r.body.features.length).toBeGreaterThan(20);
    for (const p of r.body.plans) {
      expect(p.is_archived).toBe(false);
      expect(p.is_public).toBe(true);
    }
  });

  test('GET /api/plans/:id returns a single plan; 404 for unknown', async () => {
    const r = await request(app).get('/api/plans/free').expect(200);
    expect(r.body.plan.id).toBe('free');
    await request(app).get('/api/plans/no-such-plan-xyz').expect(404);
  });
});

describe('admin /api/admin/plans (auth-gated)', () => {
  let app;
  let adminToken;
  beforeAll(() => {
    app = require('../server/index');
    const { createAdmin, loginAdmin } = require('../server/models/db');
    const { generateAdminToken } = require('../server/middleware/adminAuth');
    const email = 'plans-test-' + Date.now() + '@wab.com';
    const password = 'TestPass-123';
    let admin;
    try {
      admin = createAdmin({ email, password, name: 'Plans Test', role: 'superadmin' });
    } catch (e) {
      admin = loginAdmin({ email, password });
    }
    adminToken = generateAdminToken(admin);
  });

  test('GET requires admin auth', async () => {
    await request(app).get('/api/admin/plans').expect(401);
    const r = await request(app).get('/api/admin/plans').set('Authorization', 'Bearer ' + adminToken).expect(200);
    expect(r.body.plans.length).toBeGreaterThanOrEqual(4);
  });

  test('PUT /:id/features/:feature toggles', async () => {
    const r1 = await request(app)
      .put('/api/admin/plans/free/features/workspace')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ included: true })
      .expect(200);
    expect(r1.body.plan.features.workspace).toBe(true);

    const r2 = await request(app)
      .put('/api/admin/plans/free/features/workspace')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ included: false })
      .expect(200);
    expect(r2.body.plan.features.workspace).toBeFalsy();
  });

  test('POST creates a plan; PUT updates it; DELETE archives it', async () => {
    const slug = 'team-int-' + Date.now();
    const created = await request(app)
      .post('/api/admin/plans')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ id: slug, name: 'Team Int', price_cents: 500, currency: 'EUR', features: { protocol: true } })
      .expect(201);
    expect(created.body.plan.id).toBe(slug);

    const updated = await request(app)
      .put('/api/admin/plans/' + slug)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ name: 'Team Pro', highlight: true })
      .expect(200);
    expect(updated.body.plan.name).toBe('Team Pro');
    expect(updated.body.plan.highlight).toBe(true);

    await request(app)
      .delete('/api/admin/plans/' + slug)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    const after = await request(app).get('/api/plans').expect(200);
    expect(after.body.plans.find(p => p.id === slug)).toBeUndefined();
  });
});
