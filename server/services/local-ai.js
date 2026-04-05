/**
 * Local AI — Sovereign Intelligence Runtime
 *
 * Manages local AI models running on the user's own hardware.
 * Auto-detects Ollama, llama.cpp, and any OpenAI-compatible local endpoint.
 * Routes inference requests to the best available model based on capability,
 * context window, and current load.
 *
 * Supported Providers:
 *   - Ollama (http://localhost:11434)
 *   - llama.cpp server (http://localhost:8080)
 *   - Custom OpenAI-compatible endpoints
 *
 * All inference happens locally. No data leaves the device.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS local_models (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    model_name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    capabilities TEXT DEFAULT '["text"]',
    context_window INTEGER DEFAULT 4096,
    parameters TEXT DEFAULT '{}',
    status TEXT DEFAULT 'available',
    total_requests INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    avg_latency_ms REAL DEFAULT 0,
    last_used TEXT,
    last_probe TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, provider, model_name)
  );

  CREATE TABLE IF NOT EXISTS local_inference_log (
    id TEXT PRIMARY KEY,
    model_id TEXT NOT NULL,
    task_type TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    latency_ms INTEGER DEFAULT 0,
    success INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_local_models_site ON local_models(site_id);
  CREATE INDEX IF NOT EXISTS idx_local_models_status ON local_models(status);
  CREATE INDEX IF NOT EXISTS idx_local_inference_model ON local_inference_log(model_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  upsertModel: db.prepare("INSERT INTO local_models (id, site_id, provider, model_name, endpoint, capabilities, context_window, parameters) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, provider, model_name) DO UPDATE SET endpoint = ?, capabilities = ?, context_window = ?, parameters = ?, status = 'available', last_probe = datetime('now')"),
  getModel: db.prepare('SELECT * FROM local_models WHERE id = ?'),
  getModels: db.prepare('SELECT * FROM local_models WHERE site_id = ? ORDER BY provider, model_name'),
  getAvailableModels: db.prepare("SELECT * FROM local_models WHERE site_id = ? AND status = 'available' ORDER BY avg_latency_ms ASC"),
  getModelsByCapability: db.prepare("SELECT * FROM local_models WHERE site_id = ? AND status = 'available' AND capabilities LIKE ? ORDER BY avg_latency_ms ASC"),
  updateModelStatus: db.prepare('UPDATE local_models SET status = ?, last_probe = datetime(\'now\') WHERE id = ?'),
  updateModelStats: db.prepare("UPDATE local_models SET total_requests = total_requests + 1, total_tokens = total_tokens + ?, avg_latency_ms = (avg_latency_ms * total_requests + ?) / (total_requests + 1), last_used = datetime('now') WHERE id = ?"),
  insertLog: db.prepare('INSERT INTO local_inference_log (id, model_id, task_type, prompt_tokens, completion_tokens, latency_ms, success) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  getStats: db.prepare(`SELECT
    (SELECT COUNT(*) FROM local_models WHERE site_id = ? AND status = 'available') as available_models,
    (SELECT COUNT(*) FROM local_models WHERE site_id = ?) as total_models,
    (SELECT SUM(total_requests) FROM local_models WHERE site_id = ?) as total_requests,
    (SELECT SUM(total_tokens) FROM local_models WHERE site_id = ?) as total_tokens,
    (SELECT AVG(avg_latency_ms) FROM local_models WHERE site_id = ? AND status = 'available') as avg_latency`),
};

// ─── Default Provider Endpoints ──────────────────────────────────────

const PROVIDERS = {
  ollama: { name: 'ollama', baseUrl: 'http://localhost:11434', tagsPath: '/api/tags', chatPath: '/api/chat', generatePath: '/api/generate' },
  llamacpp: { name: 'llamacpp', baseUrl: 'http://localhost:8080', chatPath: '/v1/chat/completions', modelsPath: '/v1/models' },
};

// ─── Model Discovery ─────────────────────────────────────────────────

/**
 * Probe local endpoints and register discovered models.
 */
async function discoverModels(siteId, customEndpoints = []) {
  const discovered = [];

  // Probe Ollama
  try {
    const ollamaModels = await _probeOllama(PROVIDERS.ollama.baseUrl);
    for (const m of ollamaModels) {
      const result = _registerModel(siteId, 'ollama', m.name, PROVIDERS.ollama.baseUrl, m.capabilities, m.contextWindow, m.parameters);
      discovered.push(result);
    }
  } catch (_) { /* Ollama not running */ }

  // Probe llama.cpp
  try {
    const lcModels = await _probeLlamaCpp(PROVIDERS.llamacpp.baseUrl);
    for (const m of lcModels) {
      const result = _registerModel(siteId, 'llamacpp', m.name, PROVIDERS.llamacpp.baseUrl, m.capabilities, m.contextWindow, m.parameters);
      discovered.push(result);
    }
  } catch (_) { /* llama.cpp not running */ }

  // Probe custom endpoints
  for (const ep of customEndpoints) {
    try {
      const models = await _probeOpenAICompatible(ep.url);
      for (const m of models) {
        const result = _registerModel(siteId, ep.name || 'custom', m.name, ep.url, m.capabilities, m.contextWindow, m.parameters);
        discovered.push(result);
      }
    } catch (_) { /* endpoint not available */ }
  }

  return { discovered: discovered.length, models: discovered };
}

/**
 * Register a model manually.
 */
function registerModel(siteId, provider, modelName, endpoint, capabilities = ['text'], contextWindow = 4096) {
  return _registerModel(siteId, provider, modelName, endpoint, capabilities, contextWindow, {});
}

function _registerModel(siteId, provider, modelName, endpoint, capabilities, contextWindow, parameters) {
  const id = crypto.randomUUID();
  const caps = JSON.stringify(capabilities);
  const params = JSON.stringify(parameters);

  stmts.upsertModel.run(id, siteId, provider, modelName, endpoint, caps, contextWindow, params, endpoint, caps, contextWindow, params);
  return { id, provider, modelName, endpoint, capabilities, contextWindow };
}

// ─── Inference ───────────────────────────────────────────────────────

/**
 * Run inference on the best available local model.
 * @param {string} siteId
 * @param {string} prompt - The user prompt
 * @param {object} options - { capability, model, systemPrompt, temperature, maxTokens, stream }
 */
async function infer(siteId, prompt, options = {}) {
  const capability = options.capability || 'text';

  // Select model
  let model;
  if (options.modelId) {
    model = stmts.getModel.get(options.modelId);
    if (!model || model.status !== 'available') throw new Error('Selected model unavailable');
  } else {
    const candidates = stmts.getModelsByCapability.all(siteId, `%${capability}%`);
    if (candidates.length === 0) throw new Error(`No local model available for capability: ${capability}`);
    model = candidates[0]; // Fastest by avg latency
  }

  const start = Date.now();
  let result;

  try {
    const parsed = JSON.parse(model.parameters || '{}');
    if (model.provider === 'ollama') {
      result = await _inferOllama(model, prompt, options);
    } else if (model.provider === 'llamacpp') {
      result = await _inferLlamaCpp(model, prompt, options);
    } else {
      result = await _inferOpenAICompatible(model, prompt, options);
    }
  } catch (err) {
    const latency = Date.now() - start;
    stmts.insertLog.run(crypto.randomUUID(), model.id, capability, 0, 0, latency, 0);
    throw err;
  }

  const latency = Date.now() - start;
  const totalTokens = (result.promptTokens || 0) + (result.completionTokens || 0);

  stmts.updateModelStats.run(totalTokens, latency, model.id);
  stmts.insertLog.run(crypto.randomUUID(), model.id, capability, result.promptTokens || 0, result.completionTokens || 0, latency, 1);

  return {
    modelId: model.id,
    provider: model.provider,
    model: model.model_name,
    response: result.text,
    promptTokens: result.promptTokens || 0,
    completionTokens: result.completionTokens || 0,
    latencyMs: latency,
  };
}

// ─── Model Management ────────────────────────────────────────────────

function getModels(siteId) {
  return stmts.getModels.all(siteId).map(_deserializeModel);
}

function getAvailableModels(siteId) {
  return stmts.getAvailableModels.all(siteId).map(_deserializeModel);
}

function getModel(modelId) {
  const row = stmts.getModel.get(modelId);
  return row ? _deserializeModel(row) : null;
}

function updateModelStatus(modelId, status) {
  stmts.updateModelStatus.run(status, modelId);
}

function getStats(siteId) {
  const row = stmts.getStats.get(siteId, siteId, siteId, siteId, siteId);
  return {
    availableModels: row.available_models || 0,
    totalModels: row.total_models || 0,
    totalRequests: row.total_requests || 0,
    totalTokens: row.total_tokens || 0,
    avgLatency: row.avg_latency ? Math.round(row.avg_latency) : 0,
  };
}

// ─── Provider-Specific Inference ─────────────────────────────────────

async function _inferOllama(model, prompt, options) {
  const body = {
    model: model.model_name,
    messages: [],
    stream: false,
    options: {},
  };

  if (options.systemPrompt) body.messages.push({ role: 'system', content: options.systemPrompt });
  body.messages.push({ role: 'user', content: prompt });
  if (options.temperature != null) body.options.temperature = options.temperature;

  const res = await fetch(`${model.endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 120000),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();

  return {
    text: data.message?.content || '',
    promptTokens: data.prompt_eval_count || 0,
    completionTokens: data.eval_count || 0,
  };
}

async function _inferLlamaCpp(model, prompt, options) {
  const body = {
    model: model.model_name,
    messages: [],
    max_tokens: options.maxTokens || 2048,
    stream: false,
  };

  if (options.systemPrompt) body.messages.push({ role: 'system', content: options.systemPrompt });
  body.messages.push({ role: 'user', content: prompt });
  if (options.temperature != null) body.temperature = options.temperature;

  const res = await fetch(`${model.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 120000),
  });

  if (!res.ok) throw new Error(`llama.cpp error: ${res.status}`);
  const data = await res.json();

  return {
    text: data.choices?.[0]?.message?.content || '',
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  };
}

async function _inferOpenAICompatible(model, prompt, options) {
  const body = {
    model: model.model_name,
    messages: [],
    max_tokens: options.maxTokens || 2048,
    stream: false,
  };

  if (options.systemPrompt) body.messages.push({ role: 'system', content: options.systemPrompt });
  body.messages.push({ role: 'user', content: prompt });
  if (options.temperature != null) body.temperature = options.temperature;

  const res = await fetch(`${model.endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeout || 120000),
  });

  if (!res.ok) throw new Error(`Inference error: ${res.status}`);
  const data = await res.json();

  return {
    text: data.choices?.[0]?.message?.content || '',
    promptTokens: data.usage?.prompt_tokens || 0,
    completionTokens: data.usage?.completion_tokens || 0,
  };
}

// ─── Provider Probing ────────────────────────────────────────────────

async function _probeOllama(baseUrl) {
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || []).map(m => ({
    name: m.name,
    capabilities: _detectCapabilities(m.name),
    contextWindow: m.details?.parameter_size ? _estimateContext(m.details.parameter_size) : 4096,
    parameters: { size: m.size, family: m.details?.family },
  }));
}

async function _probeLlamaCpp(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map(m => ({
    name: m.id,
    capabilities: _detectCapabilities(m.id),
    contextWindow: 4096,
    parameters: {},
  }));
}

async function _probeOpenAICompatible(baseUrl) {
  const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(5000) });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.data || []).map(m => ({
    name: m.id,
    capabilities: _detectCapabilities(m.id),
    contextWindow: 4096,
    parameters: {},
  }));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _detectCapabilities(modelName) {
  const n = modelName.toLowerCase();
  const caps = ['text'];
  if (n.includes('vision') || n.includes('llava') || n.includes('bakllava')) caps.push('vision');
  if (n.includes('code') || n.includes('codellama') || n.includes('deepseek-coder') || n.includes('starcoder')) caps.push('code');
  if (n.includes('embed') || n.includes('nomic')) caps.push('embedding');
  if (n.includes('mistral') || n.includes('mixtral')) caps.push('reasoning');
  return caps;
}

function _estimateContext(paramSize) {
  // Rough estimate: smaller models typically have smaller context
  if (typeof paramSize === 'string') {
    const num = parseFloat(paramSize);
    if (num >= 70) return 32768;
    if (num >= 13) return 8192;
    return 4096;
  }
  return 4096;
}

function _deserializeModel(row) {
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '["text"]'),
    parameters: JSON.parse(row.parameters || '{}'),
  };
}

module.exports = {
  discoverModels, registerModel, infer,
  getModels, getAvailableModels, getModel, updateModelStatus,
  getStats,
};
