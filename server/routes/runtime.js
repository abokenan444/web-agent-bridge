'use strict';

/**
 * WAB Runtime API Routes
 *
 * Exposes the Agent OS runtime via HTTP:
 * - Task management (submit, status, cancel)
 * - Agent lifecycle (register, authenticate, deploy)
 * - Protocol operations (discover, execute, negotiate)
 * - Observability (metrics, traces, logs)
 * - Registry (commands, sites, templates)
 * - LLM operations (complete, models)
 */

const express = require('express');
const router = express.Router();

// Core modules
const protocol = require('../protocol');
const { runtime, bus } = require('../runtime');
const { logger, tracer, metrics } = require('../observability');
const { identity, signer, isolation } = require('../security');
const { agentManager, policyEngine } = require('../control-plane');
const { executor } = require('../data-plane');
const { llm } = require('../llm');
const { commandRegistry, siteRegistry, templateRegistry } = require('../registry');

// ═══════════════════════════════════════════════════════════════════════════
// PROTOCOL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Protocol info & capabilities
 */
router.get('/protocol', (req, res) => {
  res.json({
    protocol: protocol.PROTOCOL_NAME,
    version: protocol.PROTOCOL_VERSION,
    commands: protocol.schema.listCommands().map(c => ({
      name: c.name,
      version: c.version,
      category: c.category,
      description: c.description,
      capabilities: c.capabilities,
    })),
    capabilities: Object.keys(protocol.schema.Capabilities),
    permissionLevels: protocol.schema.PermissionLevels,
  });
});

/**
 * Process a protocol message
 */
router.post('/protocol/message', async (req, res) => {
  const endTimer = metrics.startTimer('api.protocol.message.duration');
  try {
    const msg = req.body;
    if (!msg || !msg.command) {
      return res.status(400).json({ error: 'Invalid protocol message' });
    }

    // Create proper protocol request if not already
    const request = msg.protocol === 'wabp' ? msg : protocol.createRequest(msg.command, msg.payload || msg.params || {}, {
      agentId: msg.agentId,
      traceId: msg.traceId,
    });

    const response = await protocolHandler.process(request);
    endTimer();
    metrics.increment('api.protocol.messages', 1, { command: msg.command });
    res.json(response);
  } catch (err) {
    endTimer();
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AGENT IDENTITY & AUTH
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a new agent
 */
router.post('/agents/register', (req, res) => {
  try {
    const { name, type, capabilities, publicKey, metadata } = req.body;
    if (!name || !type) return res.status(400).json({ error: 'name and type required' });

    const result = identity.register(name, type, { capabilities, publicKey, metadata });
    metrics.increment('agents.registered');
    logger.info('Agent registered', { agentId: result.agentId, name, type });

    res.json({
      agentId: result.agentId,
      apiKey: result.apiKey, // Only returned once!
      message: 'Store your API key securely. It cannot be recovered.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Authenticate agent
 */
router.post('/agents/authenticate', (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey required' });

  const ip = req.ip || req.connection?.remoteAddress;
  const session = identity.authenticate(apiKey, ip);
  if (!session) {
    metrics.increment('agents.auth.failed');
    return res.status(401).json({ error: 'Invalid API key or agent revoked' });
  }

  metrics.increment('agents.auth.success');
  res.json(session);
});

/**
 * Get agent info
 */
router.get('/agents/:agentId', (req, res) => {
  const agent = identity.getAgent(req.params.agentId);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  res.json(agent);
});

/**
 * List agents
 */
router.get('/agents', (req, res) => {
  const agents = identity.listAgents({ type: req.query.type, status: req.query.status || 'active' });
  res.json({ agents, total: agents.length });
});

/**
 * Negotiate capabilities
 */
router.post('/agents/:agentId/capabilities', (req, res) => {
  const { capabilities, siteId, constraints } = req.body;
  if (!capabilities || !Array.isArray(capabilities)) {
    return res.status(400).json({ error: 'capabilities array required' });
  }

  const result = protocol.negotiator.negotiate(req.params.agentId, capabilities, siteId, constraints || {});
  res.json(result);
});

/**
 * Revoke agent
 */
router.delete('/agents/:agentId', (req, res) => {
  identity.revoke(req.params.agentId);
  protocol.negotiator.revokeAgent(req.params.agentId);
  logger.info('Agent revoked', { agentId: req.params.agentId });
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// TASK MANAGEMENT (RUNTIME)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Submit a task
 */
router.post('/tasks', (req, res) => {
  try {
    const result = runtime.submitTask(req.body);
    metrics.increment('tasks.submitted', 1, { type: req.body.type });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Get task status
 */
router.get('/tasks/:taskId', (req, res) => {
  const task = runtime.scheduler.getTask(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Task not found' });
  res.json(task);
});

/**
 * List tasks
 */
router.get('/tasks', (req, res) => {
  const tasks = runtime.scheduler.listTasks(req.query.state, parseInt(req.query.limit) || 50);
  res.json({ tasks, total: tasks.length });
});

/**
 * Cancel a task
 */
router.delete('/tasks/:taskId', (req, res) => {
  const success = runtime.scheduler.cancel(req.params.taskId);
  res.json({ success });
});

/**
 * Pause a task
 */
router.post('/tasks/:taskId/pause', (req, res) => {
  const success = runtime.scheduler.pause(req.params.taskId);
  res.json({ success });
});

/**
 * Resume a task
 */
router.post('/tasks/:taskId/resume', (req, res) => {
  const success = runtime.scheduler.resume(req.params.taskId);
  res.json({ success });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION (DATA PLANE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a semantic action
 */
router.post('/execute', async (req, res) => {
  try {
    const result = await executor.execute(req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Execute semantic action (domain.action style)
 */
router.post('/execute/semantic', async (req, res) => {
  try {
    const { domain, action, params, siteId, agentId, siteDomain } = req.body;
    if (!domain || !action) return res.status(400).json({ error: 'domain and action required' });

    const result = await executor.execute({
      type: 'semantic',
      domain,
      action,
      params: params || {},
      siteId,
      agentId,
      siteDomain,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Execute a pipeline
 */
router.post('/execute/pipeline', async (req, res) => {
  try {
    const result = await executor.execute({ ...req.body, type: 'pipeline' });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Resolve a semantic action (without executing)
 */
router.get('/execute/resolve', (req, res) => {
  const { domain, action, siteDomain } = req.query;
  if (!domain || !action) return res.status(400).json({ error: 'domain and action required' });
  const impl = executor.resolver.resolve(siteDomain || '*', `${domain}.${action}`);
  if (!impl) return res.status(404).json({ error: 'No implementation found' });
  res.json(impl);
});

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL PLANE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Deploy an agent
 */
router.post('/deployments', (req, res) => {
  try {
    const { agentId, config } = req.body;
    if (!agentId) return res.status(400).json({ error: 'agentId required' });
    const deployment = agentManager.deploy(agentId, config || {});
    res.json(deployment);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * List deployments
 */
router.get('/deployments', (req, res) => {
  const deployments = agentManager.listDeployments({
    status: req.query.status,
    agentId: req.query.agentId,
  });
  res.json({ deployments, total: deployments.length });
});

/**
 * Create a policy
 */
router.post('/policies', (req, res) => {
  try {
    const policy = policyEngine.createPolicy(req.body);
    res.json(policy);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Bind policy to entity
 */
router.post('/policies/:policyId/bind', (req, res) => {
  const { entityId } = req.body;
  if (!entityId) return res.status(400).json({ error: 'entityId required' });
  policyEngine.bind(entityId, req.params.policyId);
  res.json({ success: true });
});

/**
 * Evaluate policies
 */
router.post('/policies/evaluate', (req, res) => {
  const { entityId, action, context } = req.body;
  if (!entityId || !action) return res.status(400).json({ error: 'entityId and action required' });
  const result = policyEngine.evaluate(entityId, action, context || {});
  res.json(result);
});

/**
 * List policies
 */
router.get('/policies', (req, res) => {
  const policies = policyEngine.listPolicies(req.query.entityId);
  res.json({ policies, total: policies.length });
});

// ═══════════════════════════════════════════════════════════════════════════
// SITE ISOLATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configure site isolation
 */
router.post('/isolation/:siteId', (req, res) => {
  isolation.configure(req.params.siteId, req.body);
  res.json({ success: true });
});

/**
 * Get site isolation config
 */
router.get('/isolation/:siteId', (req, res) => {
  const config = isolation.getConfig(req.params.siteId);
  if (!config) return res.status(404).json({ error: 'No isolation config' });
  res.json(config);
});

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVABILITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get metrics snapshot
 */
router.get('/observability/metrics', (req, res) => {
  res.json(metrics.snapshot());
});

/**
 * Get specific metric
 */
router.get('/observability/metrics/:name', (req, res) => {
  const h = metrics.getHistogram(req.params.name);
  if (h) return res.json({ type: 'histogram', name: req.params.name, ...h });

  const c = metrics.getCounter(req.params.name);
  if (c) return res.json({ type: 'counter', name: req.params.name, value: c });

  const g = metrics.getGauge(req.params.name);
  if (g) return res.json({ type: 'gauge', name: req.params.name, value: g });

  res.status(404).json({ error: 'Metric not found' });
});

/**
 * List traces
 */
router.get('/observability/traces', (req, res) => {
  const traces = tracer.listTraces(
    parseInt(req.query.limit) || 50,
    { status: req.query.status, name: req.query.name, since: parseInt(req.query.since) || undefined }
  );
  res.json({ traces, total: traces.length });
});

/**
 * Get trace details
 */
router.get('/observability/traces/:traceId', (req, res) => {
  const trace = tracer.getTrace(req.params.traceId);
  if (!trace) return res.status(404).json({ error: 'Trace not found' });
  res.json(trace);
});

/**
 * Query logs
 */
router.get('/observability/logs', (req, res) => {
  const logs = logger.query({
    level: req.query.level,
    traceId: req.query.traceId,
    agentId: req.query.agentId,
    since: parseInt(req.query.since) || undefined,
    message: req.query.message,
  }, parseInt(req.query.limit) || 100);
  res.json({ logs, total: logs.length });
});

/**
 * Runtime health
 */
router.get('/observability/health', (req, res) => {
  const health = runtime.getHealth();
  health.identity = identity.getStats();
  health.registry = {
    commands: commandRegistry.getStats(),
    sites: siteRegistry.getStats(),
    templates: templateRegistry.getStats(),
  };
  health.executor = executor.getStats();
  health.llm = llm.getStatus();
  res.json(health);
});

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Register a command
 */
router.post('/registry/commands', (req, res) => {
  try {
    const { siteId, ...command } = req.body;
    if (!siteId) return res.status(400).json({ error: 'siteId required' });
    const entry = commandRegistry.register(siteId, command);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Search commands
 */
router.get('/registry/commands', (req, res) => {
  const results = commandRegistry.search({
    siteId: req.query.siteId,
    category: req.query.category,
    name: req.query.name,
    tag: req.query.tag,
    capability: req.query.capability,
    limit: parseInt(req.query.limit) || 50,
  });
  res.json({ commands: results, total: results.length });
});

/**
 * Register a site
 */
router.post('/registry/sites', (req, res) => {
  const { domain, ...info } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });
  const entry = siteRegistry.register(domain, info);
  res.json(entry);
});

/**
 * Search sites
 */
router.get('/registry/sites', (req, res) => {
  const results = siteRegistry.search({
    tier: req.query.tier,
    capability: req.query.capability,
    name: req.query.name,
    verified: req.query.verified === 'true' ? true : undefined,
    limit: parseInt(req.query.limit) || 50,
  });
  res.json({ sites: results, total: results.length });
});

/**
 * Get site info
 */
router.get('/registry/sites/:domain', (req, res) => {
  const site = siteRegistry.getSite(req.params.domain);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(site);
});

/**
 * Register a template
 */
router.post('/registry/templates', (req, res) => {
  try {
    const entry = templateRegistry.register(req.body);
    res.json(entry);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Search templates
 */
router.get('/registry/templates', (req, res) => {
  const results = templateRegistry.search({
    category: req.query.category,
    name: req.query.name,
    tag: req.query.tag,
    limit: parseInt(req.query.limit) || 50,
  });
  res.json({ templates: results, total: results.length });
});

/**
 * Get template
 */
router.get('/registry/templates/:templateId', (req, res) => {
  const tmpl = templateRegistry.getTemplate(req.params.templateId);
  if (!tmpl) return res.status(404).json({ error: 'Template not found' });
  templateRegistry.trackDownload(req.params.templateId);
  res.json(tmpl);
});

// ═══════════════════════════════════════════════════════════════════════════
// LLM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LLM completion
 */
router.post('/llm/complete', async (req, res) => {
  try {
    const result = await llm.complete(req.body.prompt, req.body.options || req.body);
    metrics.increment('llm.api.requests');
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * LLM models
 */
router.get('/llm/models', (req, res) => {
  res.json({ models: llm.listModels() });
});

/**
 * LLM status
 */
router.get('/llm/status', (req, res) => {
  res.json(llm.getStatus());
});

/**
 * LLM embeddings
 */
router.post('/llm/embed', async (req, res) => {
  try {
    const result = await llm.embed(req.body.text, req.body.options || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND SIGNING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sign a command
 */
router.post('/sign', (req, res) => {
  const { payload, agentId } = req.body;
  if (!payload || !agentId) return res.status(400).json({ error: 'payload and agentId required' });
  const signature = signer.sign(payload, agentId);
  res.json(signature);
});

/**
 * Verify a signed command
 */
router.post('/verify', (req, res) => {
  const { payload, agentId, nonce, timestamp, signature } = req.body;
  const result = signer.verify(payload, agentId, nonce, timestamp, signature);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════════
// EVENT STREAM (SSE)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Server-Sent Events for real-time updates
 */
router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const filter = req.query.filter; // e.g., 'task.*' or 'agent.*'

  const subId = bus.on(filter || '*', (data, meta) => {
    res.write(`event: ${meta.event || 'message'}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  });

  req.on('close', () => {
    bus.off(subId);
    res.end();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Protocol Handler Setup
// ═══════════════════════════════════════════════════════════════════════════

const protocolHandler = new protocol.ProtocolHandler();

// Wire protocol commands to runtime
protocolHandler.handle('wab.discover', async (payload) => {
  const commands = commandRegistry.search({ siteId: payload.siteId, category: payload.category });
  return {
    actions: commands.map(c => ({
      name: c.name,
      category: c.category,
      params: c.input,
      capabilities: c.capabilities,
    })),
    meta: {
      protocol: protocol.PROTOCOL_VERSION,
      timestamp: Date.now(),
    },
  };
});

protocolHandler.handle('wab.execute', async (payload, ctx) => {
  const result = await executor.execute({
    type: 'semantic',
    domain: payload.domain || 'general',
    action: payload.action,
    params: payload.params,
    agentId: ctx.message.agentId,
  });
  return result;
});

protocolHandler.handle('wab.task.submit', async (payload) => {
  return runtime.submitTask(payload);
});

protocolHandler.handle('wab.task.status', async (payload) => {
  return runtime.scheduler.getTask(payload.taskId);
});

protocolHandler.handle('wab.agent.register', async (payload) => {
  const result = identity.register(payload.name, payload.type, {
    capabilities: payload.capabilities,
    publicKey: payload.publicKey,
    metadata: payload.metadata,
  });

  // Negotiate requested capabilities
  const negotiation = protocol.negotiator.negotiate(
    result.agentId,
    payload.capabilities,
    payload.siteId || '*'
  );

  return {
    agentId: result.agentId,
    token: result.apiKey,
    grantedCapabilities: negotiation.granted,
    expiresAt: negotiation.grant?.constraints?.expiresAt || Date.now() + 3600_000,
  };
});

protocolHandler.handle('wab.ai.infer', async (payload) => {
  return llm.complete(payload.prompt, {
    model: payload.model,
    provider: payload.provider,
    ...payload.options,
  });
});

protocolHandler.handle('wab.commerce.compare', async (payload) => {
  return executor.execute({
    type: 'parallel',
    tasks: (payload.sources || []).map(url => ({
      type: 'extraction',
      params: { url, query: payload.query },
    })),
  });
});

module.exports = router;
