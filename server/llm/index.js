'use strict';

/**
 * WAB LLM Abstraction Layer
 *
 * Model-agnostic LLM interface. Supports:
 * - OpenAI (GPT-4, GPT-3.5)
 * - Anthropic (Claude)
 * - Ollama (local models)
 * - Custom providers
 *
 * Provides a unified API with automatic fallback,
 * cost tracking, and response caching.
 */

const { metrics, logger } = require('../observability');

// ─── Provider Interface ─────────────────────────────────────────────────────

class LLMProvider {
  constructor(name, config = {}) {
    this.name = name;
    this.config = config;
    this.available = false;
    this.models = [];
  }

  async initialize() { throw new Error('Not implemented'); }
  async complete(prompt, options) { throw new Error('Not implemented'); }
  async embed(text) { throw new Error('Not implemented'); }
  async listModels() { return this.models; }
}

// ─── OpenAI Provider ────────────────────────────────────────────────────────

class OpenAIProvider extends LLMProvider {
  constructor(config) {
    super('openai', config);
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.openai.com/v1';
    this.models = ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'];
  }

  async initialize() {
    this.available = !!this.apiKey;
    return this.available;
  }

  async complete(prompt, options = {}) {
    if (!this.available) throw new Error('OpenAI provider not initialized');

    const model = options.model || 'gpt-4o-mini';
    const messages = [];
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt });
    messages.push({ role: 'user', content: prompt });

    const body = {
      model,
      messages,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens || 2048,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      text: data.choices[0]?.message?.content || '',
      model,
      provider: 'openai',
      usage: {
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
        totalTokens: data.usage?.total_tokens || 0,
      },
      finishReason: data.choices[0]?.finish_reason,
    };
  }

  async embed(text) {
    if (!this.available) throw new Error('OpenAI provider not initialized');

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
    });

    if (!res.ok) throw new Error(`OpenAI embed error ${res.status}`);
    const data = await res.json();
    return { embedding: data.data[0]?.embedding || [], model: 'text-embedding-3-small', provider: 'openai' };
  }
}

// ─── Anthropic Provider ─────────────────────────────────────────────────────

class AnthropicProvider extends LLMProvider {
  constructor(config) {
    super('anthropic', config);
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
    this.baseUrl = config.baseUrl || 'https://api.anthropic.com/v1';
    this.models = ['claude-sonnet-4-20250514', 'claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022'];
  }

  async initialize() {
    this.available = !!this.apiKey;
    return this.available;
  }

  async complete(prompt, options = {}) {
    if (!this.available) throw new Error('Anthropic provider not initialized');

    const model = options.model || 'claude-3-5-haiku-20241022';
    const body = {
      model,
      max_tokens: options.maxTokens || 2048,
      messages: [{ role: 'user', content: prompt }],
    };
    if (options.systemPrompt) body.system = options.systemPrompt;
    if (options.temperature !== undefined) body.temperature = options.temperature;

    const res = await fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic error ${res.status}: ${err}`);
    }

    const data = await res.json();
    return {
      text: data.content?.[0]?.text || '',
      model,
      provider: 'anthropic',
      usage: {
        promptTokens: data.usage?.input_tokens || 0,
        completionTokens: data.usage?.output_tokens || 0,
        totalTokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0),
      },
      finishReason: data.stop_reason,
    };
  }
}

// ─── Ollama Provider (Local) ────────────────────────────────────────────────

class OllamaProvider extends LLMProvider {
  constructor(config) {
    super('ollama', config);
    this.baseUrl = config.baseUrl || process.env.OLLAMA_URL || 'http://localhost:11434';
  }

  async initialize() {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json();
        this.models = (data.models || []).map(m => m.name);
        this.available = true;
      }
    } catch (_) {
      this.available = false;
    }
    return this.available;
  }

  async complete(prompt, options = {}) {
    if (!this.available) throw new Error('Ollama not available');

    const model = options.model || this.models[0] || 'llama3.2';
    const body = {
      model,
      prompt: options.systemPrompt ? `${options.systemPrompt}\n\n${prompt}` : prompt,
      stream: false,
      options: {},
    };
    if (options.temperature !== undefined) body.options.temperature = options.temperature;

    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Ollama error ${res.status}`);
    const data = await res.json();

    return {
      text: data.response || '',
      model,
      provider: 'ollama',
      usage: {
        promptTokens: data.prompt_eval_count || 0,
        completionTokens: data.eval_count || 0,
        totalTokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
      },
      finishReason: data.done ? 'stop' : 'length',
    };
  }

  async embed(text) {
    if (!this.available) throw new Error('Ollama not available');

    const model = this.models.find(m => m.includes('embed')) || 'nomic-embed-text';
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt: text }),
    });

    if (!res.ok) throw new Error(`Ollama embed error ${res.status}`);
    const data = await res.json();
    return { embedding: data.embedding || [], model, provider: 'ollama' };
  }
}

// ─── LLM Manager (Unified Interface) ───────────────────────────────────────

class LLMManager {
  constructor() {
    this._providers = new Map();
    this._defaultProvider = null;
    this._fallbackOrder = [];
    this._cache = new Map();
    this._maxCache = 500;
    this._stats = { requests: 0, cacheHits: 0, failures: 0, totalTokens: 0 };
  }

  /**
   * Register a provider
   */
  registerProvider(provider) {
    this._providers.set(provider.name, provider);
    if (!this._defaultProvider) this._defaultProvider = provider.name;
    this._fallbackOrder.push(provider.name);
  }

  /**
   * Initialize all providers
   */
  async initialize() {
    const results = {};
    for (const [name, provider] of this._providers) {
      try {
        results[name] = await provider.initialize();
      } catch (_) {
        results[name] = false;
      }
    }

    // Set default to first available
    for (const name of this._fallbackOrder) {
      if (this._providers.get(name)?.available) {
        this._defaultProvider = name;
        break;
      }
    }

    return results;
  }

  /**
   * Complete a prompt (with automatic fallback)
   */
  async complete(prompt, options = {}) {
    this._stats.requests++;

    // Check cache
    if (options.cache !== false) {
      const cacheKey = this._cacheKey(prompt, options);
      const cached = this._cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < 300_000)) {
        this._stats.cacheHits++;
        return { ...cached.result, cached: true };
      }
    }

    const providerName = options.provider || this._defaultProvider;
    const providers = [providerName, ...this._fallbackOrder.filter(p => p !== providerName)];

    const endTimer = metrics.startTimer('llm.request.duration');

    for (const name of providers) {
      const provider = this._providers.get(name);
      if (!provider?.available) continue;

      try {
        const result = await provider.complete(prompt, options);

        endTimer();
        metrics.increment('llm.requests.success', 1, { provider: name });
        this._stats.totalTokens += result.usage?.totalTokens || 0;

        // Cache result
        if (options.cache !== false) {
          const cacheKey = this._cacheKey(prompt, options);
          this._cache.set(cacheKey, { result, timestamp: Date.now() });
          if (this._cache.size > this._maxCache) {
            const oldest = this._cache.keys().next().value;
            this._cache.delete(oldest);
          }
        }

        return { ...result, duration: endTimer() };
      } catch (err) {
        metrics.increment('llm.requests.failure', 1, { provider: name });
        this._stats.failures++;
        // Try next provider
        continue;
      }
    }

    endTimer();
    throw new Error('All LLM providers failed');
  }

  /**
   * Generate embeddings
   */
  async embed(text, options = {}) {
    const providerName = options.provider || this._defaultProvider;
    const provider = this._providers.get(providerName);
    if (!provider?.available) throw new Error(`Provider ${providerName} not available`);
    if (!provider.embed) throw new Error(`Provider ${providerName} does not support embeddings`);
    return provider.embed(text);
  }

  /**
   * List available models across all providers
   */
  listModels() {
    const models = [];
    for (const [name, provider] of this._providers) {
      if (!provider.available) continue;
      for (const model of provider.models) {
        models.push({ model, provider: name });
      }
    }
    return models;
  }

  /**
   * Get provider status
   */
  getStatus() {
    const providers = {};
    for (const [name, provider] of this._providers) {
      providers[name] = {
        available: provider.available,
        models: provider.models,
      };
    }
    return {
      defaultProvider: this._defaultProvider,
      providers,
      stats: { ...this._stats },
    };
  }

  _cacheKey(prompt, options) {
    const key = `${options.provider || ''}:${options.model || ''}:${prompt.slice(0, 200)}`;
    return require('crypto').createHash('md5').update(key).digest('hex');
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

const llm = new LLMManager();

// Register default providers
llm.registerProvider(new OpenAIProvider({}));
llm.registerProvider(new AnthropicProvider({}));
llm.registerProvider(new OllamaProvider({}));

module.exports = {
  LLMProvider,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
  LLMManager,
  llm,
};
