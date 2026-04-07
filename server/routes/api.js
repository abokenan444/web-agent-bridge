const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { apiLimiter } = require('../middleware/rateLimits');
const { validateDomain, validateSiteConfig, sanitizeInput, auditLog } = require('../services/security');
const {
  addSite, findSitesByUser, findSiteById,
  updateSiteConfig, updateSiteTier, deleteSite,
  getAnalyticsBySite, getAnalyticsTimeline
} = require('../models/db');

// Apply general API rate limit to all routes
router.use(apiLimiter);

// ─── Sites ──────────────────────────────────────────────────────────────

router.get('/sites', authenticateToken, (req, res) => {
  const sites = findSitesByUser.all(req.user.id);
  res.json({
    sites: sites.filter(s => s.active).map(s => ({
      ...s,
      config: JSON.parse(s.config || '{}')
    }))
  });
});

router.post('/sites', authenticateToken, (req, res) => {
  const { domain, name, description, tier } = req.body;

  if (!domain || !name) {
    return res.status(400).json({ error: 'Domain and name are required' });
  }

  if (!validateDomain(domain)) {
    return res.status(400).json({ error: 'Invalid domain format. Must be a valid hostname (e.g., example.com)' });
  }

  const cleanName = sanitizeInput(name, 200);
  const cleanDesc = description ? sanitizeInput(description, 500) : undefined;

  try {
    const site = addSite({ userId: req.user.id, domain: domain.toLowerCase().trim(), name: cleanName, description: cleanDesc, tier });
    auditLog({ actorType: 'user', actorId: String(req.user.id), action: 'site_created', resource: 'site', resourceId: String(site.id), ip: req.ip });
    res.status(201).json({ site });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create site' });
  }
});

router.get('/sites/:id', authenticateToken, (req, res) => {
  const site = findSiteById.get(req.params.id);
  if (!site || site.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Site not found' });
  }
  res.json({ site: { ...site, config: JSON.parse(site.config || '{}') } });
});

router.put('/sites/:id/config', authenticateToken, (req, res) => {
  const { config } = req.body;
  if (!config) return res.status(400).json({ error: 'Config is required' });

  const validation = validateSiteConfig(config);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    const r = updateSiteConfig.run(JSON.stringify(validation.config), req.params.id, req.user.id);
    if (r.changes === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    auditLog({ actorType: 'user', actorId: String(req.user.id), action: 'site_config_updated', resource: 'site', resourceId: req.params.id, ip: req.ip });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update config' });
  }
});

router.put('/sites/:id/tier', authenticateToken, (req, res) => {
  const { tier } = req.body;
  if (!['free', 'starter', 'pro', 'enterprise'].includes(tier)) {
    return res.status(400).json({ error: 'Invalid tier' });
  }

  try {
    const r = updateSiteTier.run(tier, req.params.id, req.user.id);
    if (r.changes === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    res.json({ success: true, tier });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

router.delete('/sites/:id', authenticateToken, (req, res) => {
  try {
    const r = deleteSite.run(req.params.id, req.user.id);
    if (r.changes === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete site' });
  }
});

// ─── Analytics ──────────────────────────────────────────────────────────

router.get('/sites/:id/analytics', authenticateToken, (req, res) => {
  const site = findSiteById.get(req.params.id);
  if (!site || site.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Site not found' });
  }

  const days = parseInt(req.query.days) || 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();

  const summary = getAnalyticsBySite.all(site.id, since);
  const timeline = getAnalyticsTimeline.all(site.id, since);

  res.json({ summary, timeline, period: `${days} days` });
});

// ─── Script Generation ──────────────────────────────────────────────────

router.get('/sites/:id/snippet', authenticateToken, (req, res) => {
  const site = findSiteById.get(req.params.id);
  if (!site || site.user_id !== req.user.id) {
    return res.status(404).json({ error: 'Site not found' });
  }

  const config = JSON.parse(site.config || '{}');
  // Public site id + token endpoint only — long-lived license key stays in dashboard, not in embed
  const snippet = `<!-- Web Agent Bridge (Secure Mode) -->
<script>
window.AIBridgeConfig = {
  siteId: "${site.id}",
  configEndpoint: "/api/license/token",
  agentPermissions: ${JSON.stringify(config.agentPermissions || {}, null, 4)},
  restrictions: ${JSON.stringify(config.restrictions || {}, null, 4)},
  logging: ${JSON.stringify(config.logging || {}, null, 4)}
};
</script>
<script src="/script/ai-agent-bridge.js"></script>`;

  res.json({ snippet, siteId: site.id });
});

module.exports = router;
