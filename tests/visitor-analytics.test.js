const request = require('supertest');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';
process.env.JWT_SECRET_ADMIN = 'test-admin-secret-for-testing';

const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
try {
  if (fs.existsSync(TEST_DATA_DIR)) fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
} catch (e) {
  if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
}

const app = require('../server/index');
const { runMigrations } = require('../server/utils/migrate');
runMigrations();
const { db } = require('../server/models/db');
const visitor = require('../server/services/visitor-tracker');

describe('Visitor analytics', () => {
  beforeAll(() => {
    db.prepare('DELETE FROM page_visits').run();
  });

  test('GET / is recorded as a page_visit row', async () => {
    await request(app).get('/').set('User-Agent', 'Mozilla/5.0 (TestRunner)').set('Referer', 'https://example.com/x');
    // Give the res.on('finish') hook a tick to flush.
    await new Promise(r => setImmediate(r));
    const row = db.prepare(`SELECT * FROM page_visits ORDER BY id DESC LIMIT 1`).get();
    expect(row).toBeTruthy();
    expect(row.path).toBe('/');
    expect(row.device).toBe('desktop');
    expect(row.is_bot).toBe(0);
    expect(row.referrer).toMatch(/example.com/);
  });

  test('Bot UA is classified as bot', async () => {
    await request(app).get('/about').set('User-Agent', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    await new Promise(r => setImmediate(r));
    const row = db.prepare(`SELECT * FROM page_visits WHERE path = '/about' ORDER BY id DESC LIMIT 1`).get();
    expect(row).toBeTruthy();
    expect(row.is_bot).toBe(1);
    expect(row.device).toBe('bot');
  });

  test('Asset/API requests are NOT recorded', async () => {
    await request(app).get('/css/styles.css');
    await request(app).get('/api/auth/check-session');
    await new Promise(r => setImmediate(r));
    const css = db.prepare(`SELECT COUNT(*) AS c FROM page_visits WHERE path = '/css/styles.css'`).get();
    const api = db.prepare(`SELECT COUNT(*) AS c FROM page_visits WHERE path LIKE '/api/%'`).get();
    expect(css.c).toBe(0);
    expect(api.c).toBe(0);
  });

  test('getVisitorAnalytics returns aggregates from real DB rows', () => {
    const r = visitor.getVisitorAnalytics(30);
    expect(r.totals.pageviews).toBeGreaterThanOrEqual(2);
    expect(Array.isArray(r.timeline)).toBe(true);
    expect(Array.isArray(r.topPaths)).toBe(true);
    expect(Array.isArray(r.devices)).toBe(true);
  });

  test('getQuickCounts returns numeric counters', () => {
    const q = visitor.getQuickCounts();
    expect(typeof q.pageviews_24h).toBe('number');
    expect(typeof q.visitors_24h).toBe('number');
    expect(typeof q.pageviews_30d).toBe('number');
    expect(q.pageviews_total).toBeGreaterThanOrEqual(2);
  });
});

describe('Admin visitor endpoints', () => {
  let adminToken;

  beforeAll(async () => {
    // Bootstrap an admin directly via DB helper for tests.
    const { createAdmin } = require('../server/models/db');
    try { createAdmin({ email: 'visit-admin@test.local', password: 'AdminPass!23', name: 'Visit Admin', role: 'superadmin' }); } catch {}
    const r = await request(app).post('/api/admin/login').send({ email: 'visit-admin@test.local', password: 'AdminPass!23' });
    adminToken = r.body && r.body.token;
    expect(adminToken).toBeTruthy();
  });

  test('GET /api/admin/analytics/visits returns totals and timeline', async () => {
    const r = await request(app).get('/api/admin/analytics/visits?days=30').set('Authorization', 'Bearer ' + adminToken);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.totals).toBeTruthy();
    expect(Array.isArray(r.body.timeline)).toBe(true);
    expect(Array.isArray(r.body.topPaths)).toBe(true);
  });

  test('GET /api/admin/analytics/visits/recent returns visit rows', async () => {
    const r = await request(app).get('/api/admin/analytics/visits/recent?limit=10').set('Authorization', 'Bearer ' + adminToken);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.visits)).toBe(true);
  });

  test('GET /api/admin/stats now includes visitor counters', async () => {
    const r = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer ' + adminToken);
    expect(r.status).toBe(200);
    expect(typeof r.body.pageviews_24h).toBe('number');
    expect(typeof r.body.visitors_24h).toBe('number');
    // Normalized keys for the dashboard.
    expect(r.body.users).toBe(r.body.totalUsers);
    expect(r.body.sites).toBe(r.body.totalSites);
  });

  test('Anonymous visits (no auth) are tracked with user_id = NULL', async () => {
    await request(app).get('/pricing'); // anonymous
    await new Promise(r => setImmediate(r));
    const row = db.prepare(`SELECT * FROM page_visits WHERE path='/pricing' ORDER BY id DESC LIMIT 1`).get();
    expect(row).toBeTruthy();
    expect(row.user_id).toBeNull();
  });
});
