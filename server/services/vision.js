const { db } = require('../models/db');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════════════════════
// Schema
// ═══════════════════════════════════════════════════════════════════════

db.exec(`
  CREATE TABLE IF NOT EXISTS vision_configs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    provider TEXT DEFAULT 'local' CHECK(provider IN ('local','openai','anthropic','ollama')),
    model TEXT DEFAULT 'moondream',
    endpoint TEXT,
    api_key_encrypted TEXT,
    max_resolution TEXT DEFAULT '1280x720',
    cache_ttl INTEGER DEFAULT 300,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS vision_cache (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    url TEXT,
    screenshot_hash TEXT,
    analysis TEXT,
    elements_found TEXT,
    provider TEXT,
    model TEXT,
    tokens_used INTEGER,
    latency_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS vision_elements (
    id TEXT PRIMARY KEY,
    cache_id TEXT,
    site_id TEXT,
    element_type TEXT CHECK(element_type IN ('button','input','link','text','image','form','nav','dropdown')),
    label TEXT,
    description TEXT,
    bounding_box TEXT,
    suggested_selector TEXT,
    confidence REAL,
    interactable INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cache_id) REFERENCES vision_cache(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_vision_configs_site ON vision_configs(site_id);
  CREATE INDEX IF NOT EXISTS idx_vision_cache_site ON vision_cache(site_id);
  CREATE INDEX IF NOT EXISTS idx_vision_cache_hash ON vision_cache(screenshot_hash);
  CREATE INDEX IF NOT EXISTS idx_vision_cache_url ON vision_cache(url);
  CREATE INDEX IF NOT EXISTS idx_vision_cache_expires ON vision_cache(expires_at);
  CREATE INDEX IF NOT EXISTS idx_vision_elements_cache ON vision_elements(cache_id);
  CREATE INDEX IF NOT EXISTS idx_vision_elements_site ON vision_elements(site_id);
  CREATE INDEX IF NOT EXISTS idx_vision_elements_type ON vision_elements(element_type);
`);

// ═══════════════════════════════════════════════════════════════════════
// Encryption helpers (AES-256-GCM keyed from JWT_SECRET)
// ═══════════════════════════════════════════════════════════════════════

const ENC_PREFIX = 'venc:';

function _deriveKey() {
  const secret = process.env.JWT_SECRET || 'wab-vision-fallback-key';
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptApiKey(plaintext) {
  if (!plaintext) return null;
  const key = _deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENC_PREFIX}${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decryptApiKey(encrypted) {
  if (!encrypted || typeof encrypted !== 'string' || !encrypted.startsWith(ENC_PREFIX)) return null;
  const key = _deriveKey();
  try {
    const rest = encrypted.slice(ENC_PREFIX.length);
    const [ivHex, tagHex, dataHex] = rest.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    console.error('[Vision] Decrypt failed:', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Prepared statements
// ═══════════════════════════════════════════════════════════════════════

const stmts = {
  upsertConfig: db.prepare(`
    INSERT INTO vision_configs (id, site_id, provider, model, endpoint, api_key_encrypted, max_resolution, cache_ttl, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(site_id) DO UPDATE SET
      provider = excluded.provider,
      model = excluded.model,
      endpoint = excluded.endpoint,
      api_key_encrypted = CASE WHEN excluded.api_key_encrypted IS NOT NULL THEN excluded.api_key_encrypted ELSE vision_configs.api_key_encrypted END,
      max_resolution = excluded.max_resolution,
      cache_ttl = excluded.cache_ttl,
      updated_at = datetime('now')
  `),
  getConfig: db.prepare(`SELECT * FROM vision_configs WHERE site_id = ?`),
  insertCache: db.prepare(`
    INSERT INTO vision_cache (id, site_id, url, screenshot_hash, analysis, elements_found, provider, model, tokens_used, latency_ms, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getCacheByHash: db.prepare(`
    SELECT * FROM vision_cache WHERE site_id = ? AND screenshot_hash = ? AND expires_at > datetime('now') ORDER BY created_at DESC LIMIT 1
  `),
  insertElement: db.prepare(`
    INSERT INTO vision_elements (id, cache_id, site_id, element_type, label, description, bounding_box, suggested_selector, confidence, interactable)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  searchElements: db.prepare(`
    SELECT * FROM vision_elements WHERE site_id = ? ORDER BY confidence DESC
  `),
  searchElementsByType: db.prepare(`
    SELECT * FROM vision_elements WHERE site_id = ? AND element_type = ? ORDER BY confidence DESC
  `),
  getCacheById: db.prepare(`SELECT * FROM vision_cache WHERE id = ?`),
  getCacheBySiteAndHash: db.prepare(`
    SELECT * FROM vision_cache WHERE site_id = ? AND screenshot_hash = ? ORDER BY created_at DESC LIMIT 1
  `),
  getElementsByCache: db.prepare(`SELECT * FROM vision_elements WHERE cache_id = ?`),
  cacheStats: db.prepare(`
    SELECT
      COUNT(*) as total_cached,
      SUM(CASE WHEN expires_at > datetime('now') THEN 1 ELSE 0 END) as active_cached,
      SUM(CASE WHEN expires_at <= datetime('now') THEN 1 ELSE 0 END) as expired,
      SUM(tokens_used) as total_tokens,
      AVG(latency_ms) as avg_latency,
      SUM(LENGTH(analysis)) as total_bytes
    FROM vision_cache WHERE site_id = ?
  `),
  deleteExpiredCache: db.prepare(`DELETE FROM vision_cache WHERE site_id = ? AND expires_at <= datetime('now')`),
  deleteOldCache: db.prepare(`DELETE FROM vision_cache WHERE site_id = ? AND created_at < ?`),
  deleteOrphanedElements: db.prepare(`DELETE FROM vision_elements WHERE cache_id NOT IN (SELECT id FROM vision_cache)`),
  visionHistory: db.prepare(`SELECT * FROM vision_cache WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`),
  visionHistoryByUrl: db.prepare(`SELECT * FROM vision_cache WHERE site_id = ? AND url = ? ORDER BY created_at DESC LIMIT ?`),
};

// ═══════════════════════════════════════════════════════════════════════
// Provider API calls
// ═══════════════════════════════════════════════════════════════════════

const PROVIDER_TIMEOUT_MS = 60_000;

async function _callOllama(endpoint, model, base64Image, prompt) {
  const url = `${endpoint.replace(/\/+$/, '')}/api/generate`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        images: [base64Image],
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Ollama ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    return {
      text: data.response || '',
      tokens: (data.prompt_eval_count || 0) + (data.eval_count || 0),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function _callOpenAI(apiKey, model, base64Image, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: model || 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}`, detail: 'high' } },
            ],
          },
        ],
        max_tokens: 4096,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const choice = data.choices && data.choices[0];
    return {
      text: choice ? choice.message.content : '',
      tokens: data.usage ? data.usage.total_tokens : 0,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function _callAnthropic(apiKey, model, base64Image, prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64Image } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Anthropic ${res.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await res.json();
    const textBlock = data.content && data.content.find(b => b.type === 'text');
    const inputTokens = data.usage ? data.usage.input_tokens : 0;
    const outputTokens = data.usage ? data.usage.output_tokens : 0;
    return {
      text: textBlock ? textBlock.text : '',
      tokens: inputTokens + outputTokens,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// Prompt construction
// ═══════════════════════════════════════════════════════════════════════

function buildVisionPrompt(customPrompt) {
  const base = `Analyze this screenshot of a web page. Identify every interactive UI element visible.

For each element, return a JSON object with these fields:
- "type": one of "button", "input", "link", "text", "image", "form", "nav", "dropdown"
- "label": the visible text or aria-label of the element
- "description": a short human-readable description of what the element does
- "position": {"x": approximate x coordinate in pixels, "y": approximate y coordinate in pixels, "width": approximate width, "height": approximate height}
- "selector": a suggested CSS selector that could target this element (e.g. "button.submit-btn", "#login-form input[type=email]")
- "interactable": true if the element can be clicked, typed into, or otherwise interacted with
- "confidence": a number from 0.0 to 1.0 indicating how confident you are in this identification

Return ONLY a JSON array of these objects wrapped in a markdown code block like:
\`\`\`json
[...]
\`\`\`

Be thorough — include buttons, links, inputs, dropdowns, navigation items, forms, and any other interactive elements.`;

  if (customPrompt) {
    return `${base}\n\nAdditional instructions: ${customPrompt}`;
  }
  return base;
}

// ═══════════════════════════════════════════════════════════════════════
// Response parsing
// ═══════════════════════════════════════════════════════════════════════

const VALID_ELEMENT_TYPES = new Set(['button', 'input', 'link', 'text', 'image', 'form', 'nav', 'dropdown']);

function parseVisionResponse(rawResponse, provider) {
  if (!rawResponse || typeof rawResponse !== 'string') return [];

  let elements = [];

  const jsonBlockMatch = rawResponse.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (jsonBlockMatch) {
    try {
      const parsed = JSON.parse(jsonBlockMatch[1].trim());
      if (Array.isArray(parsed)) elements = parsed;
      else if (parsed && typeof parsed === 'object') elements = [parsed];
    } catch { /* fall through to other strategies */ }
  }

  if (elements.length === 0) {
    const arrayMatch = rawResponse.match(/\[\s*\{[\s\S]*?\}\s*\]/);
    if (arrayMatch) {
      try {
        elements = JSON.parse(arrayMatch[0]);
      } catch { /* fall through */ }
    }
  }

  if (elements.length === 0) {
    const objectMatches = [...rawResponse.matchAll(/\{[^{}]*"type"\s*:\s*"[^"]+?"[^{}]*\}/g)];
    for (const m of objectMatches) {
      try {
        elements.push(JSON.parse(m[0]));
      } catch { /* skip malformed */ }
    }
  }

  return elements.map(el => _normalizeElement(el, provider)).filter(Boolean);
}

function _normalizeElement(raw, _provider) {
  if (!raw || typeof raw !== 'object') return null;

  let type = (raw.type || raw.element_type || 'text').toLowerCase().trim();
  if (!VALID_ELEMENT_TYPES.has(type)) {
    if (/btn|button|submit/i.test(type)) type = 'button';
    else if (/input|field|text.?box|textarea/i.test(type)) type = 'input';
    else if (/link|anchor|href/i.test(type)) type = 'link';
    else if (/select|dropdown|combo/i.test(type)) type = 'dropdown';
    else if (/img|icon|logo/i.test(type)) type = 'image';
    else if (/form/i.test(type)) type = 'form';
    else if (/nav|menu|sidebar/i.test(type)) type = 'nav';
    else type = 'text';
  }

  const pos = raw.position || raw.bounding_box || raw.bbox || {};
  const boundingBox = {
    x: Number(pos.x) || 0,
    y: Number(pos.y) || 0,
    width: Number(pos.width || pos.w) || 0,
    height: Number(pos.height || pos.h) || 0,
  };

  const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0.5));

  const interactable = raw.interactable != null
    ? !!raw.interactable
    : ['button', 'input', 'link', 'dropdown', 'form'].includes(type);

  return {
    type,
    label: String(raw.label || raw.text || raw.name || '').slice(0, 500),
    description: String(raw.description || raw.desc || '').slice(0, 1000),
    boundingBox,
    suggestedSelector: String(raw.selector || raw.suggested_selector || raw.css_selector || '').slice(0, 500),
    confidence,
    interactable,
  };
}

function extractElementsFromAnalysis(analysisText) {
  if (!analysisText || typeof analysisText !== 'string') return [];

  const fromJson = parseVisionResponse(analysisText, 'unknown');
  if (fromJson.length > 0) return fromJson;

  const elements = [];
  const lines = analysisText.split('\n');

  const typeKeywords = {
    button: /\b(button|btn|submit|click)\b/i,
    input: /\b(input|field|text.?box|textarea|type|enter)\b/i,
    link: /\b(link|anchor|href|url|navigate)\b/i,
    dropdown: /\b(dropdown|select|combo|menu|option)\b/i,
    image: /\b(image|img|icon|logo|picture|photo)\b/i,
    form: /\b(form|login|signup|register|search.?bar)\b/i,
    nav: /\b(nav|menu|sidebar|header|footer|tab)\b/i,
  };

  const bulletPattern = /^[\s]*[-*•]\s+(.+)/;

  for (const line of lines) {
    const match = line.match(bulletPattern);
    if (!match) continue;
    const content = match[1].trim();
    if (content.length < 3) continue;

    let type = 'text';
    for (const [t, re] of Object.entries(typeKeywords)) {
      if (re.test(content)) { type = t; break; }
    }

    const labelMatch = content.match(/["']([^"']+)["']/);
    const label = labelMatch ? labelMatch[1] : content.slice(0, 80);

    elements.push({
      type,
      label,
      description: content.slice(0, 1000),
      boundingBox: { x: 0, y: 0, width: 0, height: 0 },
      suggestedSelector: '',
      confidence: 0.3,
      interactable: ['button', 'input', 'link', 'dropdown', 'form'].includes(type),
    });
  }

  return elements;
}

// ═══════════════════════════════════════════════════════════════════════
// Core functions
// ═══════════════════════════════════════════════════════════════════════

function configureVision(siteId, { provider, model, endpoint, apiKey, maxResolution, cacheTtl } = {}) {
  const id = uuidv4();
  const encKey = apiKey ? encryptApiKey(apiKey) : null;

  stmts.upsertConfig.run(
    id,
    siteId,
    provider || 'local',
    model || 'moondream',
    endpoint || null,
    encKey,
    maxResolution || '1280x720',
    cacheTtl != null ? cacheTtl : 300
  );

  const saved = stmts.getConfig.get(siteId);
  return _maskConfig(saved);
}

function getVisionConfig(siteId) {
  const row = stmts.getConfig.get(siteId);
  if (!row) return null;
  return _maskConfig(row);
}

function _maskConfig(row) {
  if (!row) return null;
  const out = { ...row };
  if (out.api_key_encrypted) {
    const decrypted = decryptApiKey(out.api_key_encrypted);
    out.api_key_masked = decrypted
      ? decrypted.slice(0, 4) + '****' + decrypted.slice(-4)
      : '********';
  } else {
    out.api_key_masked = null;
  }
  delete out.api_key_encrypted;
  return out;
}

async function analyzeScreenshot(siteId, { screenshotBase64, url, prompt } = {}) {
  if (!screenshotBase64) throw new Error('screenshotBase64 is required');

  const config = stmts.getConfig.get(siteId);
  if (!config || !config.enabled) throw new Error('Vision not configured or disabled for this site');

  const screenshotHash = crypto.createHash('sha256').update(screenshotBase64).digest('hex');

  const cached = stmts.getCacheByHash.get(siteId, screenshotHash);
  if (cached) {
    let elements = [];
    try { elements = JSON.parse(cached.elements_found || '[]'); } catch { /* ignore */ }
    return {
      analysis: cached.analysis,
      elements,
      cached: true,
      latency_ms: cached.latency_ms,
      tokens_used: cached.tokens_used,
      cache_id: cached.id,
    };
  }

  const fullPrompt = buildVisionPrompt(prompt);
  const apiKey = config.api_key_encrypted ? decryptApiKey(config.api_key_encrypted) : null;
  const providerName = config.provider;
  const modelName = config.model;

  const startTime = Date.now();
  let result;

  try {
    switch (providerName) {
      case 'openai':
        if (!apiKey) throw new Error('OpenAI API key not configured');
        result = await _callOpenAI(apiKey, modelName, screenshotBase64, fullPrompt);
        break;
      case 'anthropic':
        if (!apiKey) throw new Error('Anthropic API key not configured');
        result = await _callAnthropic(apiKey, modelName, screenshotBase64, fullPrompt);
        break;
      case 'ollama':
      case 'local':
      default: {
        const ep = config.endpoint || 'http://localhost:11434';
        result = await _callOllama(ep, modelName, screenshotBase64, fullPrompt);
        break;
      }
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Vision provider timed out after ${PROVIDER_TIMEOUT_MS}ms`);
    throw err;
  }

  const latencyMs = Date.now() - startTime;
  const analysisText = result.text;
  const tokensUsed = result.tokens || 0;

  const elements = parseVisionResponse(analysisText, providerName);
  const cacheId = uuidv4();
  const expiresAt = new Date(Date.now() + (config.cache_ttl || 300) * 1000).toISOString();

  stmts.insertCache.run(
    cacheId, siteId, url || null, screenshotHash,
    analysisText, JSON.stringify(elements),
    providerName, modelName, tokensUsed, latencyMs, expiresAt
  );

  const insertElements = db.transaction((elems) => {
    for (const el of elems) {
      stmts.insertElement.run(
        uuidv4(), cacheId, siteId,
        el.type, el.label, el.description,
        JSON.stringify(el.boundingBox),
        el.suggestedSelector,
        el.confidence,
        el.interactable ? 1 : 0
      );
    }
  });
  insertElements(elements);

  return {
    analysis: analysisText,
    elements,
    cached: false,
    latency_ms: latencyMs,
    tokens_used: tokensUsed,
    cache_id: cacheId,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Element search
// ═══════════════════════════════════════════════════════════════════════

function findElement(siteId, url, { description, type, label } = {}) {
  let candidates;
  if (type) {
    candidates = stmts.searchElementsByType.all(siteId, type);
  } else {
    candidates = stmts.searchElements.all(siteId);
  }

  if (url) {
    const cacheIdsForUrl = db.prepare(
      `SELECT id FROM vision_cache WHERE site_id = ? AND url = ?`
    ).all(siteId, url).map(r => r.id);

    if (cacheIdsForUrl.length > 0) {
      const urlSet = new Set(cacheIdsForUrl);
      candidates = candidates.filter(el => urlSet.has(el.cache_id));
    }
  }

  if (label) {
    const lowerLabel = label.toLowerCase();
    candidates = candidates.filter(el =>
      el.label && el.label.toLowerCase().includes(lowerLabel)
    );
  }

  if (description) {
    const terms = description.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    candidates = candidates.map(el => {
      const text = `${el.label || ''} ${el.description || ''}`.toLowerCase();
      let matchCount = 0;
      for (const term of terms) {
        if (text.includes(term)) matchCount++;
      }
      const termScore = terms.length > 0 ? matchCount / terms.length : 0;
      const combinedScore = (el.confidence * 0.4) + (termScore * 0.6);
      return { ...el, _score: combinedScore };
    });

    candidates.sort((a, b) => b._score - a._score);
    candidates = candidates.filter(el => el._score > 0.1);
  }

  return candidates.slice(0, 20).map(el => {
    let boundingBox;
    try { boundingBox = JSON.parse(el.bounding_box || '{}'); } catch { boundingBox = {}; }
    return {
      id: el.id,
      cache_id: el.cache_id,
      element_type: el.element_type,
      label: el.label,
      description: el.description,
      bounding_box: boundingBox,
      suggested_selector: el.suggested_selector,
      confidence: el.confidence,
      interactable: !!el.interactable,
      _score: el._score || el.confidence,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Screenshot comparison
// ═══════════════════════════════════════════════════════════════════════

function compareScreenshots(siteId, url, screenshotAHash, screenshotBHash) {
  const cacheA = stmts.getCacheBySiteAndHash.get(siteId, screenshotAHash);
  const cacheB = stmts.getCacheBySiteAndHash.get(siteId, screenshotBHash);

  if (!cacheA || !cacheB) {
    return { error: 'One or both screenshots not found in cache', added: [], removed: [], changed: [], unchanged: [] };
  }

  let elementsA, elementsB;
  try { elementsA = JSON.parse(cacheA.elements_found || '[]'); } catch { elementsA = []; }
  try { elementsB = JSON.parse(cacheB.elements_found || '[]'); } catch { elementsB = []; }

  const makeKey = (el) => `${el.type || el.element_type}::${(el.label || '').toLowerCase()}`;

  const mapA = new Map();
  for (const el of elementsA) mapA.set(makeKey(el), el);

  const mapB = new Map();
  for (const el of elementsB) mapB.set(makeKey(el), el);

  const added = [];
  const removed = [];
  const changed = [];
  const unchanged = [];

  for (const [key, elB] of mapB) {
    if (!mapA.has(key)) {
      added.push(elB);
    } else {
      const elA = mapA.get(key);
      const posA = elA.position || elA.boundingBox || {};
      const posB = elB.position || elB.boundingBox || {};
      const moved = Math.abs((posA.x || 0) - (posB.x || 0)) > 10
        || Math.abs((posA.y || 0) - (posB.y || 0)) > 10
        || Math.abs((posA.width || 0) - (posB.width || 0)) > 10
        || Math.abs((posA.height || 0) - (posB.height || 0)) > 10;
      const descChanged = (elA.description || '') !== (elB.description || '');

      if (moved || descChanged) {
        changed.push({ before: elA, after: elB });
      } else {
        unchanged.push(elB);
      }
    }
  }

  for (const [key, elA] of mapA) {
    if (!mapB.has(key)) {
      removed.push(elA);
    }
  }

  return {
    added,
    removed,
    changed,
    unchanged,
    summary: {
      added_count: added.length,
      removed_count: removed.length,
      changed_count: changed.length,
      unchanged_count: unchanged.length,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Cache management
// ═══════════════════════════════════════════════════════════════════════

function getCacheStats(siteId) {
  const stats = stmts.cacheStats.get(siteId);
  const totalCached = stats.total_cached || 0;
  const activeCached = stats.active_cached || 0;
  const expired = stats.expired || 0;
  const hitRate = totalCached > 0 ? ((activeCached / totalCached) * 100).toFixed(1) : '0.0';

  return {
    total_cached: totalCached,
    active_cached: activeCached,
    expired,
    hit_rate_pct: parseFloat(hitRate),
    total_tokens_used: stats.total_tokens || 0,
    avg_latency_ms: Math.round(stats.avg_latency || 0),
    storage_estimate_bytes: stats.total_bytes || 0,
  };
}

function clearCache(siteId, { olderThan } = {}) {
  let deleted = 0;

  if (olderThan) {
    const cutoff = new Date(Date.now() - olderThan * 1000).toISOString();
    const result = stmts.deleteOldCache.run(siteId, cutoff);
    deleted = result.changes;
  } else {
    const result = stmts.deleteExpiredCache.run(siteId);
    deleted = result.changes;
  }

  const orphaned = stmts.deleteOrphanedElements.run();
  return { deleted, orphaned_elements_cleaned: orphaned.changes };
}

// ═══════════════════════════════════════════════════════════════════════
// Supported models
// ═══════════════════════════════════════════════════════════════════════

function getSupportedModels() {
  return [
    {
      provider: 'local',
      models: [
        { id: 'moondream', name: 'Moondream', capabilities: ['element_detection', 'text_recognition', 'layout_analysis'], max_resolution: '1280x720', cost: 'free' },
        { id: 'llava', name: 'LLaVA', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning'], max_resolution: '1920x1080', cost: 'free' },
        { id: 'llava:13b', name: 'LLaVA 13B', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning', 'complex_ui'], max_resolution: '1920x1080', cost: 'free' },
      ],
    },
    {
      provider: 'ollama',
      models: [
        { id: 'moondream', name: 'Moondream (Ollama)', capabilities: ['element_detection', 'text_recognition', 'layout_analysis'], max_resolution: '1280x720', cost: 'free' },
        { id: 'llava', name: 'LLaVA (Ollama)', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning'], max_resolution: '1920x1080', cost: 'free' },
        { id: 'bakllava', name: 'BakLLaVA (Ollama)', capabilities: ['element_detection', 'text_recognition', 'layout_analysis'], max_resolution: '1920x1080', cost: 'free' },
      ],
    },
    {
      provider: 'openai',
      models: [
        { id: 'gpt-4o', name: 'GPT-4o', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning', 'complex_ui', 'accessibility'], max_resolution: '4096x4096', cost: 'paid' },
        { id: 'gpt-4o-mini', name: 'GPT-4o Mini', capabilities: ['element_detection', 'text_recognition', 'layout_analysis'], max_resolution: '4096x4096', cost: 'paid' },
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning', 'complex_ui'], max_resolution: '4096x4096', cost: 'paid' },
      ],
    },
    {
      provider: 'anthropic',
      models: [
        { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning', 'complex_ui', 'accessibility'], max_resolution: '4096x4096', cost: 'paid' },
        { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', capabilities: ['element_detection', 'text_recognition', 'layout_analysis', 'reasoning', 'complex_ui'], max_resolution: '4096x4096', cost: 'paid' },
        { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', capabilities: ['element_detection', 'text_recognition', 'layout_analysis'], max_resolution: '4096x4096', cost: 'paid' },
      ],
    },
  ];
}

// ═══════════════════════════════════════════════════════════════════════
// Token estimation
// ═══════════════════════════════════════════════════════════════════════

function estimateTokens(imageBase64) {
  if (!imageBase64) return 0;

  const byteLength = Math.ceil(imageBase64.length * 0.75);

  let width = 1280;
  let height = 720;
  try {
    if (imageBase64.startsWith('/9j/')) {
      /* JPEG — use byte size heuristic */
    } else if (imageBase64.startsWith('iVBOR')) {
      const buf = Buffer.from(imageBase64.slice(0, 100), 'base64');
      if (buf.length >= 24) {
        width = buf.readUInt32BE(16);
        height = buf.readUInt32BE(20);
      }
    }
  } catch { /* use defaults */ }

  const tiles = Math.ceil(width / 512) * Math.ceil(height / 512);
  const highDetailTokens = 85 + (tiles * 170);
  const sizeBasedEstimate = Math.ceil(byteLength / 750);

  return Math.max(highDetailTokens, sizeBasedEstimate);
}

// ═══════════════════════════════════════════════════════════════════════
// History
// ═══════════════════════════════════════════════════════════════════════

function getVisionHistory(siteId, { limit, url } = {}) {
  const max = limit || 50;
  let rows;
  if (url) {
    rows = stmts.visionHistoryByUrl.all(siteId, url, max);
  } else {
    rows = stmts.visionHistory.all(siteId, max);
  }
  return rows.map(row => {
    let elements = [];
    try { elements = JSON.parse(row.elements_found || '[]'); } catch { /* ignore */ }
    return {
      id: row.id,
      site_id: row.site_id,
      url: row.url,
      screenshot_hash: row.screenshot_hash,
      provider: row.provider,
      model: row.model,
      tokens_used: row.tokens_used,
      latency_ms: row.latency_ms,
      elements_count: elements.length,
      created_at: row.created_at,
      expires_at: row.expires_at,
    };
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  configureVision,
  getVisionConfig,
  analyzeScreenshot,
  buildVisionPrompt,
  parseVisionResponse,
  extractElementsFromAnalysis,
  findElement,
  compareScreenshots,
  getCacheStats,
  clearCache,
  encryptApiKey,
  decryptApiKey,
  getSupportedModels,
  estimateTokens,
  getVisionHistory,
};
