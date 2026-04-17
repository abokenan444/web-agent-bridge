'use strict';

/**
 * WAB Cluster — Distributed Execution, Worker Nodes & Cluster Orchestration
 *
 * Turns WAB from a single-server Agent OS into a distributed fleet.
 *
 * Architecture:
 *   ┌──────────────┐     ┌──────────┐     ┌──────────┐
 *   │  Coordinator │────▶│ Worker-1 │     │ Worker-2 │
 *   │  (this node) │────▶│  (remote) │     │  (remote) │
 *   │              │────▶│          │     │          │
 *   └──────────────┘     └──────────┘     └──────────┘
 *         │                   ▲                 ▲
 *         │                   │                 │
 *         └───────────────────┴─────────────────┘
 *                   heartbeat / task results
 *
 * Components:
 *   1. WorkerNode    — A remote execution node that connects, heartbeats, runs tasks
 *   2. TaskDistributor — Routes tasks to workers based on capacity/affinity/load
 *   3. ClusterOrchestrator — Fleet management, auto-scaling, failover, rebalancing
 *
 * Communication: HTTP/JSON between nodes (pull-based + push notifications)
 * Persistence: SQLite tables for durability across restarts
 * Consistency: Leader-based (coordinator is source of truth)
 */

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { db } = require('../models/db');
const { bus } = require('../runtime/event-bus');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS cluster_nodes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    region TEXT DEFAULT 'default',
    zone TEXT DEFAULT 'a',
    role TEXT DEFAULT 'worker',
    status TEXT DEFAULT 'joining',
    capacity_total INTEGER DEFAULT 20,
    capacity_used INTEGER DEFAULT 0,
    tags TEXT DEFAULT '[]',
    hardware TEXT DEFAULT '{}',
    version TEXT,
    secret_hash TEXT,
    last_heartbeat TEXT DEFAULT (datetime('now')),
    registered_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cluster_tasks (
    id TEXT PRIMARY KEY,
    external_id TEXT,
    node_id TEXT,
    task_type TEXT NOT NULL,
    objective TEXT,
    payload TEXT DEFAULT '{}',
    priority INTEGER DEFAULT 50,
    status TEXT DEFAULT 'pending',
    result TEXT,
    error TEXT,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    affinity_tags TEXT DEFAULT '[]',
    affinity_region TEXT,
    timeout_ms INTEGER DEFAULT 60000,
    submitted_at TEXT DEFAULT (datetime('now')),
    assigned_at TEXT,
    started_at TEXT,
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cluster_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    node_id TEXT,
    task_id TEXT,
    data TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_cluster_nodes_status ON cluster_nodes(status);
  CREATE INDEX IF NOT EXISTS idx_cluster_nodes_region ON cluster_nodes(region);
  CREATE INDEX IF NOT EXISTS idx_cluster_tasks_status ON cluster_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_cluster_tasks_node ON cluster_tasks(node_id);
  CREATE INDEX IF NOT EXISTS idx_cluster_tasks_priority ON cluster_tasks(priority DESC);
  CREATE INDEX IF NOT EXISTS idx_cluster_events_type ON cluster_events(event_type);
  CREATE INDEX IF NOT EXISTS idx_cluster_events_node ON cluster_events(node_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  // Nodes
  insertNode: db.prepare(`
    INSERT INTO cluster_nodes (id, name, endpoint, region, zone, role, status, capacity_total, tags, hardware, version, secret_hash)
    VALUES (@id, @name, @endpoint, @region, @zone, @role, @status, @capacity_total, @tags, @hardware, @version, @secret_hash)
  `),
  updateNode: db.prepare(`
    UPDATE cluster_nodes SET name=@name, endpoint=@endpoint, region=@region, zone=@zone,
    capacity_total=@capacity_total, tags=@tags, hardware=@hardware, version=@version, updated_at=datetime('now')
    WHERE id=@id
  `),
  setNodeStatus: db.prepare(`UPDATE cluster_nodes SET status=@status, updated_at=datetime('now') WHERE id=@id`),
  heartbeatNode: db.prepare(`
    UPDATE cluster_nodes SET last_heartbeat=datetime('now'), capacity_used=@capacity_used, status='active', updated_at=datetime('now')
    WHERE id=@id
  `),
  getNode: db.prepare(`SELECT * FROM cluster_nodes WHERE id=?`),
  getNodeByEndpoint: db.prepare(`SELECT * FROM cluster_nodes WHERE endpoint=?`),
  listNodes: db.prepare(`SELECT * FROM cluster_nodes ORDER BY registered_at DESC`),
  listActiveNodes: db.prepare(`SELECT * FROM cluster_nodes WHERE status='active' ORDER BY capacity_used ASC`),
  listNodesByRegion: db.prepare(`SELECT * FROM cluster_nodes WHERE region=? AND status='active' ORDER BY capacity_used ASC`),
  deleteNode: db.prepare(`DELETE FROM cluster_nodes WHERE id=?`),
  getStaleNodes: db.prepare(`SELECT * FROM cluster_nodes WHERE status='active' AND last_heartbeat < datetime('now', '-' || ? || ' seconds')`),

  // Tasks
  insertTask: db.prepare(`
    INSERT INTO cluster_tasks (id, external_id, task_type, objective, payload, priority, status, affinity_tags, affinity_region, timeout_ms, max_attempts)
    VALUES (@id, @external_id, @task_type, @objective, @payload, @priority, @status, @affinity_tags, @affinity_region, @timeout_ms, @max_attempts)
  `),
  assignTask: db.prepare(`
    UPDATE cluster_tasks SET node_id=@node_id, status='assigned', assigned_at=datetime('now'), attempts=attempts+1
    WHERE id=@id
  `),
  startTask: db.prepare(`UPDATE cluster_tasks SET status='running', started_at=datetime('now') WHERE id=?`),
  completeTask: db.prepare(`
    UPDATE cluster_tasks SET status='completed', result=@result, completed_at=datetime('now') WHERE id=@id
  `),
  failTask: db.prepare(`
    UPDATE cluster_tasks SET status='failed', error=@error, completed_at=datetime('now') WHERE id=@id
  `),
  requeueTask: db.prepare(`UPDATE cluster_tasks SET status='pending', node_id=NULL, assigned_at=NULL WHERE id=?`),
  getTask: db.prepare(`SELECT * FROM cluster_tasks WHERE id=?`),
  getTaskByExternal: db.prepare(`SELECT * FROM cluster_tasks WHERE external_id=?`),
  getPendingTasks: db.prepare(`SELECT * FROM cluster_tasks WHERE status='pending' ORDER BY priority DESC, submitted_at ASC LIMIT ?`),
  getTasksByNode: db.prepare(`SELECT * FROM cluster_tasks WHERE node_id=? AND status IN ('assigned','running') ORDER BY priority DESC`),
  getTasksByStatus: db.prepare(`SELECT * FROM cluster_tasks WHERE status=? ORDER BY submitted_at DESC LIMIT ?`),
  listTasks: db.prepare(`SELECT * FROM cluster_tasks ORDER BY submitted_at DESC LIMIT ?`),
  getStuckTasks: db.prepare(`
    SELECT * FROM cluster_tasks WHERE status IN ('assigned','running')
    AND assigned_at < datetime('now', '-' || ? || ' seconds')
  `),
  countByStatus: db.prepare(`SELECT status, COUNT(*) as count FROM cluster_tasks GROUP BY status`),
  incrementNodeLoad: db.prepare(`UPDATE cluster_nodes SET capacity_used = capacity_used + 1 WHERE id=?`),
  decrementNodeLoad: db.prepare(`UPDATE cluster_nodes SET capacity_used = MAX(0, capacity_used - 1) WHERE id=?`),

  // Events
  insertEvent: db.prepare(`INSERT INTO cluster_events (event_type, node_id, task_id, data) VALUES (@event_type, @node_id, @task_id, @data)`),
  getEvents: db.prepare(`SELECT * FROM cluster_events ORDER BY id DESC LIMIT ?`),
  getEventsByNode: db.prepare(`SELECT * FROM cluster_events WHERE node_id=? ORDER BY id DESC LIMIT ?`),
};

// ═══════════════════════════════════════════════════════════════════════════
// TASK DISTRIBUTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Routes tasks to worker nodes based on capacity, affinity, and load balancing.
 *
 * Strategies:
 *   - least-loaded: Pick the node with the most free capacity
 *   - affinity: Match task tags to node tags
 *   - region: Prefer nodes in the same region as the task
 *   - round-robin: Distribute evenly across all active nodes
 */
class TaskDistributor {
  constructor() {
    this._roundRobinIndex = 0;
    this._stats = { distributed: 0, reassigned: 0, noCapacity: 0 };
  }

  /**
   * Submit a task for distributed execution
   */
  submit(task) {
    const id = task.id || `ct_${crypto.randomBytes(12).toString('hex')}`;
    const entry = {
      id,
      external_id: task.externalId || null,
      task_type: task.type || 'general',
      objective: task.objective || '',
      payload: JSON.stringify(task.params || {}),
      priority: task.priority || 50,
      status: 'pending',
      affinity_tags: JSON.stringify(task.affinityTags || []),
      affinity_region: task.affinityRegion || null,
      timeout_ms: task.timeout || 60000,
      max_attempts: task.maxAttempts || 3,
    };
    stmts.insertTask.run(entry);

    bus.emit('cluster.task.submitted', { taskId: id, type: entry.task_type, priority: entry.priority });
    this._stats.distributed++;

    // Try immediate assignment
    this._tryAssign(id);

    return { taskId: id, status: 'pending' };
  }

  /**
   * Try to assign a task to a worker node
   */
  _tryAssign(taskId) {
    const task = stmts.getTask.get(taskId);
    if (!task || task.status !== 'pending') return false;

    const node = this._selectNode(task);
    if (!node) {
      this._stats.noCapacity++;
      return false;
    }

    stmts.assignTask.run({ id: taskId, node_id: node.id });
    stmts.incrementNodeLoad.run(node.id);

    logEvent('task.assigned', node.id, taskId, { strategy: this._lastStrategy });
    bus.emit('cluster.task.assigned', { taskId, nodeId: node.id });

    // Push notification to worker (fire-and-forget)
    this._notifyWorker(node, taskId, task);

    return true;
  }

  /**
   * Select the best node for a task
   */
  _selectNode(task) {
    let candidates = stmts.listActiveNodes.all();
    if (candidates.length === 0) return null;

    // Filter by capacity
    candidates = candidates.filter(n => n.capacity_used < n.capacity_total);
    if (candidates.length === 0) return null;

    const affinityTags = safeParse(task.affinity_tags, []);
    const affinityRegion = task.affinity_region;

    // Strategy 1: Region affinity
    if (affinityRegion) {
      const regionNodes = candidates.filter(n => n.region === affinityRegion);
      if (regionNodes.length > 0) {
        candidates = regionNodes;
        this._lastStrategy = 'region';
      }
    }

    // Strategy 2: Tag affinity
    if (affinityTags.length > 0) {
      const tagged = candidates.filter(n => {
        const nodeTags = safeParse(n.tags, []);
        return affinityTags.some(t => nodeTags.includes(t));
      });
      if (tagged.length > 0) {
        candidates = tagged;
        this._lastStrategy = 'affinity';
      }
    }

    // Strategy 3: Least-loaded
    candidates.sort((a, b) => {
      const loadA = a.capacity_used / a.capacity_total;
      const loadB = b.capacity_used / b.capacity_total;
      return loadA - loadB;
    });

    this._lastStrategy = this._lastStrategy || 'least-loaded';
    return candidates[0];
  }

  /**
   * Push task notification to a worker node
   */
  _notifyWorker(node, taskId, task) {
    const payload = JSON.stringify({
      type: 'task.assigned',
      taskId,
      taskType: task.task_type,
      objective: task.objective,
      params: safeParse(task.payload, {}),
      priority: task.priority,
      timeout: task.timeout_ms,
    });

    const url = new URL('/wab-worker/tasks/notify', node.endpoint);
    const mod = url.protocol === 'https:' ? https : http;

    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 5000,
    });
    req.on('error', () => { /* best-effort push */ });
    req.write(payload);
    req.end();
  }

  /**
   * Reassign tasks from a dead node to other nodes
   */
  reassignFromNode(nodeId) {
    const tasks = stmts.getTasksByNode.all(nodeId);
    let reassigned = 0;

    for (const task of tasks) {
      if (task.attempts >= task.max_attempts) {
        stmts.failTask.run({ id: task.id, error: 'Node died, max attempts reached' });
        logEvent('task.failed', nodeId, task.id, { reason: 'node_death' });
        bus.emit('cluster.task.failed', { taskId: task.id, reason: 'node_death' });
        continue;
      }

      stmts.decrementNodeLoad.run(nodeId);
      stmts.requeueTask.run(task.id);
      logEvent('task.requeued', nodeId, task.id, { attempt: task.attempts });

      // Try to assign to another node
      if (this._tryAssign(task.id)) {
        reassigned++;
        this._stats.reassigned++;
      }
    }

    return reassigned;
  }

  /**
   * Process pending tasks — called periodically
   */
  processPending() {
    const pending = stmts.getPendingTasks.all(50);
    let assigned = 0;
    for (const task of pending) {
      if (this._tryAssign(task.id)) assigned++;
    }
    return assigned;
  }

  /**
   * Worker pulls tasks for execution
   */
  pullTasks(nodeId, limit = 5) {
    const node = stmts.getNode.get(nodeId);
    if (!node || node.status !== 'active') return [];

    const available = node.capacity_total - node.capacity_used;
    if (available <= 0) return [];

    const count = Math.min(limit, available);
    const pending = stmts.getPendingTasks.all(count);
    const assigned = [];

    for (const task of pending) {
      // Check affinity
      const affinityRegion = task.affinity_region;
      if (affinityRegion && node.region !== affinityRegion) continue;

      const affinityTags = safeParse(task.affinity_tags, []);
      const nodeTags = safeParse(node.tags, []);
      if (affinityTags.length > 0 && !affinityTags.some(t => nodeTags.includes(t))) continue;

      stmts.assignTask.run({ id: task.id, node_id: nodeId });
      stmts.incrementNodeLoad.run(nodeId);
      logEvent('task.assigned', nodeId, task.id, { strategy: 'pull' });

      assigned.push({
        taskId: task.id,
        type: task.task_type,
        objective: task.objective,
        params: safeParse(task.payload, {}),
        priority: task.priority,
        timeout: task.timeout_ms,
      });
    }

    return assigned;
  }

  getStats() { return { ...this._stats }; }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLUSTER ORCHESTRATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fleet management — lifecycle, health, auto-scaling, failover, rebalancing.
 *
 * Responsibilities:
 *   - Node registration and authentication
 *   - Health monitoring via heartbeats
 *   - Dead node detection and task failover
 *   - Load rebalancing across the cluster
 *   - Cluster topology and status reporting
 *   - Drain and cordon operations
 */
class ClusterOrchestrator {
  constructor(distributor) {
    this._distributor = distributor;
    this._heartbeatThresholdSec = 90; // Node considered dead after 90s no heartbeat
    this._checkInterval = null;
    this._rebalanceInterval = null;
    this._started = false;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the orchestrator — begins periodic health checks and task processing
   */
  start() {
    if (this._started) return;
    this._started = true;

    // Health check every 30s
    this._checkInterval = setInterval(() => {
      this._healthCheck();
      this._recoverStuckTasks();
      this._distributor.processPending();
    }, 30_000);
    if (this._checkInterval.unref) this._checkInterval.unref();

    // Rebalance every 5 min
    this._rebalanceInterval = setInterval(() => {
      this._rebalance();
    }, 300_000);
    if (this._rebalanceInterval.unref) this._rebalanceInterval.unref();

    bus.emit('cluster.started', { timestamp: Date.now() });
  }

  /**
   * Stop the orchestrator
   */
  stop() {
    if (!this._started) return;
    this._started = false;
    if (this._checkInterval) clearInterval(this._checkInterval);
    if (this._rebalanceInterval) clearInterval(this._rebalanceInterval);
    bus.emit('cluster.stopped', { timestamp: Date.now() });
  }

  // ─── Node Management ───────────────────────────────────────────────

  /**
   * Register a worker node to join the cluster
   */
  registerNode(config) {
    if (!config.name || !config.endpoint) {
      throw new Error('Node name and endpoint required');
    }

    // Check for existing node with same endpoint
    const existing = stmts.getNodeByEndpoint.get(config.endpoint);
    if (existing) {
      // Re-register: update and reactivate
      stmts.updateNode.run({
        id: existing.id,
        name: config.name,
        endpoint: config.endpoint,
        region: config.region || existing.region,
        zone: config.zone || existing.zone,
        capacity_total: config.capacity || existing.capacity_total,
        tags: JSON.stringify(config.tags || safeParse(existing.tags, [])),
        hardware: JSON.stringify(config.hardware || safeParse(existing.hardware, {})),
        version: config.version || existing.version,
      });
      stmts.setNodeStatus.run({ id: existing.id, status: 'active' });
      logEvent('node.re-registered', existing.id, null, { endpoint: config.endpoint });
      bus.emit('cluster.node.joined', { nodeId: existing.id, name: config.name, rejoined: true });
      return { nodeId: existing.id, status: 'active', rejoined: true };
    }

    const nodeId = `node_${crypto.randomBytes(12).toString('hex')}`;
    const secretHash = crypto.createHash('sha256')
      .update(config.secret || crypto.randomBytes(32).toString('hex'))
      .digest('hex');

    stmts.insertNode.run({
      id: nodeId,
      name: config.name,
      endpoint: config.endpoint,
      region: config.region || 'default',
      zone: config.zone || 'a',
      role: config.role || 'worker',
      status: 'active',
      capacity_total: config.capacity || 20,
      tags: JSON.stringify(config.tags || []),
      hardware: JSON.stringify(config.hardware || {}),
      version: config.version || null,
      secret_hash: secretHash,
    });

    logEvent('node.registered', nodeId, null, { name: config.name, endpoint: config.endpoint, region: config.region });
    bus.emit('cluster.node.joined', { nodeId, name: config.name });

    return { nodeId, status: 'active', secret: config.secret ? undefined : undefined };
  }

  /**
   * Remove a node from the cluster
   */
  deregisterNode(nodeId) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;

    // Reassign tasks before removing
    const reassigned = this._distributor.reassignFromNode(nodeId);
    stmts.deleteNode.run(nodeId);

    logEvent('node.deregistered', nodeId, null, { reassigned });
    bus.emit('cluster.node.left', { nodeId, name: node.name, tasksReassigned: reassigned });

    return { nodeId, reassigned };
  }

  /**
   * Process heartbeat from a worker node
   */
  heartbeat(nodeId, data = {}) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;

    stmts.heartbeatNode.run({
      id: nodeId,
      capacity_used: data.capacityUsed != null ? data.capacityUsed : node.capacity_used,
    });

    // Update hardware profile if provided
    if (data.hardware) {
      stmts.updateNode.run({
        id: nodeId,
        name: node.name,
        endpoint: node.endpoint,
        region: node.region,
        zone: node.zone,
        capacity_total: data.capacityTotal || node.capacity_total,
        tags: JSON.stringify(data.tags || safeParse(node.tags, [])),
        hardware: JSON.stringify(data.hardware),
        version: data.version || node.version,
      });
    }

    return {
      nodeId,
      status: 'active',
      pendingTasks: stmts.getPendingTasks.all(1).length > 0,
    };
  }

  /**
   * Drain a node — stop assigning new tasks, wait for running tasks to finish
   */
  drainNode(nodeId) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;

    stmts.setNodeStatus.run({ id: nodeId, status: 'draining' });
    logEvent('node.draining', nodeId, null, {});
    bus.emit('cluster.node.draining', { nodeId, name: node.name });

    return { nodeId, status: 'draining', activeTasks: stmts.getTasksByNode.all(nodeId).length };
  }

  /**
   * Cordon a node — prevent scheduling but keep running tasks
   */
  cordonNode(nodeId) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;

    stmts.setNodeStatus.run({ id: nodeId, status: 'cordoned' });
    logEvent('node.cordoned', nodeId, null, {});
    bus.emit('cluster.node.cordoned', { nodeId, name: node.name });

    return { nodeId, status: 'cordoned' };
  }

  /**
   * Uncordon a node — allow scheduling again
   */
  uncordonNode(nodeId) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;

    stmts.setNodeStatus.run({ id: nodeId, status: 'active' });
    logEvent('node.uncordoned', nodeId, null, {});

    return { nodeId, status: 'active' };
  }

  /**
   * Get node details
   */
  getNode(nodeId) {
    const node = stmts.getNode.get(nodeId);
    if (!node) return null;
    node.tags = safeParse(node.tags, []);
    node.hardware = safeParse(node.hardware, {});
    node.activeTasks = stmts.getTasksByNode.all(nodeId).length;
    return node;
  }

  /**
   * List all cluster nodes
   */
  listNodes(filter = {}) {
    let nodes;
    if (filter.region) {
      nodes = stmts.listNodesByRegion.all(filter.region);
    } else if (filter.active) {
      nodes = stmts.listActiveNodes.all();
    } else {
      nodes = stmts.listNodes.all();
    }
    return nodes.map(n => ({
      ...n,
      tags: safeParse(n.tags, []),
      hardware: safeParse(n.hardware, {}),
    }));
  }

  // ─── Task Reporting ─────────────────────────────────────────────────

  /**
   * Worker reports task started
   */
  reportTaskStarted(taskId) {
    const task = stmts.getTask.get(taskId);
    if (!task) return null;
    stmts.startTask.run(taskId);
    logEvent('task.started', task.node_id, taskId, {});
    bus.emit('cluster.task.started', { taskId, nodeId: task.node_id });
    return { taskId, status: 'running' };
  }

  /**
   * Worker reports task completed
   */
  reportTaskCompleted(taskId, result) {
    const task = stmts.getTask.get(taskId);
    if (!task) return null;

    stmts.completeTask.run({ id: taskId, result: JSON.stringify(result || {}) });
    if (task.node_id) stmts.decrementNodeLoad.run(task.node_id);

    logEvent('task.completed', task.node_id, taskId, { hasResult: !!result });
    bus.emit('cluster.task.completed', { taskId, nodeId: task.node_id, result });

    return { taskId, status: 'completed' };
  }

  /**
   * Worker reports task failed
   */
  reportTaskFailed(taskId, error) {
    const task = stmts.getTask.get(taskId);
    if (!task) return null;

    if (task.node_id) stmts.decrementNodeLoad.run(task.node_id);

    // Retry if attempts remaining
    if (task.attempts < task.max_attempts) {
      stmts.requeueTask.run(taskId);
      logEvent('task.retrying', task.node_id, taskId, { attempt: task.attempts, error });
      bus.emit('cluster.task.retrying', { taskId, attempt: task.attempts });

      // Try to assign to a different node
      this._distributor._tryAssign(taskId);

      return { taskId, status: 'retrying', attempt: task.attempts };
    }

    // Max attempts reached
    stmts.failTask.run({ id: taskId, error: typeof error === 'string' ? error : JSON.stringify(error) });
    logEvent('task.failed', task.node_id, taskId, { error, attempts: task.attempts });
    bus.emit('cluster.task.failed', { taskId, error, nodeId: task.node_id });

    return { taskId, status: 'failed' };
  }

  /**
   * Get task details
   */
  getTask(taskId) {
    const task = stmts.getTask.get(taskId);
    if (!task) return null;
    task.payload = safeParse(task.payload, {});
    task.affinity_tags = safeParse(task.affinity_tags, []);
    task.result = safeParse(task.result, null);
    return task;
  }

  /**
   * List tasks with optional status filter
   */
  listTasks(filter = {}) {
    let tasks;
    if (filter.status) {
      tasks = stmts.getTasksByStatus.all(filter.status, filter.limit || 50);
    } else if (filter.nodeId) {
      tasks = stmts.getTasksByNode.all(filter.nodeId);
    } else {
      tasks = stmts.listTasks.all(filter.limit || 50);
    }
    return tasks.map(t => ({
      ...t,
      payload: safeParse(t.payload, {}),
      affinity_tags: safeParse(t.affinity_tags, []),
      result: safeParse(t.result, null),
    }));
  }

  // ─── Cluster Topology ───────────────────────────────────────────────

  /**
   * Get full cluster status
   */
  getClusterStatus() {
    const nodes = stmts.listNodes.all();
    const taskCounts = {};
    for (const row of stmts.countByStatus.all()) {
      taskCounts[row.status] = row.count;
    }

    const activeNodes = nodes.filter(n => n.status === 'active');
    const totalCapacity = activeNodes.reduce((sum, n) => sum + n.capacity_total, 0);
    const usedCapacity = activeNodes.reduce((sum, n) => sum + n.capacity_used, 0);

    // Group by region
    const regions = {};
    for (const node of nodes) {
      if (!regions[node.region]) regions[node.region] = { nodes: 0, active: 0, capacity: 0, used: 0 };
      regions[node.region].nodes++;
      if (node.status === 'active') {
        regions[node.region].active++;
        regions[node.region].capacity += node.capacity_total;
        regions[node.region].used += node.capacity_used;
      }
    }

    return {
      coordinator: { started: this._started },
      nodes: {
        total: nodes.length,
        active: activeNodes.length,
        draining: nodes.filter(n => n.status === 'draining').length,
        cordoned: nodes.filter(n => n.status === 'cordoned').length,
        dead: nodes.filter(n => n.status === 'dead').length,
      },
      capacity: {
        total: totalCapacity,
        used: usedCapacity,
        available: totalCapacity - usedCapacity,
        utilization: totalCapacity > 0 ? Math.round((usedCapacity / totalCapacity) * 100) : 0,
      },
      tasks: taskCounts,
      regions,
      distributor: this._distributor.getStats(),
    };
  }

  /**
   * Get cluster events log
   */
  getEvents(limit = 100, nodeId = null) {
    if (nodeId) {
      return stmts.getEventsByNode.all(nodeId, limit).map(e => ({
        ...e,
        data: safeParse(e.data, {}),
      }));
    }
    return stmts.getEvents.all(limit).map(e => ({
      ...e,
      data: safeParse(e.data, {}),
    }));
  }

  // ─── Internal Operations ────────────────────────────────────────────

  /**
   * Check for dead nodes and failover their tasks
   */
  _healthCheck() {
    const staleNodes = stmts.getStaleNodes.all(this._heartbeatThresholdSec);

    for (const node of staleNodes) {
      stmts.setNodeStatus.run({ id: node.id, status: 'dead' });
      logEvent('node.dead', node.id, null, { lastHeartbeat: node.last_heartbeat });
      bus.emit('cluster.node.dead', { nodeId: node.id, name: node.name });

      // Failover: reassign all tasks from dead node
      const reassigned = this._distributor.reassignFromNode(node.id);
      logEvent('node.failover', node.id, null, { reassigned });
      bus.emit('cluster.node.failover', { nodeId: node.id, tasksReassigned: reassigned });
    }
  }

  /**
   * Recover tasks that have been assigned/running too long (stuck)
   */
  _recoverStuckTasks() {
    const stuckTasks = stmts.getStuckTasks.all(300); // 5 min stuck threshold

    for (const task of stuckTasks) {
      if (task.attempts >= task.max_attempts) {
        stmts.failTask.run({ id: task.id, error: 'Task stuck, max attempts reached' });
        if (task.node_id) stmts.decrementNodeLoad.run(task.node_id);
        logEvent('task.stuck_failed', task.node_id, task.id, {});
      } else {
        if (task.node_id) stmts.decrementNodeLoad.run(task.node_id);
        stmts.requeueTask.run(task.id);
        this._distributor._tryAssign(task.id);
        logEvent('task.stuck_requeued', task.node_id, task.id, { attempt: task.attempts });
      }
    }
  }

  /**
   * Rebalance tasks across nodes when load is skewed
   */
  _rebalance() {
    const nodes = stmts.listActiveNodes.all();
    if (nodes.length < 2) return;

    const avgLoad = nodes.reduce((s, n) => s + (n.capacity_used / n.capacity_total), 0) / nodes.length;
    const overloaded = nodes.filter(n => (n.capacity_used / n.capacity_total) > avgLoad * 1.5 && n.capacity_used > 2);
    const underloaded = nodes.filter(n => (n.capacity_used / n.capacity_total) < avgLoad * 0.5);

    if (overloaded.length === 0 || underloaded.length === 0) return;

    let moved = 0;
    for (const over of overloaded) {
      const tasks = stmts.getTasksByNode.all(over.id);
      // Move up to 2 tasks from overloaded to underloaded
      const toMove = tasks.filter(t => t.status === 'assigned').slice(0, 2);

      for (const task of toMove) {
        const target = underloaded.find(n => n.capacity_used < n.capacity_total);
        if (!target) break;

        stmts.decrementNodeLoad.run(over.id);
        stmts.assignTask.run({ id: task.id, node_id: target.id });
        stmts.incrementNodeLoad.run(target.id);
        target.capacity_used++;
        moved++;

        logEvent('task.rebalanced', target.id, task.id, { from: over.id });
        this._distributor._notifyWorker(target, task.id, task);
      }
    }

    if (moved > 0) {
      bus.emit('cluster.rebalanced', { tasksMoved: moved });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function safeParse(str, fallback) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

function logEvent(type, nodeId, taskId, data) {
  try {
    stmts.insertEvent.run({
      event_type: type,
      node_id: nodeId || null,
      task_id: taskId || null,
      data: JSON.stringify(data || {}),
    });
  } catch { /* best-effort logging */ }
}

// ─── Singleton ───────────────────────────────────────────────────────

const distributor = new TaskDistributor();
const cluster = new ClusterOrchestrator(distributor);

module.exports = { cluster, distributor, ClusterOrchestrator, TaskDistributor };
