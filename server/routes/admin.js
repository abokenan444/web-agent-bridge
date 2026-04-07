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
  getAnalyticsTimeline
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

module.exports = router;
