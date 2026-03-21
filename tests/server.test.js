const request = require('supertest');
const path = require('path');
const fs = require('fs');

// Set test environment before requiring the app
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-key-for-testing';

// Clean test DB before run
const TEST_DATA_DIR = path.join(__dirname, '..', 'data-test');
if (fs.existsSync(TEST_DATA_DIR)) {
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
}

const app = require('../server/index');

let token;
let siteId;
let licenseKey;

describe('Auth API', () => {
  test('POST /api/auth/register - creates user', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', name: 'Test User' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe('test@example.com');
    token = res.body.token;
  });

  test('POST /api/auth/register - rejects short password', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'short@example.com', password: '123', name: 'Short' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/register - rejects duplicate email', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', password: 'password123', name: 'Dup' });
    expect(res.status).toBe(409);
  });

  test('POST /api/auth/register - rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'x@x.com' });
    expect(res.status).toBe(400);
  });

  test('POST /api/auth/login - valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  test('POST /api/auth/login - wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrongpassword' });
    expect(res.status).toBe(401);
  });

  test('POST /api/auth/login - non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me - returns user profile', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('test@example.com');
  });

  test('GET /api/auth/me - rejects without token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('GET /api/auth/me - rejects invalid token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(403);
  });
});

describe('Sites API', () => {
  test('POST /api/sites - creates site', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'example.com', name: 'Test Site', description: 'A test site' });
    expect(res.status).toBe(201);
    expect(res.body.site.domain).toBe('example.com');
    expect(res.body.site.licenseKey).toMatch(/^WAB-/);
    siteId = res.body.site.id;
    licenseKey = res.body.site.licenseKey;
  });

  test('POST /api/sites - rejects missing fields', async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'example.com' });
    expect(res.status).toBe(400);
  });

  test('POST /api/sites - rejects without auth', async () => {
    const res = await request(app)
      .post('/api/sites')
      .send({ domain: 'example.com', name: 'No Auth' });
    expect(res.status).toBe(401);
  });

  test('GET /api/sites - lists user sites', async () => {
    const res = await request(app)
      .get('/api/sites')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.sites.length).toBeGreaterThan(0);
  });

  test('GET /api/sites/:id - returns site details', async () => {
    const res = await request(app)
      .get(`/api/sites/${siteId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.site.domain).toBe('example.com');
    expect(res.body.site.config).toBeDefined();
  });

  test('GET /api/sites/:id - 404 for wrong id', async () => {
    const res = await request(app)
      .get('/api/sites/nonexistent-id')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  test('PUT /api/sites/:id/config - updates configuration', async () => {
    const config = { agentPermissions: { readContent: true, click: false }, restrictions: {}, logging: {} };
    const res = await request(app)
      .put(`/api/sites/${siteId}/config`)
      .set('Authorization', `Bearer ${token}`)
      .send({ config });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('PUT /api/sites/:id/tier - updates tier', async () => {
    const res = await request(app)
      .put(`/api/sites/${siteId}/tier`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
  });

  test('PUT /api/sites/:id/tier - rejects invalid tier', async () => {
    const res = await request(app)
      .put(`/api/sites/${siteId}/tier`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tier: 'invalid' });
    expect(res.status).toBe(400);
  });

  test('GET /api/sites/:id/snippet - returns install snippet', async () => {
    const res = await request(app)
      .get(`/api/sites/${siteId}/snippet`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.snippet).toContain('AIBridgeConfig');
    expect(res.body.licenseKey).toMatch(/^WAB-/);
  });

  test('GET /api/sites/:id/analytics - returns analytics', async () => {
    const res = await request(app)
      .get(`/api/sites/${siteId}/analytics`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.summary).toBeDefined();
    expect(res.body.timeline).toBeDefined();
  });

  test('DELETE /api/sites/:id - soft deletes site', async () => {
    const res = await request(app)
      .delete(`/api/sites/${siteId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('License API', () => {
  let newLicenseKey;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sites')
      .set('Authorization', `Bearer ${token}`)
      .send({ domain: 'licensed.com', name: 'Licensed Site' });
    newLicenseKey = res.body.site.licenseKey;
  });

  test('POST /api/license/verify - valid license', async () => {
    const res = await request(app)
      .post('/api/license/verify')
      .send({ domain: 'licensed.com', licenseKey: newLicenseKey });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.tier).toBeDefined();
  });

  test('POST /api/license/verify - invalid license key', async () => {
    const res = await request(app)
      .post('/api/license/verify')
      .send({ domain: 'licensed.com', licenseKey: 'WAB-INVALID-KEY-HERE-12345' });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
  });

  test('POST /api/license/verify - domain mismatch', async () => {
    const res = await request(app)
      .post('/api/license/verify')
      .send({ domain: 'wrong-domain.com', licenseKey: newLicenseKey });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.error).toContain('Domain mismatch');
  });

  test('POST /api/license/verify - missing fields', async () => {
    const res = await request(app)
      .post('/api/license/verify')
      .send({ domain: 'licensed.com' });
    expect(res.status).toBe(400);
  });

  test('POST /api/license/track - records analytics', async () => {
    const res = await request(app)
      .post('/api/license/track')
      .send({ licenseKey: newLicenseKey, actionName: 'click_signup', agentId: 'test-agent', success: true });
    expect(res.status).toBe(200);
    expect(res.body.recorded).toBe(true);
  });

  test('POST /api/license/track - missing fields', async () => {
    const res = await request(app)
      .post('/api/license/track')
      .send({ licenseKey: newLicenseKey });
    expect(res.status).toBe(400);
  });
});

describe('Static Pages', () => {
  test('GET / - serves landing page', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Web Agent Bridge');
  });

  test('GET /login - serves login page', async () => {
    const res = await request(app).get('/login');
    expect(res.status).toBe(200);
  });

  test('GET /register - serves register page', async () => {
    const res = await request(app).get('/register');
    expect(res.status).toBe(200);
  });

  test('GET /docs - serves docs page', async () => {
    const res = await request(app).get('/docs');
    expect(res.status).toBe(200);
  });

  test('GET /dashboard - serves dashboard page', async () => {
    const res = await request(app).get('/dashboard');
    expect(res.status).toBe(200);
  });
});

describe('CDN Versioning', () => {
  test('GET /v1/ai-agent-bridge.js - serves versioned script', async () => {
    const res = await request(app).get('/v1/ai-agent-bridge.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Web Agent Bridge');
  });

  test('GET /latest/ai-agent-bridge.js - serves latest script', async () => {
    const res = await request(app).get('/latest/ai-agent-bridge.js');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Web Agent Bridge');
  });
});

afterAll(() => {
  try {
    const { db } = require('../server/models/db');
    db.close();
  } catch (e) { /* ignore */ }
  try {
    if (fs.existsSync(TEST_DATA_DIR)) {
      fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
    }
  } catch (e) { /* ignore */ }
});
