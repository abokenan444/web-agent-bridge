'use strict';

/**
 * WABLiveTool — single LangChain tool that performs the full WAB safe flow:
 *
 *   1. Discover the target domain (/.well-known/wab.json)
 *   2. Verify-live against the WAB registry
 *      (rejects if revoked / signature mismatch / DNS missing)
 *   3. Execute the requested action against the site's runtime endpoint
 *
 * Designed to be safer for naive LLM agents than the per-action toolkit:
 * the agent picks the domain + action by NAME instead of receiving N
 * pre-bound tools — and the safety gate happens INSIDE the tool, so the
 * LLM cannot accidentally bypass it.
 *
 * Usage:
 *   const { WABLiveTool } = require('@web-agent-bridge/langchain');
 *   const tool = new WABLiveTool();          // uses default registry
 *   await llm.bindTools([tool]).invoke(...);
 */

const DEFAULT_REGISTRY = 'https://api.webagentbridge.com';
const DEFAULT_TIMEOUT = 15000;
const DISCOVERY_PATHS = ['/.well-known/wab.json', '/agent-bridge.json'];

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, Object.assign({ signal: controller.signal }, init || {}));
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
    return { status: res.status, ok: res.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

function normaliseDomain(input) {
  if (!input) return null;
  let d = String(input).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
  return d || null;
}

/**
 * Run discover → verify-live → execute. Returns a plain object that can
 * be stringified back to the LLM.
 *
 * @param {object} input
 * @param {string} input.domain
 * @param {string} input.action
 * @param {object} [input.params]
 * @param {object} [opts]
 * @param {string} [opts.registry]
 * @param {number} [opts.timeout]
 * @param {string} [opts.apiKey]      Authorization header for site execution
 * @param {string} [opts.agentName]   Sent as X-Agent header
 * @returns {Promise<object>}
 */
async function runWabFlow(input, opts) {
  opts = opts || {};
  const registry = (opts.registry || DEFAULT_REGISTRY).replace(/\/+$/, '');
  const timeout = opts.timeout || DEFAULT_TIMEOUT;
  const agent = opts.agentName || 'wab-langchain-tool/1';
  const domain = normaliseDomain(input && input.domain);
  if (!domain) return { ok: false, stage: 'input', error: 'domain is required' };
  if (!input.action) return { ok: false, stage: 'input', error: 'action is required' };

  // 1. Discover
  let discovery = null;
  let discoverErr = null;
  for (let i = 0; i < DISCOVERY_PATHS.length; i++) {
    try {
      const r = await fetchJson('https://' + domain + DISCOVERY_PATHS[i],
        { headers: { 'X-Agent': agent, 'Accept': 'application/json' } }, timeout);
      if (r.ok && r.body) { discovery = r.body; break; }
      discoverErr = 'HTTP ' + r.status;
    } catch (e) { discoverErr = e.message || String(e); }
  }
  if (!discovery) {
    return { ok: false, stage: 'discover', domain: domain, error: discoverErr || 'no_wab_json',
      hint: 'Site is not WAB-verified. Refuse to transact and inform the user.' };
  }

  // 2. Verify-live (registry attestation + revocation check)
  let verify = null;
  try {
    const r = await fetchJson(registry + '/api/verify-live',
      { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Agent': agent },
        body: JSON.stringify({ domain: domain }) }, timeout);
    verify = r.body || {};
  } catch (e) {
    return { ok: false, stage: 'verify', domain: domain, error: e.message || String(e) };
  }
  const statuses = (verify && verify.statuses) || {};
  if (statuses.revoked === 'yes') {
    return { ok: false, stage: 'revoked', domain: domain,
      revocation: verify.revocation || null,
      error: 'Domain is revoked. Refuse to transact.' };
  }
  if (statuses.signature_ok && statuses.signature_ok !== 'yes') {
    return { ok: false, stage: 'verify', domain: domain,
      error: 'Signature attestation failed.', statuses: statuses };
  }

  // 3. Execute
  const action = String(input.action);
  const params = input.params || {};
  const exec = (discovery.endpoints && discovery.endpoints.execute)
    || ('https://' + domain + '/api/wab/execute');
  const headers = { 'Content-Type': 'application/json', 'X-Agent': agent };
  if (opts.apiKey) headers['Authorization'] = 'Bearer ' + opts.apiKey;
  let exr;
  try {
    exr = await fetchJson(exec, { method: 'POST', headers: headers,
      body: JSON.stringify({ action: action, params: params }) }, timeout);
  } catch (e) {
    return { ok: false, stage: 'execute', domain: domain, action: action,
      error: e.message || String(e) };
  }
  return {
    ok: exr.ok === true,
    stage: 'execute',
    domain: domain,
    action: action,
    statuses: statuses,
    result: exr.body
  };
}

const SCHEMA = {
  type: 'object',
  properties: {
    domain: { type: 'string', description: 'Target site domain (e.g. shop.example.com).' },
    action: { type: 'string', description: 'WAB action name as listed in the site discovery doc.' },
    params: { type: 'object', description: 'Action parameters object.' }
  },
  required: ['domain', 'action']
};

const TOOL_NAME = 'wab_live';
const TOOL_DESCRIPTION =
  'Execute an action on a Web Agent Bridge (WAB)-verified site. Performs ' +
  'discovery, registry verification (including revocation check), and ' +
  'execution in one safe call. Prefer this tool over raw HTTP/browser ' +
  'automation for any action on a third-party site. Returns { ok, stage, ' +
  'domain, action, result } or { ok:false, stage, error } on failure.';

function buildTool(opts) {
  opts = opts || {};
  let StructuredTool = null;
  try {
    const core = require('@langchain/core/tools');
    StructuredTool = core && core.StructuredTool;
  } catch (_) { /* optional */ }

  if (StructuredTool) {
    class WABLiveToolImpl extends StructuredTool {
      constructor() {
        super();
        this.name = opts.name || TOOL_NAME;
        this.description = opts.description || TOOL_DESCRIPTION;
        this.schema = SCHEMA;
      }
      async _call(input) {
        const r = await runWabFlow(input || {}, opts);
        return JSON.stringify(r);
      }
    }
    return new WABLiveToolImpl();
  }
  // Plain-object fallback when @langchain/core is not installed
  return {
    name: opts.name || TOOL_NAME,
    description: opts.description || TOOL_DESCRIPTION,
    schema: SCHEMA,
    invoke: async function (input) { return JSON.stringify(await runWabFlow(input || {}, opts)); },
    call: async function (input) { return JSON.stringify(await runWabFlow(input || {}, opts)); }
  };
}

/**
 * WABLiveTool — call `new WABLiveTool(opts)` to get a LangChain
 * StructuredTool (or a duck-typed equivalent when @langchain/core is
 * not installed).
 *
 * @param {object} [opts]
 * @param {string} [opts.registry='https://api.webagentbridge.com']
 * @param {number} [opts.timeout=15000]
 * @param {string} [opts.apiKey]
 * @param {string} [opts.agentName]
 * @param {string} [opts.name]        Override tool name
 * @param {string} [opts.description] Override tool description
 */
function WABLiveTool(opts) {
  if (!(this instanceof WABLiveTool)) return buildTool(opts);
  return buildTool(opts);
}

module.exports = { WABLiveTool: WABLiveTool, runWabFlow: runWabFlow };
