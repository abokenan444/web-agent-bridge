'use strict';

/**
 * WAB Protocol (WABP) - Schema Registry
 * 
 * Formal JSON Schema definitions for all WAB Protocol commands.
 * Every command in the system must be registered here with:
 *   - input/output types (JSON Schema)
 *   - required capabilities
 *   - permissions
 *   - versioning
 */

const PROTOCOL_VERSION = '1.0.0';

// ─── Primitive Type Schemas ─────────────────────────────────────────────────

const Types = {
  AgentId:    { type: 'string', pattern: '^agent_[a-zA-Z0-9_-]{4,64}$', description: 'Unique agent identifier' },
  SiteId:     { type: 'string', pattern: '^site_[a-zA-Z0-9_-]{4,64}$', description: 'Unique site identifier' },
  TaskId:     { type: 'string', pattern: '^task_[a-zA-Z0-9_-]{4,64}$', description: 'Unique task identifier' },
  TraceId:    { type: 'string', pattern: '^trace_[a-f0-9]{32}$', description: 'Distributed trace identifier' },
  SpanId:     { type: 'string', pattern: '^span_[a-f0-9]{16}$', description: 'Trace span identifier' },
  Timestamp:  { type: 'number', description: 'Unix epoch milliseconds' },
  Url:        { type: 'string', format: 'uri', description: 'Valid URL' },
  Selector:   { type: 'string', minLength: 1, maxLength: 1000, description: 'DOM selector or semantic action reference' },
  Version:    { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$', description: 'Semver version string' },
};

// ─── Capability Definitions ─────────────────────────────────────────────────

const Capabilities = {
  // Browser capabilities
  'browser.read':       { description: 'Read page content and DOM', risk: 'low' },
  'browser.click':      { description: 'Click elements', risk: 'medium' },
  'browser.fill':       { description: 'Fill form fields', risk: 'medium' },
  'browser.navigate':   { description: 'Navigate to URLs', risk: 'medium' },
  'browser.scroll':     { description: 'Scroll page', risk: 'low' },
  'browser.screenshot': { description: 'Capture screenshots', risk: 'low' },
  'browser.execute':    { description: 'Execute registered actions', risk: 'high' },

  // Data capabilities
  'data.extract':       { description: 'Extract structured data', risk: 'low' },
  'data.compare':       { description: 'Compare data across sources', risk: 'low' },
  'data.store':         { description: 'Store data persistently', risk: 'medium' },

  // Agent capabilities
  'agent.spawn':        { description: 'Create child agents', risk: 'high' },
  'agent.communicate':  { description: 'Send messages to other agents', risk: 'medium' },
  'agent.delegate':     { description: 'Delegate tasks to other agents', risk: 'high' },

  // System capabilities
  'system.api':         { description: 'Make external API calls', risk: 'high' },
  'system.webhook':     { description: 'Trigger webhooks', risk: 'high' },
  'system.schedule':    { description: 'Schedule future tasks', risk: 'medium' },

  // Commerce capabilities
  'commerce.price':     { description: 'Access pricing data', risk: 'low' },
  'commerce.negotiate': { description: 'Negotiate prices', risk: 'high' },
  'commerce.purchase':  { description: 'Execute purchases', risk: 'critical' },

  // AI capabilities
  'ai.infer':           { description: 'Run LLM inference', risk: 'medium' },
  'ai.vision':          { description: 'Visual analysis', risk: 'low' },
  'ai.embed':           { description: 'Generate embeddings', risk: 'low' },
};

// ─── Permission Levels ──────────────────────────────────────────────────────

const PermissionLevels = {
  none:     0,
  read:     1,
  write:    2,
  execute:  3,
  admin:    4,
  owner:    5,
};

// ─── Command Schema Registry ────────────────────────────────────────────────

const _commands = new Map();

/**
 * Command definition structure:
 * {
 *   name: string,
 *   version: string,
 *   description: string,
 *   category: string,
 *   capabilities: string[],
 *   permission: string,
 *   input: JSONSchema,
 *   output: JSONSchema,
 *   errors: { code: number, message: string }[],
 *   idempotent: boolean,
 *   timeout: number,  // ms, 0 = no timeout
 * }
 */

function registerCommand(def) {
  if (!def.name || !def.version) throw new Error('Command requires name and version');
  if (!def.input || !def.output) throw new Error('Command requires input/output schemas');
  const key = `${def.name}@${def.version}`;
  if (_commands.has(key)) throw new Error(`Command ${key} already registered`);

  const command = {
    name: def.name,
    version: def.version || '1.0.0',
    description: def.description || '',
    category: def.category || 'general',
    capabilities: def.capabilities || [],
    permission: def.permission || 'execute',
    input: def.input,
    output: def.output,
    errors: def.errors || [],
    idempotent: def.idempotent !== false,
    timeout: def.timeout || 30000,
    deprecated: def.deprecated || false,
    since: def.since || PROTOCOL_VERSION,
  };

  _commands.set(key, command);
  // Also register as latest
  _commands.set(def.name, command);
  return command;
}

function getCommand(name, version) {
  const key = version ? `${name}@${version}` : name;
  return _commands.get(key) || null;
}

function listCommands(category) {
  const all = [];
  for (const [key, cmd] of _commands) {
    if (key.includes('@')) continue; // skip versioned duplicates
    if (!category || cmd.category === category) all.push(cmd);
  }
  return all;
}

function validateInput(commandName, data, version) {
  const cmd = getCommand(commandName, version);
  if (!cmd) return { valid: false, errors: [{ path: '', message: `Unknown command: ${commandName}` }] };
  return _validateSchema(data, cmd.input);
}

function validateOutput(commandName, data, version) {
  const cmd = getCommand(commandName, version);
  if (!cmd) return { valid: false, errors: [{ path: '', message: `Unknown command: ${commandName}` }] };
  return _validateSchema(data, cmd.output);
}

// ─── Lightweight JSON Schema Validator ──────────────────────────────────────

function _validateSchema(data, schema, path = '') {
  const errors = [];

  if (schema.type) {
    const actualType = Array.isArray(data) ? 'array' : (data === null ? 'null' : typeof data);
    if (schema.type !== actualType) {
      errors.push({ path, message: `Expected ${schema.type}, got ${actualType}` });
      return { valid: false, errors };
    }
  }

  if (schema.type === 'object' && schema.properties) {
    if (schema.required) {
      for (const req of schema.required) {
        if (data[req] === undefined) {
          errors.push({ path: `${path}.${req}`, message: `Required field missing: ${req}` });
        }
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) {
          errors.push({ path: `${path}.${key}`, message: `Unexpected field: ${key}` });
        }
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (data[key] !== undefined) {
        const sub = _validateSchema(data[key], propSchema, `${path}.${key}`);
        errors.push(...sub.errors);
      }
    }
  }

  if (schema.type === 'array' && schema.items && Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const sub = _validateSchema(data[i], schema.items, `${path}[${i}]`);
      errors.push(...sub.errors);
    }
    if (schema.minItems && data.length < schema.minItems) {
      errors.push({ path, message: `Array must have at least ${schema.minItems} items` });
    }
    if (schema.maxItems && data.length > schema.maxItems) {
      errors.push({ path, message: `Array must have at most ${schema.maxItems} items` });
    }
  }

  if (schema.type === 'string' && typeof data === 'string') {
    if (schema.minLength && data.length < schema.minLength) {
      errors.push({ path, message: `String must be at least ${schema.minLength} characters` });
    }
    if (schema.maxLength && data.length > schema.maxLength) {
      errors.push({ path, message: `String must be at most ${schema.maxLength} characters` });
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) {
      errors.push({ path, message: `String does not match pattern: ${schema.pattern}` });
    }
    if (schema.enum && !schema.enum.includes(data)) {
      errors.push({ path, message: `Value must be one of: ${schema.enum.join(', ')}` });
    }
  }

  if (schema.type === 'number' && typeof data === 'number') {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push({ path, message: `Number must be >= ${schema.minimum}` });
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push({ path, message: `Number must be <= ${schema.maximum}` });
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Register Core Commands ─────────────────────────────────────────────────

// Discovery
registerCommand({
  name: 'wab.discover',
  version: '1.0.0',
  description: 'Discover available actions on a site',
  category: 'discovery',
  capabilities: ['browser.read'],
  permission: 'read',
  input: {
    type: 'object',
    properties: {
      url: Types.Url,
      category: { type: 'string', enum: ['navigation', 'commerce', 'form', 'content', 'all'] },
      depth: { type: 'number', minimum: 1, maximum: 5 },
    },
    required: ['url'],
  },
  output: {
    type: 'object',
    properties: {
      actions: { type: 'array', items: { type: 'object', properties: {
        name: { type: 'string' },
        category: { type: 'string' },
        selector: Types.Selector,
        params: { type: 'object' },
        capabilities: { type: 'array', items: { type: 'string' } },
      }}},
      meta: { type: 'object', properties: {
        protocol: Types.Version,
        site: { type: 'string' },
        tier: { type: 'string' },
        timestamp: Types.Timestamp,
      }},
    },
  },
  idempotent: true,
  timeout: 15000,
});

// Execute action
registerCommand({
  name: 'wab.execute',
  version: '1.0.0',
  description: 'Execute a registered action on a site',
  category: 'execution',
  capabilities: ['browser.execute'],
  permission: 'execute',
  input: {
    type: 'object',
    properties: {
      action: { type: 'string', minLength: 1 },
      params: { type: 'object' },
      traceId: Types.TraceId,
      timeout: { type: 'number', minimum: 100, maximum: 300000 },
    },
    required: ['action'],
  },
  output: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      result: {},
      duration: { type: 'number' },
      traceId: Types.TraceId,
    },
  },
  idempotent: false,
  timeout: 30000,
});

// Semantic execute (checkout.addItem instead of click(selector))
registerCommand({
  name: 'wab.semantic.execute',
  version: '1.0.0',
  description: 'Execute a semantic action (e.g., checkout.addItem) without raw DOM selectors',
  category: 'execution',
  capabilities: ['browser.execute'],
  permission: 'execute',
  input: {
    type: 'object',
    properties: {
      domain: { type: 'string', description: 'Semantic domain (checkout, search, auth, etc.)' },
      action: { type: 'string', description: 'Action within domain (addItem, submitForm, etc.)' },
      params: { type: 'object' },
      traceId: Types.TraceId,
    },
    required: ['domain', 'action'],
  },
  output: {
    type: 'object',
    properties: {
      success: { type: 'boolean' },
      result: {},
      resolvedSelector: Types.Selector,
      confidence: { type: 'number', minimum: 0, maximum: 1 },
      duration: { type: 'number' },
    },
  },
  idempotent: false,
  timeout: 30000,
});

// Agent registration
registerCommand({
  name: 'wab.agent.register',
  version: '1.0.0',
  description: 'Register an agent with the runtime',
  category: 'lifecycle',
  capabilities: [],
  permission: 'write',
  input: {
    type: 'object',
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 128 },
      type: { type: 'string', enum: ['browser', 'server', 'hybrid', 'orchestrator'] },
      capabilities: { type: 'array', items: { type: 'string' } },
      publicKey: { type: 'string', description: 'Ed25519 public key (base64)' },
      metadata: { type: 'object' },
    },
    required: ['name', 'type', 'capabilities'],
  },
  output: {
    type: 'object',
    properties: {
      agentId: Types.AgentId,
      token: { type: 'string' },
      grantedCapabilities: { type: 'array', items: { type: 'string' } },
      expiresAt: Types.Timestamp,
    },
  },
  idempotent: false,
});

// Task submission
registerCommand({
  name: 'wab.task.submit',
  version: '1.0.0',
  description: 'Submit a task to the runtime scheduler',
  category: 'runtime',
  capabilities: ['system.schedule'],
  permission: 'execute',
  input: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['browser', 'api', 'extraction', 'comparison', 'workflow', 'composite'] },
      objective: { type: 'string', minLength: 1 },
      steps: { type: 'array', items: { type: 'object', properties: {
        command: { type: 'string' },
        params: { type: 'object' },
        dependsOn: { type: 'array', items: { type: 'string' } },
        retries: { type: 'number', minimum: 0, maximum: 10 },
        timeout: { type: 'number' },
      }, required: ['command'] }},
      priority: { type: 'number', minimum: 0, maximum: 100 },
      deadline: Types.Timestamp,
      agentId: Types.AgentId,
    },
    required: ['type', 'objective'],
  },
  output: {
    type: 'object',
    properties: {
      taskId: Types.TaskId,
      status: { type: 'string', enum: ['queued', 'scheduled', 'running'] },
      estimatedStart: Types.Timestamp,
    },
  },
  idempotent: false,
});

// Task status
registerCommand({
  name: 'wab.task.status',
  version: '1.0.0',
  description: 'Get task execution status',
  category: 'runtime',
  capabilities: [],
  permission: 'read',
  input: {
    type: 'object',
    properties: {
      taskId: Types.TaskId,
    },
    required: ['taskId'],
  },
  output: {
    type: 'object',
    properties: {
      taskId: Types.TaskId,
      status: { type: 'string', enum: ['queued', 'scheduled', 'running', 'paused', 'completed', 'failed', 'cancelled'] },
      progress: { type: 'number', minimum: 0, maximum: 100 },
      currentStep: { type: 'number' },
      totalSteps: { type: 'number' },
      result: {},
      error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } },
      startedAt: Types.Timestamp,
      completedAt: Types.Timestamp,
      checkpoints: { type: 'array', items: { type: 'object' } },
    },
  },
  idempotent: true,
});

// Price comparison (semantic)
registerCommand({
  name: 'wab.commerce.compare',
  version: '1.0.0',
  description: 'Compare prices across sources with fairness scoring',
  category: 'commerce',
  capabilities: ['commerce.price', 'data.compare'],
  permission: 'read',
  input: {
    type: 'object',
    properties: {
      query: { type: 'string', minLength: 1 },
      category: { type: 'string' },
      sources: { type: 'array', items: Types.Url },
      fairnessWeight: { type: 'number', minimum: 0, maximum: 1 },
    },
    required: ['query'],
  },
  output: {
    type: 'object',
    properties: {
      results: { type: 'array', items: { type: 'object', properties: {
        source: { type: 'string' },
        price: { type: 'number' },
        currency: { type: 'string' },
        fairnessScore: { type: 'number' },
        hasDecepitvePatterns: { type: 'boolean' },
      }}},
      bestDeal: { type: 'object' },
      comparison: { type: 'object' },
    },
  },
  idempotent: true,
  timeout: 60000,
});

// Negotiate
registerCommand({
  name: 'wab.commerce.negotiate',
  version: '1.0.0',
  description: 'Open or continue a price negotiation session',
  category: 'commerce',
  capabilities: ['commerce.negotiate'],
  permission: 'execute',
  input: {
    type: 'object',
    properties: {
      siteId: Types.SiteId,
      productId: { type: 'string' },
      proposal: { type: 'object', properties: {
        type: { type: 'string', enum: ['discount', 'bundle', 'loyalty', 'counter'] },
        amount: { type: 'number' },
        justification: { type: 'string' },
      }, required: ['type', 'amount'] },
      sessionId: { type: 'string' },
    },
    required: ['siteId', 'proposal'],
  },
  output: {
    type: 'object',
    properties: {
      sessionId: { type: 'string' },
      status: { type: 'string', enum: ['pending', 'accepted', 'rejected', 'counter'] },
      counterOffer: { type: 'object' },
      finalPrice: { type: 'number' },
    },
  },
  idempotent: false,
});

// Agent mesh message
registerCommand({
  name: 'wab.mesh.send',
  version: '1.0.0',
  description: 'Send a message through the agent mesh',
  category: 'communication',
  capabilities: ['agent.communicate'],
  permission: 'write',
  input: {
    type: 'object',
    properties: {
      channel: { type: 'string' },
      topic: { type: 'string' },
      payload: {},
      targetAgent: Types.AgentId,
      broadcast: { type: 'boolean' },
    },
    required: ['channel', 'topic', 'payload'],
  },
  output: {
    type: 'object',
    properties: {
      messageId: { type: 'string' },
      delivered: { type: 'number' },
      timestamp: Types.Timestamp,
    },
  },
});

// LLM Inference
registerCommand({
  name: 'wab.ai.infer',
  version: '1.0.0',
  description: 'Run LLM inference through the model abstraction layer',
  category: 'ai',
  capabilities: ['ai.infer'],
  permission: 'execute',
  input: {
    type: 'object',
    properties: {
      prompt: { type: 'string', minLength: 1 },
      model: { type: 'string' },
      provider: { type: 'string', enum: ['openai', 'anthropic', 'ollama', 'custom'] },
      options: { type: 'object', properties: {
        temperature: { type: 'number', minimum: 0, maximum: 2 },
        maxTokens: { type: 'number', minimum: 1, maximum: 128000 },
        systemPrompt: { type: 'string' },
      }},
    },
    required: ['prompt'],
  },
  output: {
    type: 'object',
    properties: {
      text: { type: 'string' },
      model: { type: 'string' },
      provider: { type: 'string' },
      usage: { type: 'object', properties: {
        promptTokens: { type: 'number' },
        completionTokens: { type: 'number' },
        totalTokens: { type: 'number' },
      }},
      duration: { type: 'number' },
    },
  },
  timeout: 120000,
});

module.exports = {
  PROTOCOL_VERSION,
  Types,
  Capabilities,
  PermissionLevels,
  registerCommand,
  getCommand,
  listCommands,
  validateInput,
  validateOutput,
};
