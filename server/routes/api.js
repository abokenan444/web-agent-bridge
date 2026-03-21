const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  addSite, findSitesByUser, findSiteById,
  updateSiteConfig, updateSiteTier, deleteSite,
  getAnalyticsBySite, getAnalyticsTimeline
} = require('../models/db');

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

  try {
    const site = addSite({ userId: req.user.id, domain, name, description, tier });
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

  try {
    updateSiteConfig.run(JSON.stringify(config), req.params.id, req.user.id);
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
    updateSiteTier.run(tier, req.params.id, req.user.id);
    res.json({ success: true, tier });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update tier' });
  }
});

router.delete('/sites/:id', authenticateToken, (req, res) => {
  try {
    deleteSite.run(req.params.id, req.user.id);
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
  // Secure snippet: server-side token exchange, license key never exposed in HTML
  const snippet = `<!-- Web Agent Bridge (Secure Mode) -->
<script>
window.AIBridgeConfig = {
  // Server-side license validation — key is NOT exposed in page source
  configEndpoint: "/api/license/token",
  _licenseKey: "${site.license_key}",
  agentPermissions: ${JSON.stringify(config.agentPermissions || {}, null, 4)},
  restrictions: ${JSON.stringify(config.restrictions || {}, null, 4)},
  logging: ${JSON.stringify(config.logging || {}, null, 4)}
};
</script>
<script src="/script/ai-agent-bridge.js"></script>`;

  res.json({ snippet, licenseKey: site.license_key });
});

module.exports = router;
