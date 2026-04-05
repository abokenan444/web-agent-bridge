/**
 * Edge Compute — Distributed Intelligence on the Periphery
 *
 * Turns every user device into a sovereign AI node. Each node registers
 * its hardware capabilities, accepts encrypted tasks, processes them
 * locally, and returns encrypted results. No central cloud needed.
 *
 * Architecture:
 *   - Node Registration: Each device reports CPU, RAM, GPU capabilities
 *   - Task Distribution: Commander assigns tasks based on node capacity
 *   - Encrypted Payloads: AES-256-GCM encryption for all inter-node data
 *   - Load Balancing: Weighted assignment based on hardware + availability
 *   - Health Monitoring: Heartbeat-based liveness, auto-failover
 *   - Swarm Formation: Nodes self-organize into capability-based clusters
 *
 * Every node is sovereign. Data is encrypted in transit. Processing is local.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS edge_nodes (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    hostname TEXT NOT NULL,
    node_type TEXT DEFAULT 'worker',
    hardware_profile TEXT DEFAULT '{}',
    capabilities TEXT DEFAULT '[]',
    status TEXT DEFAULT 'online',
    capacity REAL DEFAULT 1.0,
    current_load REAL DEFAULT 0.0,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    avg_latency_ms REAL DEFAULT 0,
    encryption_key_id TEXT,
    last_heartbeat TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, hostname)
  );

  CREATE TABLE IF NOT EXISTS edge_tasks (
    id TEXT PRIMARY KEY,
    node_id TEXT,
    mission_id TEXT,
    task_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    payload_encrypted INTEGER DEFAULT 0,
    status TEXT DEFAULT 'queued',
    result TEXT,
    priority INTEGER DEFAULT 5,
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    assigned_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS edge_encryption_keys (
    id TEXT PRIMARY KEY,
    node_id TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    algorithm TEXT DEFAULT 'aes-256-gcm',
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS edge_swarms (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    capability TEXT NOT NULL,
    node_ids TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, name)
  );

  CREATE INDEX IF NOT EXISTS idx_edge_nodes_site ON edge_nodes(site_id);
  CREATE INDEX IF NOT EXISTS idx_edge_nodes_status ON edge_nodes(status);
  CREATE INDEX IF NOT EXISTS idx_edge_tasks_node ON edge_tasks(node_id);
  CREATE INDEX IF NOT EXISTS idx_edge_tasks_status ON edge_tasks(status);
  CREATE INDEX IF NOT EXISTS idx_edge_swarms_cap ON edge_swarms(capability);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  // Nodes
  upsertNode: db.prepare("INSERT INTO edge_nodes (id, site_id, hostname, node_type, hardware_profile, capabilities, capacity) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, hostname) DO UPDATE SET hardware_profile = ?, capabilities = ?, capacity = ?, status = 'online', current_load = 0, last_heartbeat = datetime('now')"),
  getNode: db.prepare('SELECT * FROM edge_nodes WHERE id = ?'),
  getNodeByHost: db.prepare('SELECT * FROM edge_nodes WHERE site_id = ? AND hostname = ?'),
  getNodes: db.prepare("SELECT * FROM edge_nodes WHERE site_id = ? AND status != 'offline' ORDER BY current_load ASC, capacity DESC"),
  getAvailableNodes: db.prepare("SELECT * FROM edge_nodes WHERE site_id = ? AND status = 'online' AND current_load < capacity ORDER BY (capacity - current_load) DESC"),
  nodeHeartbeat: db.prepare("UPDATE edge_nodes SET last_heartbeat = datetime('now'), status = 'online', current_load = ? WHERE id = ?"),
  updateNodeLoad: db.prepare('UPDATE edge_nodes SET current_load = ? WHERE id = ?'),
  updateNodeStats: db.prepare("UPDATE edge_nodes SET tasks_completed = tasks_completed + 1, avg_latency_ms = (avg_latency_ms * tasks_completed + ?) / (tasks_completed + 1) WHERE id = ?"),
  updateNodeFail: db.prepare('UPDATE edge_nodes SET tasks_failed = tasks_failed + 1 WHERE id = ?'),
  markStaleNodes: db.prepare("UPDATE edge_nodes SET status = 'stale' WHERE status = 'online' AND last_heartbeat < datetime('now', '-120 seconds')"),
  removeNode: db.prepare("UPDATE edge_nodes SET status = 'offline' WHERE id = ?"),

  // Tasks
  insertTask: db.prepare('INSERT INTO edge_tasks (id, mission_id, task_type, payload, payload_encrypted, priority) VALUES (?, ?, ?, ?, ?, ?)'),
  assignTask: db.prepare("UPDATE edge_tasks SET node_id = ?, status = 'assigned', assigned_at = datetime('now') WHERE id = ?"),
  completeTask: db.prepare("UPDATE edge_tasks SET status = ?, result = ?, completed_at = datetime('now'), attempts = ? WHERE id = ?"),
  getTask: db.prepare('SELECT * FROM edge_tasks WHERE id = ?'),
  getQueuedTasks: db.prepare("SELECT * FROM edge_tasks WHERE status = 'queued' ORDER BY priority DESC, created_at ASC LIMIT ?"),
  getNodeTasks: db.prepare("SELECT * FROM edge_tasks WHERE node_id = ? AND status IN ('assigned','processing') ORDER BY priority DESC"),
  getTasksByMission: db.prepare('SELECT * FROM edge_tasks WHERE mission_id = ? ORDER BY created_at ASC'),

  // Encryption keys
  insertKey: db.prepare('INSERT INTO edge_encryption_keys (id, node_id, key_hash, algorithm, expires_at) VALUES (?, ?, ?, ?, ?)'),
  getNodeKey: db.prepare('SELECT * FROM edge_encryption_keys WHERE node_id = ? ORDER BY created_at DESC LIMIT 1'),

  // Swarms
  upsertSwarm: db.prepare("INSERT INTO edge_swarms (id, site_id, name, capability, node_ids) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, name) DO UPDATE SET node_ids = ?, capability = ?, status = 'active'"),
  getSwarms: db.prepare('SELECT * FROM edge_swarms WHERE site_id = ? ORDER BY name ASC'),
  getSwarmByCapability: db.prepare("SELECT * FROM edge_swarms WHERE site_id = ? AND capability = ? AND status = 'active'"),

  // Stats
  getStats: db.prepare(`SELECT
    (SELECT COUNT(*) FROM edge_nodes WHERE site_id = ? AND status = 'online') as online_nodes,
    (SELECT COUNT(*) FROM edge_nodes WHERE site_id = ? AND status = 'stale') as stale_nodes,
    (SELECT COUNT(*) FROM edge_tasks WHERE status = 'queued') as queued_tasks,
    (SELECT COUNT(*) FROM edge_tasks WHERE status = 'assigned') as active_tasks,
    (SELECT COUNT(*) FROM edge_tasks WHERE status = 'completed') as completed_tasks,
    (SELECT COUNT(*) FROM edge_tasks WHERE status = 'failed') as failed_tasks,
    (SELECT COUNT(*) FROM edge_swarms WHERE site_id = ? AND status = 'active') as active_swarms,
    (SELECT AVG(current_load / CASE WHEN capacity > 0 THEN capacity ELSE 1 END) FROM edge_nodes WHERE site_id = ? AND status = 'online') as avg_utilization`),
};

// ─── Config ──────────────────────────────────────────────────────────

const ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;   // 256 bits
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// ─── Node Management ─────────────────────────────────────────────────

/**
 * Register a device as an edge computing node.
 * @param {string} siteId
 * @param {string} hostname - Unique node identifier
 * @param {object} hardware - { cpuCores, ramGB, gpuName, gpuVRAM, os }
 * @param {string[]} capabilities - ['text-inference', 'vision', 'embedding', ...]
 */
function registerNode(siteId, hostname, hardware = {}, capabilities = []) {
  const id = crypto.randomUUID();
  const capacity = _estimateCapacity(hardware);

  stmts.upsertNode.run(
    id, siteId, hostname, hardware.gpuName ? 'gpu-worker' : 'cpu-worker',
    JSON.stringify(hardware), JSON.stringify(capabilities), capacity,
    JSON.stringify(hardware), JSON.stringify(capabilities), capacity
  );

  // Generate encryption key for this node
  const encKey = generateNodeKey(id);

  // Auto-join capability swarms
  for (const cap of capabilities) {
    _joinSwarm(siteId, cap, id);
  }

  return { nodeId: id, hostname, capacity, nodeType: hardware.gpuName ? 'gpu-worker' : 'cpu-worker', encryptionKeyId: encKey.keyId };
}

function nodeHeartbeat(nodeId, currentLoad = 0) {
  stmts.nodeHeartbeat.run(currentLoad, nodeId);
}

function removeNode(nodeId) {
  stmts.removeNode.run(nodeId);
}

function getNodes(siteId) {
  stmts.markStaleNodes.run();
  return stmts.getNodes.all(siteId).map(_deserializeNode);
}

function getAvailableNodes(siteId) {
  stmts.markStaleNodes.run();
  return stmts.getAvailableNodes.all(siteId).map(_deserializeNode);
}

function getNode(nodeId) {
  const row = stmts.getNode.get(nodeId);
  return row ? _deserializeNode(row) : null;
}

// ─── Task Distribution ──────────────────────────────────────────────

/**
 * Submit a task for edge execution. Payload is encrypted if a key is available.
 */
function submitTask(taskType, payload, options = {}) {
  const id = crypto.randomUUID();
  const priority = options.priority || 5;
  const encrypted = options.encrypt !== false;

  let storedPayload = JSON.stringify(payload);
  let isEncrypted = 0;

  if (encrypted && options.encryptionKey) {
    storedPayload = encryptPayload(storedPayload, options.encryptionKey);
    isEncrypted = 1;
  }

  stmts.insertTask.run(id, options.missionId || null, taskType, storedPayload, isEncrypted, priority);

  return { taskId: id, queued: true, encrypted: isEncrypted === 1 };
}

/**
 * Assign queued tasks to available nodes using weighted load balancing.
 */
function distributeTask(siteId) {
  stmts.markStaleNodes.run();
  const queued = stmts.getQueuedTasks.all(10);
  if (queued.length === 0) return { assigned: 0 };

  const nodes = stmts.getAvailableNodes.all(siteId);
  if (nodes.length === 0) return { assigned: 0, reason: 'no_available_nodes' };

  let assigned = 0;
  const assignments = [];

  for (const task of queued) {
    // Find best node: lowest load relative to capacity
    const node = _selectBestNode(nodes, task);
    if (!node) break;

    stmts.assignTask.run(node.id, task.id);

    // Update node load
    const newLoad = Math.min(node.capacity, (node.current_load || 0) + 0.1);
    stmts.updateNodeLoad.run(newLoad, node.id);
    node.current_load = newLoad;

    assignments.push({ taskId: task.id, nodeId: node.id });
    assigned++;
  }

  return { assigned, assignments };
}

/**
 * Complete a task — called by the node after processing.
 */
function completeTask(taskId, result, success = true) {
  const task = stmts.getTask.get(taskId);
  if (!task) throw new Error('Task not found');

  const status = success ? 'completed' : 'failed';
  stmts.completeTask.run(status, JSON.stringify(result), (task.attempts || 0) + 1, taskId);

  // Update node stats
  if (task.node_id) {
    if (success) {
      const duration = task.assigned_at
        ? Date.now() - new Date(task.assigned_at).getTime()
        : 0;
      stmts.updateNodeStats.run(duration, task.node_id);
    } else {
      stmts.updateNodeFail.run(task.node_id);
    }
    // Release node load
    const node = stmts.getNode.get(task.node_id);
    if (node) {
      stmts.updateNodeLoad.run(Math.max(0, node.current_load - 0.1), task.node_id);
    }
  }

  return { taskId, status };
}

function getTask(taskId) {
  const row = stmts.getTask.get(taskId);
  return row ? _deserializeEdgeTask(row) : null;
}

function getNodeTasks(nodeId) {
  return stmts.getNodeTasks.all(nodeId).map(_deserializeEdgeTask);
}

// ─── Encryption Layer ────────────────────────────────────────────────

/**
 * Generate an encryption key for a node. Returns keyId and the raw key.
 * The raw key must be securely stored by the node — only the hash is persisted.
 */
function generateNodeKey(nodeId) {
  const rawKey = crypto.randomBytes(KEY_LENGTH);
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600000).toISOString(); // 30 days

  stmts.insertKey.run(keyId, nodeId, keyHash, ENCRYPTION_ALGORITHM, expiresAt);

  return { keyId, key: rawKey.toString('base64'), algorithm: ENCRYPTION_ALGORITHM, expiresAt };
}

/**
 * Encrypt a payload using AES-256-GCM.
 * Returns a string: iv:authTag:ciphertext (all hex-encoded).
 */
function encryptPayload(plaintext, keyBase64) {
  const key = Buffer.from(keyBase64, 'base64');
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a payload encrypted with encryptPayload.
 */
function decryptPayload(encryptedStr, keyBase64) {
  const [ivHex, authTagHex, ciphertext] = encryptedStr.split(':');
  if (!ivHex || !authTagHex || !ciphertext) throw new Error('Invalid encrypted format');

  const key = Buffer.from(keyBase64, 'base64');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

// ─── Swarm Management ────────────────────────────────────────────────

/**
 * Swarms are self-organizing clusters of nodes sharing a capability.
 */
function getSwarms(siteId) {
  return stmts.getSwarms.all(siteId).map(s => ({
    ...s,
    node_ids: JSON.parse(s.node_ids || '[]'),
  }));
}

function getSwarmByCapability(siteId, capability) {
  const row = stmts.getSwarmByCapability.get(siteId, capability);
  if (!row) return null;
  return { ...row, node_ids: JSON.parse(row.node_ids || '[]') };
}

function _joinSwarm(siteId, capability, nodeId) {
  const existing = stmts.getSwarmByCapability.get(siteId, capability);
  const swarmName = `swarm-${capability}`;

  if (existing) {
    const nodeIds = JSON.parse(existing.node_ids || '[]');
    if (!nodeIds.includes(nodeId)) nodeIds.push(nodeId);
    stmts.upsertSwarm.run(existing.id, siteId, swarmName, capability, JSON.stringify(nodeIds), JSON.stringify(nodeIds), capability);
  } else {
    stmts.upsertSwarm.run(crypto.randomUUID(), siteId, swarmName, capability, JSON.stringify([nodeId]), JSON.stringify([nodeId]), capability);
  }
}

// ─── Stats ───────────────────────────────────────────────────────────

function getStats(siteId) {
  stmts.markStaleNodes.run();
  const row = stmts.getStats.get(siteId, siteId, siteId, siteId);
  return {
    onlineNodes: row.online_nodes || 0,
    staleNodes: row.stale_nodes || 0,
    queuedTasks: row.queued_tasks || 0,
    activeTasks: row.active_tasks || 0,
    completedTasks: row.completed_tasks || 0,
    failedTasks: row.failed_tasks || 0,
    activeSwarms: row.active_swarms || 0,
    avgUtilization: row.avg_utilization !== null ? Math.round(row.avg_utilization * 1000) / 1000 : 0,
  };
}

// ─── Internal Helpers ────────────────────────────────────────────────

function _estimateCapacity(hardware) {
  let cap = 1.0;
  if (hardware.cpuCores) cap += Math.min(hardware.cpuCores / 4, 4); // up to +4 for 16+ cores
  if (hardware.ramGB) cap += Math.min(hardware.ramGB / 8, 4);       // up to +4 for 32+ GB
  if (hardware.gpuVRAM) cap += Math.min(hardware.gpuVRAM / 4, 8);  // up to +8 for 32+ GB VRAM
  return Math.round(cap * 10) / 10;
}

function _selectBestNode(nodes, task) {
  let best = null;
  let bestScore = -1;

  for (const node of nodes) {
    if (node.current_load >= node.capacity) continue;
    const headroom = node.capacity - node.current_load;
    const reliability = 1 - (node.tasks_failed / Math.max(1, node.tasks_completed + node.tasks_failed));
    const score = headroom * 0.6 + reliability * 0.4;
    if (score > bestScore) {
      bestScore = score;
      best = node;
    }
  }

  return best;
}

function _deserializeNode(row) {
  return {
    ...row,
    hardware_profile: JSON.parse(row.hardware_profile || '{}'),
    capabilities: JSON.parse(row.capabilities || '[]'),
  };
}

function _deserializeEdgeTask(row) {
  let payload;
  try { payload = row.payload_encrypted ? row.payload : JSON.parse(row.payload); } catch (_) { payload = row.payload; }
  return {
    ...row,
    payload,
    result: row.result ? JSON.parse(row.result) : null,
  };
}

module.exports = {
  registerNode, nodeHeartbeat, removeNode, getNodes, getAvailableNodes, getNode,
  submitTask, distributeTask, completeTask, getTask, getNodeTasks,
  generateNodeKey, encryptPayload, decryptPayload,
  getSwarms, getSwarmByCapability,
  getStats,
};
