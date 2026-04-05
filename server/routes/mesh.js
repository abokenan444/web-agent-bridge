/**
 * Mesh Routes — REST API for the Private Agent Mesh
 *
 * Exposes the mesh, learning, and symphony services through
 * RESTful endpoints. All routes are site-scoped and require
 * no external authentication (local-only mesh).
 */

const express = require('express');
const router = express.Router();

const mesh = require('../services/agent-mesh');
const learning = require('../services/agent-learning');
const symphony = require('../services/agent-symphony');

// ─── Helpers ─────────────────────────────────────────────────────────

function ok(res, data) { res.json({ ok: true, ...data }); }
function fail(res, status, message) { res.status(status).json({ ok: false, error: message }); }

function requireBody(req, res, ...fields) {
  for (const f of fields) {
    if (req.body[f] === undefined || req.body[f] === null) {
      fail(res, 400, `Missing required field: ${f}`);
      return false;
    }
  }
  return true;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH — Agent Registration & Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Register a new agent
router.post('/agents', (req, res) => {
  try {
    if (!requireBody(req, res, 'role')) return;
    const { siteId, role, displayName, capabilities } = req.body;
    const agent = mesh.registerAgent(siteId || null, role, displayName, capabilities);
    ok(res, { agent });
  } catch (e) { fail(res, 500, e.message); }
});

// Deregister an agent
router.delete('/agents/:id', (req, res) => {
  try {
    mesh.deregisterAgent(req.params.id);
    ok(res, { deregistered: req.params.id });
  } catch (e) { fail(res, 500, e.message); }
});

// Get active agents
router.get('/agents', (req, res) => {
  try {
    const agents = req.query.role
      ? mesh.getAgentsByRole(req.query.role)
      : mesh.getActiveAgents();
    ok(res, { agents });
  } catch (e) { fail(res, 500, e.message); }
});

// Get single agent
router.get('/agents/:id', (req, res) => {
  try {
    const agent = mesh.getAgent(req.params.id);
    if (!agent) return fail(res, 404, 'Agent not found');
    ok(res, { agent });
  } catch (e) { fail(res, 500, e.message); }
});

// Update agent metadata
router.patch('/agents/:id/meta', (req, res) => {
  try {
    if (!requireBody(req, res, 'metadata')) return;
    mesh.updateAgentMeta(req.params.id, req.body.metadata);
    ok(res, { updated: true });
  } catch (e) { fail(res, 500, e.message); }
});

// Heartbeat
router.post('/agents/:id/heartbeat', (req, res) => {
  try {
    mesh.heartbeat(req.params.id);
    ok(res, { alive: true });
  } catch (e) { fail(res, 500, e.message); }
});

// Set agent status
router.put('/agents/:id/status', (req, res) => {
  try {
    if (!requireBody(req, res, 'status')) return;
    mesh.setAgentStatus(req.params.id, req.body.status);
    ok(res, { status: req.body.status });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH — Channels & Messaging
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Get channels
router.get('/channels', (req, res) => {
  try {
    ok(res, { channels: mesh.getChannels() });
  } catch (e) { fail(res, 500, e.message); }
});

// Create channel
router.post('/channels', (req, res) => {
  try {
    if (!requireBody(req, res, 'name')) return;
    const channel = mesh.createChannel(req.body.name, req.body.description, req.body.type);
    ok(res, { channel });
  } catch (e) { fail(res, 500, e.message); }
});

// Publish message
router.post('/messages', (req, res) => {
  try {
    if (!requireBody(req, res, 'senderId', 'type', 'subject')) return;
    const { channelName, senderId, targetId, type, subject, payload, priority, ttl } = req.body;
    const msg = mesh.publish(channelName || 'general', senderId, targetId, type, subject, payload, priority, ttl);
    ok(res, { message: msg });
  } catch (e) { fail(res, 500, e.message); }
});

// Get messages (for a channel or for a specific agent)
router.get('/messages', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    let messages;
    if (req.query.agentId) {
      messages = mesh.getMessagesForAgent(req.query.agentId, limit);
    } else {
      messages = mesh.getMessages(req.query.channel || 'general', limit);
    }
    ok(res, { messages });
  } catch (e) { fail(res, 500, e.message); }
});

// Acknowledge message
router.post('/messages/:id/acknowledge', (req, res) => {
  try {
    mesh.acknowledge(req.params.id);
    ok(res, { acknowledged: true });
  } catch (e) { fail(res, 500, e.message); }
});

// Unread count
router.get('/agents/:id/unread', (req, res) => {
  try {
    const count = mesh.getUnreadCount(req.params.id);
    const byChannel = mesh.getUnreadByChannel(req.params.id);
    ok(res, { unreadCount: count, byChannel });
  } catch (e) { fail(res, 500, e.message); }
});

// Convenience: broadcast alert
router.post('/alert', (req, res) => {
  try {
    if (!requireBody(req, res, 'senderId', 'subject', 'details')) return;
    const msg = mesh.broadcastAlert(req.body.senderId, req.body.subject, req.body.details, req.body.priority);
    ok(res, { message: msg });
  } catch (e) { fail(res, 500, e.message); }
});

// Convenience: share tactic
router.post('/tactic', (req, res) => {
  try {
    if (!requireBody(req, res, 'senderId', 'name', 'tactic')) return;
    const msg = mesh.shareTactic(req.body.senderId, req.body.name, req.body.tactic);
    ok(res, { message: msg });
  } catch (e) { fail(res, 500, e.message); }
});

// Convenience: request help
router.post('/help', (req, res) => {
  try {
    if (!requireBody(req, res, 'senderId', 'problem', 'context')) return;
    const msg = mesh.requestHelp(req.body.senderId, req.body.problem, req.body.context);
    ok(res, { message: msg });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH — Knowledge
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Share knowledge
router.post('/knowledge', (req, res) => {
  try {
    if (!requireBody(req, res, 'agentId', 'type', 'key', 'value')) return;
    const { agentId, type, domain, key, value, confidence, source } = req.body;
    const entry = mesh.shareKnowledge(agentId, type, domain, key, value, confidence, source);
    ok(res, { knowledge: entry });
  } catch (e) { fail(res, 500, e.message); }
});

// Query knowledge
router.get('/knowledge', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    let results;
    if (req.query.domain) {
      results = mesh.queryKnowledge(req.query.domain, req.query.type, limit);
    } else if (req.query.type) {
      results = mesh.searchKnowledgeByType(req.query.type, limit);
    } else if (req.query.agentId) {
      results = mesh.searchKnowledgeByAgent(req.query.agentId, limit);
    } else {
      results = mesh.getRecentKnowledge(limit);
    }
    ok(res, { knowledge: results });
  } catch (e) { fail(res, 500, e.message); }
});

// Get single knowledge entry
router.get('/knowledge/:id', (req, res) => {
  try {
    const entry = mesh.getKnowledgeById(req.params.id);
    if (!entry) return fail(res, 404, 'Knowledge entry not found');
    ok(res, { knowledge: entry });
  } catch (e) { fail(res, 500, e.message); }
});

// Search knowledge
router.get('/knowledge/search/:query', (req, res) => {
  try {
    const results = mesh.searchKnowledge(req.params.query, parseInt(req.query.limit) || 20);
    ok(res, { knowledge: results });
  } catch (e) { fail(res, 500, e.message); }
});

// Knowledge domains
router.get('/knowledge-domains', (req, res) => {
  try {
    ok(res, { domains: mesh.getKnowledgeDomains() });
  } catch (e) { fail(res, 500, e.message); }
});

// Recent knowledge
router.get('/knowledge-recent', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    ok(res, { knowledge: mesh.getRecentKnowledge(limit) });
  } catch (e) { fail(res, 500, e.message); }
});

// Verify knowledge
router.post('/knowledge/:id/verify', (req, res) => {
  try {
    if (!requireBody(req, res, 'verifierId', 'confidence')) return;
    mesh.verifyKnowledge(req.params.id, req.body.verifierId, req.body.confidence);
    ok(res, { verified: true });
  } catch (e) { fail(res, 500, e.message); }
});

// Update knowledge value
router.put('/knowledge/:id', (req, res) => {
  try {
    if (!requireBody(req, res, 'value')) return;
    mesh.updateKnowledge(req.params.id, req.body.value);
    ok(res, { updated: true });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH — Voting
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Create vote
router.post('/votes', (req, res) => {
  try {
    if (!requireBody(req, res, 'senderId', 'subject', 'options', 'deadlineSeconds')) return;
    const { senderId, subject, options, deadlineSeconds } = req.body;
    const vote = mesh.createVote(senderId, subject, options, deadlineSeconds);
    ok(res, { vote });
  } catch (e) { fail(res, 500, e.message); }
});

// Cast vote
router.post('/votes/:messageId/cast', (req, res) => {
  try {
    if (!requireBody(req, res, 'voterId', 'choice')) return;
    const { voterId, choice, weight, reason } = req.body;
    const result = mesh.castVote(req.params.messageId, voterId, choice, weight, reason);
    ok(res, { result });
  } catch (e) { fail(res, 400, e.message); }
});

// Tally votes
router.get('/votes/:messageId/tally', (req, res) => {
  try {
    const tally = mesh.tallyVotes(req.params.messageId);
    ok(res, { tally });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MESH — Stats
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/stats', (req, res) => {
  try {
    ok(res, { stats: mesh.getStats() });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LEARNING — Decision Recording & Recommendations
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Record a decision
router.post('/learning/decisions', (req, res) => {
  try {
    if (!requireBody(req, res, 'siteId', 'agentId', 'domain', 'action')) return;
    const { siteId, agentId, domain, action, context, features } = req.body;
    const result = learning.recordDecision(siteId, agentId, domain, action, context, features);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Provide feedback
router.post('/learning/feedback', (req, res) => {
  try {
    if (!requireBody(req, res, 'decisionId', 'outcome', 'reward')) return;
    const result = learning.feedback(req.body.decisionId, req.body.outcome, req.body.reward);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Batch feedback
router.post('/learning/feedback/batch', (req, res) => {
  try {
    if (!requireBody(req, res, 'feedbackList')) return;
    const results = learning.batchFeedback(req.body.feedbackList);
    ok(res, { results });
  } catch (e) { fail(res, 500, e.message); }
});

// Get recommendation
router.post('/learning/recommend', (req, res) => {
  try {
    if (!requireBody(req, res, 'siteId', 'agentId', 'domain', 'actions')) return;
    const { siteId, agentId, domain, actions, context } = req.body;
    const result = learning.recommend(siteId, agentId, domain, actions, context);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Get preferences
router.get('/learning/preferences', (req, res) => {
  try {
    const { siteId, agentId, domain } = req.query;
    if (!siteId || !agentId || !domain) return fail(res, 400, 'Missing siteId, agentId, or domain');
    const prefs = learning.getPreferences(siteId, agentId, domain);
    ok(res, { preferences: prefs });
  } catch (e) { fail(res, 500, e.message); }
});

// Get reward history
router.get('/learning/rewards', (req, res) => {
  try {
    const { siteId, agentId } = req.query;
    if (!siteId || !agentId) return fail(res, 400, 'Missing siteId or agentId');
    const history = learning.getRewardHistory(siteId, agentId, parseInt(req.query.limit) || 30);
    ok(res, { rewardHistory: history });
  } catch (e) { fail(res, 500, e.message); }
});

// Reset domain
router.delete('/learning/domain', (req, res) => {
  try {
    const { siteId, agentId, domain } = req.query;
    if (!siteId || !agentId || !domain) return fail(res, 400, 'Missing siteId, agentId, or domain');
    const result = learning.resetDomain(siteId, agentId, domain);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Learning stats
router.get('/learning/stats', (req, res) => {
  try {
    const { siteId, agentId } = req.query;
    if (!siteId || !agentId) return fail(res, 400, 'Missing siteId or agentId');
    const stats = learning.getStats(siteId, agentId);
    ok(res, { stats });
  } catch (e) { fail(res, 500, e.message); }
});

// Learning sessions
router.post('/learning/sessions', (req, res) => {
  try {
    if (!requireBody(req, res, 'siteId', 'agentId')) return;
    const session = learning.startSession(req.body.siteId, req.body.agentId);
    ok(res, session);
  } catch (e) { fail(res, 500, e.message); }
});

router.put('/learning/sessions/:id', (req, res) => {
  try {
    if (!requireBody(req, res, 'decisionsMade', 'correctPredictions')) return;
    const result = learning.endSession(req.params.id, req.body.decisionsMade, req.body.correctPredictions);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// SYMPHONY — Composition Orchestration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Execute composition
router.post('/symphony/compose', (req, res) => {
  try {
    if (!requireBody(req, res, 'siteId', 'template')) return;
    const { siteId, template, inputData, schema } = req.body;
    const result = symphony.perform(siteId, template, inputData, schema);
    ok(res, result);
  } catch (e) { fail(res, 400, e.message); }
});

// Get templates
router.get('/symphony/templates', (req, res) => {
  try {
    ok(res, { templates: symphony.getTemplates() });
  } catch (e) { fail(res, 500, e.message); }
});

// Get composition by ID
router.get('/symphony/compositions/:id', (req, res) => {
  try {
    const comp = symphony.getComposition(req.params.id);
    if (!comp) return fail(res, 404, 'Composition not found');
    ok(res, { composition: comp });
  } catch (e) { fail(res, 500, e.message); }
});

// Get compositions list
router.get('/symphony/compositions', (req, res) => {
  try {
    const { siteId, template } = req.query;
    if (!siteId) return fail(res, 400, 'Missing siteId');
    const comps = template
      ? symphony.getCompositionsByTemplate(siteId, template, parseInt(req.query.limit) || 10)
      : symphony.getCompositions(siteId, parseInt(req.query.limit) || 20);
    ok(res, { compositions: comps });
  } catch (e) { fail(res, 500, e.message); }
});

// Get phase logs
router.get('/symphony/compositions/:id/phases', (req, res) => {
  try {
    const logs = symphony.getPhaseLogs(req.params.id);
    ok(res, { phases: logs });
  } catch (e) { fail(res, 500, e.message); }
});

// Symphony stats
router.get('/symphony/stats', (req, res) => {
  try {
    const { siteId } = req.query;
    if (!siteId) return fail(res, 400, 'Missing siteId');
    const stats = symphony.getStats(siteId);
    ok(res, { stats });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
