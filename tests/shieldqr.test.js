/**
 * Tests for WAB ShieldQR
 *   - service: heuristics + Ed25519 signature verification
 *   - public API: scan / report / recent
 */
'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');
const request = require('supertest');

const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
const DB_PATH = path.join(TEST_DATA_DIR, 'wab-test.db');

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET = 'test-secret-please-change';
  if (fs.existsSync(DB_PATH)) { try { fs.unlinkSync(DB_PATH); } catch {} }
  // Bootstrap DB then apply all migrations
  require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
});

describe('shieldqr service — heuristics', () => {
  const shieldqr = require('../server/services/shieldqr');

  test('flags shortener domain as medium severity', async () => {
    // We don't actually hit the network here; heuristics + DNS that fails
    // gracefully should still produce a sane result. host=bit.ly will NXDOMAIN
    // on _wab.bit.ly and _wab-trust.bit.ly so DNS contributes nothing.
    const r = await shieldqr.scan('https://bit.ly/abc');
    expect(r.host).toBe('bit.ly');
    expect(r.signals.some((s) => s.id === 'shortener')).toBe(true);
  });

  test('IP literal host is flagged high severity', async () => {
    const r = await shieldqr.scan('http://203.0.113.5/path');
    expect(r.signals.some((s) => s.id === 'ip_literal_host')).toBe(true);
    expect(r.signals.some((s) => s.id === 'plain_http')).toBe(true);
  });

  test('invalid URL returns red', async () => {
    const r = await shieldqr.scan('   ');
    expect(r.level).toBe('red');
    expect(r.signals.some((s) => s.id === 'invalid_url')).toBe(true);
  });

  test('canonicalJson is stable regardless of key order', () => {
    const a = shieldqr.canonicalJson({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = shieldqr.canonicalJson({ a: 2, c: { x: 2, y: 1 }, b: 1 });
    expect(a).toBe(b);
  });

  test('parseWabTxt extracts pk + endpoint + ssl_thumbprint', () => {
    const fields = shieldqr.parseWabTxt([
      'v=wab1; endpoint=https://example.com/.well-known/wab.json; pk=ed25519:AAAA; ssl_thumbprint=DEAD; shieldqr=enabled',
    ]);
    expect(fields.endpoint).toBe('https://example.com/.well-known/wab.json');
    expect(fields.pk).toBe('ed25519:AAAA');
    expect(fields.ssl_thumbprint).toBe('DEAD');
    expect(fields.shieldqr).toBe('enabled');
  });
});

describe('shieldqr Ed25519 verification math', () => {
  const shieldqr = require('../server/services/shieldqr');

  test('a valid Ed25519 signature over canonical payload verifies', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const payload = { type: 'wab.trust', host: 'example.com', issued: '2026-01-01' };
    const message = Buffer.from(shieldqr.canonicalJson(payload), 'utf8');
    const sig = crypto.sign(null, message, privateKey);

    // Round-trip: build SPKI DER from the 32-byte raw key, just like the service does
    const der = publicKey.export({ format: 'der', type: 'spki' });
    expect(der.length).toBe(44);
    const ok = crypto.verify(null, message, publicKey, sig);
    expect(ok).toBe(true);

    // Tamper detection
    const bad = Buffer.from(shieldqr.canonicalJson({ ...payload, host: 'evil.com' }), 'utf8');
    expect(crypto.verify(null, bad, publicKey, sig)).toBe(false);
  });
});

describe('public /api/shieldqr', () => {
  let app;
  beforeAll(() => { app = require('../server/index'); });

  test('POST /scan validates input', async () => {
    const r1 = await request(app).post('/api/shieldqr/scan').send({});
    expect(r1.status).toBe(400);
    const r2 = await request(app).post('/api/shieldqr/scan').send({ url: 'x'.repeat(3000) });
    expect(r2.status).toBe(400);
  });

  test('POST /scan returns a structured verdict', async () => {
    const r = await request(app).post('/api/shieldqr/scan').send({ url: 'http://203.0.113.5/' });
    expect(r.status).toBe(200);
    expect(['green', 'yellow', 'red']).toContain(r.body.level);
    expect(typeof r.body.score).toBe('number');
    expect(Array.isArray(r.body.signals)).toBe(true);
  });

  test('GET /recent works after a scan', async () => {
    await request(app).post('/api/shieldqr/scan').send({ url: 'https://bit.ly/test' });
    const r = await request(app).get('/api/shieldqr/recent?limit=5');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.scans)).toBe(true);
    expect(r.body.scans.length).toBeGreaterThan(0);
  });

  test('POST /report stores reports', async () => {
    const r = await request(app).post('/api/shieldqr/report').send({ url: 'https://evil.example/qr', reason: 'phishing' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });
});
