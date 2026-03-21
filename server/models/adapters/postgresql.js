/**
 * PostgreSQL Adapter for WAB
 *
 * Prerequisites: npm install pg
 * Set DATABASE_URL=postgres://user:pass@host:5432/wab
 *
 * This adapter implements the same interface as the SQLite adapter
 * so it can be used as a drop-in replacement.
 */

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Initialize tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      company TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      tier TEXT DEFAULT 'free' CHECK(tier IN ('free','starter','pro','enterprise')),
      license_key TEXT UNIQUE NOT NULL,
      api_key TEXT UNIQUE,
      config JSONB DEFAULT '{}',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id SERIAL PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      action_name TEXT NOT NULL,
      agent_id TEXT,
      trigger_type TEXT,
      success BOOLEAN,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      tier TEXT NOT NULL CHECK(tier IN ('free','starter','pro','enterprise')),
      status TEXT DEFAULT 'active' CHECK(status IN ('active','cancelled','expired','trial')),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );

    CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
    CREATE INDEX IF NOT EXISTS idx_sites_license ON sites(license_key);
    CREATE INDEX IF NOT EXISTS idx_analytics_site ON analytics(site_id);
    CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics(created_at);
  `);
}

initDB().catch(console.error);

function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segments = [];
  for (let s = 0; s < 4; s++) {
    let seg = '';
    for (let i = 0; i < 5; i++) seg += chars[Math.floor(Math.random() * chars.length)];
    segments.push(seg);
  }
  return `WAB-${segments.join('-')}`;
}

function generateApiKey() {
  return `wab_${uuidv4().replace(/-/g, '')}`;
}

// ─── User Operations ──────────────────────────────────────────────────
async function registerUser({ email, password, name, company }) {
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  await pool.query(
    'INSERT INTO users (id, email, password, name, company) VALUES ($1, $2, $3, $4, $5)',
    [id, email, hashed, name, company || null]
  );
  return { id, email, name, company };
}

async function loginUser({ email, password }) {
  const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  const user = rows[0];
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password)) return null;
  return { id: user.id, email: user.email, name: user.name, company: user.company };
}

// ─── Site Operations ──────────────────────────────────────────────────
async function addSite({ userId, domain, name, description, tier }) {
  const id = uuidv4();
  const licenseKey = generateLicenseKey();
  const apiKey = generateApiKey();
  const config = {
    agentPermissions: { readContent: true, click: true, fillForms: false, scroll: true, navigate: false, apiAccess: false, automatedLogin: false, extractData: false },
    features: { advancedAnalytics: false, realTimeUpdates: false },
    restrictions: { allowedSelectors: [], blockedSelectors: ['.private', '[data-private]'], rateLimit: { maxCallsPerMinute: 60 } },
    logging: { enabled: false, level: 'basic' }
  };
  await pool.query(
    'INSERT INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [id, userId, domain, name, description || '', tier || 'free', licenseKey, apiKey, JSON.stringify(config)]
  );
  return { id, domain, name, licenseKey, apiKey, tier: tier || 'free' };
}

// ─── Analytics ────────────────────────────────────────────────────────
async function recordAnalytic({ siteId, actionName, agentId, triggerType, success, metadata }) {
  await pool.query(
    'INSERT INTO analytics (site_id, action_name, agent_id, trigger_type, success, metadata) VALUES ($1,$2,$3,$4,$5,$6)',
    [siteId, actionName, agentId || null, triggerType || null, success, JSON.stringify(metadata || {})]
  );
}

// ─── License Verification ─────────────────────────────────────────────
async function verifyLicense(domain, licenseKey) {
  const { rows } = await pool.query(
    'SELECT * FROM sites WHERE domain = $1 AND license_key = $2 AND active = TRUE', [domain, licenseKey]
  );
  const site = rows[0];
  if (!site) {
    const { rows: byKey } = await pool.query('SELECT * FROM sites WHERE license_key = $1 AND active = TRUE', [licenseKey]);
    if (byKey[0]) return { valid: false, error: 'Domain mismatch', tier: 'free' };
    return { valid: false, error: 'Invalid license key', tier: 'free' };
  }

  const tierPermissions = {
    free: { apiAccess: false, automatedLogin: false, extractData: false, advancedAnalytics: false },
    starter: { apiAccess: false, automatedLogin: true, extractData: false, advancedAnalytics: true },
    pro: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true },
    enterprise: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true }
  };

  const config = typeof site.config === 'string' ? JSON.parse(site.config) : site.config;
  return {
    valid: true,
    tier: site.tier,
    permissions: { ...config.agentPermissions, ...tierPermissions[site.tier] },
    restrictions: config.restrictions,
    features: config.features,
    siteId: site.id
  };
}

module.exports = {
  registerUser,
  loginUser,
  addSite,
  recordAnalytic,
  verifyLicense,
  pool
};
