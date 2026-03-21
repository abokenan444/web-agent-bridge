const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const isTest = process.env.NODE_ENV === 'test';
const DATA_DIR = isTest
  ? path.join(__dirname, '..', '..', 'data-test')
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = isTest ? 'wab-test.db' : 'wab.db';
const db = new Database(path.join(DATA_DIR, dbFile));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    company TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    tier TEXT DEFAULT 'free' CHECK(tier IN ('free','starter','pro','enterprise')),
    license_key TEXT UNIQUE NOT NULL,
    api_key TEXT UNIQUE,
    config TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS analytics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    action_name TEXT NOT NULL,
    agent_id TEXT,
    trigger_type TEXT,
    success INTEGER,
    metadata TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    tier TEXT NOT NULL CHECK(tier IN ('free','starter','pro','enterprise')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','cancelled','expired','trial')),
    started_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_sites_domain ON sites(domain);
  CREATE INDEX IF NOT EXISTS idx_sites_license ON sites(license_key);
  CREATE INDEX IF NOT EXISTS idx_analytics_site ON analytics(site_id);
  CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics(created_at);
`);

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
const createUser = db.prepare(`
  INSERT INTO users (id, email, password, name, company) VALUES (?, ?, ?, ?, ?)
`);

const findUserByEmail = db.prepare(`SELECT * FROM users WHERE email = ?`);
const findUserById = db.prepare(`SELECT id, email, name, company, created_at FROM users WHERE id = ?`);

function registerUser({ email, password, name, company }) {
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  createUser.run(id, email, hashed, name, company || null);
  return { id, email, name, company };
}

function loginUser({ email, password }) {
  const user = findUserByEmail.get(email);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password)) return null;
  return { id: user.id, email: user.email, name: user.name, company: user.company };
}

// ─── Site Operations ──────────────────────────────────────────────────
const createSite = db.prepare(`
  INSERT INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const findSitesByUser = db.prepare(`SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC`);
const findSiteById = db.prepare(`SELECT * FROM sites WHERE id = ?`);
const findSiteByLicense = db.prepare(`SELECT * FROM sites WHERE license_key = ? AND active = 1`);
const findSiteByDomainAndLicense = db.prepare(`SELECT * FROM sites WHERE domain = ? AND license_key = ? AND active = 1`);
const updateSiteConfig = db.prepare(`UPDATE sites SET config = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`);
const updateSiteTier = db.prepare(`UPDATE sites SET tier = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`);
const deleteSite = db.prepare(`UPDATE sites SET active = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?`);

function addSite({ userId, domain, name, description, tier }) {
  const id = uuidv4();
  const licenseKey = generateLicenseKey();
  const apiKey = generateApiKey();
  const config = JSON.stringify({
    agentPermissions: { readContent: true, click: true, fillForms: false, scroll: true, navigate: false, apiAccess: false, automatedLogin: false, extractData: false },
    features: { advancedAnalytics: false, realTimeUpdates: false },
    restrictions: { allowedSelectors: [], blockedSelectors: ['.private', '[data-private]'], rateLimit: { maxCallsPerMinute: 60 } },
    logging: { enabled: false, level: 'basic' }
  });
  createSite.run(id, userId, domain, name, description || '', tier || 'free', licenseKey, apiKey, config);
  return { id, domain, name, licenseKey, apiKey, tier: tier || 'free' };
}

// ─── Analytics ────────────────────────────────────────────────────────
const insertAnalytic = db.prepare(`
  INSERT INTO analytics (site_id, action_name, agent_id, trigger_type, success, metadata)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const getAnalyticsBySite = db.prepare(`
  SELECT action_name, trigger_type, COUNT(*) as count, SUM(success) as successes
  FROM analytics WHERE site_id = ? AND created_at >= ? GROUP BY action_name, trigger_type
  ORDER BY count DESC
`);

const getAnalyticsTimeline = db.prepare(`
  SELECT date(created_at) as day, COUNT(*) as count
  FROM analytics WHERE site_id = ? AND created_at >= ?
  GROUP BY day ORDER BY day
`);

function recordAnalytic({ siteId, actionName, agentId, triggerType, success, metadata }) {
  insertAnalytic.run(siteId, actionName, agentId || null, triggerType || null, success ? 1 : 0, JSON.stringify(metadata || {}));
}

// ─── License Verification ─────────────────────────────────────────────
function verifyLicense(domain, licenseKey) {
  const site = findSiteByDomainAndLicense.get(domain, licenseKey);
  if (!site) {
    const siteByKey = findSiteByLicense.get(licenseKey);
    if (siteByKey) return { valid: false, error: 'Domain mismatch', tier: 'free' };
    return { valid: false, error: 'Invalid license key', tier: 'free' };
  }

  const tierPermissions = {
    free: { apiAccess: false, automatedLogin: false, extractData: false, advancedAnalytics: false },
    starter: { apiAccess: false, automatedLogin: true, extractData: false, advancedAnalytics: true },
    pro: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true },
    enterprise: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true }
  };

  return {
    valid: true,
    tier: site.tier,
    domain: site.domain,
    allowedPermissions: tierPermissions[site.tier] || tierPermissions.free
  };
}

module.exports = {
  db,
  registerUser,
  loginUser,
  findUserById,
  addSite,
  findSitesByUser,
  findSiteById,
  findSiteByLicense,
  updateSiteConfig,
  updateSiteTier,
  deleteSite,
  recordAnalytic,
  getAnalyticsBySite,
  getAnalyticsTimeline,
  verifyLicense,
  generateLicenseKey,
  generateApiKey
};
