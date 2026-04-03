const crypto = require('crypto');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS swarm_configs (
    id TEXT PRIMARY KEY,
    site_id TEXT UNIQUE,
    name TEXT,
    strategy TEXT DEFAULT 'parallel',
    max_agents INTEGER DEFAULT 3,
    timeout_ms INTEGER DEFAULT 30000,
    merge_strategy TEXT DEFAULT 'best_score',
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS swarm_tasks (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    config_id TEXT,
    task_type TEXT,
    objective TEXT,
    parameters TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending',
    created_by TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS swarm_agents (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    agent_role TEXT,
    agent_type TEXT,
    target TEXT,
    status TEXT DEFAULT 'idle',
    result TEXT DEFAULT '{}',
    score REAL,
    error TEXT,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS swarm_results (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    merged_result TEXT DEFAULT '{}',
    fairness_applied INTEGER DEFAULT 0,
    total_sources INTEGER DEFAULT 0,
    best_source TEXT,
    comparison TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_swarm_configs_site ON swarm_configs(site_id);
  CREATE INDEX IF NOT EXISTS idx_swarm_tasks_site ON swarm_tasks(site_id);
  CREATE INDEX IF NOT EXISTS idx_swarm_tasks_status ON swarm_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_swarm_tasks_config ON swarm_tasks(config_id);
  CREATE INDEX IF NOT EXISTS idx_swarm_agents_task ON swarm_agents(task_id);
  CREATE INDEX IF NOT EXISTS idx_swarm_agents_status ON swarm_agents(status);
  CREATE INDEX IF NOT EXISTS idx_swarm_results_task ON swarm_results(task_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  upsertConfig: db.prepare(`
    INSERT INTO swarm_configs (id, site_id, name, strategy, max_agents, timeout_ms, merge_strategy, enabled)
    VALUES (@id, @site_id, @name, @strategy, @max_agents, @timeout_ms, @merge_strategy, @enabled)
    ON CONFLICT(site_id) DO UPDATE SET
      name = excluded.name,
      strategy = excluded.strategy,
      max_agents = excluded.max_agents,
      timeout_ms = excluded.timeout_ms,
      merge_strategy = excluded.merge_strategy,
      enabled = excluded.enabled,
      updated_at = datetime('now')
  `),
  getConfig: db.prepare('SELECT * FROM swarm_configs WHERE site_id = ?'),
  getConfigById: db.prepare('SELECT * FROM swarm_configs WHERE id = ?'),
  insertTask: db.prepare(`
    INSERT INTO swarm_tasks (id, site_id, config_id, task_type, objective, parameters, status, created_by)
    VALUES (@id, @site_id, @config_id, @task_type, @objective, @parameters, @status, @created_by)
  `),
  getTask: db.prepare('SELECT * FROM swarm_tasks WHERE id = ?'),
  updateTaskStatus: db.prepare('UPDATE swarm_tasks SET status = ?, started_at = COALESCE(started_at, ?), completed_at = ? WHERE id = ?'),
  insertAgent: db.prepare(`
    INSERT INTO swarm_agents (id, task_id, agent_role, agent_type, target, status)
    VALUES (@id, @task_id, @agent_role, @agent_type, @target, @status)
  `),
  getAgentsByTask: db.prepare('SELECT * FROM swarm_agents WHERE task_id = ? ORDER BY started_at ASC'),
  updateAgent: db.prepare(`
    UPDATE swarm_agents SET status = ?, result = ?, score = ?, error = ?, started_at = COALESCE(started_at, ?), completed_at = ?
    WHERE id = ?
  `),
  insertResult: db.prepare(`
    INSERT INTO swarm_results (id, task_id, merged_result, fairness_applied, total_sources, best_source, comparison)
    VALUES (@id, @task_id, @merged_result, @fairness_applied, @total_sources, @best_source, @comparison)
  `),
  getResult: db.prepare('SELECT * FROM swarm_results WHERE task_id = ?'),
  cancelPendingAgents: db.prepare("UPDATE swarm_agents SET status = 'cancelled' WHERE task_id = ? AND status IN ('idle', 'running')"),
  taskHistory: db.prepare('SELECT * FROM swarm_tasks WHERE site_id = ? ORDER BY created_at DESC LIMIT ?'),
  taskHistoryByType: db.prepare('SELECT * FROM swarm_tasks WHERE site_id = ? AND task_type = ? ORDER BY created_at DESC LIMIT ?'),
};

// ─── 1. configureSwarm ───────────────────────────────────────────────

function configureSwarm(siteId, { name, strategy, maxAgents, timeoutMs, mergeStrategy } = {}) {
  const existing = stmts.getConfig.get(siteId);
  const id = existing ? existing.id : crypto.randomUUID();

  const params = {
    id,
    site_id: siteId,
    name: name ?? (existing ? existing.name : siteId),
    strategy: strategy ?? (existing ? existing.strategy : 'parallel'),
    max_agents: maxAgents ?? (existing ? existing.max_agents : 3),
    timeout_ms: timeoutMs ?? (existing ? existing.timeout_ms : 30000),
    merge_strategy: mergeStrategy ?? (existing ? existing.merge_strategy : 'best_score'),
    enabled: 1,
  };

  stmts.upsertConfig.run(params);
  return stmts.getConfig.get(siteId);
}

// ─── 2. getSwarmConfig ───────────────────────────────────────────────

function getSwarmConfig(siteId) {
  return stmts.getConfig.get(siteId) || null;
}

// ─── 3. createTask ───────────────────────────────────────────────────

function createTask(siteId, { taskType, objective, parameters, createdBy } = {}) {
  const config = stmts.getConfig.get(siteId);
  const id = crypto.randomUUID();

  stmts.insertTask.run({
    id,
    site_id: siteId,
    config_id: config ? config.id : null,
    task_type: taskType || 'general',
    objective: objective || '',
    parameters: JSON.stringify(parameters || {}),
    status: 'pending',
    created_by: createdBy || null,
  });

  return stmts.getTask.get(id);
}

// ─── 4. assignAgents ─────────────────────────────────────────────────

function assignAgents(taskId, agentDefinitions) {
  const task = stmts.getTask.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const config = task.config_id ? stmts.getConfigById.get(task.config_id) : null;
  const maxAgents = config ? config.max_agents : 10;
  const defs = agentDefinitions.slice(0, maxAgents);

  const agents = [];
  const insertMany = db.transaction((items) => {
    for (const def of items) {
      const agentId = crypto.randomUUID();
      stmts.insertAgent.run({
        id: agentId,
        task_id: taskId,
        agent_role: def.role || 'worker',
        agent_type: def.type || 'fetch',
        target: def.target || '',
        status: 'idle',
      });
      agents.push({ id: agentId, task_id: taskId, agent_role: def.role, agent_type: def.type, target: def.target, status: 'idle' });
    }
  });

  insertMany(defs);
  return agents;
}

// ─── 5. runSwarmTask ─────────────────────────────────────────────────

async function runSwarmTask(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  if (task.status === 'cancelled') throw new Error(`Task ${taskId} is cancelled`);

  const config = task.config_id ? stmts.getConfigById.get(task.config_id) : null;
  const strategy = config ? config.strategy : 'parallel';
  const mergeStrategy = config ? config.merge_strategy : 'best_score';
  const timeoutMs = config ? config.timeout_ms : 30000;

  const now = new Date().toISOString();
  stmts.updateTaskStatus.run('running', now, null, taskId);

  let agents = stmts.getAgentsByTask.all(taskId);
  if (agents.length === 0) throw new Error(`No agents assigned to task ${taskId}`);

  try {
    switch (strategy) {
      case 'sequential':
        await runSequential(agents, timeoutMs);
        break;
      case 'competitive':
        await runCompetitive(agents, timeoutMs);
        break;
      case 'collaborative':
        await runCollaborative(agents, timeoutMs);
        break;
      case 'parallel':
      default:
        await runParallel(agents, timeoutMs);
        break;
    }

    agents = stmts.getAgentsByTask.all(taskId);
    const completedAgents = agents.filter(a => a.status === 'completed');

    const rawResults = completedAgents.map(a => {
      let parsed = {};
      try { parsed = JSON.parse(a.result || '{}'); } catch (_) {}
      return { ...parsed, _agentId: a.id, _role: a.agent_role, _score: a.score, _source: a.target };
    });

    const fairResults = applyFairnessToResults(rawResults);
    const merged = mergeResults(fairResults, mergeStrategy);

    const bestAgent = completedAgents.reduce((best, cur) =>
      (cur.score || 0) > (best.score || 0) ? cur : best, completedAgents[0]);

    const comparison = completedAgents.map(a => ({
      agentId: a.id,
      role: a.agent_role,
      target: a.target,
      score: a.score,
      status: a.status,
    }));

    const resultId = crypto.randomUUID();
    stmts.insertResult.run({
      id: resultId,
      task_id: taskId,
      merged_result: JSON.stringify(merged),
      fairness_applied: 1,
      total_sources: completedAgents.length,
      best_source: bestAgent ? bestAgent.target : null,
      comparison: JSON.stringify(comparison),
    });

    const doneAt = new Date().toISOString();
    stmts.updateTaskStatus.run('completed', now, doneAt, taskId);

    return { taskId, status: 'completed', result: merged, sources: completedAgents.length, bestSource: bestAgent ? bestAgent.target : null };
  } catch (err) {
    const failAt = new Date().toISOString();
    stmts.updateTaskStatus.run('failed', now, failAt, taskId);
    throw err;
  }
}

// ─── Strategy Runners ────────────────────────────────────────────────

async function runParallel(agents, timeoutMs) {
  const promises = agents.map(agent => runSingleAgent(agent, timeoutMs));
  await Promise.allSettled(promises);
}

async function runSequential(agents, timeoutMs) {
  let previousResult = null;
  for (const agent of agents) {
    previousResult = await runSingleAgent(agent, timeoutMs, previousResult);
  }
}

async function runCompetitive(agents, timeoutMs) {
  const promises = agents.map(agent => runSingleAgent(agent, timeoutMs));
  await Promise.allSettled(promises);
}

async function runCollaborative(agents, timeoutMs) {
  const promises = agents.map(agent => runSingleAgent(agent, timeoutMs));
  await Promise.allSettled(promises);
}

async function runSingleAgent(agent, timeoutMs, previousResult) {
  const startedAt = new Date().toISOString();
  stmts.updateAgent.run('running', agent.result || '{}', null, null, startedAt, null, agent.id);

  try {
    const agentInput = { ...agent, timeoutMs, previousResult };
    const result = await executeAgent(agentInput);
    const completedAt = new Date().toISOString();
    stmts.updateAgent.run('completed', JSON.stringify(result), result.relevance || 0, null, startedAt, completedAt, agent.id);
    return result;
  } catch (err) {
    const completedAt = new Date().toISOString();
    stmts.updateAgent.run('failed', '{}', 0, err.message, startedAt, completedAt, agent.id);
    return null;
  }
}

// ─── 6. executeAgent ─────────────────────────────────────────────────

function executeAgent(agent) {
  const timeout = agent.timeoutMs || 30000;
  const targetUrl = agent.target;

  if (!targetUrl) {
    return Promise.resolve({ title: '', description: '', prices: [], relevance: 0, source: '' });
  }

  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch (_) {
      return resolve({ title: '', description: '', prices: [], relevance: 0, source: targetUrl, error: 'Invalid URL' });
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => {
      req.destroy();
      resolve({ title: '', description: '', prices: [], relevance: 0, source: targetUrl, error: 'Timeout' });
    }, timeout);

    const req = transport.get(targetUrl, { headers: { 'User-Agent': 'WAB-Swarm-Agent/1.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        clearTimeout(timer);
        const redirectAgent = { ...agent, target: res.headers.location };
        resolve(executeAgent(redirectAgent));
        res.resume();
        return;
      }

      let body = '';
      const maxBytes = 2 * 1024 * 1024;
      let received = 0;

      res.on('data', (chunk) => {
        received += chunk.length;
        if (received <= maxBytes) body += chunk;
      });

      res.on('end', () => {
        clearTimeout(timer);

        const title = extractFirst(body, /<title[^>]*>([\s\S]*?)<\/title>/i) || '';
        const metaDesc = extractFirst(body, /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i)
          || extractFirst(body, /<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["']/i)
          || '';
        const h1 = extractFirst(body, /<h1[^>]*>([\s\S]*?)<\/h1>/i) || '';
        const priceMatches = body.match(/(?:\$|USD\s?)(\d{1,7}(?:[.,]\d{2})?)/g) || [];
        const prices = [...new Set(priceMatches.slice(0, 20))];

        const objective = agent.previousResult?.objective || '';
        const relevance = computeRelevanceScore(title, metaDesc, h1, prices, objective, targetUrl);

        resolve({
          title: cleanHtml(title).slice(0, 500),
          description: cleanHtml(metaDesc).slice(0, 1000),
          h1: cleanHtml(h1).slice(0, 500),
          prices,
          relevance,
          source: targetUrl,
          statusCode: res.statusCode,
        });
      });

      res.on('error', (err) => {
        clearTimeout(timer);
        resolve({ title: '', description: '', prices: [], relevance: 0, source: targetUrl, error: err.message });
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      resolve({ title: '', description: '', prices: [], relevance: 0, source: targetUrl, error: err.message });
    });
  });
}

function extractFirst(html, regex) {
  const m = html.match(regex);
  return m ? m[1].trim() : null;
}

function cleanHtml(text) {
  return text.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function computeRelevanceScore(title, description, h1, prices, objective, source) {
  let score = 0;

  if (title) score += 15;
  if (description) score += 15;
  if (h1) score += 10;
  if (prices.length > 0) score += 10;

  if (objective) {
    const terms = objective.toLowerCase().split(/\s+/).filter(Boolean);
    const corpus = `${title} ${description} ${h1}`.toLowerCase();
    let hits = 0;
    for (const t of terms) {
      if (corpus.includes(t)) hits++;
    }
    const termRatio = terms.length > 0 ? hits / terms.length : 0;
    score += Math.round(termRatio * 40);
  } else {
    score += 20;
  }

  if (source) {
    try {
      const u = new URL(source);
      if (u.protocol === 'https:') score += 5;
      if (u.pathname !== '/' && u.pathname.length > 1) score += 5;
    } catch (_) {}
  }

  return Math.min(Math.max(Math.round(score * 100) / 100, 0), 100);
}

// ─── 7. mergeResults ─────────────────────────────────────────────────

function mergeResults(agents, strategy) {
  if (!agents || agents.length === 0) return { merged: true, data: [], strategy };

  switch (strategy) {
    case 'best_score': return mergeBestScore(agents);
    case 'weighted_average': return mergeWeightedAverage(agents);
    case 'union': return mergeUnion(agents);
    case 'consensus': return mergeConsensus(agents);
    default: return mergeBestScore(agents);
  }
}

function mergeBestScore(agents) {
  const sorted = [...agents].sort((a, b) => (b._score || b.relevance || 0) - (a._score || a.relevance || 0));
  const best = sorted[0];
  return {
    merged: true,
    strategy: 'best_score',
    title: best.title || '',
    description: best.description || '',
    h1: best.h1 || '',
    prices: best.prices || [],
    relevance: best._score || best.relevance || 0,
    source: best._source || best.source || '',
    allSources: sorted.map(a => ({ source: a._source || a.source, score: a._score || a.relevance || 0 })),
  };
}

function mergeWeightedAverage(agents) {
  const totalWeight = agents.reduce((s, a) => s + (a._score || a.relevance || 0), 0);
  if (totalWeight === 0) return mergeBestScore(agents);

  const allPrices = [];
  let weightedRelevance = 0;
  let bestTitle = '';
  let bestDesc = '';
  let bestH1 = '';
  let highestWeight = -1;

  for (const a of agents) {
    const w = a._score || a.relevance || 0;
    weightedRelevance += w * w;
    if (a.prices) allPrices.push(...a.prices);
    if (w > highestWeight) {
      highestWeight = w;
      bestTitle = a.title || bestTitle;
      bestDesc = a.description || bestDesc;
      bestH1 = a.h1 || bestH1;
    }
  }

  return {
    merged: true,
    strategy: 'weighted_average',
    title: bestTitle,
    description: bestDesc,
    h1: bestH1,
    prices: [...new Set(allPrices)],
    relevance: Math.round((weightedRelevance / totalWeight) * 100) / 100,
    sourceCount: agents.length,
    allSources: agents.map(a => ({ source: a._source || a.source, score: a._score || a.relevance || 0 })),
  };
}

function mergeUnion(agents) {
  const allPrices = [];
  const allTitles = [];
  const allDescriptions = [];
  let maxRelevance = 0;

  for (const a of agents) {
    if (a.title) allTitles.push(a.title);
    if (a.description) allDescriptions.push(a.description);
    if (a.prices) allPrices.push(...a.prices);
    maxRelevance = Math.max(maxRelevance, a._score || a.relevance || 0);
  }

  return {
    merged: true,
    strategy: 'union',
    titles: [...new Set(allTitles)],
    descriptions: [...new Set(allDescriptions)],
    prices: [...new Set(allPrices)],
    relevance: maxRelevance,
    sourceCount: agents.length,
    allSources: agents.map(a => ({ source: a._source || a.source, score: a._score || a.relevance || 0 })),
  };
}

function mergeConsensus(agents) {
  const titleFreq = {};
  const priceFreq = {};
  let bestDesc = '';
  let bestDescScore = -1;

  for (const a of agents) {
    const t = (a.title || '').toLowerCase().trim();
    if (t) titleFreq[t] = (titleFreq[t] || 0) + 1;
    if (a.prices) {
      for (const p of a.prices) priceFreq[p] = (priceFreq[p] || 0) + 1;
    }
    const s = a._score || a.relevance || 0;
    if (s > bestDescScore && a.description) {
      bestDescScore = s;
      bestDesc = a.description;
    }
  }

  const threshold = Math.max(Math.ceil(agents.length / 2), 1);

  const consensusTitles = Object.entries(titleFreq).filter(([, c]) => c >= threshold).map(([t]) => t);
  const consensusPrices = Object.entries(priceFreq).filter(([, c]) => c >= threshold).map(([p]) => p);

  const avgRelevance = agents.reduce((s, a) => s + (a._score || a.relevance || 0), 0) / agents.length;

  return {
    merged: true,
    strategy: 'consensus',
    titles: consensusTitles,
    description: bestDesc,
    prices: consensusPrices,
    relevance: Math.round(avgRelevance * 100) / 100,
    agreement: {
      titleAgreement: consensusTitles.length > 0,
      priceAgreement: consensusPrices.length > 0,
      threshold,
      totalAgents: agents.length,
    },
    allSources: agents.map(a => ({ source: a._source || a.source, score: a._score || a.relevance || 0 })),
  };
}

// ─── 8. applyFairnessToResults ───────────────────────────────────────

function applyFairnessToResults(results) {
  if (!results || results.length === 0) return results;

  const domainCounts = {};
  for (const r of results) {
    const domain = extractDomain(r._source || r.source || '');
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }

  const totalResults = results.length;

  return results.map(r => {
    const domain = extractDomain(r._source || r.source || '');
    const score = r._score || r.relevance || 0;
    let adjusted = score;

    const isIndie = isIndependentSite(domain);
    if (isIndie) adjusted += score * 0.12;

    const domainShare = (domainCounts[domain] || 1) / totalResults;
    if (domainShare > 0.4) {
      adjusted -= score * 0.10;
    }

    const isSmall = isSmallSite(domain);
    if (isSmall) adjusted += score * 0.08;

    adjusted = Math.min(Math.max(Math.round(adjusted * 100) / 100, 0), 100);

    return { ...r, _score: adjusted, _fairnessApplied: true, _originalScore: score };
  });
}

function extractDomain(url) {
  try { return new URL(url).hostname; } catch (_) { return url; }
}

const MAJOR_DOMAINS = [
  'amazon.com', 'google.com', 'facebook.com', 'apple.com', 'microsoft.com',
  'walmart.com', 'ebay.com', 'target.com', 'bestbuy.com', 'alibaba.com',
  'aliexpress.com', 'rakuten.com', 'shopify.com', 'etsy.com',
];

function isIndependentSite(domain) {
  const lower = domain.toLowerCase().replace(/^www\./, '');
  return !MAJOR_DOMAINS.some(d => lower === d || lower.endsWith('.' + d));
}

function isSmallSite(domain) {
  const lower = domain.toLowerCase().replace(/^www\./, '');
  const parts = lower.split('.');
  if (parts.length > 3) return false;
  return !MAJOR_DOMAINS.some(d => lower === d || lower.endsWith('.' + d));
}

// ─── 9. getTaskStatus / getTaskResult ────────────────────────────────

function getTaskStatus(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) return null;

  const agents = stmts.getAgentsByTask.all(taskId);
  const agentSummary = agents.map(a => ({
    id: a.id,
    role: a.agent_role,
    type: a.agent_type,
    target: a.target,
    status: a.status,
    score: a.score,
    error: a.error,
  }));

  return {
    id: task.id,
    siteId: task.site_id,
    taskType: task.task_type,
    objective: task.objective,
    status: task.status,
    createdAt: task.created_at,
    startedAt: task.started_at,
    completedAt: task.completed_at,
    agents: agentSummary,
  };
}

function getTaskResult(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) return null;

  const resultRow = stmts.getResult.get(taskId);
  if (!resultRow) return { taskId, status: task.status, result: null };

  let mergedResult = {};
  let comparison = {};
  try { mergedResult = JSON.parse(resultRow.merged_result || '{}'); } catch (_) {}
  try { comparison = JSON.parse(resultRow.comparison || '{}'); } catch (_) {}

  return {
    taskId,
    status: task.status,
    result: mergedResult,
    fairnessApplied: !!resultRow.fairness_applied,
    totalSources: resultRow.total_sources,
    bestSource: resultRow.best_source,
    comparison,
    createdAt: resultRow.created_at,
  };
}

// ─── 10. cancelTask ──────────────────────────────────────────────────

function cancelTask(taskId) {
  const task = stmts.getTask.get(taskId);
  if (!task) return null;
  if (task.status === 'completed' || task.status === 'cancelled') {
    return { id: task.id, status: task.status, changed: false };
  }

  const now = new Date().toISOString();
  stmts.updateTaskStatus.run('cancelled', task.started_at || now, now, taskId);
  stmts.cancelPendingAgents.run(taskId);

  return { id: task.id, status: 'cancelled', changed: true };
}

// ─── 11. getSwarmHistory ─────────────────────────────────────────────

function getSwarmHistory(siteId, { limit = 50, taskType } = {}) {
  let tasks;
  if (taskType) {
    tasks = stmts.taskHistoryByType.all(siteId, taskType, limit);
  } else {
    tasks = stmts.taskHistory.all(siteId, limit);
  }

  return tasks.map(t => {
    let params = {};
    try { params = JSON.parse(t.parameters || '{}'); } catch (_) {}
    const agents = stmts.getAgentsByTask.all(t.id);
    return {
      id: t.id,
      taskType: t.task_type,
      objective: t.objective,
      parameters: params,
      status: t.status,
      agentCount: agents.length,
      createdBy: t.created_by,
      createdAt: t.created_at,
      startedAt: t.started_at,
      completedAt: t.completed_at,
    };
  });
}

// ─── 12. getSwarmStats ───────────────────────────────────────────────

function getSwarmStats(siteId) {
  const totalTasks = db.prepare('SELECT COUNT(*) as c FROM swarm_tasks WHERE site_id = ?').get(siteId).c;
  const completedTasks = db.prepare("SELECT COUNT(*) as c FROM swarm_tasks WHERE site_id = ? AND status = 'completed'").get(siteId).c;
  const failedTasks = db.prepare("SELECT COUNT(*) as c FROM swarm_tasks WHERE site_id = ? AND status = 'failed'").get(siteId).c;
  const cancelledTasks = db.prepare("SELECT COUNT(*) as c FROM swarm_tasks WHERE site_id = ? AND status = 'cancelled'").get(siteId).c;
  const runningTasks = db.prepare("SELECT COUNT(*) as c FROM swarm_tasks WHERE site_id = ? AND status = 'running'").get(siteId).c;

  const avgAgentsRow = db.prepare(`
    SELECT AVG(agent_count) as avg_agents FROM (
      SELECT COUNT(*) as agent_count FROM swarm_agents a
      JOIN swarm_tasks t ON a.task_id = t.id
      WHERE t.site_id = ? GROUP BY a.task_id
    )
  `).get(siteId);
  const avgAgents = avgAgentsRow ? Math.round((avgAgentsRow.avg_agents || 0) * 100) / 100 : 0;

  const successRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 10000) / 100 : 0;

  const latencyRow = db.prepare(`
    SELECT AVG(
      CAST((julianday(completed_at) - julianday(started_at)) * 86400000 AS INTEGER)
    ) as avg_latency
    FROM swarm_tasks
    WHERE site_id = ? AND status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
  `).get(siteId);
  const avgLatencyMs = latencyRow ? Math.round(latencyRow.avg_latency || 0) : 0;

  const taskTypeBreakdown = db.prepare(`
    SELECT task_type, COUNT(*) as count,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
    FROM swarm_tasks WHERE site_id = ? GROUP BY task_type
  `).all(siteId);

  return {
    totalTasks,
    completedTasks,
    failedTasks,
    cancelledTasks,
    runningTasks,
    avgAgents,
    successRate,
    avgLatencyMs,
    taskTypeBreakdown,
  };
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  configureSwarm,
  getSwarmConfig,
  createTask,
  assignAgents,
  runSwarmTask,
  executeAgent,
  mergeResults,
  applyFairnessToResults,
  getTaskStatus,
  getTaskResult,
  cancelTask,
  getSwarmHistory,
  getSwarmStats,
};
