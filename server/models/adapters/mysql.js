/**
 * MySQL Adapter for WAB
 *
 * Prerequisites: npm install mysql2
 * Set DATABASE_URL=mysql://user:pass@host:3306/wab
 *
 * This adapter implements the same interface as the SQLite adapter
 * so it can be used as a drop-in replacement.
 */

const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const pool = mysql.createPool(process.env.DATABASE_URL);

// Initialize tables
async function initDB() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        company VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        tier ENUM('free','starter','pro','enterprise') DEFAULT 'free',
        license_key VARCHAR(30) UNIQUE NOT NULL,
        api_key VARCHAR(50) UNIQUE,
        config JSON,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_sites_domain (domain),
        INDEX idx_sites_license (license_key)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS analytics (
        id INT AUTO_INCREMENT PRIMARY KEY,
        site_id VARCHAR(36) NOT NULL,
        action_name VARCHAR(255) NOT NULL,
        agent_id VARCHAR(255),
        trigger_type VARCHAR(50),
        success BOOLEAN,
        metadata JSON,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
        INDEX idx_analytics_site (site_id),
        INDEX idx_analytics_created (created_at)
      )
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        site_id VARCHAR(36) NOT NULL,
        tier ENUM('free','starter','pro','enterprise') NOT NULL,
        status ENUM('active','cancelled','expired','trial') DEFAULT 'active',
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
      )
    `);
  } finally {
    conn.release();
  }
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
  await pool.execute(
    'INSERT INTO users (id, email, password, name, company) VALUES (?, ?, ?, ?, ?)',
    [id, email, hashed, name, company || null]
  );
  return { id, email, name, company };
}

async function loginUser({ email, password }) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
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
  const config = JSON.stringify({
    agentPermissions: { readContent: true, click: true, fillForms: false, scroll: true, navigate: false, apiAccess: false, automatedLogin: false, extractData: false },
    features: { advancedAnalytics: false, realTimeUpdates: false },
    restrictions: { allowedSelectors: [], blockedSelectors: ['.private', '[data-private]'], rateLimit: { maxCallsPerMinute: 60 } },
    logging: { enabled: false, level: 'basic' }
  });
  await pool.execute(
    'INSERT INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, userId, domain, name, description || '', tier || 'free', licenseKey, apiKey, config]
  );
  return { id, domain, name, licenseKey, apiKey, tier: tier || 'free' };
}

// ─── Analytics ────────────────────────────────────────────────────────
async function recordAnalytic({ siteId, actionName, agentId, triggerType, success, metadata }) {
  await pool.execute(
    'INSERT INTO analytics (site_id, action_name, agent_id, trigger_type, success, metadata) VALUES (?,?,?,?,?,?)',
    [siteId, actionName, agentId || null, triggerType || null, success ? 1 : 0, JSON.stringify(metadata || {})]
  );
}

// ─── License Verification ─────────────────────────────────────────────
async function verifyLicense(domain, licenseKey) {
  const [rows] = await pool.execute(
    'SELECT * FROM sites WHERE domain = ? AND license_key = ? AND active = TRUE', [domain, licenseKey]
  );
  const site = rows[0];
  if (!site) {
    const [byKey] = await pool.execute('SELECT * FROM sites WHERE license_key = ? AND active = TRUE', [licenseKey]);
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
