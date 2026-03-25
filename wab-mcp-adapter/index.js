/**
 * WAB-MCP Adapter
 *
 * Converts Web Agent Bridge (WAB) capabilities into Model Context Protocol
 * (MCP) tools so any MCP-compatible AI agent can interact with WAB-enabled
 * websites through a uniform tool interface.
 *
 * @module wab-mcp-adapter
 */

'use strict';

const DISCOVERY_PATHS = ['/agent-bridge.json', '/.well-known/wab.json'];
const DEFAULT_REGISTRY = 'https://registry.webagentbridge.com';
const DEFAULT_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal fetch wrapper with timeout and error normalisation.
 * Uses the global `fetch` available in Node 18+.
 *
 * @param {string}  url
 * @param {object}  [opts]         - Standard fetch options
 * @param {number}  [timeoutMs]    - Per-request timeout
 * @returns {Promise<object>}      - Parsed JSON body
 */
async function jsonFetch(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} from ${url}: ${body}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Build a fully-qualified URL, tolerating trailing slashes. */
function resolveUrl(base, path) {
  return new URL(path, base.replace(/\/+$/, '') + '/').href;
}

/**
 * Convert a single WAB action descriptor into an MCP tool definition.
 *
 * @param {object} action
 * @returns {object} MCP tool
 */
function actionToTool(action) {
  const properties = {};
  const required = [];

  const fields = action.params || action.fields || [];
  for (const f of fields) {
    properties[f.name] = {
      type: f.type || 'string',
      description: f.description || f.label || f.name,
    };
    if (f.required) required.push(f.name);
  }

  return {
    name: `wab_${action.name}`,
    description: action.description || `Execute WAB action "${action.name}"`,
    input_schema: {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Built-in tool definitions (always available regardless of site)
// ---------------------------------------------------------------------------

const BUILTIN_TOOLS = [
  {
    name: 'wab_discover',
    description: 'Discover a WAB-enabled site — returns the full discovery document including metadata, supported actions and fairness policy.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Site URL to discover (defaults to the configured siteUrl)' },
      },
    },
  },
  {
    name: 'wab_get_actions',
    description: 'List all actions exposed by the connected WAB site, optionally filtered by category.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Optional category filter' },
      },
    },
  },
  {
    name: 'wab_execute_action',
    description: 'Execute any WAB action by name with the supplied parameters.',
    input_schema: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Action name to execute' },
        params: { type: 'object', description: 'Key/value parameters for the action' },
      },
      required: ['name'],
    },
  },
  {
    name: 'wab_read_content',
    description: 'Read the text content of a page element identified by a CSS selector.',
    input_schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector of the target element' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'wab_get_page_info',
    description: 'Return page metadata including title, URL, bridge version and active configuration.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'wab_fairness_search',
    description: 'Search the WAB discovery registry for sites matching a query, ranked using the fairness protocol to surface smaller sites equitably.',
    input_schema: {
      type: 'object',
      properties: {
        query:    { type: 'string', description: 'Search query' },
        category: { type: 'string', description: 'Optional category filter' },
        limit:    { type: 'number', description: 'Maximum results (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'wab_authenticate',
    description: 'Authenticate with the WAB site using an API key and optional agent metadata.',
    input_schema: {
      type: 'object',
      properties: {
        apiKey: { type: 'string', description: 'API key for authentication' },
        meta:   { type: 'object', description: 'Optional agent metadata (name, version, etc.)' },
      },
      required: ['apiKey'],
    },
  },
];

// ---------------------------------------------------------------------------
// Transport layer
// ---------------------------------------------------------------------------

class HTTPTransport {
  /** @param {string} baseUrl  @param {object} headers */
  constructor(baseUrl, headers = {}) {
    this.baseUrl = baseUrl;
    this.headers = headers;
  }

  async request(path, body) {
    const url = resolveUrl(this.baseUrl, path);
    const opts = body
      ? { method: 'POST', headers: { 'Content-Type': 'application/json', ...this.headers }, body: JSON.stringify(body) }
      : { method: 'GET', headers: this.headers };
    return jsonFetch(url, opts);
  }
}

class WebSocketTransport {
  /** @param {string} wsUrl  @param {object} headers */
  constructor(wsUrl, headers = {}) {
    this.wsUrl = wsUrl;
    this.headers = headers;
    this._ws = null;
    this._id = 0;
    this._pending = new Map();
  }

  async connect() {
    if (this._ws && this._ws.readyState === 1) return;

    const WebSocket = (await import('ws')).default;
    return new Promise((resolve, reject) => {
      this._ws = new WebSocket(this.wsUrl, { headers: this.headers });
      this._ws.on('open', resolve);
      this._ws.on('error', reject);
      this._ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw);
          const cb = this._pending.get(msg.id);
          if (cb) { this._pending.delete(msg.id); cb(msg); }
        } catch { /* ignore malformed frames */ }
      });
    });
  }

  async request(_path, body) {
    await this.connect();
    const id = ++this._id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._pending.delete(id); reject(new Error('WebSocket request timed out')); }, DEFAULT_TIMEOUT_MS);
      this._pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(msg.error)) : resolve(msg.result ?? msg); });
      this._ws.send(JSON.stringify({ id, ...body }));
    });
  }

  close() {
    if (this._ws) { this._ws.close(); this._ws = null; }
  }
}

class DirectTransport {
  /**
   * @param {object} page - Puppeteer / Playwright page handle
   */
  constructor(page) {
    this.page = page;
  }

  async request(_path, body) {
    if (!body) {
      return this.page.evaluate(() => window.AICommands.getPageInfo());
    }
    const { name, data } = body;
    if (name) {
      return this.page.evaluate((n, d) => window.AICommands.execute(n, d), name, data ?? {});
    }
    return this.page.evaluate((b) => window.AICommands.execute(b.method, b.params || {}), body);
  }
}

// ---------------------------------------------------------------------------
// WABMCPAdapter
// ---------------------------------------------------------------------------

/**
 * Main adapter class that connects to a WAB-enabled website and exposes its
 * capabilities as MCP tools consumable by any MCP-compatible AI agent.
 *
 * @example
 * const adapter = new WABMCPAdapter({ siteUrl: 'https://example.com' });
 * const tools = await adapter.getTools();
 * const result = await adapter.executeTool('wab_discover', {});
 */
class WABMCPAdapter {
  /**
   * @param {object}  options
   * @param {string}  [options.siteUrl]        - Target WAB site URL
   * @param {string}  [options.siteId]         - WAB site identifier
   * @param {string}  [options.apiKey]         - API key for authenticated requests
   * @param {string}  [options.transport='http'] - 'http' | 'websocket' | 'direct'
   * @param {string}  [options.registryUrl]    - Custom WAB registry URL
   * @param {object}  [options.page]           - Page handle (required for 'direct' transport)
   * @param {string}  [options.wsUrl]          - WebSocket URL (required for 'websocket' transport)
   * @param {number}  [options.timeout]        - Request timeout in ms
   */
  constructor(options = {}) {
    this.siteUrl     = options.siteUrl;
    this.siteId      = options.siteId || null;
    this.apiKey      = options.apiKey || null;
    this.registryUrl = options.registryUrl || DEFAULT_REGISTRY;
    this.timeout     = options.timeout || DEFAULT_TIMEOUT_MS;

    this._discovery   = null;
    this._siteActions = [];
    this._sessionToken = null;

    const headers = {};
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    const transport = (options.transport || 'http').toLowerCase();
    if (transport === 'websocket') {
      const wsUrl = options.wsUrl || (this.siteUrl ? this.siteUrl.replace(/^http/, 'ws') + '/ws' : null);
      if (!wsUrl) throw new Error('wsUrl or siteUrl is required for websocket transport');
      this._transport = new WebSocketTransport(wsUrl, headers);
    } else if (transport === 'direct') {
      if (!options.page) throw new Error('page option is required for direct transport');
      this._transport = new DirectTransport(options.page);
    } else {
      if (!this.siteUrl) throw new Error('siteUrl is required for http transport');
      this._transport = new HTTPTransport(this.siteUrl, headers);
    }
  }

  // -----------------------------------------------------------------------
  // Discovery
  // -----------------------------------------------------------------------

  /**
   * Fetch the WAB discovery document from the site, trying multiple
   * well-known paths in order.
   *
   * @param {string} [url] - Override URL to discover
   * @returns {Promise<object>}
   */
  async discover(url) {
    const base = url || this.siteUrl;
    if (!base) throw new Error('No siteUrl configured and no url argument supplied');

    let lastError;
    for (const path of DISCOVERY_PATHS) {
      try {
        this._discovery = await jsonFetch(resolveUrl(base, path), {}, this.timeout);
        this._extractActions(this._discovery);
        return this._discovery;
      } catch (err) {
        lastError = err;
      }
    }

    try {
      this._discovery = await this._transport.request('/api/wab/discover');
      this._extractActions(this._discovery);
      return this._discovery;
    } catch (err) {
      lastError = err;
    }

    throw new Error(`WAB discovery failed for ${base}: ${lastError?.message}`);
  }

  /** @private */
  _extractActions(doc) {
    this._siteActions = doc.actions || doc.capabilities?.actions || [];
  }

  // -----------------------------------------------------------------------
  // MCP tool interface
  // -----------------------------------------------------------------------

  /**
   * Return the full set of MCP tool definitions — built-ins plus any
   * site-specific action tools discovered from the WAB document.
   *
   * @returns {Promise<object[]>}
   */
  async getTools() {
    if (!this._discovery && this.siteUrl) {
      try { await this.discover(); } catch { /* built-ins still available */ }
    }

    const siteTools = this._siteActions.map(actionToTool);
    return [...BUILTIN_TOOLS, ...siteTools];
  }

  /**
   * Execute a single MCP tool call.
   *
   * @param {string} toolName  - MCP tool name (e.g. 'wab_discover')
   * @param {object} input     - Tool input parameters
   * @returns {Promise<object>}
   */
  async executeTool(toolName, input = {}) {
    try {
      const result = await this._dispatch(toolName, input);
      return { type: 'tool_result', tool_use_id: toolName, content: result };
    } catch (err) {
      return { type: 'tool_result', tool_use_id: toolName, is_error: true, content: { error: err.message } };
    }
  }

  /** @private Route a tool call to the appropriate handler. */
  async _dispatch(name, input) {
    switch (name) {
      case 'wab_discover':
        return this.discover(input.url);

      case 'wab_get_actions':
        return this._getActions(input.category);

      case 'wab_execute_action':
        return this._executeAction(input.name, input.params);

      case 'wab_read_content':
        return this._readContent(input.selector);

      case 'wab_get_page_info':
        return this._getPageInfo();

      case 'wab_fairness_search':
        return this._fairnessSearch(input.query, input.category, input.limit);

      case 'wab_authenticate':
        return this._authenticate(input.apiKey, input.meta);

      default:
        // Site-specific dynamic tools: strip `wab_` prefix and execute
        if (name.startsWith('wab_')) {
          const actionName = name.slice(4);
          return this._executeAction(actionName, input);
        }
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // -----------------------------------------------------------------------
  // Core operations
  // -----------------------------------------------------------------------

  /** @private */
  async _getActions(category) {
    if (!this._discovery) await this.discover();
    let actions = this._siteActions;
    if (category) {
      actions = actions.filter((a) => a.category === category);
    }
    return { actions };
  }

  /** @private */
  async _executeAction(name, params) {
    if (!name) throw new Error('Action name is required');

    const headers = this._authHeaders();
    if (this._transport instanceof HTTPTransport) {
      const url = resolveUrl(this.siteUrl, `/api/wab/actions/${encodeURIComponent(name)}`);
      return jsonFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ params: params || {} }),
      }, this.timeout);
    }

    return this._transport.request(`/api/wab/actions/${name}`, { name, data: params || {} });
  }

  /** @private */
  async _readContent(selector) {
    if (!selector) throw new Error('CSS selector is required');

    if (this._transport instanceof HTTPTransport) {
      const url = resolveUrl(this.siteUrl, '/api/wab/read');
      return jsonFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._authHeaders() },
        body: JSON.stringify({ selector }),
      }, this.timeout);
    }

    return this._transport.request('/api/wab/read', { selector });
  }

  /** @private */
  async _getPageInfo() {
    if (this._transport instanceof HTTPTransport) {
      return jsonFetch(resolveUrl(this.siteUrl, '/api/wab/page-info'), { headers: this._authHeaders() }, this.timeout);
    }
    return this._transport.request('/api/wab/page-info');
  }

  // -----------------------------------------------------------------------
  // Fairness registry
  // -----------------------------------------------------------------------

  /**
   * Search the WAB discovery registry with fairness-weighted ranking so
   * smaller and newer sites get equitable visibility alongside large ones.
   *
   * @param {string}  query
   * @param {string}  [category]
   * @param {number}  [limit=10]
   * @returns {Promise<object>}
   */
  async _fairnessSearch(query, category, limit = 10) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (category) params.set('category', category);

    return jsonFetch(`${this.registryUrl}/api/search?${params}`, {}, this.timeout);
  }

  // -----------------------------------------------------------------------
  // Authentication
  // -----------------------------------------------------------------------

  /** @private */
  async _authenticate(apiKey, meta) {
    if (!apiKey) throw new Error('apiKey is required');

    const payload = { apiKey, ...(meta ? { meta } : {}) };

    if (this._transport instanceof HTTPTransport) {
      const result = await jsonFetch(resolveUrl(this.siteUrl, '/api/wab/authenticate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, this.timeout);
      if (result.token) this._sessionToken = result.token;
      return result;
    }

    const result = await this._transport.request('/api/wab/authenticate', payload);
    if (result.token) this._sessionToken = result.token;
    return result;
  }

  /** @private Build auth headers from session token and/or API key. */
  _authHeaders() {
    const h = {};
    if (this._sessionToken) h['Authorization'] = `Bearer ${this._sessionToken}`;
    if (this.apiKey) h['x-api-key'] = this.apiKey;
    return h;
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Clean up resources (e.g. open WebSocket connections). */
  close() {
    if (typeof this._transport.close === 'function') {
      this._transport.close();
    }
  }
}

module.exports = { WABMCPAdapter, actionToTool, BUILTIN_TOOLS };
