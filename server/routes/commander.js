/**
 * Commander Routes — REST API for the Commander Agent System
 *
 * Exposes commander, edge computing, and local AI services through
 * RESTful endpoints. All routes are site-scoped.
 *
 * Sections:
 *   /missions   — Mission lifecycle (create, launch, list, get)
 *   /agents     — Commander agent registry
 *   /edge       — Edge computing node management
 *   /local-ai   — Local model discovery and inference
 *   /stats      — Unified statistics
 */

const express = require('express');
const router = express.Router();

const commander = require('../services/commander');
const edge = require('../services/edge-compute');
const localAI = require('../services/local-ai');

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
// MISSIONS — Task Decomposition & Orchestration
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Launch a full mission (create + execute)
router.post('/missions/launch', async (req, res) => {
  try {
    if (!requireBody(req, res, 'goal')) return;
    const { siteId, goal, title, strategy, priority, context } = req.body;
    const result = await commander.launchMission(siteId || 'default', title || goal.substring(0, 80), goal, {
      strategy, priority, context,
    });
    ok(res, { mission: result });
  } catch (e) { fail(res, 500, e.message); }
});

// Create a mission (plan only, no execution)
router.post('/missions', (req, res) => {
  try {
    if (!requireBody(req, res, 'goal')) return;
    const { siteId, goal, title, strategy, priority, context } = req.body;
    const mission = commander.createMission(siteId || 'default', title || goal.substring(0, 80), goal, {
      strategy, priority, context,
    });
    ok(res, { mission });
  } catch (e) { fail(res, 500, e.message); }
});

// Execute an existing mission
router.post('/missions/:id/execute', async (req, res) => {
  try {
    const result = await commander.executeMission(req.params.id);
    ok(res, { mission: result });
  } catch (e) { fail(res, 500, e.message); }
});

// Get a single mission
router.get('/missions/:id', (req, res) => {
  try {
    const mission = commander.getMission(req.params.id);
    if (!mission) return fail(res, 404, 'Mission not found');
    ok(res, { mission });
  } catch (e) { fail(res, 500, e.message); }
});

// Get mission tasks
router.get('/missions/:id/tasks', (req, res) => {
  try {
    const tasks = commander.getMissionTasks(req.params.id);
    ok(res, { tasks });
  } catch (e) { fail(res, 500, e.message); }
});

// List missions
router.get('/missions', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    const missions = req.query.active === 'true'
      ? commander.getActiveMissions(siteId)
      : commander.getMissions(siteId, parseInt(req.query.limit) || 50);
    ok(res, { missions });
  } catch (e) { fail(res, 500, e.message); }
});

// Get decomposition strategies
router.get('/strategies', (req, res) => {
  try {
    ok(res, { strategies: commander.getStrategies() });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// AGENTS — Commander Agent Registry
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.post('/agents', (req, res) => {
  try {
    if (!requireBody(req, res, 'agentType')) return;
    const { siteId, agentType, displayName, capabilities, modelInfo, hardware } = req.body;
    const agent = commander.registerAgent(siteId || 'default', agentType, displayName, capabilities, modelInfo, hardware);
    ok(res, { agent });
  } catch (e) { fail(res, 500, e.message); }
});

router.get('/agents', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    const agents = req.query.capability
      ? commander.getAgentsByCapability(siteId, req.query.capability)
      : commander.getAgents(siteId);
    ok(res, { agents });
  } catch (e) { fail(res, 500, e.message); }
});

router.post('/agents/:id/heartbeat', (req, res) => {
  try {
    commander.agentHeartbeat(req.params.id);
    ok(res, { alive: true });
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EDGE — Distributed Computing Nodes
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Register an edge node
router.post('/edge/nodes', (req, res) => {
  try {
    if (!requireBody(req, res, 'hostname')) return;
    const { siteId, hostname, hardware, capabilities } = req.body;
    const node = edge.registerNode(siteId || 'default', hostname, hardware, capabilities);
    ok(res, { node });
  } catch (e) { fail(res, 500, e.message); }
});

// List edge nodes
router.get('/edge/nodes', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    const nodes = req.query.available === 'true'
      ? edge.getAvailableNodes(siteId)
      : edge.getNodes(siteId);
    ok(res, { nodes });
  } catch (e) { fail(res, 500, e.message); }
});

// Node heartbeat
router.post('/edge/nodes/:id/heartbeat', (req, res) => {
  try {
    edge.nodeHeartbeat(req.params.id, req.body.currentLoad || 0);
    ok(res, { alive: true });
  } catch (e) { fail(res, 500, e.message); }
});

// Remove node
router.delete('/edge/nodes/:id', (req, res) => {
  try {
    edge.removeNode(req.params.id);
    ok(res, { removed: req.params.id });
  } catch (e) { fail(res, 500, e.message); }
});

// Submit a task for edge execution
router.post('/edge/tasks', (req, res) => {
  try {
    if (!requireBody(req, res, 'taskType', 'payload')) return;
    const { taskType, payload, priority, missionId, encrypt, encryptionKey } = req.body;
    const task = edge.submitTask(taskType, payload, { priority, missionId, encrypt, encryptionKey });
    ok(res, { task });
  } catch (e) { fail(res, 500, e.message); }
});

// Distribute queued tasks to available nodes
router.post('/edge/distribute', (req, res) => {
  try {
    const siteId = req.body.siteId || 'default';
    const result = edge.distributeTask(siteId);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Complete a task (called by the executing node)
router.post('/edge/tasks/:id/complete', (req, res) => {
  try {
    const { result, success } = req.body;
    const outcome = edge.completeTask(req.params.id, result, success !== false);
    ok(res, outcome);
  } catch (e) { fail(res, 500, e.message); }
});

// Get tasks for a specific node
router.get('/edge/tasks', (req, res) => {
  try {
    if (req.query.nodeId) {
      ok(res, { tasks: edge.getNodeTasks(req.query.nodeId) });
    } else if (req.query.missionId) {
      const task = edge.getTask(req.query.missionId);
      ok(res, { tasks: task ? [task] : [] });
    } else {
      fail(res, 400, 'Provide nodeId or missionId query param');
    }
  } catch (e) { fail(res, 500, e.message); }
});

// Get edge swarms
router.get('/edge/swarms', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    const swarms = req.query.capability
      ? [edge.getSwarmByCapability(siteId, req.query.capability)].filter(Boolean)
      : edge.getSwarms(siteId);
    ok(res, { swarms });
  } catch (e) { fail(res, 500, e.message); }
});

// Edge stats
router.get('/edge/stats', (req, res) => {
  try {
    ok(res, edge.getStats(req.query.siteId || 'default'));
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// LOCAL AI — Sovereign Model Management
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

// Discover local models (probe Ollama, llama.cpp, etc.)
router.post('/local-ai/discover', async (req, res) => {
  try {
    const siteId = req.body.siteId || 'default';
    const result = await localAI.discoverModels(siteId, req.body.customEndpoints);
    ok(res, result);
  } catch (e) { fail(res, 500, e.message); }
});

// Register a model manually
router.post('/local-ai/models', (req, res) => {
  try {
    if (!requireBody(req, res, 'provider', 'modelName', 'endpoint')) return;
    const { siteId, provider, modelName, endpoint, capabilities, contextWindow } = req.body;
    const model = localAI.registerModel(siteId || 'default', provider, modelName, endpoint, capabilities, contextWindow);
    ok(res, { model });
  } catch (e) { fail(res, 500, e.message); }
});

// Run inference
router.post('/local-ai/infer', async (req, res) => {
  try {
    if (!requireBody(req, res, 'prompt')) return;
    const { siteId, prompt, capability, modelId, systemPrompt, temperature, maxTokens } = req.body;
    const result = await localAI.infer(siteId || 'default', prompt, {
      capability, modelId, systemPrompt, temperature, maxTokens,
    });
    ok(res, { result });
  } catch (e) { fail(res, 500, e.message); }
});

// List models
router.get('/local-ai/models', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    const models = req.query.available === 'true'
      ? localAI.getAvailableModels(siteId)
      : localAI.getModels(siteId);
    ok(res, { models });
  } catch (e) { fail(res, 500, e.message); }
});

// Update model status
router.patch('/local-ai/models/:id', (req, res) => {
  try {
    if (!requireBody(req, res, 'status')) return;
    localAI.updateModelStatus(req.params.id, req.body.status);
    ok(res, { updated: req.params.id });
  } catch (e) { fail(res, 500, e.message); }
});

// Local AI stats
router.get('/local-ai/stats', (req, res) => {
  try {
    ok(res, localAI.getStats(req.query.siteId || 'default'));
  } catch (e) { fail(res, 500, e.message); }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// UNIFIED STATS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

router.get('/stats', (req, res) => {
  try {
    const siteId = req.query.siteId || 'default';
    ok(res, {
      commander: commander.getStats(siteId),
      edge: edge.getStats(siteId),
      localAI: localAI.getStats(siteId),
    });
  } catch (e) { fail(res, 500, e.message); }
});

module.exports = router;
