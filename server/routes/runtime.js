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
const { failureAnalyzer } = require('../observability/failure-analysis');
const { identity, signer, isolation } = require('../security');
const { agentManager, policyEngine } = require('../control-plane');
const { executor } = require('../data-plane');
const { llm } = require('../llm');
const { commandRegistry, siteRegistry, templateRegistry } = require('../registry');
const { certificationEngine } = require('../registry/certification');
const { adapterManager, mcpAdapter, restAdapter, browserAdapter } = require('../adapters');
const { replayEngine } = require('../runtime/replay');
const { featureGate, usageLimit } = require('../middleware/featureGate');
const { listPlans, getPlan, USAGE_PRICING, MARKETPLACE } = require('../config/plans');
const metering = require('../services/metering');
const { marketplace } = require('../services/marketplace');
const { hostedRuntime } = require('../services/hosted-runtime');
const { sessionEngine } = require('../runtime/session-engine');

// ═══════════════════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Authenticate requests via API key or session token.
 * Public endpoints (protocol info, agent registration, health) bypass auth.
 */
const PUBLIC_PATHS = [
  '/protocol',
  '/agents/register',
  '/agents/authenticate',
  '/observability/health',
  '/llm/models',
  '/llm/status',
  '/registry/commands',
  '/registry/sites',
  '/registry/templates',
  '/plans',
  '/marketplace',
];

function authMiddleware(req, res, next) {
  // Allow public GET endpoints
  const matchesPublic = PUBLIC_PATHS.some(p =>
    req.path === p || (req.method === 'GET' && req.path.startsWith(p))
  );
  if (matchesPublic) return next();

  // Check session token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const session = identity.validateSession(token);
    if (session) {
      req.agentId = session.agentId;
      req.session = session;
      return next();
    }
  }

  // Check API key
  const apiKey = req.headers['x-wab-key'];
  if (apiKey) {
    const ip = req.ip || req.connection?.remoteAddress;
    const session = identity.authenticate(apiKey, ip);
    if (session) {
      req.agentId = session.agentId;
      req.session = session;
      return next();
    }
  }

  // Check agent ID header (for internal/trusted calls)
  const agentHeader = req.headers['x-wab-agent'];
  if (agentHeader) {
    const agent = identity.getAgent(agentHeader);
    if (agent && agent.status === 'active') {
      req.agentId = agentHeader;
      return next();
    }
  }

  // No auth on non-mutation GET requests (read-only)
  if (req.method === 'GET') return next();

  metrics.increment('auth.rejected');
  return res.status(401).json({ error: 'Authentication required. Provide X-WAB-Key or Authorization: Bearer <token>' });
}

router.use(authMiddleware);
router.use(featureGate);

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
router.post('/tasks', usageLimit('tasksPerDay'), (req, res) => {
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
router.post('/execute', usageLimit('executionsPerDay'), async (req, res) => {
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
  health.adapters = adapterManager.getStats();
  health.replay = replayEngine.getStats();
  health.sessions = sessionEngine.getStats();
  health.failures = failureAnalyzer.getStats();
  health.certification = certificationEngine.getStats();
  health.marketplace = marketplace.getStats();
  health.hostedRuntime = hostedRuntime.getStats();
  health.metering = metering.getStats();
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
router.post('/llm/complete', usageLimit('executionsPerDay'), async (req, res) => {
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

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List adapters
 */
router.get('/adapters', (req, res) => {
  res.json({ adapters: adapterManager.list() });
});

/**
 * Adapter stats
 */
router.get('/adapters/stats', (req, res) => {
  res.json(adapterManager.getStats());
});

/**
 * MCP: list tools
 */
router.get('/adapters/mcp/tools', (req, res) => {
  const commands = protocol.schema.listCommands();
  res.json(mcpAdapter.handleListTools(commands));
});

/**
 * MCP: call tool
 */
router.post('/adapters/mcp/call', async (req, res) => {
  try {
    const result = await mcpAdapter.handleCallTool(req.body, async (wapReq) => {
      const request = protocol.createRequest(wapReq.command, wapReq.payload);
      return protocolHandler.process(request);
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * REST adapter: register endpoint
 */
router.post('/adapters/rest/endpoints', (req, res) => {
  try {
    const endpoint = restAdapter.registerEndpoint(req.body.id, req.body);
    res.json(endpoint);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * REST adapter: list endpoints
 */
router.get('/adapters/rest/endpoints', (req, res) => {
  res.json({ endpoints: restAdapter.listEndpoints() });
});

/**
 * REST adapter: execute
 */
router.post('/adapters/rest/execute', async (req, res) => {
  try {
    const result = await restAdapter.execute(req.body.endpoint, req.body.params);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Browser adapter: list semantic mappings
 */
router.get('/adapters/browser/mappings', (req, res) => {
  res.json({ mappings: browserAdapter.listMappings() });
});

/**
 * Browser adapter: resolve semantic action
 */
router.post('/adapters/browser/resolve', (req, res) => {
  const { domain, action, params } = req.body;
  const plan = browserAdapter.fromWAP({ domain, action, params });
  if (!plan) return res.status(404).json({ error: 'No mapping for this semantic action' });
  res.json(plan);
});

/**
 * Browser adapter: register mapping
 */
router.post('/adapters/browser/mappings', (req, res) => {
  const { domainAction, plan } = req.body;
  if (!domainAction || !plan) return res.status(400).json({ error: 'domainAction and plan required' });
  browserAdapter.registerMapping(domainAction, plan);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPLAY ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List recordings
 */
router.get('/replay/recordings', (req, res) => {
  res.json({ recordings: replayEngine.listRecordings(parseInt(req.query.limit) || 50) });
});

/**
 * Get recording
 */
router.get('/replay/recordings/:taskId', (req, res) => {
  const rec = replayEngine.getRecording(req.params.taskId);
  if (!rec) return res.status(404).json({ error: 'Recording not found' });
  res.json(rec);
});

/**
 * Replay a task
 */
router.post('/replay/:taskId', async (req, res) => {
  try {
    const result = await replayEngine.replay(req.params.taskId, {
      verify: req.body.verify !== false,
      continueOnMismatch: !!req.body.continueOnMismatch,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Diff two recordings
 */
router.get('/replay/diff/:taskId1/:taskId2', (req, res) => {
  const diff = replayEngine.diff(req.params.taskId1, req.params.taskId2);
  if (!diff) return res.status(404).json({ error: 'One or both recordings not found' });
  res.json(diff);
});

/**
 * Replay stats
 */
router.get('/replay/stats', (req, res) => {
  res.json(replayEngine.getStats());
});

// ═══════════════════════════════════════════════════════════════════════════
// SESSION ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create browser session
 */
router.post('/sessions', (req, res) => {
  const session = sessionEngine.create(req.body);
  res.json(session);
});

/**
 * List sessions
 */
router.get('/sessions', (req, res) => {
  const sessions = sessionEngine.list({
    agentId: req.query.agentId,
    siteId: req.query.siteId,
    state: req.query.state,
  }, parseInt(req.query.limit) || 50);
  res.json({ sessions, total: sessions.length });
});

/**
 * Get session
 */
router.get('/sessions/:sessionId', (req, res) => {
  const session = sessionEngine.get(req.params.sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found or expired' });
  res.json(session);
});

/**
 * Export session
 */
router.get('/sessions/:sessionId/export', (req, res) => {
  const data = sessionEngine.export(req.params.sessionId);
  if (!data) return res.status(404).json({ error: 'Session not found' });
  res.json(data);
});

/**
 * Import session
 */
router.post('/sessions/import', (req, res) => {
  const session = sessionEngine.import(req.body);
  res.json(session);
});

/**
 * Set cookies
 */
router.post('/sessions/:sessionId/cookies', (req, res) => {
  sessionEngine.setCookies(req.params.sessionId, req.body.cookies || []);
  res.json({ success: true });
});

/**
 * Get cookies
 */
router.get('/sessions/:sessionId/cookies', (req, res) => {
  const cookies = sessionEngine.getCookies(req.params.sessionId, req.query.domain);
  res.json({ cookies });
});

/**
 * Set storage
 */
router.post('/sessions/:sessionId/storage', (req, res) => {
  const { key, value, type } = req.body;
  sessionEngine.setStorage(req.params.sessionId, key, value, type);
  res.json({ success: true });
});

/**
 * Destroy session
 */
router.delete('/sessions/:sessionId', (req, res) => {
  sessionEngine.destroy(req.params.sessionId);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// FAILURE ANALYSIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Query failures
 */
router.get('/failures', (req, res) => {
  const failures = failureAnalyzer.query({
    classification: req.query.classification,
    severity: req.query.severity,
    agentId: req.query.agentId,
    taskId: req.query.taskId,
    retryable: req.query.retryable === 'true' ? true : req.query.retryable === 'false' ? false : undefined,
    since: parseInt(req.query.since) || undefined,
  }, parseInt(req.query.limit) || 50);
  res.json({ failures, total: failures.length });
});

/**
 * Get failure
 */
router.get('/failures/:failureId', (req, res) => {
  const failure = failureAnalyzer.getFailure(req.params.failureId);
  if (!failure) return res.status(404).json({ error: 'Failure not found' });
  res.json(failure);
});

/**
 * Get failure patterns
 */
router.get('/failures/analysis/patterns', (req, res) => {
  res.json({ patterns: failureAnalyzer.getPatterns() });
});

/**
 * Get failure summary
 */
router.get('/failures/analysis/summary', (req, res) => {
  res.json(failureAnalyzer.getSummary(parseInt(req.query.since) || 0));
});

/**
 * Classify a failure manually
 */
router.post('/failures/classify', (req, res) => {
  const { error, context } = req.body;
  if (!error) return res.status(400).json({ error: 'error object required' });
  const classification = failureAnalyzer.classify(error, context || {});
  res.json(classification);
});

// ═══════════════════════════════════════════════════════════════════════════
// CERTIFICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verify a site
 */
router.post('/certification/verify', async (req, res) => {
  try {
    const { domain, probeData } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain required' });
    const result = await certificationEngine.verify(domain, probeData || {});
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Get certificate
 */
router.get('/certification/:domain', (req, res) => {
  const cert = certificationEngine.getCertificate(req.params.domain);
  if (!cert) return res.status(404).json({ error: 'No active certificate for this domain' });
  res.json(cert);
});

/**
 * List certificates
 */
router.get('/certification', (req, res) => {
  const certs = certificationEngine.listCertificates({
    level: req.query.level,
    minScore: parseInt(req.query.minScore) || undefined,
  }, parseInt(req.query.limit) || 50);
  res.json({ certificates: certs, total: certs.length });
});

/**
 * Revoke certificate
 */
router.delete('/certification/:domain', (req, res) => {
  certificationEngine.revoke(req.params.domain);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// PLANS & PRICING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * List available plans
 */
router.get('/plans', (req, res) => {
  const plans = listPlans().map(p => ({
    id: p.id,
    name: p.name,
    price: p.price,
    interval: p.interval,
    description: p.description,
    limits: p.limits,
    features: Object.entries(p.features)
      .filter(([, v]) => v === true)
      .map(([k]) => k),
  }));
  res.json({ plans, usagePricing: USAGE_PRICING });
});

/**
 * Get specific plan details
 */
router.get('/plans/:planId', (req, res) => {
  const plan = getPlan(req.params.planId);
  if (!plan || plan.id === 'free' && req.params.planId !== 'free') {
    return res.status(404).json({ error: 'Plan not found' });
  }
  res.json(plan);
});

// ═══════════════════════════════════════════════════════════════════════════
// USAGE METERING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get usage for current agent
 */
router.get('/usage', (req, res) => {
  const entityId = req.agentId || req.ip;
  const tier = req.agentTier || req.session?.tier || 'free';
  res.json(metering.getUsage(entityId, tier));
});

/**
 * Get billing summary (overages)
 */
router.get('/usage/billing', (req, res) => {
  const entityId = req.agentId || req.ip;
  res.json(metering.getBillingSummary(entityId));
});

/**
 * Get metering stats (admin)
 */
router.get('/usage/stats', (req, res) => {
  res.json(metering.getStats());
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Search marketplace
 */
router.get('/marketplace', (req, res) => {
  const listings = marketplace.search({
    type: req.query.type,
    category: req.query.category,
    query: req.query.q,
    tag: req.query.tag,
    free: req.query.free === 'true',
    paid: req.query.paid === 'true',
    minRating: req.query.minRating ? parseFloat(req.query.minRating) : undefined,
    sortBy: req.query.sortBy,
  }, parseInt(req.query.limit) || 50);
  res.json({ listings, total: listings.length });
});

/**
 * Get listing
 */
router.get('/marketplace/:listingId', (req, res) => {
  const listing = marketplace.getListing(req.params.listingId);
  if (!listing) return res.status(404).json({ error: 'Listing not found' });
  res.json(listing);
});

/**
 * Get reviews
 */
router.get('/marketplace/:listingId/reviews', (req, res) => {
  res.json({ reviews: marketplace.getReviews(req.params.listingId) });
});

/**
 * Publish listing
 */
router.post('/marketplace/publish', (req, res) => {
  try {
    const listing = marketplace.publish({
      ...req.body,
      sellerId: req.agentId || req.body.sellerId,
    });
    res.json(listing);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Purchase/install listing
 */
router.post('/marketplace/:listingId/purchase', (req, res) => {
  try {
    const buyerId = req.agentId || req.body.buyerId;
    if (!buyerId) return res.status(400).json({ error: 'buyerId required' });
    const purchase = marketplace.purchase(req.params.listingId, buyerId);
    res.json(purchase);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Add review
 */
router.post('/marketplace/:listingId/review', (req, res) => {
  try {
    const review = marketplace.addReview(req.params.listingId, {
      userId: req.agentId || req.body.userId,
      rating: req.body.rating,
      comment: req.body.comment,
    });
    res.json(review);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Get my purchases
 */
router.get('/marketplace/my/purchases', (req, res) => {
  const buyerId = req.agentId || req.query.buyerId;
  res.json({ purchases: marketplace.getPurchases(buyerId) });
});

/**
 * Get seller earnings
 */
router.get('/marketplace/my/earnings', (req, res) => {
  const sellerId = req.agentId || req.query.sellerId;
  res.json(marketplace.getEarnings(sellerId));
});

/**
 * Admin: pending listings
 */
router.get('/marketplace/admin/pending', (req, res) => {
  res.json({ listings: marketplace.getPendingListings() });
});

/**
 * Admin: approve listing
 */
router.post('/marketplace/admin/:listingId/approve', (req, res) => {
  try {
    const listing = marketplace.approve(req.params.listingId);
    res.json(listing);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Admin: reject listing
 */
router.post('/marketplace/admin/:listingId/reject', (req, res) => {
  try {
    const listing = marketplace.reject(req.params.listingId, req.body.reason);
    res.json(listing);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Marketplace stats
 */
router.get('/marketplace/stats', (req, res) => {
  res.json(marketplace.getStats());
});

// ═══════════════════════════════════════════════════════════════════════════
// HOSTED RUNTIME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Launch hosted instance
 */
router.post('/hosted/launch', (req, res) => {
  try {
    const instance = hostedRuntime.launch({
      agentId: req.agentId || req.body.agentId,
      tier: req.agentTier || req.session?.tier || 'starter',
      region: req.body.region,
      cpu: req.body.cpu,
      memory: req.body.memory,
      timeout: req.body.timeout,
    });
    res.json(instance);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Execute on hosted instance
 */
router.post('/hosted/:instanceId/execute', async (req, res) => {
  try {
    const execution = await hostedRuntime.execute(req.params.instanceId, req.body);
    res.json(execution);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Complete execution
 */
router.post('/hosted/executions/:executionId/complete', (req, res) => {
  const execution = hostedRuntime.completeExecution(
    req.params.executionId,
    req.body.result,
    req.body.error ? new Error(req.body.error) : null
  );
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json(execution);
});

/**
 * Stop hosted instance
 */
router.post('/hosted/:instanceId/stop', (req, res) => {
  const success = hostedRuntime.stop(req.params.instanceId);
  res.json({ success });
});

/**
 * Get hosted instance
 */
router.get('/hosted/:instanceId', (req, res) => {
  const instance = hostedRuntime.getInstance(req.params.instanceId);
  if (!instance) return res.status(404).json({ error: 'Instance not found' });
  res.json(instance);
});

/**
 * List instances
 */
router.get('/hosted', (req, res) => {
  const instances = hostedRuntime.listInstances({
    agentId: req.query.agentId,
    status: req.query.status,
    region: req.query.region,
  }, parseInt(req.query.limit) || 50);
  res.json({ instances, total: instances.length });
});

/**
 * List executions for instance
 */
router.get('/hosted/:instanceId/executions', (req, res) => {
  const executions = hostedRuntime.listExecutions(
    req.params.instanceId,
    parseInt(req.query.limit) || 50
  );
  res.json({ executions, total: executions.length });
});

/**
 * Get compute usage
 */
router.get('/hosted/usage/:agentId', (req, res) => {
  res.json(hostedRuntime.getComputeUsage(req.params.agentId));
});

/**
 * Hosted runtime stats
 */
router.get('/hosted/stats', (req, res) => {
  res.json(hostedRuntime.getStats());
});

module.exports = router;
