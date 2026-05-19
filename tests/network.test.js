'use strict';

const request = require('supertest');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';

// Generate an Ed25519 operator key for this test process BEFORE loading the app.
{
  const { privateKey } = crypto.generateKeyPairSync('ed25519');
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  process.env.WAB_OPERATOR_ED25519_PRIV = der.toString('base64');
}
process.env.WAB_SNAPSHOT_DIR = path.join(__dirname, '..', 'data-test', 'snapshots-test');

const { db } = require('../server/models/db');
const app = require('../server/index');
const { canonicalize } = require('../server/services/canonical-json');

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

  // ── v3.15.0 — signed snapshots + daily archive ────────────────────

  test('GET /api/trusted-domains.json includes content_hash, signature, and signed headers', async () => {
    // Reset cache so a fresh signed snapshot is generated.
    require('../server/routes/network').__resetCache();
    const r = await request(app).get('/api/trusted-domains.json');
    expect(r.status).toBe(200);
    expect(r.body.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(r.body.signature).toBeDefined();
    expect(r.body.signature.alg).toBe('ed25519');
    expect(typeof r.body.signature.value).toBe('string');
    expect(r.body.signature.key_url).toBe('/api/operator-key.json');
    expect(r.body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.headers['x-wab-snapshot-hash']).toBe(r.body.content_hash);
    expect(r.headers['x-wab-snapshot-signature']).toBe(r.body.signature.value);
  });

  test('Snapshot signature verifies with the operator public key', async () => {
    require('../server/routes/network').__resetCache();
    const snap = (await request(app).get('/api/trusted-domains.json')).body;
    const keyResp = (await request(app).get('/api/operator-key.json')).body;
    expect(keyResp.alg).toBe('ed25519');
    expect(keyResp.public_key_b64).toMatch(/^[A-Za-z0-9+/=]+$/);

    // Reconstruct payload without content_hash + signature (signing input).
    const payload = {
      schema: snap.schema,
      generated_at: snap.generated_at,
      date: snap.date,
      total: snap.total,
      domains: snap.domains,
    };

    // Build SPKI from the raw 32-byte public key (Ed25519 prefix per RFC 8410).
    const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
    const rawPub = Buffer.from(keyResp.public_key_b64, 'base64');
    const spki = Buffer.concat([SPKI_PREFIX, rawPub]);
    const pubKey = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });

    const ok = crypto.verify(
      null,
      Buffer.from(canonicalize(payload), 'utf8'),
      pubKey,
      Buffer.from(snap.signature.value, 'base64')
    );
    expect(ok).toBe(true);
  });

  test('GET /api/operator-key.json returns Ed25519 public key + JWK', async () => {
    const r = await request(app).get('/api/operator-key.json');
    expect(r.status).toBe(200);
    expect(r.body.schema).toBe('wab-operator-key/v1');
    expect(r.body.alg).toBe('ed25519');
    expect(r.body.public_key_b64).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(r.body.jwk).toMatchObject({ kty: 'OKP', crv: 'Ed25519', alg: 'EdDSA' });
    expect(typeof r.body.jwk.x).toBe('string');
  });

  test('GET /api/trusted-domains/archive.json lists today and is signed', async () => {
    require('../server/routes/network').__resetCache();
    // Touch live endpoint first so today's archive file definitely exists.
    await request(app).get('/api/trusted-domains.json');
    const r = await request(app).get('/api/trusted-domains/archive.json');
    expect(r.status).toBe(200);
    expect(r.body.schema).toBe('wab-trusted-domains-archive/v1');
    expect(Array.isArray(r.body.snapshots)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const found = r.body.snapshots.find(s => s.date === today);
    expect(found).toBeDefined();
    expect(found.url).toBe('/api/trusted-domains/' + today + '.json');
    expect(r.body.signature && r.body.signature.alg).toBe('ed25519');
  });

  test('GET /api/trusted-domains/:date.json serves historical snapshot or 400/404', async () => {
    require('../server/routes/network').__resetCache();
    await request(app).get('/api/trusted-domains.json'); // ensure today written

    const today = new Date().toISOString().slice(0, 10);
    const live = await request(app).get('/api/trusted-domains/' + today + '.json');
    expect(live.status).toBe(200);
    expect(live.body.date).toBe(today);

    // Seed a historical file directly so we exercise the file-serving branch.
    const histDate = '2026-01-01';
    const histFile = path.join(process.env.WAB_SNAPSHOT_DIR, histDate + '.json');
    fs.writeFileSync(histFile, JSON.stringify({ schema: 'wab-trusted-domains/v1', date: histDate, total: 0, domains: [] }), 'utf8');
    const hist = await request(app).get('/api/trusted-domains/' + histDate + '.json');
    expect(hist.status).toBe(200);
    expect(hist.body.date).toBe(histDate);

    const bad = await request(app).get('/api/trusted-domains/not-a-date.json');
    expect(bad.status).toBe(400);

    const missing = await request(app).get('/api/trusted-domains/2020-01-01.json');
    expect(missing.status).toBe(404);
  });
});
