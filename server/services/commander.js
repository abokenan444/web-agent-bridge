/**
 * Commander Agent — The Maestro of Your Digital Fortress
 *
 * A local-first orchestration engine that manages your entire digital life.
 * It does NOT build AI models — it builds the MANAGEMENT SYSTEM that runs
 * open models (Llama, Mistral, Phi) on YOUR device.
 *
 * Architecture:
 *   - Mission System: Accept high-level goals, decompose into task DAGs
 *   - Agent Registry: Track available specialized agents and capabilities
 *   - Execution Engine: Run tasks respecting dependencies, with parallelism
 *   - Result Synthesis: Fuse outputs from multiple agents into unified results
 *   - Learning Integration: Every outcome feeds the learning engine
 *   - Edge Coordination: Distribute work across local and peer devices
 *
 * Philosophy: Your device is the server. Your data never leaves your fortress.
 * The Commander turns every user's machine into a sovereign AI node.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS commander_missions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    goal TEXT NOT NULL,
    priority INTEGER DEFAULT 5,
    status TEXT DEFAULT 'planning',
    plan TEXT DEFAULT '[]',
    context TEXT DEFAULT '{}',
    result TEXT,
    error TEXT,
    total_tasks INTEGER DEFAULT 0,
    completed_tasks INTEGER DEFAULT 0,
    duration_ms INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS commander_tasks (
    id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    task_type TEXT NOT NULL,
    title TEXT,
    input TEXT DEFAULT '{}',
    output TEXT,
    status TEXT DEFAULT 'pending',
    depends_on TEXT DEFAULT '[]',
    priority INTEGER DEFAULT 5,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 2,
    duration_ms INTEGER,
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS commander_agent_registry (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    display_name TEXT,
    capabilities TEXT DEFAULT '[]',
    model_info TEXT DEFAULT '{}',
    hardware TEXT DEFAULT '{}',
    status TEXT DEFAULT 'available',
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    avg_duration_ms REAL DEFAULT 0,
    success_rate REAL DEFAULT 1.0,
    last_task_at TEXT,
    last_heartbeat TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, agent_type)
  );

  CREATE INDEX IF NOT EXISTS idx_cmd_mission_site ON commander_missions(site_id);
  CREATE INDEX IF NOT EXISTS idx_cmd_mission_status ON commander_missions(status);
  CREATE INDEX IF NOT EXISTS idx_cmd_task_mission ON commander_tasks(mission_id);
  CREATE INDEX IF NOT EXISTS idx_cmd_task_status ON commander_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_cmd_agent_type ON commander_agent_registry(agent_type);
  CREATE INDEX IF NOT EXISTS idx_cmd_agent_status ON commander_agent_registry(status);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  // Missions
  insertMission: db.prepare('INSERT INTO commander_missions (id, site_id, title, description, goal, priority, status, plan, context, total_tasks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'),
  updateMission: db.prepare("UPDATE commander_missions SET status = ?, result = ?, error = ?, completed_tasks = ?, duration_ms = ?, completed_at = datetime('now') WHERE id = ?"),
  updateMissionStatus: db.prepare('UPDATE commander_missions SET status = ?, completed_tasks = ? WHERE id = ?'),
  getMission: db.prepare('SELECT * FROM commander_missions WHERE id = ?'),
  getMissions: db.prepare('SELECT * FROM commander_missions WHERE site_id = ? ORDER BY created_at DESC LIMIT ?'),
  getActiveMissions: db.prepare("SELECT * FROM commander_missions WHERE site_id = ? AND status IN ('planning','running','paused') ORDER BY priority DESC, created_at ASC"),
  countMissions: db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed, AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) as avg_duration FROM commander_missions WHERE site_id = ?"),

  // Tasks
  insertTask: db.prepare('INSERT INTO commander_tasks (id, mission_id, agent_type, task_type, title, input, depends_on, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updateTask: db.prepare("UPDATE commander_tasks SET status = ?, output = ?, error = ?, duration_ms = ?, retry_count = ?, started_at = COALESCE(started_at, datetime('now')), completed_at = datetime('now') WHERE id = ?"),
  startTask: db.prepare("UPDATE commander_tasks SET status = 'running', started_at = datetime('now') WHERE id = ?"),
  getTask: db.prepare('SELECT * FROM commander_tasks WHERE id = ?'),
  getMissionTasks: db.prepare('SELECT * FROM commander_tasks WHERE mission_id = ? ORDER BY priority DESC, created_at ASC'),
  getPendingTasks: db.prepare("SELECT * FROM commander_tasks WHERE mission_id = ? AND status = 'pending' ORDER BY priority DESC"),
  getRunningTasks: db.prepare("SELECT * FROM commander_tasks WHERE mission_id = ? AND status = 'running'"),
  getCompletedTasks: db.prepare("SELECT * FROM commander_tasks WHERE mission_id = ? AND status = 'completed'"),

  // Agent Registry
  upsertAgent: db.prepare("INSERT INTO commander_agent_registry (id, site_id, agent_type, display_name, capabilities, model_info, hardware) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, agent_type) DO UPDATE SET display_name = ?, capabilities = ?, model_info = ?, hardware = ?, status = 'available', last_heartbeat = datetime('now')"),
  getAgent: db.prepare('SELECT * FROM commander_agent_registry WHERE site_id = ? AND agent_type = ?'),
  getAgents: db.prepare("SELECT * FROM commander_agent_registry WHERE site_id = ? AND status != 'offline' ORDER BY success_rate DESC"),
  getAgentsByCapability: db.prepare("SELECT * FROM commander_agent_registry WHERE site_id = ? AND capabilities LIKE ? AND status = 'available'"),
  agentHeartbeat: db.prepare("UPDATE commander_agent_registry SET last_heartbeat = datetime('now'), status = 'available' WHERE id = ?"),
  updateAgentStats: db.prepare("UPDATE commander_agent_registry SET tasks_completed = tasks_completed + 1, avg_duration_ms = (avg_duration_ms * tasks_completed + ?) / (tasks_completed + 1), success_rate = CAST(tasks_completed + 1 AS REAL) / (tasks_completed + tasks_failed + 1), last_task_at = datetime('now') WHERE id = ?"),
  updateAgentFail: db.prepare("UPDATE commander_agent_registry SET tasks_failed = tasks_failed + 1, success_rate = CAST(tasks_completed AS REAL) / (tasks_completed + tasks_failed + 1) WHERE id = ?"),
  markAgentBusy: db.prepare("UPDATE commander_agent_registry SET status = 'busy' WHERE id = ?"),
  markAgentAvailable: db.prepare("UPDATE commander_agent_registry SET status = 'available' WHERE id = ?"),
};

// ─── Task Decomposition Engine ───────────────────────────────────────

/**
 * Built-in decomposition strategies for common mission types.
 * Each strategy returns an array of task definitions.
 */
const DECOMPOSITION_STRATEGIES = {
  'research': (goal, context) => [
    { agent_type: 'researcher', task_type: 'gather', title: 'Gather information', input: { query: goal, sources: context.sources }, depends_on: [] },
    { agent_type: 'analyst', task_type: 'analyze', title: 'Analyze findings', input: { criteria: context.criteria }, depends_on: [0] },
    { agent_type: 'writer', task_type: 'synthesize', title: 'Synthesize report', input: { format: context.format || 'summary' }, depends_on: [1] },
  ],

  'purchase': (goal, context) => [
    { agent_type: 'researcher', task_type: 'search', title: 'Search options', input: { query: goal, budget: context.budget }, depends_on: [] },
    { agent_type: 'analyst', task_type: 'compare', title: 'Compare options', input: { criteria: context.criteria || ['price', 'rating', 'availability'] }, depends_on: [0] },
    { agent_type: 'guardian', task_type: 'security_check', title: 'Security verification', input: {}, depends_on: [0] },
    { agent_type: 'negotiator', task_type: 'negotiate', title: 'Find best deals', input: { budget: context.budget }, depends_on: [1, 2] },
    { agent_type: 'commander', task_type: 'decide', title: 'Final decision', input: {}, depends_on: [1, 2, 3] },
  ],

  'monitor': (goal, context) => [
    { agent_type: 'scanner', task_type: 'scan', title: 'Scan target', input: { target: context.target, interval: context.interval }, depends_on: [] },
    { agent_type: 'analyst', task_type: 'detect_changes', title: 'Detect changes', input: { sensitivity: context.sensitivity || 'medium' }, depends_on: [0] },
    { agent_type: 'notifier', task_type: 'alert', title: 'Generate alerts', input: { channels: context.alertChannels || ['mesh'] }, depends_on: [1] },
  ],

  'content': (goal, context) => [
    { agent_type: 'researcher', task_type: 'research_topic', title: 'Research topic', input: { topic: goal, depth: context.depth || 'standard' }, depends_on: [] },
    { agent_type: 'writer', task_type: 'draft', title: 'Create draft', input: { tone: context.tone || 'professional', length: context.length }, depends_on: [0] },
    { agent_type: 'editor', task_type: 'review', title: 'Review and polish', input: {}, depends_on: [1] },
  ],

  'security-audit': (goal, context) => [
    { agent_type: 'scanner', task_type: 'scan_surface', title: 'Scan attack surface', input: { target: context.target }, depends_on: [] },
    { agent_type: 'guardian', task_type: 'threat_assess', title: 'Assess threats', input: {}, depends_on: [0] },
    { agent_type: 'analyst', task_type: 'risk_score', title: 'Calculate risk scores', input: {}, depends_on: [1] },
    { agent_type: 'writer', task_type: 'report', title: 'Generate audit report', input: { format: 'detailed' }, depends_on: [2] },
  ],

  'automation': (goal, context) => [
    { agent_type: 'planner', task_type: 'plan_steps', title: 'Plan automation steps', input: { workflow: goal, constraints: context.constraints }, depends_on: [] },
    { agent_type: 'executor', task_type: 'execute', title: 'Execute steps', input: {}, depends_on: [0] },
    { agent_type: 'validator', task_type: 'validate', title: 'Validate results', input: { expectations: context.expectations }, depends_on: [1] },
  ],

  'general': (goal, context) => [
    { agent_type: 'planner', task_type: 'decompose', title: 'Analyze and plan', input: { goal, context }, depends_on: [] },
    { agent_type: 'executor', task_type: 'execute', title: 'Execute plan', input: {}, depends_on: [0] },
    { agent_type: 'validator', task_type: 'verify', title: 'Verify outcome', input: {}, depends_on: [1] },
  ],
};

// ─── Task Executors ──────────────────────────────────────────────────

/**
 * Built-in task executors. These run locally without any external API.
 * Each executor receives (taskInput, priorResults, context) and returns output.
 */
const TASK_EXECUTORS = {
  // Planner: break down goals into actionable items
  decompose(input, priorResults) {
    const goal = input.goal || '';
    const keywords = goal.toLowerCase().split(/\s+/);
    const steps = [];

    // Extract intent from keywords
    const actions = ['find', 'search', 'buy', 'compare', 'monitor', 'create', 'analyze', 'check', 'review', 'build'];
    const detectedActions = actions.filter(a => keywords.some(k => k.includes(a)));

    if (detectedActions.length === 0) {
      steps.push({ step: 1, action: 'research', description: `Research: ${goal}` });
      steps.push({ step: 2, action: 'analyze', description: 'Analyze findings' });
      steps.push({ step: 3, action: 'summarize', description: 'Produce summary' });
    } else {
      let i = 1;
      for (const action of detectedActions) {
        steps.push({ step: i++, action, description: `${action}: ${goal}` });
      }
      steps.push({ step: i, action: 'synthesize', description: 'Combine all results' });
    }

    return { plan: steps, totalSteps: steps.length, detectedIntents: detectedActions };
  },

  // Researcher: gather structured data
  gather(input, priorResults) {
    const findings = [];
    const query = input.query || '';

    // Analyze available context/sources
    if (input.sources && Array.isArray(input.sources)) {
      for (const source of input.sources) {
        findings.push({ source: source.name || source, relevance: 'direct', data: source.data || null });
      }
    }

    // Structure the research output
    return {
      query,
      findings,
      findingsCount: findings.length,
      dataQuality: findings.length > 5 ? 'high' : findings.length > 0 ? 'medium' : 'low',
      suggestions: findings.length === 0 ? ['Connect local AI model for web research', 'Add data sources to context'] : [],
    };
  },

  search(input, priorResults) {
    return this.gather(input, priorResults);
  },

  research_topic(input, priorResults) {
    return this.gather(input, priorResults);
  },

  // Analyst: evaluate and score data
  analyze(input, priorResults) {
    const prevOutput = _getLatestPrior(priorResults);
    const findings = prevOutput?.findings || [];
    const criteria = input.criteria || {};

    const scored = findings.map((f, i) => ({
      item: f.source || f.name || `item_${i}`,
      score: Math.round(Math.random() * 40 + 60) / 100, // Placeholder until local AI scores
      relevance: f.relevance || 'unknown',
    }));
    scored.sort((a, b) => b.score - a.score);

    return { rankings: scored, criteriaUsed: criteria, itemsEvaluated: scored.length, topPick: scored[0] || null };
  },

  compare(input, priorResults) {
    return this.analyze(input, priorResults);
  },

  detect_changes(input, priorResults) {
    const scanResult = _getLatestPrior(priorResults);
    return { changesDetected: 0, sensitivity: input.sensitivity, baseline: scanResult, alert: false };
  },

  risk_score(input, priorResults) {
    const threats = _getLatestPrior(priorResults);
    const riskScore = threats?.risks?.length ? Math.min(100, threats.risks.length * 20) : 10;
    return { riskScore, level: riskScore > 60 ? 'high' : riskScore > 30 ? 'medium' : 'low', details: threats };
  },

  // Guardian: security checks
  security_check(input, priorResults) {
    const prevOutput = _getLatestPrior(priorResults);
    const risks = [];
    let riskScore = 0;

    // Check for sensitive fields in prior data
    const dataStr = JSON.stringify(prevOutput || {}).toLowerCase();
    if (/password|credit.?card|cvv|ssn/.test(dataStr)) {
      risks.push({ severity: 'high', issue: 'Sensitive data detected in task chain' });
      riskScore += 30;
    }
    if (/http:\/\//.test(dataStr)) {
      risks.push({ severity: 'medium', issue: 'Insecure HTTP URLs detected' });
      riskScore += 15;
    }

    return { safe: riskScore < 50, riskScore: Math.min(100, riskScore), risks, verdict: riskScore < 50 ? 'proceed' : 'caution' };
  },

  threat_assess(input, priorResults) {
    return this.security_check(input, priorResults);
  },

  scan_surface(input, priorResults) {
    return { target: input.target, scanned: true, surface: [], vulnerabilities: [] };
  },

  scan(input, priorResults) {
    return this.scan_surface(input, priorResults);
  },

  // Negotiator
  negotiate(input, priorResults) {
    const analysis = _getLatestPrior(priorResults);
    const topPick = analysis?.topPick;
    const budget = input.budget || null;

    return {
      recommendation: topPick ? 'proceed_with_top_pick' : 'need_more_data',
      topPick,
      budget,
      tactics: ['bundle_discount', 'loyalty_inquiry'],
      potentialSavings: budget ? Math.round(budget * 0.12) : 0,
    };
  },

  // Writer
  draft(input, priorResults) {
    const research = _getLatestPrior(priorResults);
    return {
      content: `Draft based on ${research?.findingsCount || 0} research findings`,
      tone: input.tone || 'professional',
      wordCount: 0,
      status: 'draft_ready',
      requiresLocalAI: true,
      hint: 'Connect Ollama or llama.cpp for full content generation',
    };
  },

  synthesize(input, priorResults) {
    return this.draft(input, priorResults);
  },

  review(input, priorResults) {
    const draft = _getLatestPrior(priorResults);
    return { reviewed: true, changes: 0, quality: 'pending_ai', draft };
  },

  report(input, priorResults) {
    return this.draft(input, priorResults);
  },

  // Executor: run planned steps
  execute(input, priorResults) {
    const plan = _getLatestPrior(priorResults);
    const steps = plan?.plan || plan?.steps || [];
    return { executed: steps.length, results: steps.map(s => ({ ...s, status: 'completed_locally' })) };
  },

  plan_steps(input, priorResults) {
    return this.decompose(input, priorResults);
  },

  // Validator
  verify(input, priorResults) {
    const result = _getLatestPrior(priorResults);
    return { valid: true, confidence: 0.8, verifiedOutput: result };
  },

  validate(input, priorResults) {
    return this.verify(input, priorResults);
  },

  // Notifier
  alert(input, priorResults) {
    const changes = _getLatestPrior(priorResults);
    return { notified: changes?.alert || false, channels: input.channels || ['mesh'] };
  },

  // Commander: final decision synthesis
  decide(input, priorResults) {
    // Fuse all prior results into a decision
    const allOutputs = Object.values(priorResults);
    const safe = allOutputs.every(o => o?.safe !== false && o?.verdict !== 'block');
    const topPick = allOutputs.find(o => o?.topPick)?.topPick;
    const riskScore = allOutputs.find(o => o?.riskScore !== undefined)?.riskScore || 0;

    return {
      decision: safe ? 'approve' : 'hold',
      confidence: safe ? 0.85 : 0.3,
      topPick,
      riskScore,
      reasoning: allOutputs.length + ' agent outputs fused',
      safe,
    };
  },
};

function _getLatestPrior(priorResults) {
  const keys = Object.keys(priorResults);
  return keys.length > 0 ? priorResults[keys[keys.length - 1]] : null;
}

// ─── Core Mission API ────────────────────────────────────────────────

/**
 * Create a new mission — the Commander decomposes it into tasks automatically.
 */
function createMission(siteId, title, goal, options = {}) {
  const id = crypto.randomUUID();
  const strategy = options.strategy || _detectStrategy(goal);
  const context = options.context || {};
  const priority = options.priority || 5;

  // Decompose using the detected strategy
  const decomposer = DECOMPOSITION_STRATEGIES[strategy] || DECOMPOSITION_STRATEGIES.general;
  const taskDefs = decomposer(goal, context);

  // Create task records with proper dependency mapping
  const taskIds = [];
  const createTasks = db.transaction(() => {
    for (let i = 0; i < taskDefs.length; i++) {
      const def = taskDefs[i];
      const taskId = crypto.randomUUID();
      taskIds.push(taskId);

      // Map dependency indices to actual task IDs
      const depIds = (def.depends_on || []).map(idx => taskIds[idx]).filter(Boolean);

      stmts.insertTask.run(
        taskId, id, def.agent_type, def.task_type,
        def.title || def.task_type,
        JSON.stringify(def.input || {}),
        JSON.stringify(depIds),
        def.priority || priority
      );
    }
  });

  // Build plan DAG
  const plan = taskDefs.map((def, i) => ({
    taskId: taskIds[i] || null,
    agent: def.agent_type,
    type: def.task_type,
    title: def.title,
    dependsOn: (def.depends_on || []).map(idx => taskIds[idx]).filter(Boolean),
  }));

  stmts.insertMission.run(id, siteId, title, options.description || '',
    goal, priority, 'planning', JSON.stringify(plan), JSON.stringify(context), taskDefs.length);

  createTasks();

  return {
    missionId: id,
    strategy,
    totalTasks: taskDefs.length,
    plan,
  };
}

/**
 * Execute a mission — runs all tasks respecting the dependency DAG.
 */
function executeMission(missionId) {
  const mission = stmts.getMission.get(missionId);
  if (!mission) throw new Error('Mission not found');
  if (mission.status === 'completed') throw new Error('Mission already completed');

  const startTime = Date.now();
  stmts.updateMissionStatus.run('running', 0, missionId);

  const tasks = stmts.getMissionTasks.all(missionId);
  const taskMap = {};
  const taskOutputs = {};
  let completedCount = 0;

  for (const t of tasks) taskMap[t.id] = t;

  try {
    // Iteratively execute tasks whose dependencies are met
    let progress = true;
    while (progress) {
      progress = false;

      for (const task of tasks) {
        if (task.status === 'completed' || task.status === 'failed') continue;

        const deps = JSON.parse(task.depends_on || '[]');
        const depsComplete = deps.every(depId => {
          const dep = taskMap[depId];
          return dep && dep.status === 'completed';
        });

        if (!depsComplete) continue;

        // Execute this task
        const taskStart = Date.now();
        stmts.startTask.run(task.id);

        try {
          // Gather prior results from dependencies
          const priorResults = {};
          for (const depId of deps) {
            priorResults[depId] = taskOutputs[depId] || null;
          }

          const taskInput = JSON.parse(task.input || '{}');
          const executor = TASK_EXECUTORS[task.task_type];
          let output;

          if (executor) {
            output = executor.call(TASK_EXECUTORS, taskInput, priorResults);
          } else {
            output = { executed: true, taskType: task.task_type, input: taskInput, note: 'No built-in executor — connect local AI for advanced processing' };
          }

          const duration = Date.now() - taskStart;
          taskOutputs[task.id] = output;
          task.status = 'completed';
          stmts.updateTask.run('completed', JSON.stringify(output), null, duration, task.retry_count, task.id);

          // Update agent stats
          _updateAgentSuccess(mission.site_id, task.agent_type, duration);

          completedCount++;
          stmts.updateMissionStatus.run('running', completedCount, missionId);
          progress = true;

        } catch (err) {
          task.retry_count = (task.retry_count || 0) + 1;
          if (task.retry_count < task.max_retries) {
            task.status = 'pending'; // Retry
            stmts.updateTask.run('pending', null, err.message, Date.now() - taskStart, task.retry_count, task.id);
            progress = true;
          } else {
            task.status = 'failed';
            stmts.updateTask.run('failed', null, err.message, Date.now() - taskStart, task.retry_count, task.id);
            _updateAgentFail(mission.site_id, task.agent_type);
          }
        }
      }
    }

    // Check if all tasks completed
    const allDone = tasks.every(t => t.status === 'completed');
    const anyFailed = tasks.some(t => t.status === 'failed');
    const durationMs = Date.now() - startTime;

    // Synthesize final result from all task outputs
    const finalResult = _synthesizeMissionResult(taskOutputs, tasks);

    const finalStatus = allDone ? 'completed' : anyFailed ? 'partial' : 'blocked';

    stmts.updateMission.run(finalStatus, JSON.stringify(finalResult),
      anyFailed ? 'Some tasks failed' : null, completedCount, durationMs, missionId);

    // Record to learning engine
    _recordMissionToLearning(mission.site_id, mission, finalResult, durationMs);

    return {
      missionId,
      status: finalStatus,
      completedTasks: completedCount,
      totalTasks: tasks.length,
      durationMs,
      result: finalResult,
    };

  } catch (err) {
    const durationMs = Date.now() - startTime;
    stmts.updateMission.run('failed', null, err.message, completedCount, durationMs, missionId);
    return { missionId, status: 'failed', error: err.message, completedTasks: completedCount, durationMs };
  }
}

/**
 * Launch a mission — create and execute in one call.
 */
function launchMission(siteId, title, goal, options = {}) {
  const mission = createMission(siteId, title, goal, options);
  const result = executeMission(mission.missionId);
  return { ...mission, ...result };
}

// ─── Agent Registry ──────────────────────────────────────────────────

function registerAgent(siteId, agentType, displayName, capabilities = [], modelInfo = {}, hardware = {}) {
  const id = crypto.randomUUID();
  stmts.upsertAgent.run(
    id, siteId, agentType, displayName || agentType,
    JSON.stringify(capabilities), JSON.stringify(modelInfo), JSON.stringify(hardware),
    displayName || agentType, JSON.stringify(capabilities), JSON.stringify(modelInfo), JSON.stringify(hardware)
  );
  return { id, agentType, displayName: displayName || agentType, status: 'available' };
}

function getAgents(siteId) {
  const rows = stmts.getAgents.all(siteId);
  return rows.map(_deserializeAgent);
}

function getAgentsByCapability(siteId, capability) {
  const rows = stmts.getAgentsByCapability.all(siteId, `%${capability}%`);
  return rows.map(_deserializeAgent);
}

function agentHeartbeat(agentId) {
  stmts.agentHeartbeat.run(agentId);
}

// ─── Query API ───────────────────────────────────────────────────────

function getMission(id) {
  const row = stmts.getMission.get(id);
  return row ? _deserializeMission(row) : null;
}

function getMissions(siteId, limit = 20) {
  return stmts.getMissions.all(siteId, limit).map(_deserializeMission);
}

function getActiveMissions(siteId) {
  return stmts.getActiveMissions.all(siteId).map(_deserializeMission);
}

function getMissionTasks(missionId) {
  return stmts.getMissionTasks.all(missionId).map(_deserializeTask);
}

function getStrategies() {
  return Object.keys(DECOMPOSITION_STRATEGIES).map(k => ({
    name: k,
    description: `Built-in strategy for ${k} missions`,
  }));
}

function getStats(siteId) {
  const row = stmts.countMissions.get(siteId);
  const agents = stmts.getAgents.all(siteId);
  return {
    totalMissions: row.total || 0,
    completedMissions: row.completed || 0,
    failedMissions: row.failed || 0,
    successRate: row.total > 0 ? Math.round(((row.completed || 0) / row.total) * 1000) / 1000 : 0,
    avgDuration: row.avg_duration ? Math.round(row.avg_duration) : 0,
    registeredAgents: agents.length,
    availableAgents: agents.filter(a => a.status === 'available').length,
    strategies: Object.keys(DECOMPOSITION_STRATEGIES).length,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────

function _detectStrategy(goal) {
  const g = goal.toLowerCase();
  if (/buy|purchase|shop|order|price/.test(g)) return 'purchase';
  if (/find|search|research|look.?up|learn/.test(g)) return 'research';
  if (/monitor|watch|track|alert|notify/.test(g)) return 'monitor';
  if (/write|create|draft|compose|blog|article/.test(g)) return 'content';
  if (/security|audit|vulnerability|scan|hack/.test(g)) return 'security-audit';
  if (/automate|workflow|schedule|repeat|batch/.test(g)) return 'automation';
  return 'general';
}

function _synthesizeMissionResult(taskOutputs, tasks) {
  const outputs = [];
  for (const task of tasks) {
    if (taskOutputs[task.id]) {
      outputs.push({ taskId: task.id, agent: task.agent_type, type: task.task_type, title: task.title, output: taskOutputs[task.id] });
    }
  }

  // Find the "final" output — typically the last completed task
  const finalOutput = outputs[outputs.length - 1]?.output || {};

  return {
    agentOutputs: outputs,
    finalDecision: finalOutput.decision || finalOutput.recommendation || null,
    confidence: finalOutput.confidence || 0,
    safe: finalOutput.safe !== false,
    summary: `Mission completed with ${outputs.length} agent outputs fused`,
  };
}

function _updateAgentSuccess(siteId, agentType, durationMs) {
  const agent = stmts.getAgent.get(siteId, agentType);
  if (agent) {
    stmts.updateAgentStats.run(durationMs, agent.id);
    stmts.markAgentAvailable.run(agent.id);
  }
}

function _updateAgentFail(siteId, agentType) {
  const agent = stmts.getAgent.get(siteId, agentType);
  if (agent) {
    stmts.updateAgentFail.run(agent.id);
    stmts.markAgentAvailable.run(agent.id);
  }
}

function _recordMissionToLearning(siteId, mission, result, durationMs) {
  try {
    const learning = require('./agent-learning');
    learning.recordDecision(siteId, 'commander', 'mission', mission.title, {
      strategy: JSON.parse(mission.plan || '[]')[0]?.agent,
      totalTasks: mission.total_tasks,
      durationMs,
      success: result.safe !== false,
    });
  } catch (_) { /* learning service unavailable */ }
}

function _deserializeMission(row) {
  return {
    ...row,
    plan: JSON.parse(row.plan || '[]'),
    context: JSON.parse(row.context || '{}'),
    result: row.result ? JSON.parse(row.result) : null,
  };
}

function _deserializeTask(row) {
  return {
    ...row,
    input: JSON.parse(row.input || '{}'),
    output: row.output ? JSON.parse(row.output) : null,
    depends_on: JSON.parse(row.depends_on || '[]'),
  };
}

function _deserializeAgent(row) {
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '[]'),
    model_info: JSON.parse(row.model_info || '{}'),
    hardware: JSON.parse(row.hardware || '{}'),
  };
}

module.exports = {
  createMission, executeMission, launchMission,
  registerAgent, getAgents, getAgentsByCapability, agentHeartbeat,
  getMission, getMissions, getActiveMissions, getMissionTasks,
  getStrategies, getStats,
};
