'use strict';

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema Creation ──────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS plugin_registry (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    version TEXT,
    author TEXT,
    description TEXT,
    category TEXT,
    entry_point TEXT,
    hooks TEXT DEFAULT '[]',
    config_schema TEXT DEFAULT '{}',
    icon TEXT,
    downloads INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    rating_count INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1,
    is_official INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS plugin_installations (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    user_id TEXT,
    config TEXT DEFAULT '{}',
    enabled INTEGER DEFAULT 1,
    installed_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(plugin_id, site_id)
  );

  CREATE TABLE IF NOT EXISTS plugin_hooks (
    id TEXT PRIMARY KEY,
    plugin_id TEXT NOT NULL,
    hook_name TEXT NOT NULL,
    handler TEXT NOT NULL,
    priority INTEGER DEFAULT 10,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS hook_executions (
    id TEXT PRIMARY KEY,
    hook_name TEXT NOT NULL,
    plugin_id TEXT,
    site_id TEXT,
    input TEXT DEFAULT '{}',
    output TEXT DEFAULT '{}',
    duration_ms INTEGER,
    success INTEGER,
    error TEXT,
    executed_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_plugin_registry_category ON plugin_registry(category);
  CREATE INDEX IF NOT EXISTS idx_plugin_registry_name ON plugin_registry(name);
  CREATE INDEX IF NOT EXISTS idx_plugin_installations_site ON plugin_installations(site_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_installations_plugin ON plugin_installations(plugin_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_hooks_plugin ON plugin_hooks(plugin_id);
  CREATE INDEX IF NOT EXISTS idx_plugin_hooks_hook_name ON plugin_hooks(hook_name);
  CREATE INDEX IF NOT EXISTS idx_hook_executions_site ON hook_executions(site_id);
  CREATE INDEX IF NOT EXISTS idx_hook_executions_hook ON hook_executions(hook_name);
  CREATE INDEX IF NOT EXISTS idx_hook_executions_executed ON hook_executions(executed_at);
`);

// ─── Prepared Statements ──────────────────────────────────────────────

const stmts = {
  insertPlugin: db.prepare(`
    INSERT INTO plugin_registry (id, name, version, author, description, category, entry_point, hooks, config_schema, icon, is_official, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `),
  getPlugin: db.prepare(`SELECT * FROM plugin_registry WHERE id = ?`),
  getPluginByName: db.prepare(`SELECT * FROM plugin_registry WHERE name = ?`),
  insertInstallation: db.prepare(`
    INSERT INTO plugin_installations (id, plugin_id, site_id, user_id, config, enabled, installed_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(plugin_id, site_id) DO UPDATE SET
      user_id = excluded.user_id,
      config = excluded.config,
      enabled = 1,
      updated_at = datetime('now')
  `),
  deleteInstallation: db.prepare(`DELETE FROM plugin_installations WHERE plugin_id = ? AND site_id = ?`),
  getInstallation: db.prepare(`SELECT * FROM plugin_installations WHERE id = ?`),
  updateInstallationConfig: db.prepare(`UPDATE plugin_installations SET config = ?, updated_at = datetime('now') WHERE id = ?`),
  getInstalledPlugins: db.prepare(`
    SELECT pi.*, pr.name, pr.version, pr.author, pr.description, pr.category, pr.icon, pr.hooks as plugin_hooks, pr.config_schema, pr.rating, pr.rating_count, pr.downloads, pr.is_official
    FROM plugin_installations pi
    JOIN plugin_registry pr ON pi.plugin_id = pr.id
    WHERE pi.site_id = ? AND pi.enabled = 1 AND pr.enabled = 1
    ORDER BY pr.name
  `),
  insertHook: db.prepare(`
    INSERT INTO plugin_hooks (id, plugin_id, hook_name, handler, priority, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `),
  getHooksForName: db.prepare(`
    SELECT ph.*, pr.name as plugin_name
    FROM plugin_hooks ph
    JOIN plugin_registry pr ON ph.plugin_id = pr.id
    WHERE ph.hook_name = ?
    ORDER BY ph.priority ASC
  `),
  getHooksForPlugin: db.prepare(`SELECT * FROM plugin_hooks WHERE plugin_id = ?`),
  deleteHooksForPlugin: db.prepare(`DELETE FROM plugin_hooks WHERE plugin_id = ?`),
  insertExecution: db.prepare(`
    INSERT INTO hook_executions (id, hook_name, plugin_id, site_id, input, output, duration_ms, success, error, executed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `),
  incrementDownloads: db.prepare(`UPDATE plugin_registry SET downloads = downloads + 1, updated_at = datetime('now') WHERE id = ?`),
  updateRating: db.prepare(`UPDATE plugin_registry SET rating = ?, rating_count = rating_count + 1, updated_at = datetime('now') WHERE id = ?`),
  installationCount: db.prepare(`SELECT COUNT(*) as count FROM plugin_installations WHERE plugin_id = ?`),
  executionStats: db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes
    FROM hook_executions WHERE plugin_id = ?
  `),
};

// ─── Helpers ──────────────────────────────────────────────────────────

function parseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function enrichPlugin(row) {
  if (!row) return null;
  return {
    ...row,
    hooks: parseJSON(row.hooks, []),
    config_schema: parseJSON(row.config_schema, {}),
    enabled: !!row.enabled,
    is_official: !!row.is_official,
  };
}

// ─── validateConfig ───────────────────────────────────────────────────

function validateConfig(config, schema) {
  if (!schema || typeof schema !== 'object') return { valid: true, errors: [] };
  const errors = [];

  if (schema.required && Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (config[field] === undefined || config[field] === null) {
        errors.push(`Missing required field: ${field}`);
      }
    }
  }

  if (schema.properties && typeof schema.properties === 'object') {
    for (const [key, rule] of Object.entries(schema.properties)) {
      const val = config[key];
      if (val === undefined || val === null) continue;

      if (rule.type) {
        const typeMap = {
          string: 'string',
          number: 'number',
          boolean: 'boolean',
          array: 'array',
          object: 'object',
        };
        const expected = typeMap[rule.type];
        if (expected) {
          const actual = Array.isArray(val) ? 'array' : typeof val;
          if (actual !== expected) {
            errors.push(`Field "${key}" must be of type ${rule.type}, got ${actual}`);
          }
        }
      }

      if (rule.enum && Array.isArray(rule.enum)) {
        if (!rule.enum.includes(val)) {
          errors.push(`Field "${key}" must be one of: ${rule.enum.join(', ')}`);
        }
      }

      if (rule.type === 'number' && typeof val === 'number') {
        if (rule.min !== undefined && val < rule.min) {
          errors.push(`Field "${key}" must be >= ${rule.min}`);
        }
        if (rule.max !== undefined && val > rule.max) {
          errors.push(`Field "${key}" must be <= ${rule.max}`);
        }
      }

      if (rule.type === 'string' && typeof val === 'string') {
        if (rule.minLength !== undefined && val.length < rule.minLength) {
          errors.push(`Field "${key}" must have length >= ${rule.minLength}`);
        }
        if (rule.maxLength !== undefined && val.length > rule.maxLength) {
          errors.push(`Field "${key}" must have length <= ${rule.maxLength}`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Core Functions ───────────────────────────────────────────────────

function registerPlugin({ name, version, author, description, category, entryPoint, hooks, configSchema, icon, isOfficial }) {
  const id = crypto.randomUUID();
  const hooksJSON = JSON.stringify(hooks || []);
  const schemaJSON = JSON.stringify(configSchema || {});

  stmts.insertPlugin.run(
    id, name, version || '1.0.0', author || 'Unknown', description || '',
    category || 'general', entryPoint || '', hooksJSON, schemaJSON,
    icon || '', isOfficial ? 1 : 0
  );

  if (Array.isArray(hooks)) {
    for (const hook of hooks) {
      if (hook.name && hook.handler) {
        registerHook(id, hook.name, hook.handler, hook.priority || 10);
      }
    }
  }

  return enrichPlugin(stmts.getPlugin.get(id));
}

function getPlugin(pluginId) {
  return enrichPlugin(stmts.getPlugin.get(pluginId));
}

function getPluginByName(name) {
  return enrichPlugin(stmts.getPluginByName.get(name));
}

function listPlugins({ category, search, sort, limit, offset } = {}) {
  let sql = 'SELECT * FROM plugin_registry WHERE enabled = 1';
  const params = [];

  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }

  if (search) {
    sql += ' AND (name LIKE ? OR description LIKE ?)';
    const term = `%${search}%`;
    params.push(term, term);
  }

  const sortMap = {
    downloads: 'downloads DESC',
    rating: 'rating DESC',
    created_at: 'created_at DESC',
    name: 'name ASC',
  };
  sql += ` ORDER BY ${sortMap[sort] || 'created_at DESC'}`;

  sql += ' LIMIT ? OFFSET ?';
  params.push(limit || 50, offset || 0);

  const rows = db.prepare(sql).all(...params);
  return rows.map(enrichPlugin);
}

function installPlugin(pluginId, siteId, userId, config) {
  const plugin = stmts.getPlugin.get(pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

  const schema = parseJSON(plugin.config_schema, {});
  const finalConfig = config || {};

  if (schema && schema.properties) {
    const validation = validateConfig(finalConfig, schema);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join('; ')}`);
    }
  }

  const id = crypto.randomUUID();
  stmts.insertInstallation.run(id, pluginId, siteId, userId || null, JSON.stringify(finalConfig));
  stmts.incrementDownloads.run(pluginId);

  return {
    id,
    plugin_id: pluginId,
    site_id: siteId,
    user_id: userId,
    config: finalConfig,
    enabled: true,
  };
}

function uninstallPlugin(pluginId, siteId) {
  const changes = stmts.deleteInstallation.run(pluginId, siteId).changes;
  return changes > 0;
}

function configurePlugin(installationId, config) {
  const installation = stmts.getInstallation.get(installationId);
  if (!installation) throw new Error(`Installation not found: ${installationId}`);

  const plugin = stmts.getPlugin.get(installation.plugin_id);
  if (!plugin) throw new Error(`Plugin not found: ${installation.plugin_id}`);

  const schema = parseJSON(plugin.config_schema, {});
  if (schema && schema.properties) {
    const validation = validateConfig(config, schema);
    if (!validation.valid) {
      throw new Error(`Invalid config: ${validation.errors.join('; ')}`);
    }
  }

  stmts.updateInstallationConfig.run(JSON.stringify(config), installationId);
  return { id: installationId, config };
}

function getInstalledPlugins(siteId) {
  const rows = stmts.getInstalledPlugins.all(siteId);
  return rows.map(row => ({
    ...row,
    config: parseJSON(row.config, {}),
    plugin_hooks: parseJSON(row.plugin_hooks, []),
    config_schema: parseJSON(row.config_schema, {}),
    enabled: !!row.enabled,
    is_official: !!row.is_official,
  }));
}

// ─── Hook Management ──────────────────────────────────────────────────

function registerHook(pluginId, hookName, handlerCode, priority) {
  const id = crypto.randomUUID();
  stmts.insertHook.run(id, pluginId, hookName, handlerCode, priority || 10);
  return { id, plugin_id: pluginId, hook_name: hookName, priority: priority || 10 };
}

function executeHook(hookName, siteId, input) {
  const installed = stmts.getInstalledPlugins.all(siteId);
  const installedPluginIds = new Set(installed.map(i => i.plugin_id));

  const allHooks = stmts.getHooksForName.all(hookName);
  const relevantHooks = allHooks.filter(h => installedPluginIds.has(h.plugin_id));

  const results = [];

  for (const hook of relevantHooks) {
    const execId = crypto.randomUUID();
    const start = Date.now();
    let output = null;
    let success = true;
    let error = null;

    try {
      const vm = require('vm');
      const sandbox = {
        input: JSON.parse(JSON.stringify(input || {})),
        config: {},
        result: null,
        JSON,
        Math,
        Date,
        Array,
        Object,
        String,
        Number,
        Boolean,
        parseInt,
        parseFloat,
        isNaN,
        isFinite,
        encodeURIComponent,
        decodeURIComponent,
      };
      const inst = installed.find(i => i.plugin_id === hook.plugin_id);
      sandbox.config = inst ? JSON.parse(JSON.stringify(parseJSON(inst.config, {}))) : {};

      const wrappedCode = `'use strict'; result = (function(input, config) { ${hook.handler} })(input, config);`;
      const script = new vm.Script(wrappedCode, { timeout: 1000, filename: `plugin-${hook.plugin_id}.vm` });
      const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
      script.runInContext(context, { timeout: 1000 });
      output = sandbox.result;
    } catch (err) {
      success = false;
      error = err.message || String(err);
    }

    const duration = Date.now() - start;

    stmts.insertExecution.run(
      execId, hookName, hook.plugin_id, siteId,
      JSON.stringify(input || {}), JSON.stringify(output || {}),
      duration, success ? 1 : 0, error
    );

    results.push({
      plugin_id: hook.plugin_id,
      plugin_name: hook.plugin_name,
      hook_name: hookName,
      output,
      success,
      error,
      duration_ms: duration,
    });
  }

  return results;
}

function getAvailableHooks() {
  return [
    { name: 'before_action', description: 'Triggered before any agent action is executed' },
    { name: 'after_action', description: 'Triggered after an agent action completes' },
    { name: 'on_discover', description: 'Triggered when agent discovers new page elements' },
    { name: 'on_authenticate', description: 'Triggered during authentication flow' },
    { name: 'on_error', description: 'Triggered when an error occurs during agent execution' },
    { name: 'on_memory_store', description: 'Triggered when data is stored in agent memory' },
    { name: 'on_memory_recall', description: 'Triggered when data is recalled from agent memory' },
    { name: 'on_heal_selector', description: 'Triggered when a CSS selector self-heals' },
    { name: 'on_vision_analyze', description: 'Triggered when vision analysis is performed on a page' },
    { name: 'on_swarm_start', description: 'Triggered when a swarm task begins' },
    { name: 'on_swarm_complete', description: 'Triggered when a swarm task completes' },
    { name: 'on_fairness_search', description: 'Triggered during fairness-aware search ranking' },
    { name: 'on_page_load', description: 'Triggered when a monitored page is loaded' },
    { name: 'on_agent_connect', description: 'Triggered when an agent connects to a site' },
    { name: 'on_agent_disconnect', description: 'Triggered when an agent disconnects from a site' },
    { name: 'custom', description: 'Generic hook for user-defined plugin events' },
  ];
}

// ─── Stats & Rating ───────────────────────────────────────────────────

function getPluginStats(pluginId) {
  const plugin = stmts.getPlugin.get(pluginId);
  if (!plugin) return null;

  const instCount = stmts.installationCount.get(pluginId).count;
  const execStats = stmts.executionStats.get(pluginId);
  const total = execStats.total || 0;
  const successes = execStats.successes || 0;

  return {
    plugin_id: pluginId,
    name: plugin.name,
    installations: instCount,
    downloads: plugin.downloads,
    avg_rating: plugin.rating,
    rating_count: plugin.rating_count,
    total_executions: total,
    successful_executions: successes,
    success_rate: total > 0 ? Math.round((successes / total) * 10000) / 100 : 0,
  };
}

function ratePlugin(pluginId, userId, rating) {
  if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

  const plugin = stmts.getPlugin.get(pluginId);
  if (!plugin) throw new Error(`Plugin not found: ${pluginId}`);

  const oldAvg = plugin.rating || 0;
  const oldCount = plugin.rating_count || 0;
  const newAvg = ((oldAvg * oldCount) + rating) / (oldCount + 1);
  const rounded = Math.round(newAvg * 100) / 100;

  stmts.updateRating.run(rounded, pluginId);

  return { plugin_id: pluginId, new_rating: rounded, rating_count: oldCount + 1 };
}

// ─── Execution Log ────────────────────────────────────────────────────

function getHookExecutionLog(siteId, { hookName, pluginId, limit } = {}) {
  let sql = 'SELECT he.*, pr.name as plugin_name FROM hook_executions he LEFT JOIN plugin_registry pr ON he.plugin_id = pr.id WHERE he.site_id = ?';
  const params = [siteId];

  if (hookName) {
    sql += ' AND he.hook_name = ?';
    params.push(hookName);
  }
  if (pluginId) {
    sql += ' AND he.plugin_id = ?';
    params.push(pluginId);
  }

  sql += ' ORDER BY he.executed_at DESC LIMIT ?';
  params.push(limit || 100);

  const rows = db.prepare(sql).all(...params);
  return rows.map(row => ({
    ...row,
    input: parseJSON(row.input, {}),
    output: parseJSON(row.output, {}),
    success: !!row.success,
  }));
}

// ─── Seed Official Plugins ────────────────────────────────────────────

function seedOfficialPlugins() {
  const existing = stmts.getPluginByName.get('fairness-boost');
  if (existing) return;

  const plugins = [
    {
      name: 'fairness-boost',
      version: '1.0.0',
      author: 'WAB Team',
      description: 'Boosts indie and small-business sites in search results by 15% to promote a fairer web ecosystem.',
      category: 'fairness',
      entryPoint: 'fairness-boost/index.js',
      icon: '⚖️',
      isOfficial: true,
      configSchema: {
        properties: {
          boost_percentage: { type: 'number', min: 1, max: 50 },
          target_categories: { type: 'array' },
        },
        required: [],
      },
      hooks: [
        {
          name: 'on_fairness_search',
          priority: 5,
          handler: [
            'var results = input.results || [];',
            'var boost = (config && config.boost_percentage) || 15;',
            'var boosted = results.map(function(r) {',
            '  if (r.is_indie || r.is_small_business) {',
            '    return Object.assign({}, r, { score: (r.score || 0) * (1 + boost / 100), boosted: true });',
            '  }',
            '  return r;',
            '});',
            'return { results: boosted, boost_applied: boost };',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'security-monitor',
      version: '1.0.0',
      author: 'WAB Team',
      description: 'Monitors agent actions for suspicious patterns like credential harvesting, XSS payloads, and unauthorized data access.',
      category: 'security',
      entryPoint: 'security-monitor/index.js',
      icon: '🛡️',
      isOfficial: true,
      configSchema: {
        properties: {
          alert_threshold: { type: 'number', min: 1, max: 10 },
          blocked_patterns: { type: 'array' },
        },
        required: [],
      },
      hooks: [
        {
          name: 'after_action',
          priority: 1,
          handler: [
            'var action = input.action || "";',
            'var data = input.data || "";',
            'var dataStr = typeof data === "string" ? data : JSON.stringify(data);',
            'var suspicious = [];',
            'var patterns = [',
            '  { re: /password|passwd|secret|token/i, label: "credential_access" },',
            '  { re: /<script|javascript:|on\\w+\\s*=/i, label: "xss_attempt" },',
            '  { re: /eval\\(|Function\\(|setTimeout\\(.*,/i, label: "code_injection" },',
            '  { re: /\\.env|credentials|private_key/i, label: "sensitive_file_access" }',
            '];',
            'for (var i = 0; i < patterns.length; i++) {',
            '  if (patterns[i].re.test(action) || patterns[i].re.test(dataStr)) {',
            '    suspicious.push(patterns[i].label);',
            '  }',
            '}',
            'return { flagged: suspicious.length > 0, threats: suspicious, action: action, timestamp: new Date().toISOString() };',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'analytics-enhanced',
      version: '1.0.0',
      author: 'WAB Team',
      description: 'Provides detailed page-load analytics including timing metrics, resource counts, and performance scoring.',
      category: 'analytics',
      entryPoint: 'analytics-enhanced/index.js',
      icon: '📊',
      isOfficial: true,
      configSchema: {
        properties: {
          track_resources: { type: 'boolean' },
          track_timing: { type: 'boolean' },
          sampling_rate: { type: 'number', min: 0, max: 100 },
        },
        required: [],
      },
      hooks: [
        {
          name: 'on_page_load',
          priority: 10,
          handler: [
            'var url = input.url || "unknown";',
            'var timing = input.timing || {};',
            'var loadTime = timing.loadComplete || 0;',
            'var domReady = timing.domReady || 0;',
            'var resources = input.resources || [];',
            'var scripts = resources.filter(function(r) { return r.type === "script"; }).length;',
            'var styles = resources.filter(function(r) { return r.type === "stylesheet"; }).length;',
            'var images = resources.filter(function(r) { return r.type === "image"; }).length;',
            'var perfScore = 100;',
            'if (loadTime > 3000) perfScore -= 20;',
            'if (loadTime > 5000) perfScore -= 20;',
            'if (scripts > 20) perfScore -= 15;',
            'if (images > 50) perfScore -= 10;',
            'if (perfScore < 0) perfScore = 0;',
            'return {',
            '  url: url,',
            '  load_time_ms: loadTime,',
            '  dom_ready_ms: domReady,',
            '  resource_counts: { scripts: scripts, styles: styles, images: images, total: resources.length },',
            '  performance_score: perfScore,',
            '  tracked_at: new Date().toISOString()',
            '};',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'auto-healer',
      version: '1.0.0',
      author: 'WAB Team',
      description: 'Automatically logs errors and suggests self-healing strategies such as selector updates, retry logic, and fallback actions.',
      category: 'reliability',
      entryPoint: 'auto-healer/index.js',
      icon: '🩹',
      isOfficial: true,
      configSchema: {
        properties: {
          max_retries: { type: 'number', min: 0, max: 10 },
          auto_retry: { type: 'boolean' },
        },
        required: [],
      },
      hooks: [
        {
          name: 'on_error',
          priority: 3,
          handler: [
            'var errorMsg = input.error || input.message || "Unknown error";',
            'var selector = input.selector || null;',
            'var action = input.action || "unknown";',
            'var strategies = [];',
            'if (selector) {',
            '  strategies.push({ type: "selector_update", suggestion: "Try broader selector or data-testid attribute" });',
            '  strategies.push({ type: "wait_and_retry", suggestion: "Element may not be loaded yet, add wait before action" });',
            '}',
            'if (/timeout|ETIMEDOUT/i.test(errorMsg)) {',
            '  strategies.push({ type: "increase_timeout", suggestion: "Network may be slow, increase timeout threshold" });',
            '  strategies.push({ type: "retry", suggestion: "Transient failure, retry with exponential backoff" });',
            '}',
            'if (/not found|404/i.test(errorMsg)) {',
            '  strategies.push({ type: "fallback_url", suggestion: "Page may have moved, check for redirects" });',
            '}',
            'if (/permission|forbidden|403/i.test(errorMsg)) {',
            '  strategies.push({ type: "re_authenticate", suggestion: "Session may have expired, re-authenticate" });',
            '}',
            'if (strategies.length === 0) {',
            '  strategies.push({ type: "log_and_skip", suggestion: "Unknown error pattern, log and continue" });',
            '}',
            'return { error: errorMsg, action: action, selector: selector, strategies: strategies, analyzed_at: new Date().toISOString() };',
          ].join('\n'),
        },
      ],
    },
    {
      name: 'memory-optimizer',
      version: '1.0.0',
      author: 'WAB Team',
      description: 'Checks for duplicate entries before storing new data in agent memory, reducing storage waste and improving recall accuracy.',
      category: 'performance',
      entryPoint: 'memory-optimizer/index.js',
      icon: '🧠',
      isOfficial: true,
      configSchema: {
        properties: {
          similarity_threshold: { type: 'number', min: 0, max: 1 },
          max_memory_entries: { type: 'number', min: 10, max: 100000 },
        },
        required: [],
      },
      hooks: [
        {
          name: 'on_memory_store',
          priority: 5,
          handler: [
            'var key = input.key || "";',
            'var value = input.value || "";',
            'var existingKeys = input.existing_keys || [];',
            'var valueStr = typeof value === "string" ? value : JSON.stringify(value);',
            'var dominated = false;',
            'var duplicateOf = null;',
            'for (var i = 0; i < existingKeys.length; i++) {',
            '  if (existingKeys[i] === key) {',
            '    dominated = true;',
            '    duplicateOf = key;',
            '    break;',
            '  }',
            '  var normalizedExisting = existingKeys[i].toLowerCase().replace(/[^a-z0-9]/g, "");',
            '  var normalizedNew = key.toLowerCase().replace(/[^a-z0-9]/g, "");',
            '  if (normalizedExisting === normalizedNew) {',
            '    dominated = true;',
            '    duplicateOf = existingKeys[i];',
            '    break;',
            '  }',
            '}',
            'return {',
            '  allow_store: !dominated,',
            '  is_duplicate: dominated,',
            '  duplicate_of: duplicateOf,',
            '  key: key,',
            '  value_length: valueStr.length,',
            '  checked_at: new Date().toISOString()',
            '};',
          ].join('\n'),
        },
      ],
    },
  ];

  const doSeed = db.transaction(() => {
    for (const p of plugins) {
      try {
        registerPlugin(p);
      } catch (_) {
        // already exists
      }
    }
  });
  doSeed();
}

seedOfficialPlugins();

// ─── Exports ──────────────────────────────────────────────────────────

module.exports = {
  registerPlugin,
  getPlugin,
  getPluginByName,
  listPlugins,
  installPlugin,
  uninstallPlugin,
  configurePlugin,
  getInstalledPlugins,
  registerHook,
  executeHook,
  getAvailableHooks,
  validateConfig,
  getPluginStats,
  ratePlugin,
  getHookExecutionLog,
  seedOfficialPlugins,
};
