'use strict';

/**
 * WAB Adapter Layer
 *
 * Makes WAP the top-level protocol with MCP, REST, and Browser as transport paths.
 * MCP becomes just ONE adapter among many — not the primary interface.
 *
 * Architecture:
 *   WAP (Web Agent Protocol)
 *     ├── MCP Adapter    → Expose WAB as MCP tools for Claude/GPT/etc.
 *     ├── REST Adapter   → Translate REST/GraphQL APIs into WAP commands
 *     └── Browser Adapter → Convert DOM automation into semantic actions
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const { metrics } = require('../observability');

// ─── Base Adapter ───────────────────────────────────────────────────────────

class BaseAdapter {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this._stats = { requests: 0, successes: 0, failures: 0 };
  }

  /**
   * Convert external format → WAP command
   */
  toWAP(externalMessage) {
    throw new Error(`${this.name}: toWAP() not implemented`);
  }

  /**
   * Convert WAP result → external format
   */
  fromWAP(wapResult) {
    throw new Error(`${this.name}: fromWAP() not implemented`);
  }

  /**
   * List capabilities this adapter supports
   */
  capabilities() {
    return [];
  }

  getStats() {
    return { adapter: this.name, ...this._stats };
  }
}

// ─── MCP Adapter ────────────────────────────────────────────────────────────

/**
 * Translates between MCP tool calls and WAP commands.
 * Makes WAB actions available as MCP tools for Claude, GPT, Gemini.
 */
class MCPAdapter extends BaseAdapter {
  constructor(config = {}) {
    super('mcp', config);
    this._toolMappings = new Map(); // mcpToolName → wapCommand
  }

  /**
   * Convert WAP commands registry into MCP tool definitions
   */
  exportAsTools(commands) {
    return commands.map(cmd => ({
      name: cmd.name.replace(/\./g, '_'),
      description: cmd.description,
      input_schema: {
        type: 'object',
        properties: cmd.input?.properties || {},
        required: cmd.input?.required || [],
      },
    }));
  }

  /**
   * Convert MCP tool_use message → WAP request
   */
  toWAP(mcpMessage) {
    this._stats.requests++;
    const toolName = mcpMessage.name || mcpMessage.tool;
    const wapCommand = toolName.replace(/_/g, '.');

    return {
      command: wapCommand,
      payload: mcpMessage.arguments || mcpMessage.input || {},
      metadata: {
        source: 'mcp',
        originalTool: toolName,
        mcpVersion: mcpMessage.version || '2024-11-05',
      },
    };
  }

  /**
   * Convert WAP result → MCP tool_result
   */
  fromWAP(wapResult) {
    if (wapResult.error) {
      this._stats.failures++;
      return {
        type: 'tool_result',
        is_error: true,
        content: [{ type: 'text', text: wapResult.error }],
      };
    }
    this._stats.successes++;
    return {
      type: 'tool_result',
      content: [{ type: 'text', text: JSON.stringify(wapResult.data || wapResult, null, 2) }],
    };
  }

  /**
   * Handle MCP list_tools request
   */
  handleListTools(commands) {
    return {
      tools: this.exportAsTools(commands),
    };
  }

  /**
   * Handle MCP call_tool request
   */
  async handleCallTool(request, executor) {
    const wapReq = this.toWAP(request);
    try {
      const result = await executor(wapReq);
      return this.fromWAP(result);
    } catch (err) {
      return this.fromWAP({ error: err.message });
    }
  }

  capabilities() {
    return ['mcp.list_tools', 'mcp.call_tool', 'mcp.resources'];
  }
}

// ─── REST Adapter ───────────────────────────────────────────────────────────

/**
 * Translates REST/GraphQL API calls into WAP commands.
 * Enables WAP agents to interact with any API.
 */
class RESTAdapter extends BaseAdapter {
  constructor(config = {}) {
    super('rest', config);
    this._endpoints = new Map();   // endpointId → { url, method, headers, mapping }
  }

  /**
   * Register an API endpoint as a WAP-accessible resource
   */
  registerEndpoint(id, config) {
    const endpoint = {
      id,
      url: config.url,
      method: (config.method || 'GET').toUpperCase(),
      headers: config.headers || {},
      auth: config.auth || null,   // { type: 'bearer', token } or { type: 'api_key', key, header }
      mapping: {
        request: config.requestMapping || null,  // fn(wapParams) → fetchBody
        response: config.responseMapping || null, // fn(apiResponse) → wapResult
      },
      rateLimit: config.rateLimit || null,
      timeout: config.timeout || 30000,
      registeredAt: Date.now(),
    };
    this._endpoints.set(id, endpoint);
    return endpoint;
  }

  /**
   * Convert WAP command → REST API call params
   */
  toWAP(restResponse, endpointId) {
    this._stats.requests++;
    const endpoint = this._endpoints.get(endpointId);
    if (endpoint?.mapping.response) {
      return endpoint.mapping.response(restResponse);
    }
    return { data: restResponse, source: 'rest', endpointId };
  }

  /**
   * Convert WAP params → REST request config
   */
  fromWAP(wapCommand) {
    const endpointId = wapCommand.endpoint || wapCommand.payload?.endpoint;
    const endpoint = this._endpoints.get(endpointId);
    if (!endpoint) return null;

    let body = wapCommand.payload;
    if (endpoint.mapping.request) {
      body = endpoint.mapping.request(wapCommand.payload);
    }

    const headers = { ...endpoint.headers };
    if (endpoint.auth) {
      if (endpoint.auth.type === 'bearer') {
        headers['Authorization'] = `Bearer ${endpoint.auth.token}`;
      } else if (endpoint.auth.type === 'api_key') {
        headers[endpoint.auth.header || 'X-API-Key'] = endpoint.auth.key;
      }
    }

    return {
      url: endpoint.url,
      method: endpoint.method,
      headers,
      body: endpoint.method !== 'GET' ? JSON.stringify(body) : undefined,
      timeout: endpoint.timeout,
    };
  }

  /**
   * Execute a REST call through the adapter
   */
  async execute(endpointId, params = {}) {
    const endpoint = this._endpoints.get(endpointId);
    if (!endpoint) throw new Error(`REST endpoint '${endpointId}' not registered`);

    const fetchConfig = this.fromWAP({ endpoint: endpointId, payload: params });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), fetchConfig.timeout);

    try {
      const response = await fetch(fetchConfig.url, {
        method: fetchConfig.method,
        headers: { 'Content-Type': 'application/json', ...fetchConfig.headers },
        body: fetchConfig.body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      const data = await response.json().catch(() => ({ status: response.status }));
      this._stats.successes++;
      return this.toWAP(data, endpointId);
    } catch (err) {
      clearTimeout(timer);
      this._stats.failures++;
      throw err;
    }
  }

  listEndpoints() {
    return Array.from(this._endpoints.values()).map(e => ({
      id: e.id, url: e.url, method: e.method,
    }));
  }

  capabilities() {
    return ['rest.get', 'rest.post', 'rest.put', 'rest.delete', 'rest.graphql'];
  }
}

// ─── Browser Adapter ────────────────────────────────────────────────────────

/**
 * Translates semantic actions into browser automation commands.
 * Abstracts DOM interaction behind domain-level actions.
 */
class BrowserAdapter extends BaseAdapter {
  constructor(config = {}) {
    super('browser', config);
    this._semanticMap = new Map();   // "domain.action" → browser execution plan
    this._sessions = new Map();      // sessionId → session state
    this._defaultStrategies();
  }

  /**
   * Register built-in semantic → browser mappings
   */
  _defaultStrategies() {
    // Checkout flow
    this._semanticMap.set('checkout.addItem', {
      steps: [
        { action: 'click', selector: '[data-action="add-to-cart"], .add-to-cart, #add-to-cart-btn, button[name="add"]' },
      ],
      fallback: 'form_submit',
      verify: { selector: '.cart-count, .cart-badge, .cart-items', expect: 'increment' },
    });

    this._semanticMap.set('checkout.viewCart', {
      steps: [
        { action: 'navigate', path: '/cart' },
      ],
      fallback: 'click:.cart-icon, a[href*="cart"]',
    });

    this._semanticMap.set('checkout.complete', {
      steps: [
        { action: 'click', selector: '.checkout-btn, #checkout, button[name="checkout"]' },
      ],
      requires: ['commerce.purchase'],
    });

    // Search
    this._semanticMap.set('search.query', {
      steps: [
        { action: 'fill', selector: 'input[type="search"], input[name="q"], .search-input', value: '{{query}}' },
        { action: 'submit', selector: 'form[role="search"], .search-form' },
      ],
      fallback: 'keyboard_enter',
    });

    // Auth
    this._semanticMap.set('auth.login', {
      steps: [
        { action: 'fill', selector: 'input[type="email"], input[name="email"], #email', value: '{{email}}' },
        { action: 'fill', selector: 'input[type="password"], input[name="password"], #password', value: '{{password}}' },
        { action: 'click', selector: 'button[type="submit"], .login-btn, #login-btn' },
      ],
      verify: { selector: '.user-menu, .account, .logout', expect: 'visible' },
    });

    // Navigation
    this._semanticMap.set('navigation.goto', {
      steps: [
        { action: 'navigate', path: '{{url}}' },
      ],
    });

    this._semanticMap.set('navigation.back', {
      steps: [
        { action: 'browser_back' },
      ],
    });

    // Content
    this._semanticMap.set('content.read', {
      steps: [
        { action: 'extract', selector: '{{selector}}', type: 'text' },
      ],
    });

    this._semanticMap.set('content.screenshot', {
      steps: [
        { action: 'screenshot', fullPage: true },
      ],
    });
  }

  /**
   * Convert semantic action → browser execution plan
   */
  toWAP(browserResult) {
    this._stats.requests++;
    this._stats.successes++;
    return {
      data: browserResult,
      source: 'browser',
    };
  }

  /**
   * Convert WAP semantic command → browser steps
   */
  fromWAP(wapCommand) {
    const key = `${wapCommand.domain}.${wapCommand.action}`;
    const plan = this._semanticMap.get(key);
    if (!plan) return null;

    // Template substitution
    const steps = plan.steps.map(step => {
      const resolved = { ...step };
      for (const [k, v] of Object.entries(resolved)) {
        if (typeof v === 'string' && v.includes('{{')) {
          resolved[k] = v.replace(/\{\{(\w+)\}\}/g, (_, param) =>
            wapCommand.params?.[param] || ''
          );
        }
      }
      return resolved;
    });

    return {
      steps,
      fallback: plan.fallback || null,
      verify: plan.verify || null,
      requires: plan.requires || [],
    };
  }

  /**
   * Register a custom semantic mapping
   */
  registerMapping(domainAction, plan) {
    this._semanticMap.set(domainAction, plan);
  }

  /**
   * Create a browser session
   */
  createSession(config = {}) {
    const sessionId = `bsess_${crypto.randomBytes(12).toString('hex')}`;
    this._sessions.set(sessionId, {
      id: sessionId,
      cookies: config.cookies || [],
      localStorage: config.localStorage || {},
      userAgent: config.userAgent || null,
      viewport: config.viewport || { width: 1920, height: 1080 },
      createdAt: Date.now(),
      history: [],
      state: 'active',
    });
    return sessionId;
  }

  /**
   * Get session
   */
  getSession(sessionId) {
    return this._sessions.get(sessionId) || null;
  }

  /**
   * Record a step in session history (for replay)
   */
  recordStep(sessionId, step) {
    const session = this._sessions.get(sessionId);
    if (session) {
      session.history.push({
        ...step,
        timestamp: Date.now(),
        index: session.history.length,
      });
    }
  }

  /**
   * Get steps for replay
   */
  getReplaySteps(sessionId) {
    const session = this._sessions.get(sessionId);
    return session ? [...session.history] : [];
  }

  /**
   * List semantic actions
   */
  listMappings() {
    const mappings = [];
    for (const [key, plan] of this._semanticMap) {
      const [domain, action] = key.split('.');
      mappings.push({ domain, action, steps: plan.steps.length, requires: plan.requires || [] });
    }
    return mappings;
  }

  capabilities() {
    return ['browser.semantic', 'browser.session', 'browser.replay', 'browser.screenshot'];
  }
}

// ─── Adapter Manager ────────────────────────────────────────────────────────

class AdapterManager {
  constructor() {
    this._adapters = new Map();
  }

  register(adapter) {
    this._adapters.set(adapter.name, adapter);
    bus.emit('adapter.registered', { name: adapter.name, capabilities: adapter.capabilities() });
    metrics.increment('adapters.registered');
  }

  get(name) {
    return this._adapters.get(name) || null;
  }

  list() {
    return Array.from(this._adapters.values()).map(a => ({
      name: a.name,
      capabilities: a.capabilities(),
      stats: a.getStats(),
    }));
  }

  getStats() {
    const stats = {};
    for (const [name, adapter] of this._adapters) {
      stats[name] = adapter.getStats();
    }
    return stats;
  }
}

// ─── Singletons ─────────────────────────────────────────────────────────────

const adapterManager = new AdapterManager();
const mcpAdapter = new MCPAdapter();
const restAdapter = new RESTAdapter();
const browserAdapter = new BrowserAdapter();

adapterManager.register(mcpAdapter);
adapterManager.register(restAdapter);
adapterManager.register(browserAdapter);

module.exports = {
  BaseAdapter,
  MCPAdapter,
  RESTAdapter,
  BrowserAdapter,
  AdapterManager,
  adapterManager,
  mcpAdapter,
  restAdapter,
  browserAdapter,
};
