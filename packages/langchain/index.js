'use strict';

/**
 * @web-agent-bridge/langchain
 *
 * Wraps WAB site actions as LangChain-compatible tools so any LangChain or
 * LangGraph agent can discover and execute WAB actions through standard
 * LLM tool-calling.
 *
 * Works in two modes:
 *   1. **HTTP mode** (Node / serverless) — fetches the discovery endpoint directly.
 *   2. **Browser mode** — delegates to a Puppeteer/Playwright page that has WAB loaded.
 *
 * Minimal usage (HTTP):
 *   const { WABToolkit } = require('@web-agent-bridge/langchain');
 *   const toolkit = new WABToolkit({ siteUrl: 'https://shop.example.com' });
 *   const tools = await toolkit.getTools();   // Array<StructuredTool>
 *   // Pass `tools` to ChatOpenAI.bind_tools() or AgentExecutor
 *
 * Minimal usage (browser):
 *   const { WABToolkit } = require('@web-agent-bridge/langchain');
 *   const { WABAgent } = require('@anthropic-wab/agent-sdk');
 *   const toolkit = new WABToolkit({ agent: new WABAgent(page) });
 *   const tools = await toolkit.getTools();
 */

const DEFAULT_TIMEOUT = 15000;
const DISCOVERY_PATHS = ['/agent-bridge.json', '/.well-known/wab.json'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson(url, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs);
  try {
    var res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

async function discoverSite(siteUrl, timeoutMs) {
  var base = siteUrl.replace(/\/+$/, '');
  for (var i = 0; i < DISCOVERY_PATHS.length; i++) {
    try {
      return await fetchJson(base + DISCOVERY_PATHS[i], timeoutMs);
    } catch (_) {
      // try next
    }
  }
  throw new Error('WAB discovery failed for ' + siteUrl);
}

function buildInputSchema(action) {
  var properties = {};
  var required = [];
  var fields = action.params || action.fields || [];
  for (var j = 0; j < fields.length; j++) {
    var f = fields[j];
    properties[f.name] = {
      type: f.type || 'string',
      description: f.description || f.label || f.name
    };
    if (f.required) required.push(f.name);
  }
  return { type: 'object', properties: properties, required: required };
}

// ---------------------------------------------------------------------------
// WABTool — a single WAB action wrapped as a LangChain StructuredTool
// ---------------------------------------------------------------------------

/**
 * A LangChain StructuredTool that executes a single WAB action.
 *
 * If @langchain/core is available it subclasses StructuredTool; otherwise
 * it returns a plain object with the same shape so the adapter degrades
 * gracefully without hard dependency issues.
 */
function createToolClass() {
  try {
    var core = require('@langchain/core/tools');
    var StructuredTool = core.StructuredTool;
    if (!StructuredTool) throw new Error('no StructuredTool');

    /** @param {{ name, description, schema, invoke }} spec */
    return function WABLangChainTool(spec) {
      // We create a subclass dynamically per-tool
      class _Tool extends StructuredTool {
        constructor() {
          super();
          this.name = spec.name;
          this.description = spec.description;
          this.schema = spec.schema;
        }
        async _call(input) {
          return spec.invoke(input);
        }
      }
      return new _Tool();
    };
  } catch (_) {
    // LangChain not installed — return plain tool objects
    return function plainTool(spec) {
      return {
        name: spec.name,
        description: spec.description,
        schema: spec.schema,
        invoke: spec.invoke,
        call: spec.invoke
      };
    };
  }
}

var makeTool = createToolClass();

// ---------------------------------------------------------------------------
// WABToolkit
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {string} [options.siteUrl]  — Site URL (HTTP mode)
 * @param {object} [options.agent]    — WABAgent instance (browser mode)
 * @param {number} [options.timeout]
 * @param {string} [options.apiKey]   — Passed as Authorization header
 */
function WABToolkit(options) {
  if (!options) throw new Error('WABToolkit requires options');
  this.siteUrl = options.siteUrl || null;
  this.agent = options.agent || null;
  this.timeout = options.timeout || DEFAULT_TIMEOUT;
  this.apiKey = options.apiKey || null;
  this._discovery = null;
}

/**
 * Discover the site and return an array of LangChain-compatible tools.
 * @param {string} [category] — Optional category filter
 * @returns {Promise<Array>}
 */
WABToolkit.prototype.getTools = async function getTools(category) {
  var actions = await this._getActions(category);
  var self = this;

  return actions.map(function (action) {
    return makeTool({
      name: 'wab_' + action.name,
      description: action.description || 'Execute WAB action "' + action.name + '"',
      schema: buildInputSchema(action),
      invoke: function (input) {
        return self._execute(action.name, input || {});
      }
    });
  });
};

/**
 * Return raw discovery document.
 * @returns {Promise<object>}
 */
WABToolkit.prototype.getDiscovery = async function () {
  if (this._discovery) return this._discovery;
  if (this.agent) {
    await this.agent.waitForBridge();
    this._discovery = { actions: await this.agent.getActions() };
  } else if (this.siteUrl) {
    this._discovery = await discoverSite(this.siteUrl, this.timeout);
  } else {
    throw new Error('Provide siteUrl or agent');
  }
  return this._discovery;
};

/** @private */
WABToolkit.prototype._getActions = async function (category) {
  var disc = await this.getDiscovery();
  var actions = disc.actions || [];
  if (category) {
    actions = actions.filter(function (a) { return a.category === category; });
  }
  return actions;
};

/** @private */
WABToolkit.prototype._execute = async function (name, params) {
  if (this.agent) {
    var res = await this.agent.execute(name, params);
    return JSON.stringify(res);
  }
  if (this.siteUrl) {
    var url = this.siteUrl.replace(/\/+$/, '') + '/api/wab/execute';
    var headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['Authorization'] = 'Bearer ' + this.apiKey;
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, this.timeout);
    try {
      var resp = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({ action: name, params: params }),
        signal: controller.signal
      });
      var data = await resp.json();
      return JSON.stringify(data);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Provide siteUrl or agent');
};

module.exports = { WABToolkit: WABToolkit };
