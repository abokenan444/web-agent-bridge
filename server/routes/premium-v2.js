'use strict';

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { findSiteById } = require('../models/db');
const memory = require('../services/agent-memory');
const healing = require('../services/self-healing');
const vision = require('../services/vision');
const swarm = require('../services/swarm');
const plugins = require('../services/plugins');

// ─── Middleware ───────────────────────────────────────────────────────────────

function requireSiteOwnership(req, res, next) {
  const siteId = req.params.siteId || req.body.siteId;
  if (!siteId) return res.status(400).json({ error: 'siteId is required' });

  const site = findSiteById.get(siteId);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  if (site.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

  req.site = site;
  next();
}

// ═════════════════════════════════════════════════════════════════════════════
//  MEMORY API
// ═════════════════════════════════════════════════════════════════════════════

router.post('/memory/:siteId/store', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, type, category, key, value, importance, ttlSeconds } = req.body;
    if (!agentId || !key) return res.status(400).json({ error: 'agentId and key are required' });

    const result = memory.storeMemory(req.params.siteId, agentId, { type, category, key, value, importance, ttlSeconds });
    res.status(201).json({ memory: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to store memory', details: err.message });
  }
});

router.post('/memory/:siteId/recall', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, query, category, type, limit, minImportance } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const results = memory.recallMemories(req.params.siteId, agentId, { query, category, type, limit, minImportance });
    res.json({ memories: results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to recall memories', details: err.message });
  }
});

router.post('/memory/:siteId/associate', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { sourceId, targetId, relationship, strength } = req.body;
    if (!sourceId || !targetId || !relationship) {
      return res.status(400).json({ error: 'sourceId, targetId, and relationship are required' });
    }

    const result = memory.associateMemories(sourceId, targetId, relationship, strength);
    res.status(201).json({ association: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to associate memories', details: err.message });
  }
});

router.delete('/memory/:siteId/:memoryId', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const ok = memory.forgetMemory(req.params.memoryId);
    if (!ok) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to forget memory', details: err.message });
  }
});

router.post('/memory/:siteId/consolidate', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const stats = memory.consolidateMemories(req.params.siteId, agentId);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to consolidate memories', details: err.message });
  }
});

router.get('/memory/:siteId/stats', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId query param is required' });

    const stats = memory.getMemoryStats(req.params.siteId, agentId);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get memory stats', details: err.message });
  }
});

router.post('/memory/:siteId/session/start', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, context } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const session = memory.startSession(req.params.siteId, agentId, context);
    res.status(201).json({ session });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start session', details: err.message });
  }
});

router.post('/memory/:siteId/session/:sessionId/end', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { summary } = req.body;
    const ok = memory.endSession(req.params.sessionId, summary);
    if (!ok) return res.status(404).json({ error: 'Session not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to end session', details: err.message });
  }
});

router.get('/memory/:siteId/sessions', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, limit } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId query param is required' });

    const sessions = memory.getSessionHistory(req.params.siteId, agentId, {
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get session history', details: err.message });
  }
});

router.get('/memory/:siteId/preferences', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId query param is required' });

    const preferences = memory.getPreferences(req.params.siteId, agentId);
    res.json({ preferences });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get preferences', details: err.message });
  }
});

router.post('/memory/:siteId/preferences', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, key, value } = req.body;
    if (!agentId || !key) return res.status(400).json({ error: 'agentId and key are required' });

    const result = memory.recordPreference(req.params.siteId, agentId, key, value);
    res.status(201).json({ preference: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record preference', details: err.message });
  }
});

router.get('/memory/:siteId/export', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, format } = req.query;
    if (!agentId) return res.status(400).json({ error: 'agentId query param is required' });

    const data = memory.exportMemories(req.params.siteId, agentId, { format });

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="memories.csv"');
      return res.send(data);
    }

    res.setHeader('Content-Type', 'application/json');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: 'Failed to export memories', details: err.message });
  }
});

router.post('/memory/:siteId/import', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { agentId, data } = req.body;
    if (!agentId || !Array.isArray(data)) {
      return res.status(400).json({ error: 'agentId and data (array) are required' });
    }

    const result = memory.importMemories(req.params.siteId, agentId, data);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to import memories', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  SELF-HEALING API
// ═════════════════════════════════════════════════════════════════════════════

router.post('/healing/:siteId/register', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { actionName, selector, selectorType, elementSignature } = req.body;
    if (!actionName || !selector) {
      return res.status(400).json({ error: 'actionName and selector are required' });
    }

    const result = healing.registerSelector(req.params.siteId, { actionName, selector, selectorType, elementSignature });
    res.status(201).json({ selector: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register selector', details: err.message });
  }
});

router.post('/healing/:siteId/heal', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { actionName, failedSelector, pageElements } = req.body;
    if (!actionName || !failedSelector) {
      return res.status(400).json({ error: 'actionName and failedSelector are required' });
    }

    const result = healing.healSelector(req.params.siteId, actionName, failedSelector, pageElements || []);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to heal selector', details: err.message });
  }
});

router.post('/healing/:siteId/correct', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { registryId, oldSelector, newSelector, correctedBy, reason, shared } = req.body;
    if (!oldSelector || !newSelector) {
      return res.status(400).json({ error: 'oldSelector and newSelector are required' });
    }

    const result = healing.submitCorrection(req.params.siteId, registryId, {
      oldSelector, newSelector, correctedBy, reason, shared,
    });
    res.status(201).json({ correction: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to submit correction', details: err.message });
  }
});

router.get('/healing/:siteId/suggestions', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { failedSelector } = req.query;
    if (!failedSelector) return res.status(400).json({ error: 'failedSelector query param is required' });

    const suggestions = healing.getCommunitySuggestions(req.params.siteId, failedSelector);
    res.json({ suggestions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get community suggestions', details: err.message });
  }
});

router.post('/healing/:siteId/verify', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { actionName, elementData } = req.body;
    if (!actionName || !elementData) {
      return res.status(400).json({ error: 'actionName and elementData are required' });
    }

    const result = healing.verifySelector(req.params.siteId, actionName, elementData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to verify selector', details: err.message });
  }
});

router.get('/healing/:siteId/health', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const health = healing.getSelectorHealth(req.params.siteId);
    res.json({ health });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get selector health', details: err.message });
  }
});

router.get('/healing/:siteId/history', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { limit, actionName } = req.query;
    const history = healing.getHealingHistory(req.params.siteId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      actionName,
    });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get healing history', details: err.message });
  }
});

router.post('/healing/:siteId/snapshot', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { url, elements } = req.body;
    if (!url || !Array.isArray(elements)) {
      return res.status(400).json({ error: 'url and elements (array) are required' });
    }

    const result = healing.snapshotElements(req.params.siteId, url, elements);
    res.status(201).json({ snapshot: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to snapshot elements', details: err.message });
  }
});

router.post('/healing/:siteId/drift', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { url, currentElements } = req.body;
    if (!url || !Array.isArray(currentElements)) {
      return res.status(400).json({ error: 'url and currentElements (array) are required' });
    }

    const result = healing.detectDrift(req.params.siteId, url, currentElements);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to detect drift', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  VISION API
// ═════════════════════════════════════════════════════════════════════════════

router.put('/vision/:siteId/config', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { provider, model, endpoint, apiKey, maxResolution, cacheTtl } = req.body;
    const config = vision.configureVision(req.params.siteId, { provider, model, endpoint, apiKey, maxResolution, cacheTtl });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to configure vision', details: err.message });
  }
});

router.get('/vision/:siteId/config', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const config = vision.getVisionConfig(req.params.siteId);
    if (!config) return res.status(404).json({ error: 'Vision not configured for this site' });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get vision config', details: err.message });
  }
});

router.post('/vision/:siteId/analyze', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { screenshotBase64, url, prompt } = req.body;
    if (!screenshotBase64) return res.status(400).json({ error: 'screenshotBase64 is required' });

    const result = await vision.analyzeScreenshot(req.params.siteId, { screenshotBase64, url, prompt });
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not configured') || err.message.includes('disabled') ? 400 : 500;
    res.status(status).json({ error: 'Failed to analyze screenshot', details: err.message });
  }
});

router.post('/vision/:siteId/find-element', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { url, description, type, label } = req.body;
    const elements = vision.findElement(req.params.siteId, url, { description, type, label });
    res.json({ elements, count: elements.length });
  } catch (err) {
    res.status(500).json({ error: 'Failed to find element', details: err.message });
  }
});

router.post('/vision/:siteId/compare', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { url, screenshotAHash, screenshotBHash } = req.body;
    if (!screenshotAHash || !screenshotBHash) {
      return res.status(400).json({ error: 'screenshotAHash and screenshotBHash are required' });
    }

    const result = vision.compareScreenshots(req.params.siteId, url, screenshotAHash, screenshotBHash);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to compare screenshots', details: err.message });
  }
});

router.get('/vision/:siteId/cache-stats', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const stats = vision.getCacheStats(req.params.siteId);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get cache stats', details: err.message });
  }
});

router.delete('/vision/:siteId/cache', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { olderThan } = req.query;
    const result = vision.clearCache(req.params.siteId, {
      olderThan: olderThan ? parseInt(olderThan, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to clear cache', details: err.message });
  }
});

router.get('/vision/:siteId/history', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { limit, url } = req.query;
    const history = vision.getVisionHistory(req.params.siteId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      url,
    });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get vision history', details: err.message });
  }
});

router.get('/vision/models', (_req, res) => {
  try {
    const models = vision.getSupportedModels();
    res.json({ models });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get supported models', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  SWARM API
// ═════════════════════════════════════════════════════════════════════════════

router.put('/swarm/:siteId/config', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { name, strategy, maxAgents, timeoutMs, mergeStrategy } = req.body;
    const config = swarm.configureSwarm(req.params.siteId, { name, strategy, maxAgents, timeoutMs, mergeStrategy });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to configure swarm', details: err.message });
  }
});

router.get('/swarm/:siteId/config', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const config = swarm.getSwarmConfig(req.params.siteId);
    if (!config) return res.status(404).json({ error: 'Swarm not configured for this site' });
    res.json({ config });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get swarm config', details: err.message });
  }
});

router.post('/swarm/:siteId/tasks', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { taskType, objective, parameters } = req.body;
    if (!objective) return res.status(400).json({ error: 'objective is required' });

    const task = swarm.createTask(req.params.siteId, {
      taskType, objective, parameters, createdBy: req.user.id,
    });
    res.status(201).json({ task });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create task', details: err.message });
  }
});

router.post('/swarm/tasks/:taskId/agents', authenticateToken, (req, res) => {
  try {
    const { agents: agentDefinitions } = req.body;
    if (!Array.isArray(agentDefinitions) || agentDefinitions.length === 0) {
      return res.status(400).json({ error: 'agents (non-empty array) is required' });
    }

    const agents = swarm.assignAgents(req.params.taskId, agentDefinitions);
    res.status(201).json({ agents });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: 'Failed to assign agents', details: err.message });
  }
});

router.post('/swarm/tasks/:taskId/run', authenticateToken, async (req, res) => {
  try {
    const result = await swarm.runSwarmTask(req.params.taskId);
    res.json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404
      : err.message.includes('cancelled') ? 400
      : err.message.includes('No agents') ? 400 : 500;
    res.status(status).json({ error: 'Failed to run swarm task', details: err.message });
  }
});

router.get('/swarm/tasks/:taskId', authenticateToken, (req, res) => {
  try {
    const status = swarm.getTaskStatus(req.params.taskId);
    if (!status) return res.status(404).json({ error: 'Task not found' });
    res.json({ task: status });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task status', details: err.message });
  }
});

router.get('/swarm/tasks/:taskId/result', authenticateToken, (req, res) => {
  try {
    const result = swarm.getTaskResult(req.params.taskId);
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get task result', details: err.message });
  }
});

router.post('/swarm/tasks/:taskId/cancel', authenticateToken, (req, res) => {
  try {
    const result = swarm.cancelTask(req.params.taskId);
    if (!result) return res.status(404).json({ error: 'Task not found' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to cancel task', details: err.message });
  }
});

router.get('/swarm/:siteId/history', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { limit, taskType } = req.query;
    const history = swarm.getSwarmHistory(req.params.siteId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      taskType,
    });
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get swarm history', details: err.message });
  }
});

router.get('/swarm/:siteId/stats', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const stats = swarm.getSwarmStats(req.params.siteId);
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get swarm stats', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
//  PLUGINS API
// ═════════════════════════════════════════════════════════════════════════════

router.get('/plugins/marketplace', (req, res) => {
  try {
    const { category, search, limit, offset } = req.query;
    const result = plugins.listPlugins({
      category, search,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to list plugins', details: err.message });
  }
});

router.get('/plugins/hooks', (req, res) => {
  try {
    const hooks = plugins.getAvailableHooks();
    res.json({ hooks });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get available hooks', details: err.message });
  }
});

router.get('/plugins/:pluginId', authenticateToken, (req, res) => {
  try {
    const plugin = plugins.getPlugin(req.params.pluginId);
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json({ plugin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get plugin', details: err.message });
  }
});

router.post('/plugins/register', authenticateToken, (req, res) => {
  try {
    const { name, description, version, author, hooks, configSchema, category } = req.body;
    if (!name || !version) return res.status(400).json({ error: 'name and version are required' });

    const plugin = plugins.registerPlugin({
      name, description, version, author, hooks, configSchema, category,
      registeredBy: req.user.id,
    });
    res.status(201).json({ plugin });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register plugin', details: err.message });
  }
});

router.post('/plugins/:pluginId/install/:siteId', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { config } = req.body;
    const installation = plugins.installPlugin(req.params.pluginId, req.params.siteId, req.user.id, config);
    res.status(201).json({ installation });
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: 'Failed to install plugin', details: err.message });
  }
});

router.delete('/plugins/:pluginId/uninstall/:siteId', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const ok = plugins.uninstallPlugin(req.params.pluginId, req.params.siteId);
    if (!ok) return res.status(404).json({ error: 'Plugin installation not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to uninstall plugin', details: err.message });
  }
});

router.put('/plugins/installations/:installationId/config', authenticateToken, (req, res) => {
  try {
    const { config } = req.body;
    if (!config) return res.status(400).json({ error: 'config is required' });

    const result = plugins.configurePlugin(req.params.installationId, config);
    if (!result) return res.status(404).json({ error: 'Installation not found' });
    res.json({ installation: result });
  } catch (err) {
    res.status(500).json({ error: 'Failed to configure plugin', details: err.message });
  }
});

router.get('/plugins/installed/:siteId', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const installed = plugins.getInstalledPlugins(req.params.siteId);
    res.json({ plugins: installed });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get installed plugins', details: err.message });
  }
});

router.post('/plugins/:pluginId/rate', authenticateToken, (req, res) => {
  try {
    const { rating, review } = req.body;
    if (rating == null || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'rating (1-5) is required' });
    }

    const result = plugins.ratePlugin(req.params.pluginId, req.user.id, rating);
    res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ error: 'Failed to rate plugin', details: err.message });
  }
});

router.get('/plugins/:pluginId/stats', authenticateToken, (req, res) => {
  try {
    const stats = plugins.getPluginStats(req.params.pluginId);
    if (!stats) return res.status(404).json({ error: 'Plugin not found' });
    res.json({ stats });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get plugin stats', details: err.message });
  }
});

router.post('/plugins/hooks/:hookName/execute/:siteId', authenticateToken, requireSiteOwnership, async (req, res) => {
  try {
    const { payload } = req.body;
    const result = await plugins.executeHook(req.params.hookName, req.params.siteId, payload || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to execute hook', details: err.message });
  }
});

router.get('/plugins/hooks/log/:siteId', authenticateToken, requireSiteOwnership, (req, res) => {
  try {
    const { limit, hookName } = req.query;
    const logs = plugins.getHookExecutionLog(req.params.siteId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      hookName,
    });
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get hook execution log', details: err.message });
  }
});

module.exports = router;
