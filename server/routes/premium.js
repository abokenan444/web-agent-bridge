const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const premium = require('../services/premium');
const { findSiteById, findSitesByUser } = require('../models/db');

function requireSiteOwnership(req, res, next) {
  const siteId = req.params.siteId || req.body.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId required' });
  const site = findSiteById.get(siteId);
  if (!site || site.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });
  req.site = site;
  next();
}

// ─── Traffic Intelligence ────────────────────────────────────────────────

router.get('/traffic/:siteId/profiles', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit, offset, type } = req.query;
    const profiles = await premium.getAgentProfiles(req.params.siteId, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      type
    });
    res.json({ profiles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent profiles' });
  }
});

router.get('/traffic/:siteId/stats', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days) : 30;
    const stats = await premium.getTrafficStats(req.params.siteId, days);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch traffic stats' });
  }
});

router.get('/traffic/:siteId/alerts', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit, acknowledged } = req.query;
    const alerts = await premium.getAnomalyAlerts(req.params.siteId, {
      limit: limit ? parseInt(limit) : undefined,
      acknowledged: acknowledged !== undefined ? acknowledged === 'true' : undefined
    });
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch anomaly alerts' });
  }
});

router.post('/traffic/:siteId/alerts/:alertId/acknowledge', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.acknowledgeAlert(req.params.alertId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Alert not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to acknowledge alert' });
  }
});

router.post('/traffic/:siteId/check-anomalies', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const alerts = await premium.checkForAnomalies(req.params.siteId);
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check for anomalies' });
  }
});

// ─── Exploit Shield ──────────────────────────────────────────────────────

router.get('/security/:siteId/events', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit, severity, since } = req.query;
    const events = await premium.getSecurityEvents(req.params.siteId, {
      limit: limit ? parseInt(limit) : undefined,
      severity,
      since
    });
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch security events' });
  }
});

router.get('/security/:siteId/report', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days) : 30;
    const report = await premium.getSecurityReport(req.params.siteId, days);
    res.json({ report });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate security report' });
  }
});

router.get('/security/:siteId/blocked', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const blocked = await premium.getBlockedAgents(req.params.siteId);
    res.json({ blocked });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch blocked agents' });
  }
});

router.post('/security/:siteId/block', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { agentSignature, reason, expiresAt } = req.body;
    if (!agentSignature) return res.status(400).json({ error: 'agentSignature is required' });
    const record = await premium.blockAgent(req.params.siteId, { agentSignature, reason, expiresAt });
    res.status(201).json({ blocked: record });
  } catch (err) {
    res.status(500).json({ error: 'Failed to block agent' });
  }
});

router.delete('/security/:siteId/block/:blockId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.unblockAgent(req.params.blockId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Block record not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to unblock agent' });
  }
});

// ─── Actions Library ─────────────────────────────────────────────────────

router.get('/actions/packs', authenticateToken, async (req, res) => {
  try {
    const { platform, tier } = req.query;
    const packs = await premium.getActionPacks({
      platform,
      tierRequired: tier
    });
    res.json({ packs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch action packs' });
  }
});

router.get('/actions/packs/:packId', authenticateToken, async (req, res) => {
  try {
    const pack = await premium.getActionPack(req.params.packId);
    if (!pack) return res.status(404).json({ error: 'Pack not found' });
    res.json({ pack });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch action pack' });
  }
});

router.get('/actions/packs/:packId/actions', authenticateToken, async (req, res) => {
  try {
    const actions = await premium.getPackActions(req.params.packId);
    res.json({ actions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch pack actions' });
  }
});

router.get('/actions/:siteId/installed', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const installed = await premium.getInstalledPacks(req.params.siteId);
    res.json({ installed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch installed packs' });
  }
});

router.post('/actions/:siteId/install', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { packId, config } = req.body;
    if (!packId) return res.status(400).json({ error: 'packId is required' });
    const installation = await premium.installPack(req.params.siteId, packId, config);
    res.status(201).json({ installation });
  } catch (err) {
    res.status(500).json({ error: 'Failed to install pack' });
  }
});

router.delete('/actions/:siteId/install/:installId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.uninstallPack(req.params.installId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Installation not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to uninstall pack' });
  }
});

// ─── Custom Agents ───────────────────────────────────────────────────────

router.get('/agents/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const agents = await premium.getAgents(req.user.id, req.params.siteId);
    res.json({ agents });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

router.post('/agents/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { name, description, steps, schedule } = req.body;
    if (!name || !steps) return res.status(400).json({ error: 'name and steps are required' });
    const agent = await premium.createAgent(req.user.id, req.params.siteId, { name, description, steps, schedule });
    res.status(201).json({ agent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

router.get('/agents/:siteId/:agentId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const agent = await premium.getAgent(req.params.agentId, req.user.id);
    if (!agent) return res.status(404).json({ error: 'Agent not found' });
    res.json({ agent });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

router.put('/agents/:siteId/:agentId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { name, description, steps, schedule } = req.body;
    const ok = await premium.updateAgent(req.params.agentId, req.user.id, { name, description, steps, schedule });
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

router.delete('/agents/:siteId/:agentId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.deleteAgent(req.params.agentId, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Agent not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

router.post('/agents/:siteId/:agentId/run', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const result = await premium.runAgent(req.params.agentId, req.user.id);
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run agent' });
  }
});

router.get('/agents/:siteId/:agentId/runs', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit } = req.query;
    const runs = await premium.getAgentRuns(req.params.agentId, {
      limit: limit ? parseInt(limit) : undefined
    });
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch agent runs' });
  }
});

// ─── Webhooks & CRM ─────────────────────────────────────────────────────

router.get('/webhooks/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const webhooks = await premium.getWebhooks(req.params.siteId);
    res.json({ webhooks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch webhooks' });
  }
});

router.post('/webhooks/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { name, url, events, secret } = req.body;
    if (!name || !url || !events) return res.status(400).json({ error: 'name, url, and events are required' });
    const webhook = await premium.createWebhook(req.params.siteId, { name, url, events, secret });
    res.status(201).json({ webhook });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create webhook' });
  }
});

router.put('/webhooks/:siteId/:webhookId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { name, url, events, secret, active } = req.body;
    const ok = await premium.updateWebhook(req.params.webhookId, req.params.siteId, { name, url, events, secret, active });
    if (!ok) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update webhook' });
  }
});

router.delete('/webhooks/:siteId/:webhookId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.deleteWebhook(req.params.webhookId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Webhook not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete webhook' });
  }
});

router.get('/webhooks/:siteId/:webhookId/logs', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit } = req.query;
    const logs = await premium.getWebhookLogs(req.params.webhookId, {
      limit: limit ? parseInt(limit) : undefined
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch webhook logs' });
  }
});

router.post('/webhooks/:siteId/test', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { eventType, payload } = req.body;
    if (!eventType) return res.status(400).json({ error: 'eventType is required' });
    const results = await premium.triggerWebhooks(req.params.siteId, eventType, payload || {});
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to trigger webhooks' });
  }
});

router.get('/crm/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const integrations = await premium.getCrmIntegrations(req.params.siteId);
    res.json({ integrations });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch CRM integrations' });
  }
});

router.post('/crm/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { provider, config } = req.body;
    if (!provider || !config) return res.status(400).json({ error: 'provider and config are required' });
    const integration = await premium.addCrmIntegration(req.params.siteId, { provider, config });
    res.status(201).json({ integration });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add CRM integration' });
  }
});

router.put('/crm/:siteId/:integrationId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { provider, config, active } = req.body;
    const ok = await premium.updateCrmIntegration(req.params.integrationId, req.params.siteId, { provider, config, active });
    if (!ok) return res.status(404).json({ error: 'Integration not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update CRM integration' });
  }
});

router.delete('/crm/:siteId/:integrationId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.deleteCrmIntegration(req.params.integrationId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Integration not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete CRM integration' });
  }
});

// ─── Multi-Tenant ────────────────────────────────────────────────────────

router.get('/team', authenticateToken, async (req, res) => {
  try {
    const subUsers = await premium.getSubUsers(req.user.id);
    res.json({ subUsers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch team members' });
  }
});

router.post('/team', authenticateToken, async (req, res) => {
  try {
    const { email, name, password, role, siteAccess, quotaActionsMonth } = req.body;
    if (!email || !name || !password) return res.status(400).json({ error: 'email, name, and password are required' });
    const subUser = await premium.inviteSubUser(req.user.id, { email, name, password, role, siteAccess, quotaActionsMonth });
    res.status(201).json({ subUser });
  } catch (err) {
    res.status(500).json({ error: 'Failed to invite team member' });
  }
});

router.put('/team/:subUserId', authenticateToken, async (req, res) => {
  try {
    const { name, role, siteAccess, quotaActionsMonth, active } = req.body;
    const ok = await premium.updateSubUser(req.params.subUserId, req.user.id, { name, role, siteAccess, quotaActionsMonth, active });
    if (!ok) return res.status(404).json({ error: 'Team member not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update team member' });
  }
});

router.delete('/team/:subUserId', authenticateToken, async (req, res) => {
  try {
    const ok = await premium.deleteSubUser(req.params.subUserId, req.user.id);
    if (!ok) return res.status(404).json({ error: 'Team member not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete team member' });
  }
});

// ─── Support ─────────────────────────────────────────────────────────────

router.get('/support/tickets', authenticateToken, async (req, res) => {
  try {
    const { status, limit } = req.query;
    const tickets = await premium.getTickets(req.user.id, {
      status,
      limit: limit ? parseInt(limit) : undefined
    });
    res.json({ tickets });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

router.post('/support/tickets', authenticateToken, async (req, res) => {
  try {
    const { subject, priority, category } = req.body;
    if (!subject) return res.status(400).json({ error: 'subject is required' });
    const ticket = await premium.createTicket(req.user.id, { subject, priority, category });
    res.status(201).json({ ticket });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create ticket' });
  }
});

router.get('/support/stats', authenticateToken, async (req, res) => {
  try {
    const stats = await premium.getTicketStats(req.user.id);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ticket stats' });
  }
});

router.get('/support/tickets/:ticketId', authenticateToken, async (req, res) => {
  try {
    const ticket = await premium.getTicket(req.params.ticketId, req.user.id);
    if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
    const messages = await premium.getTicketMessages(req.params.ticketId);
    res.json({ ticket, messages });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

router.put('/support/tickets/:ticketId/status', authenticateToken, async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status is required' });
    const ok = await premium.updateTicketStatus(req.params.ticketId, req.user.id, status);
    if (!ok) return res.status(404).json({ error: 'Ticket not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update ticket status' });
  }
});

router.post('/support/tickets/:ticketId/messages', authenticateToken, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'message is required' });
    const msg = await premium.addTicketMessage(req.params.ticketId, {
      senderType: 'user',
      senderId: req.user.id,
      message
    });

    const botReply = await premium.generateBotResponse(message);
    let botMsg = null;
    if (botReply) {
      botMsg = await premium.addTicketMessage(req.params.ticketId, {
        senderType: 'bot',
        senderId: 'system',
        message: botReply
      });
    }

    res.status(201).json({ message: msg, botReply: botMsg });
  } catch (err) {
    res.status(500).json({ error: 'Failed to add message' });
  }
});

// ─── Custom Script ───────────────────────────────────────────────────────

router.get('/script/plugins', authenticateToken, async (req, res) => {
  try {
    const plugins = await premium.getAvailablePlugins();
    res.json({ plugins });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch plugins' });
  }
});

router.get('/script/:siteId/config', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const config = await premium.getScriptConfig(req.params.siteId);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch script config' });
  }
});

router.put('/script/:siteId/config', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { plugins, minified, ampCompatible, autoPatch, customCss, customJs } = req.body;
    const config = await premium.updateScriptConfig(req.params.siteId, {
      plugins, minified, ampCompatible, autoPatch, customCss, customJs
    });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update script config' });
  }
});

router.post('/script/:siteId/build', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const result = await premium.buildScript(req.params.siteId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to build script' });
  }
});

// ─── Stealth ─────────────────────────────────────────────────────────────

router.get('/stealth/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const profile = await premium.getStealthProfile(req.params.siteId);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch stealth profile' });
  }
});

router.put('/stealth/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const profile = await premium.upsertStealthProfile(req.params.siteId, req.body);
    res.json({ profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update stealth profile' });
  }
});

router.get('/stealth/:siteId/script', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const script = await premium.generateStealthScript(req.params.siteId);
    res.json({ script });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate stealth script' });
  }
});

// ─── CDN ─────────────────────────────────────────────────────────────────

router.get('/cdn/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const config = await premium.getCdnConfig(req.params.siteId);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch CDN config' });
  }
});

router.put('/cdn/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const config = await premium.upsertCdnConfig(req.params.siteId, req.body);
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update CDN config' });
  }
});

router.get('/cdn/:siteId/stats', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const days = req.query.days ? parseInt(req.query.days) : 30;
    const cdnConfig = await premium.getCdnConfig(req.params.siteId);
    if (!cdnConfig) return res.status(404).json({ error: 'CDN not configured' });
    const stats = await premium.getCdnStats(cdnConfig.id, days);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch CDN stats' });
  }
});

// ─── Audit ───────────────────────────────────────────────────────────────

router.get('/audit/:siteId/logs', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { limit, offset, action, since, until } = req.query;
    const result = await premium.getAuditLogs(req.params.siteId, {
      limit: limit ? parseInt(limit) : undefined,
      offset: offset ? parseInt(offset) : undefined,
      action,
      since,
      until
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch audit logs' });
  }
});

router.get('/audit/:siteId/compliance', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const settings = await premium.getComplianceSettings(req.params.siteId);
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch compliance settings' });
  }
});

router.put('/audit/:siteId/compliance', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const settings = await premium.upsertComplianceSettings(req.params.siteId, req.body);
    res.json({ settings });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update compliance settings' });
  }
});

router.get('/audit/:siteId/export', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { format, since, until } = req.query;
    const result = await premium.exportAuditLogs(req.params.siteId, { format, since, until });
    res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export audit logs' });
  }
});

router.post('/audit/:siteId/purge', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const result = await premium.purgeOldLogs(req.params.siteId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to purge old logs' });
  }
});

// ─── Sandbox ─────────────────────────────────────────────────────────────

router.get('/sandbox/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const sandboxes = await premium.getSandboxes(req.params.siteId);
    res.json({ sandboxes });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch sandboxes' });
  }
});

router.post('/sandbox/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const sandbox = await premium.createSandbox(req.params.siteId, { name });
    res.status(201).json({ sandbox });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create sandbox' });
  }
});

router.delete('/sandbox/:siteId/:sandboxId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const ok = await premium.deleteSandbox(req.params.sandboxId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Sandbox not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete sandbox' });
  }
});

router.post('/sandbox/:siteId/:sandboxId/simulate', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { agentCount, duration, actionsPerAgent } = req.body;
    if (!agentCount || !duration) return res.status(400).json({ error: 'agentCount and duration are required' });
    const result = await premium.simulateTraffic(req.params.sandboxId, { agentCount, duration, actionsPerAgent });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to simulate traffic' });
  }
});

router.post('/sandbox/:siteId/:sandboxId/benchmark', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { benchmarkType } = req.body;
    if (!benchmarkType) return res.status(400).json({ error: 'benchmarkType is required' });
    const result = await premium.runBenchmark(req.params.sandboxId, { benchmarkType });
    res.json({ result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to run benchmark' });
  }
});

router.get('/sandbox/:siteId/:sandboxId/benchmarks', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const benchmarks = await premium.getBenchmarks(req.params.sandboxId);
    res.json({ benchmarks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch benchmarks' });
  }
});

module.exports = router;
