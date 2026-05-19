'use strict';

const request = require('supertest');

process.env.NODE_ENV = 'test';

const { db } = require('../server/models/db');
const app = require('../server/index');

beforeAll(() => {
  // Don't wipe other tests' fixtures — just remove our own rows if leftover.
  db.prepare(`DELETE FROM site_revocations WHERE id = ?`).run('rev-net-1');
  db.prepare(`DELETE FROM sites WHERE id IN ('s-net-1','s-net-2','s-net-3')`).run();
  const insertUser = db.prepare(`INSERT OR IGNORE INTO users (id, email, password, name) VALUES (?, ?, ?, ?)`);
  insertUser.run('user-net-1', 'net-test@example.com', 'x', 'NetTest');
  const insert = db.prepare(`
    INSERT INTO sites (id, user_id, domain, name, description, tier, license_key, api_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insert.run('s-net-1', 'user-net-1', 'shop-net-test.example.com',  'Shop',  '', 'free', 'lk-net-1', 'ak-net-1');
  insert.run('s-net-2', 'user-net-1', 'cafe-net-test.example.com',  'Cafe',  '', 'free', 'lk-net-2', 'ak-net-2');
  insert.run('s-net-3', 'user-net-1', 'evil-net-test.example.com',  'Evil',  '', 'free', 'lk-net-3', 'ak-net-3');

  db.prepare(`
    INSERT INTO site_revocations
      (id, site_id, domain, type, reason_code, reason_text, decided_by, status, decided_at, appeal_deadline)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), date('now','+14 days'))
  `).run('rev-net-1', 's-net-3', 'evil-net-test.example.com', 'revoked', 'fraud',
         'Operator confirmed fraudulent transactions', 'admin:test', 'final');

  // Invalidate snapshot cache so test sees fresh data.
  require('../server/routes/network')._buildSnapshot && (
    require('../server/routes/network').__resetCache && require('../server/routes/network').__resetCache()
  );
});

afterAll(() => {
  db.prepare(`DELETE FROM site_revocations WHERE id = ?`).run('rev-net-1');
  db.prepare(`DELETE FROM sites WHERE id IN ('s-net-1','s-net-2','s-net-3')`).run();
});

describe('network-effect endpoints', () => {
  test('GET /api/trusted-domains.json returns schema + non-revoked domains only', async () => {
    const r = await request(app).get('/api/trusted-domains.json');
    expect(r.status).toBe(200);
    expect(r.body.schema).toBe('wab-trusted-domains/v1');
    expect(r.body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(typeof r.body.total).toBe('number');
    const domains = r.body.domains.map(d => d.domain);
    expect(domains).toContain('shop-net-test.example.com');
    expect(domains).toContain('cafe-net-test.example.com');
    expect(domains).not.toContain('evil-net-test.example.com'); // revoked → excluded
    const shop = r.body.domains.find(d => d.domain === 'shop-net-test.example.com');
    expect(shop.discovery_url).toBe('https://shop-net-test.example.com/.well-known/wab.json');
    expect(shop.badge_url).toMatch(/badge\/shop-net-test\.example\.com\.svg$/);
  });

  test('GET /api/trusted-domains.txt returns newline-separated list, no revoked', async () => {
    const r = await request(app).get('/api/trusted-domains.txt');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/plain/);
    const lines = r.text.trim().split('\n');
    expect(lines).toContain('shop-net-test.example.com');
    expect(lines).toContain('cafe-net-test.example.com');
    expect(lines).not.toContain('evil-net-test.example.com');
  });

  test('GET /api/transparency/feed.json returns JSON Feed 1.1 with our revocation', async () => {
    const r = await request(app).get('/api/transparency/feed.json');
    expect(r.status).toBe(200);
    expect(r.body.version).toBe('https://jsonfeed.org/version/1.1');
    expect(Array.isArray(r.body.items)).toBe(true);
    const found = r.body.items.find(i => i.id === 'rev-net-1');
    expect(found).toBeDefined();
    expect(found.title).toMatch(/REVOKED/);
    expect(found.title).toContain('evil-net-test.example.com');
    expect(found._wab.reason_code).toBe('fraud');
    expect(found.tags).toContain('revoked');
  });

  test('GET /api/transparency/feed.xml returns valid Atom 1.0', async () => {
    const r = await request(app).get('/api/transparency/feed.xml');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toMatch(/atom\+xml/);
    expect(r.text).toMatch(/^<\?xml version="1.0"/);
    expect(r.text).toMatch(/<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
    expect(r.text).toContain('evil-net-test.example.com');
    expect(r.text).toContain('tag:webagentbridge.com,2026:rev-net-1');
    expect(r.text).toMatch(/<\/feed>\s*$/);
  });
});
