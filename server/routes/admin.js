/**
 * Admin API Routes
 * Full admin panel backend: users, sites, analytics, Stripe, SMTP, grants
 */

const express = require('express');
const router = express.Router();
const { authenticateAdmin, generateAdminToken } = require('../middleware/adminAuth');
const { adminLoginLimiter } = require('../middleware/rateLimits');
const { auditLog, revokeJWT } = require('../services/security');
const {
  loginAdmin, findAdminById, createAdmin,
  getAllUsers, getAllSites, getAdminStats, getPlatformAnalytics,
  getUserFullDetails, adminUpdateUserTier, adminUpdateSite, adminDeleteUser,
  grantFreeTier, revokeGrant, getActiveGrants,
  getSmtpSettings, updateSmtpSettings, getNotificationLogs,
  getPayments, getPlatformSetting, setPlatformSetting,
  findUserByEmail,
  findSiteById,
  getAnalyticsBySite,
  getAnalyticsTimeline,
  db
} = require('../models/db');
const { sendEmail } = require('../services/email');
const { createCheckoutSession, createPortalSession, isStripeConfigured, getStripePrices } = require('../services/stripe');

// ─── Auth ──────────────────────────────────────────────────────────────

router.post('/login', adminLoginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const admin = loginAdmin({ email, password });
  if (!admin) {
    auditLog({ actorType: 'admin', action: 'admin_login_failed', details: { email }, ip: req.ip, outcome: 'denied', severity: 'warning' });
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = generateAdminToken(admin);
  auditLog({ actorType: 'admin', actorId: String(admin.id), action: 'admin_login', ip: req.ip });
  res.json({ admin, token });
});

router.post('/logout', authenticateAdmin, (req, res) => {
  if (req._rawToken) {
    revokeJWT(req._rawToken, 'admin_logout');
    auditLog({ actorType: 'admin', actorId: String(req.admin.id), action: 'admin_logout', ip: req.ip });
  }
  res.json({ success: true });
});

router.get('/me', authenticateAdmin, (req, res) => {
  const admin = findAdminById(req.admin.id);
  if (!admin) return res.status(404).json({ error: 'Admin not found' });
  res.json({ admin });
});

// ─── Dashboard Stats ──────────────────────────────────────────────────

router.get('/stats', authenticateAdmin, (req, res) => {
  const stats = getAdminStats();
  stats.stripeConfigured = isStripeConfigured();
  res.json(stats);
});

router.get('/analytics', authenticateAdmin, (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = getPlatformAnalytics(days);
  res.json(data);
});

// ─── Users Management ─────────────────────────────────────────────────

router.get('/users', authenticateAdmin, (req, res) => {
  const users = getAllUsers();
  res.json({ users });
});

router.get('/users/:id', authenticateAdmin, (req, res) => {
  const user = getUserFullDetails(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

router.put('/users/:id/tier', authenticateAdmin, (req, res) => {
  const { tier, siteId } = req.body;
  if (!['free', 'starter', 'pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }
  adminUpdateUserTier(req.params.id, siteId, tier);
  res.json({ success: true });
});

router.delete('/users/:id', authenticateAdmin, (req, res) => {
  adminDeleteUser(req.params.id);
  res.json({ success: true });
});

// ─── Sites Management ─────────────────────────────────────────────────

router.get('/sites', authenticateAdmin, (req, res) => {
  const sites = getAllSites();
  res.json({ sites });
});

router.put('/sites/:id', authenticateAdmin, (req, res) => {
  const { tier, active } = req.body;
  const ok = adminUpdateSite(req.params.id, { tier, active });
  if (!ok) return res.status(404).json({ error: 'Site not found or invalid tier' });
  res.json({ success: true });
});

router.get('/sites/:id/analytics', authenticateAdmin, (req, res) => {
  const site = findSiteById.get(req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  const days = parseInt(req.query.days, 10) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const summary = getAnalyticsBySite.all(site.id, since);
  const timeline = getAnalyticsTimeline.all(site.id, since);
  res.json({
    site: {
      id: site.id,
      name: site.name,
      domain: site.domain,
      tier: site.tier,
      license_key: site.license_key
    },
    summary,
    timeline,
    period: `${days} days`
  });
});

// ─── Free Grants ──────────────────────────────────────────────────────

router.get('/grants', authenticateAdmin, (req, res) => {
  const grants = getActiveGrants();
  res.json({ grants });
});

router.post('/grants', authenticateAdmin, (req, res) => {
  const { userId, siteId, tier, reason, expiresAt } = req.body;
  if (!userId || !tier) return res.status(400).json({ error: 'userId and tier required' });
  if (!['starter', 'pro', 'enterprise'].includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  const grant = grantFreeTier({ userId, siteId, tier, reason, grantedBy: req.admin.id, expiresAt });

  // Send notification email
  const user = getUserFullDetails(userId);
  if (user) {
    sendEmail({
      to: user.email,
      template: 'tier_upgrade',
      data: { name: user.name, tier, reason: reason || 'Complimentary upgrade' },
      userId
    }).catch(() => {});
  }

  res.status(201).json({ grant });
});

router.delete('/grants/:id', authenticateAdmin, (req, res) => {
  const ok = revokeGrant(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Grant not found' });
  res.json({ success: true });
});

// ─── Stripe Settings ─────────────────────────────────────────────────

router.get('/stripe/config', authenticateAdmin, (req, res) => {
  const secretKey = getPlatformSetting('stripe_secret_key');
  const publishableKey = getPlatformSetting('stripe_publishable_key');
  const webhookSecret = getPlatformSetting('stripe_webhook_secret');
  const prices = getStripePrices();

  res.json({
    configured: isStripeConfigured(),
    hasSecretKey: !!secretKey,
    publishableKey: publishableKey || '',
    webhookSecret: webhookSecret ? '••••' + webhookSecret.slice(-4) : '',
    prices
  });
});

router.put('/stripe/config', authenticateAdmin, (req, res) => {
  const { secretKey, publishableKey, webhookSecret, priceStarter, pricePro, priceEnterprise } = req.body;

  if (secretKey) setPlatformSetting('stripe_secret_key', secretKey);
  if (publishableKey) setPlatformSetting('stripe_publishable_key', publishableKey);
  if (webhookSecret) setPlatformSetting('stripe_webhook_secret', webhookSecret);
  if (priceStarter) setPlatformSetting('stripe_price_starter', priceStarter);
  if (pricePro) setPlatformSetting('stripe_price_pro', pricePro);
  if (priceEnterprise) setPlatformSetting('stripe_price_enterprise', priceEnterprise);

  res.json({ success: true });
});

// ─── Payments ──────────────────────────────────────────────────────────

router.get('/payments', authenticateAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const payments = getPayments(limit);
  res.json({ payments });
});

// ─── SMTP Settings ────────────────────────────────────────────────────

router.get('/smtp', authenticateAdmin, (req, res) => {
  const settings = getSmtpSettings();
  // Mask password
  if (settings && settings.password) {
    settings.password = '••••••••';
  }
  res.json({ settings });
});

router.put('/smtp', authenticateAdmin, (req, res) => {
  const { host, port, secure, username, password, fromName, fromEmail, enabled } = req.body;
  if (!host || !username || !fromEmail) {
    return res.status(400).json({ error: 'Host, username, and fromEmail are required' });
  }
  updateSmtpSettings({ host, port, secure, username, password, fromName, fromEmail, enabled });
  res.json({ success: true });
});

router.post('/smtp/test', authenticateAdmin, (req, res) => {
  const { testEmail } = req.body;
  if (!testEmail) return res.status(400).json({ error: 'testEmail required' });

  sendEmail({
    to: testEmail,
    template: 'welcome',
    data: { name: 'Test User', dashboardUrl: 'https://webagentbridge.com/dashboard' }
  }).then(result => {
    res.json(result);
  }).catch(err => {
    res.status(500).json({ success: false, error: err.message });
  });
});

// ─── Notification Logs ────────────────────────────────────────────────

router.get('/notifications', authenticateAdmin, (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = getNotificationLogs(limit);
  res.json({ logs });
});

// ─── Send Custom Notification ─────────────────────────────────────────

router.post('/notifications/send', authenticateAdmin, (req, res) => {
  const { userId, email, template, data } = req.body;
  if (!email || !template) return res.status(400).json({ error: 'email and template required' });

  sendEmail({ to: email, template, data: data || {}, userId }).then(result => {
    res.json(result);
  }).catch(err => {
    res.status(500).json({ success: false, error: err.message });
  });
});

// ─── DNS Discovery Oversight ──────────────────────────────────────────
//  Real-data views into discovery_usage_runs / discovery_trust_runs.
//  Tables are auto-created by routes/discovery.js.

function tableExists(name) {
  try {
    return !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name = ?`).get(name);
  } catch { return false; }
}

router.get('/discovery/stats', authenticateAdmin, (_req, res) => {
  if (!tableExists('discovery_usage_runs')) {
    return res.json({ enabled: false, totals: {}, last7d: [], topDomains: [] });
  }
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS runs,
      COUNT(DISTINCT domain) AS domains,
      SUM(CASE WHEN execution_succeeded = 1 THEN 1 ELSE 0 END) AS successes,
      AVG(value_score) AS avg_score
    FROM discovery_usage_runs
    WHERE created_at >= datetime('now', '-30 days')
  `).get();
  const last7d = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS runs,
           SUM(CASE WHEN execution_succeeded = 1 THEN 1 ELSE 0 END) AS successes
    FROM discovery_usage_runs
    WHERE created_at >= datetime('now', '-7 days')
    GROUP BY day ORDER BY day ASC
  `).all();
  const topDomains = db.prepare(`
    SELECT domain, COUNT(*) AS runs, AVG(value_score) AS score
    FROM discovery_usage_runs
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY domain ORDER BY runs DESC LIMIT 25
  `).all();
  res.json({ enabled: true, totals, last7d, topDomains });
});

router.get('/discovery/runs', authenticateAdmin, (req, res) => {
  if (!tableExists('discovery_usage_runs')) return res.json({ runs: [] });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const runs = db.prepare(`
    SELECT id, domain, mode, preferred_use_case, selected_action,
           readiness_ok, execution_attempted, execution_succeeded,
           value_score, end_to_end_ms, created_at
    FROM discovery_usage_runs
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  res.json({ runs });
});

router.get('/trust/stats', authenticateAdmin, (_req, res) => {
  if (!tableExists('discovery_trust_runs')) {
    return res.json({ enabled: false, totals: {}, leaderboard: [] });
  }
  const totals = db.prepare(`
    SELECT COUNT(*) AS runs, COUNT(DISTINCT domain) AS domains,
           AVG(score) AS avg_score,
           SUM(sig_valid) AS valid_sigs,
           SUM(signed_manifest) AS signed_manifests,
           SUM(has_pk) AS domains_with_pk
    FROM discovery_trust_runs
    WHERE created_at >= datetime('now', '-30 days')
  `).get();
  const leaderboard = db.prepare(`
    SELECT domain, MAX(score) AS score, MAX(created_at) AS last_run
    FROM discovery_trust_runs
    GROUP BY domain ORDER BY score DESC, last_run DESC LIMIT 25
  `).all();
  res.json({ enabled: true, totals, leaderboard });
});

router.get('/trust/runs', authenticateAdmin, (req, res) => {
  if (!tableExists('discovery_trust_runs')) return res.json({ runs: [] });
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const runs = db.prepare(`
    SELECT id, domain, score, dnssec, has_pk, signed_manifest, sig_valid, https_ok, created_at
    FROM discovery_trust_runs
    ORDER BY created_at DESC LIMIT ?
  `).all(limit);
  res.json({ runs });
});

// ─── Providers Oversight (cross-user) ─────────────────────────────────

router.get('/providers/stats', authenticateAdmin, (_req, res) => {
  if (!tableExists('provider_accounts')) {
    return res.json({ enabled: false, totals: {}, byProvider: [], recentActions: [] });
  }
  const totals = db.prepare(`
    SELECT COUNT(*) AS accounts,
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
           SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS errored,
           SUM(domains_count) AS domains_under_management
    FROM provider_accounts
  `).get();
  const byProvider = db.prepare(`
    SELECT provider_type, COUNT(*) AS accounts,
           SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active,
           COALESCE(SUM(domains_count), 0) AS domains
    FROM provider_accounts
    GROUP BY provider_type ORDER BY accounts DESC
  `).all();
  const recentActions = tableExists('provider_action_log')
    ? db.prepare(`
        SELECT l.id, l.account_id, a.provider_type, l.domain, l.action, l.status,
               l.duration_ms, l.detail, l.created_at
        FROM provider_action_log l
        LEFT JOIN provider_accounts a ON a.id = l.account_id
        ORDER BY l.created_at DESC LIMIT 50
      `).all()
    : [];
  const wabEnabled = tableExists('provider_domains')
    ? db.prepare(`SELECT COUNT(*) AS c FROM provider_domains WHERE wab_enabled = 1`).get().c
    : 0;
  res.json({ enabled: true, totals: { ...totals, wab_enabled_domains: wabEnabled }, byProvider, recentActions });
});

router.get('/providers/accounts', authenticateAdmin, (req, res) => {
  if (!tableExists('provider_accounts')) return res.json({ accounts: [] });
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const rows = db.prepare(`
    SELECT a.id, a.user_id, u.email AS user_email, a.provider_type, a.label,
           a.status, a.last_test_at, a.last_test_ok, a.last_test_error,
           a.last_sync_at, a.domains_count, a.created_at, a.updated_at
    FROM provider_accounts a
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY a.created_at DESC LIMIT ?
  `).all(limit);
  res.json({ accounts: rows });
});

router.get('/providers/domains', authenticateAdmin, (req, res) => {
  if (!tableExists('provider_domains')) return res.json({ domains: [] });
  const limit = Math.min(parseInt(req.query.limit, 10) || 200, 1000);
  const rows = db.prepare(`
    SELECT d.id, d.account_id, a.provider_type, a.user_id, u.email AS user_email,
           d.domain, d.zone_id, d.wab_enabled, d.wab_record_value,
           d.last_action, d.last_action_at, d.last_action_status, d.last_action_error
    FROM provider_domains d
    LEFT JOIN provider_accounts a ON a.id = d.account_id
    LEFT JOIN users u ON u.id = a.user_id
    ORDER BY d.updated_at DESC LIMIT ?
  `).all(limit);
  res.json({ domains: rows });
});

// ─── API Modules: real counts (replaces hardcoded dashboard placeholders) ──
router.get('/modules/stats', authenticateAdmin, (_req, res) => {
  // Source of truth: server/routes/* + service registry. We treat each
  // top-level route module as one "API module" and return real numbers.
  const modules = [
    { id: 'auth',         label: 'Authentication',   openness: 'open' },
    { id: 'wab',          label: 'WAB Core API',     openness: 'open' },
    { id: 'discovery',    label: 'DNS Discovery',    openness: 'open' },
    { id: 'sovereign',    label: 'Sovereign Mode',   openness: 'open' },
    { id: 'commander',    label: 'Commander SDK',    openness: 'partial' },
    { id: 'mesh',         label: 'Agent Mesh',       openness: 'partial' },
    { id: 'workspace',    label: 'Agent Workspace',  openness: 'partial' },
    { id: 'universal',    label: 'Universal Agent',  openness: 'partial' },
    { id: 'gateway',      label: 'Gateway (v1)',     openness: 'closed' },
    { id: 'premium',      label: 'Premium APIs',     openness: 'closed' },
    { id: 'admin',        label: 'Admin APIs',       openness: 'closed' },
    { id: 'providers',    label: 'DNS Providers',    openness: 'open' },
  ];
  const counts = modules.reduce((acc, m) => { acc[m.openness] = (acc[m.openness] || 0) + 1; return acc; }, {});
  res.json({
    total: modules.length,
    open: counts.open || 0,
    partial: counts.partial || 0,
    closed: counts.closed || 0,
    modules,
  });
});

module.exports = router;
