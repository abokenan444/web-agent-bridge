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

  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'admin' CHECK(role IN ('admin','superadmin')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS free_grants (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT,
    granted_tier TEXT NOT NULL CHECK(granted_tier IN ('starter','pro','enterprise')),
    reason TEXT,
    granted_by TEXT NOT NULL,
    granted_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (granted_by) REFERENCES admins(id)
  );

  CREATE TABLE IF NOT EXISTS stripe_customers (
    id TEXT PRIMARY KEY,
    user_id TEXT UNIQUE NOT NULL,
    stripe_customer_id TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS stripe_subscriptions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    stripe_subscription_id TEXT UNIQUE,
    stripe_price_id TEXT,
    tier TEXT NOT NULL CHECK(tier IN ('starter','pro','enterprise')),
    status TEXT DEFAULT 'active' CHECK(status IN ('active','cancelled','past_due','trialing','incomplete')),
    current_period_start TEXT,
    current_period_end TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    stripe_payment_id TEXT UNIQUE,
    amount INTEGER NOT NULL,
    currency TEXT DEFAULT 'usd',
    status TEXT DEFAULT 'succeeded',
    description TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    email_to TEXT NOT NULL,
    template TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'sent' CHECK(status IN ('sent','failed','queued')),
    error_message TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS smtp_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    host TEXT,
    port INTEGER DEFAULT 587,
    secure INTEGER DEFAULT 0,
    username TEXT,
    password TEXT,
    from_name TEXT DEFAULT 'Web Agent Bridge',
    from_email TEXT,
    enabled INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  INSERT OR IGNORE INTO smtp_settings (id) VALUES (1);

  CREATE TABLE IF NOT EXISTS platform_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_free_grants_user ON free_grants(user_id);
  CREATE INDEX IF NOT EXISTS idx_stripe_subs_user ON stripe_subscriptions(user_id);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications_log(user_id);
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

  // Check for free grant override
  const grant = db.prepare(`SELECT * FROM free_grants WHERE user_id = ? AND (site_id = ? OR site_id IS NULL) AND active = 1 AND (expires_at IS NULL OR expires_at > datetime('now')) ORDER BY granted_at DESC LIMIT 1`).get(site.user_id, site.id);
  const effectiveTier = grant ? grant.granted_tier : site.tier;

  const tierPermissions = {
    free: { apiAccess: false, automatedLogin: false, extractData: false, advancedAnalytics: false },
    starter: { apiAccess: false, automatedLogin: true, extractData: false, advancedAnalytics: true },
    pro: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true },
    enterprise: { apiAccess: true, automatedLogin: true, extractData: true, advancedAnalytics: true }
  };

  return {
    valid: true,
    tier: effectiveTier,
    domain: site.domain,
    allowedPermissions: tierPermissions[effectiveTier] || tierPermissions.free
  };
}

// ─── Admin Operations ─────────────────────────────────────────────────
function createAdmin({ email, password, name, role }) {
  const id = uuidv4();
  const hashed = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO admins (id, email, password, name, role) VALUES (?, ?, ?, ?, ?)`).run(id, email, hashed, name, role || 'admin');
  return { id, email, name, role: role || 'admin' };
}

function loginAdmin({ email, password }) {
  const admin = db.prepare(`SELECT * FROM admins WHERE email = ?`).get(email);
  if (!admin) return null;
  if (!bcrypt.compareSync(password, admin.password)) return null;
  return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
}

function findAdminById(id) {
  return db.prepare(`SELECT id, email, name, role, created_at FROM admins WHERE id = ?`).get(id);
}

function ensureDefaultAdmin() {
  const count = db.prepare(`SELECT COUNT(*) as c FROM admins`).get().c;
  if (count === 0) {
    createAdmin({ email: 'admin@webagentbridge.com', password: 'Admin@WAB2024!', name: 'Super Admin', role: 'superadmin' });
  }
}
ensureDefaultAdmin();

// ─── Admin Queries ────────────────────────────────────────────────────
function getAllUsers() {
  return db.prepare(`SELECT id, email, name, company, created_at FROM users ORDER BY created_at DESC`).all();
}

function getAllSites() {
  return db.prepare(`SELECT s.*, u.email as user_email, u.name as user_name FROM sites s LEFT JOIN users u ON s.user_id = u.id ORDER BY s.created_at DESC`).all();
}

function getAdminStats() {
  const totalUsers = db.prepare(`SELECT COUNT(*) as c FROM users`).get().c;
  const totalSites = db.prepare(`SELECT COUNT(*) as c FROM sites WHERE active = 1`).get().c;
  const totalAnalytics = db.prepare(`SELECT COUNT(*) as c FROM analytics`).get().c;
  const todayAnalytics = db.prepare(`SELECT COUNT(*) as c FROM analytics WHERE created_at >= date('now')`).get().c;
  const tierBreakdown = db.prepare(`SELECT tier, COUNT(*) as count FROM sites WHERE active = 1 GROUP BY tier`).all();
  const recentUsers = db.prepare(`SELECT id, email, name, company, created_at FROM users ORDER BY created_at DESC LIMIT 10`).all();
  const totalRevenue = db.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'succeeded'`).get().total;
  const activeGrants = db.prepare(`SELECT COUNT(*) as c FROM free_grants WHERE active = 1 AND (expires_at IS NULL OR expires_at > datetime('now'))`).get().c;
  const monthlySignups = db.prepare(`SELECT COUNT(*) as c FROM users WHERE created_at >= date('now', '-30 days')`).get().c;
  return { totalUsers, totalSites, totalAnalytics, todayAnalytics, tierBreakdown, recentUsers, totalRevenue, activeGrants, monthlySignups };
}

function getPlatformAnalytics(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const timeline = db.prepare(`SELECT date(created_at) as day, COUNT(*) as count FROM analytics WHERE created_at >= ? GROUP BY day ORDER BY day`).all(since);
  const topActions = db.prepare(`SELECT action_name, COUNT(*) as count FROM analytics WHERE created_at >= ? GROUP BY action_name ORDER BY count DESC LIMIT 20`).all(since);
  const signups = db.prepare(`SELECT date(created_at) as day, COUNT(*) as count FROM users WHERE created_at >= ? GROUP BY day ORDER BY day`).all(since);
  return { timeline, topActions, signups };
}

// ─── Free Grant Operations ────────────────────────────────────────────
function grantFreeTier({ userId, siteId, tier, reason, grantedBy, expiresAt }) {
  const id = uuidv4();
  db.prepare(`INSERT INTO free_grants (id, user_id, site_id, granted_tier, reason, granted_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, siteId || null, tier, reason || null, grantedBy, expiresAt || null);
  if (siteId) {
    db.prepare(`UPDATE sites SET tier = ?, updated_at = datetime('now') WHERE id = ?`).run(tier, siteId);
  } else {
    db.prepare(`UPDATE sites SET tier = ?, updated_at = datetime('now') WHERE user_id = ? AND active = 1`).run(tier, userId);
  }
  return { id, userId, siteId, tier, reason };
}

function revokeGrant(grantId) {
  const grant = db.prepare(`SELECT * FROM free_grants WHERE id = ?`).get(grantId);
  if (!grant) return false;
  db.prepare(`UPDATE free_grants SET active = 0 WHERE id = ?`).run(grantId);
  if (grant.site_id) {
    db.prepare(`UPDATE sites SET tier = 'free', updated_at = datetime('now') WHERE id = ?`).run(grant.site_id);
  } else {
    db.prepare(`UPDATE sites SET tier = 'free', updated_at = datetime('now') WHERE user_id = ? AND active = 1`).run(grant.user_id);
  }
  return true;
}

function getActiveGrants() {
  return db.prepare(`SELECT g.*, u.email as user_email, u.name as user_name, a.name as admin_name FROM free_grants g LEFT JOIN users u ON g.user_id = u.id LEFT JOIN admins a ON g.granted_by = a.id WHERE g.active = 1 ORDER BY g.granted_at DESC`).all();
}

// ─── Stripe DB Operations ─────────────────────────────────────────────
function saveStripeCustomer(userId, stripeCustomerId) {
  const id = uuidv4();
  db.prepare(`INSERT OR REPLACE INTO stripe_customers (id, user_id, stripe_customer_id) VALUES (?, ?, ?)`).run(id, userId, stripeCustomerId);
}

function getStripeCustomer(userId) {
  return db.prepare(`SELECT * FROM stripe_customers WHERE user_id = ?`).get(userId);
}

function saveStripeSubscription({ userId, siteId, stripeSubId, stripePriceId, tier, status, periodStart, periodEnd }) {
  const id = uuidv4();
  db.prepare(`INSERT INTO stripe_subscriptions (id, user_id, site_id, stripe_subscription_id, stripe_price_id, tier, status, current_period_start, current_period_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, siteId, stripeSubId, stripePriceId, tier, status || 'active', periodStart, periodEnd);
}

function updateStripeSubscription(stripeSubId, { status, periodStart, periodEnd, tier }) {
  const updates = [];
  const params = [];
  if (status) { updates.push('status = ?'); params.push(status); }
  if (periodStart) { updates.push('current_period_start = ?'); params.push(periodStart); }
  if (periodEnd) { updates.push('current_period_end = ?'); params.push(periodEnd); }
  if (tier) { updates.push('tier = ?'); params.push(tier); }
  if (updates.length === 0) return;
  params.push(stripeSubId);
  db.prepare(`UPDATE stripe_subscriptions SET ${updates.join(', ')} WHERE stripe_subscription_id = ?`).run(...params);
}

function getStripeSubscriptionBySubId(stripeSubId) {
  return db.prepare(`SELECT * FROM stripe_subscriptions WHERE stripe_subscription_id = ?`).get(stripeSubId);
}

function savePayment({ userId, stripePaymentId, amount, currency, status, description }) {
  const id = uuidv4();
  db.prepare(`INSERT INTO payments (id, user_id, stripe_payment_id, amount, currency, status, description) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, userId, stripePaymentId, amount, currency || 'usd', status || 'succeeded', description || null);
}

function getPayments(limit) {
  return db.prepare(`SELECT p.*, u.email as user_email, u.name as user_name FROM payments p LEFT JOIN users u ON p.user_id = u.id ORDER BY p.created_at DESC LIMIT ?`).all(limit || 50);
}

// ─── SMTP Settings ────────────────────────────────────────────────────
function getSmtpSettings() {
  return db.prepare(`SELECT * FROM smtp_settings WHERE id = 1`).get();
}

function updateSmtpSettings({ host, port, secure, username, password, fromName, fromEmail, enabled }) {
  db.prepare(`UPDATE smtp_settings SET host = ?, port = ?, secure = ?, username = ?, password = ?, from_name = ?, from_email = ?, enabled = ?, updated_at = datetime('now') WHERE id = 1`).run(host, port || 587, secure ? 1 : 0, username, password, fromName || 'Web Agent Bridge', fromEmail, enabled ? 1 : 0);
}

function logNotification({ userId, emailTo, template, subject, status, errorMessage }) {
  db.prepare(`INSERT INTO notifications_log (user_id, email_to, template, subject, status, error_message) VALUES (?, ?, ?, ?, ?, ?)`).run(userId || null, emailTo, template, subject, status || 'sent', errorMessage || null);
}

function getNotificationLogs(limit) {
  return db.prepare(`SELECT * FROM notifications_log ORDER BY created_at DESC LIMIT ?`).all(limit || 100);
}

// ─── Admin User Management ───────────────────────────────────────────
function adminUpdateUserTier(userId, siteId, tier) {
  if (siteId) {
    db.prepare(`UPDATE sites SET tier = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(tier, siteId, userId);
  } else {
    db.prepare(`UPDATE sites SET tier = ?, updated_at = datetime('now') WHERE user_id = ? AND active = 1`).run(tier, userId);
  }
}

function adminDeleteUser(userId) {
  db.prepare(`UPDATE sites SET active = 0 WHERE user_id = ?`).run(userId);
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
}

function getUserFullDetails(userId) {
  const user = db.prepare(`SELECT id, email, name, company, created_at FROM users WHERE id = ?`).get(userId);
  if (!user) return null;
  const sites = db.prepare(`SELECT * FROM sites WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  const grants = db.prepare(`SELECT * FROM free_grants WHERE user_id = ? AND active = 1`).all(userId);
  const payments = db.prepare(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC`).all(userId);
  const stripeCustomer = db.prepare(`SELECT * FROM stripe_customers WHERE user_id = ?`).get(userId);
  return { ...user, sites, grants, payments, stripeCustomer };
}

// ─── Platform Settings ───────────────────────────────────────────────
function getPlatformSetting(key) {
  const row = db.prepare(`SELECT value FROM platform_settings WHERE key = ?`).get(key);
  return row ? row.value : null;
}

function setPlatformSetting(key, value) {
  db.prepare(`INSERT OR REPLACE INTO platform_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))`).run(key, value);
}

module.exports = {
  db,
  registerUser,
  loginUser,
  findUserById,
  findUserByEmail,
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
  generateApiKey,
  // Admin
  createAdmin,
  loginAdmin,
  findAdminById,
  getAllUsers,
  getAllSites,
  getAdminStats,
  getPlatformAnalytics,
  adminUpdateUserTier,
  adminDeleteUser,
  getUserFullDetails,
  // Free Grants
  grantFreeTier,
  revokeGrant,
  getActiveGrants,
  // Stripe
  saveStripeCustomer,
  getStripeCustomer,
  saveStripeSubscription,
  updateStripeSubscription,
  getStripeSubscriptionBySubId,
  savePayment,
  getPayments,
  // SMTP
  getSmtpSettings,
  updateSmtpSettings,
  logNotification,
  getNotificationLogs,
  // Platform
  getPlatformSetting,
  setPlatformSetting
};
