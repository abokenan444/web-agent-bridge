/**
 * Mesh API Routes
 * ════════════════════════════════════════════════════════════════════════
 * Routes for: Agent Mesh Protocol, Agent Learning Engine,
 * and Agent Symphony Orchestrator.
 */

const express = require('express');
const router = express.Router();

const mesh = require('../services/agent-mesh');
const learning = require('../services/agent-learning');
const symphony = require('../services/agent-symphony');

// ═══════════════════════════════════════════════════════════════════════
// AGENT MESH PROTOCOL
// ═══════════════════════════════════════════════════════════════════════

// Register an agent in the mesh
router.post('/agents', (req, res) => {
  const { siteId, role, displayName, capabilities } = req.body;
  if (!role) return res.status(400).json({ error: 'role is required' });
  const result = mesh.registerAgent(siteId || 'default', role, displayName, capabilities);
  res.json(result);
});

// Get all active agents
router.get('/agents', (req, res) => {
  res.json(mesh.getActiveAgents());
});

// Get agents by role
router.get('/agents/role/:role', (req, res) => {
  res.json(mesh.getAgentsByRole(req.params.role));
});

// Agent heartbeat
router.post('/agents/:agentId/heartbeat', (req, res) => {
  mesh.heartbeat(req.params.agentId);
  res.json({ ok: true });
});

// Set agent status
router.patch('/agents/:agentId/status', (req, res) => {
  const { status } = req.body;
  if (!status) return res.status(400).json({ error: 'status is required' });
  mesh.setAgentStatus(req.params.agentId, status);
  res.json({ ok: true });
});

// Get channels
router.get('/channels', (req, res) => {
  res.json(mesh.getChannels());
});

// Publish message to channel
router.post('/channels/:channel/messages', (req, res) => {
  const { senderId, messageType, subject, payload, priority, ttl, targetId } = req.body;
  if (!senderId || !messageType || !subject) {
    return res.status(400).json({ error: 'senderId, messageType, and subject are required' });
  }
  try {
    const msg = mesh.publish(senderId, req.params.channel, messageType, subject, payload || {}, { priority, ttl, targetId });
    res.json(msg);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get messages from channel
router.get('/channels/:channel/messages', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  res.json(mesh.getMessages(req.params.channel, limit));
});

// Get unread messages for an agent
router.get('/agents/:agentId/messages/:channel', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(mesh.getMessagesForAgent(req.params.agentId, req.params.channel, limit));
});

// Acknowledge a message
router.post('/agents/:agentId/messages/:messageId/ack', (req, res) => {
  mesh.acknowledge(req.params.agentId, req.params.messageId);
  res.json({ ok: true });
});

// Get unread count
router.get('/agents/:agentId/unread', (req, res) => {
  res.json({ count: mesh.getUnreadCount(req.params.agentId) });
});

// Broadcast alert
router.post('/alerts', (req, res) => {
  const { senderId, subject, details, priority } = req.body;
  if (!senderId || !subject) return res.status(400).json({ error: 'senderId and subject are required' });
  res.json(mesh.broadcastAlert(senderId, subject, details || {}, priority));
});

// Share tactic
router.post('/tactics', (req, res) => {
  const { senderId, domain, tactic, confidence } = req.body;
  if (!senderId || !domain || !tactic) {
    return res.status(400).json({ error: 'senderId, domain, and tactic are required' });
  }
  res.json(mesh.shareTactic(senderId, domain, tactic, confidence));
});

// Request help from other agents
router.post('/help', (req, res) => {
  const { senderId, subject, question, targetRole } = req.body;
  if (!senderId || !subject || !question) {
    return res.status(400).json({ error: 'senderId, subject, and question are required' });
  }
  res.json(mesh.requestHelp(senderId, subject, question, targetRole));
});

// ═══════════════════════════════════════════════════════════════════════
// KNOWLEDGE SHARING
// ═══════════════════════════════════════════════════════════════════════

// Share knowledge to the mesh
router.post('/knowledge', (req, res) => {
  const { agentId, knowledgeType, domain, key, value, confidence } = req.body;
  if (!agentId || !knowledgeType || !domain || !key || !value) {
    return res.status(400).json({ error: 'agentId, knowledgeType, domain, key, and value are required' });
  }
  res.json(mesh.shareKnowledge(agentId, knowledgeType, domain, key, value, confidence));
});

// Query knowledge
router.get('/knowledge/:domain/:key', (req, res) => {
  const result = mesh.queryKnowledge(req.params.domain, req.params.key);
  if (!result) return res.status(404).json({ error: 'Knowledge not found' });
  res.json(result);
});

// Search knowledge by domain
router.get('/knowledge/:domain', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(mesh.searchKnowledge(req.params.domain, limit));
});

// Verify knowledge
router.post('/knowledge/:knowledgeId/verify', (req, res) => {
  const { verifierAgentId, confidence } = req.body;
  if (!verifierAgentId) return res.status(400).json({ error: 'verifierAgentId is required' });
  mesh.verifyKnowledge(req.params.knowledgeId, verifierAgentId, confidence || 1.0);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════
// AGENT LEARNING ENGINE
// ═══════════════════════════════════════════════════════════════════════

// Record a decision
router.post('/learning/decisions', (req, res) => {
  const { siteId, agentId, domain, action, context, features } = req.body;
  if (!siteId || !agentId || !domain || !action) {
    return res.status(400).json({ error: 'siteId, agentId, domain, and action are required' });
  }
  res.json(learning.recordDecision(siteId, agentId, domain, action, context, features));
});

// Provide feedback on a decision
router.post('/learning/decisions/:decisionId/feedback', (req, res) => {
  const { outcome, reward } = req.body;
  if (!outcome || reward === undefined) {
    return res.status(400).json({ error: 'outcome and reward are required' });
  }
  try {
    res.json(learning.feedback(req.params.decisionId, outcome, reward));
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

// Get recommendation
router.post('/learning/recommend', (req, res) => {
  const { siteId, agentId, domain, actions, context } = req.body;
  if (!siteId || !agentId || !domain || !actions || !Array.isArray(actions)) {
    return res.status(400).json({ error: 'siteId, agentId, domain, and actions (array) are required' });
  }
  res.json(learning.recommend(siteId, agentId, domain, actions, context));
});

// Get preferences
router.get('/learning/preferences/:siteId/:agentId/:domain', (req, res) => {
  res.json(learning.getPreferences(req.params.siteId, req.params.agentId, req.params.domain));
});

// Start learning session
router.post('/learning/sessions', (req, res) => {
  const { siteId, agentId } = req.body;
  if (!siteId || !agentId) return res.status(400).json({ error: 'siteId and agentId are required' });
  res.json(learning.startSession(siteId, agentId));
});

// End learning session
router.post('/learning/sessions/:sessionId/end', (req, res) => {
  const { decisionsMade, correctPredictions } = req.body;
  res.json(learning.endSession(req.params.sessionId, decisionsMade || 0, correctPredictions || 0));
});

// Learning stats
router.get('/learning/stats/:siteId/:agentId', (req, res) => {
  res.json(learning.getStats(req.params.siteId, req.params.agentId));
});

// ═══════════════════════════════════════════════════════════════════════
// AGENT SYMPHONY ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════

// Perform a full symphony (end-to-end)
router.post('/symphony/perform', (req, res) => {
  const { siteId, task, taskType, inputData, agentIds } = req.body;
  if (!siteId || !task || !taskType) {
    return res.status(400).json({ error: 'siteId, task, and taskType are required' });
  }
  try {
    const result = symphony.perform(siteId, task, taskType, inputData, agentIds);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Compose a symphony (step-by-step)
router.post('/symphony/compose', (req, res) => {
  const { siteId, task, taskType, agentIds } = req.body;
  if (!siteId || !task || !taskType) {
    return res.status(400).json({ error: 'siteId, task, and taskType are required' });
  }
  try {
    res.json(symphony.compose(siteId, task, taskType, agentIds));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Execute a single phase
router.post('/symphony/:compositionId/phase', (req, res) => {
  const { phase, input } = req.body;
  if (!phase) return res.status(400).json({ error: 'phase is required' });
  try {
    res.json(symphony.executePhase(req.params.compositionId, phase, input));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get composition details
router.get('/symphony/:compositionId', (req, res) => {
  const result = symphony.getComposition(req.params.compositionId);
  if (!result) return res.status(404).json({ error: 'Composition not found' });
  res.json(result);
});

// Get compositions for site
router.get('/symphony/site/:siteId', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  res.json(symphony.getCompositions(req.params.siteId, limit));
});

// Get templates
router.get('/symphony/templates/all', (req, res) => {
  res.json(symphony.getTemplates());
});

// Symphony stats
router.get('/symphony/stats/:siteId', (req, res) => {
  res.json(symphony.getStats(req.params.siteId));
});

// ═══════════════════════════════════════════════════════════════════════
// MESH STATISTICS
// ═══════════════════════════════════════════════════════════════════════

// Overall mesh stats
router.get('/stats', (req, res) => {
  const meshStats = mesh.getStats();
  res.json(meshStats);
});

// Dashboard aggregate data
router.get('/dashboard', (req, res) => {
  const meshStats = mesh.getStats();
  const channels = mesh.getChannels();
  const agents = mesh.getActiveAgents();
  const templates = symphony.getTemplates();

  res.json({
    mesh: meshStats,
    channels,
    agents,
    symphonyTemplates: templates,
  });
});

module.exports = router;
