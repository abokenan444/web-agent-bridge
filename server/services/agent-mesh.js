/**
 * Agent Mesh Protocol — Inter-Agent Communication Bus
 *
 * Enables peer-to-peer communication between agents within a private mesh.
 * Agents share discoveries, warnings, and learned tactics in real-time
 * without any data leaving the user's fortress.
 *
 * Architecture:
 *   - Each agent registers with the mesh and gets a mesh identity
 *   - Agents publish messages to channels (broadcast or targeted)
 *   - Message types: alert, discovery, tactic, request, response, vote
 *   - All communication is local — never leaves the WAB instance
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS mesh_agents (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    agent_role TEXT NOT NULL,
    display_name TEXT,
    capabilities TEXT DEFAULT '[]',
    status TEXT DEFAULT 'idle',
    last_heartbeat TEXT DEFAULT (datetime('now')),
    knowledge_count INTEGER DEFAULT 0,
    messages_sent INTEGER DEFAULT 0,
    messages_received INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mesh_channels (
    id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    channel_type TEXT DEFAULT 'broadcast',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mesh_messages (
    id TEXT PRIMARY KEY,
    channel_id TEXT,
    sender_id TEXT NOT NULL,
    target_id TEXT,
    message_type TEXT NOT NULL,
    subject TEXT,
    payload TEXT DEFAULT '{}',
    priority INTEGER DEFAULT 0,
    ttl_seconds INTEGER DEFAULT 300,
    acknowledged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS mesh_knowledge (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    knowledge_type TEXT NOT NULL,
    domain TEXT,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    confidence REAL DEFAULT 1.0,
    source TEXT,
    verified_by TEXT,
    access_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_mesh_messages_channel ON mesh_messages(channel_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_messages_sender ON mesh_messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_messages_target ON mesh_messages(target_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_knowledge_domain ON mesh_knowledge(domain);
  CREATE INDEX IF NOT EXISTS idx_mesh_knowledge_key ON mesh_knowledge(key);
  CREATE INDEX IF NOT EXISTS idx_mesh_agents_role ON mesh_agents(agent_role);
`);

// ─── Default Channels ───────────────────────────────────────────────

const DEFAULT_CHANNELS = [
  { name: 'alerts', description: 'Security alerts and site behavior warnings', channel_type: 'broadcast' },
  { name: 'discoveries', description: 'New site capabilities and schema changes', channel_type: 'broadcast' },
  { name: 'tactics', description: 'Successful strategies and approach patterns', channel_type: 'broadcast' },
  { name: 'negotiations', description: 'Price negotiations and deal coordination', channel_type: 'broadcast' },
  { name: 'votes', description: 'Consensus decisions and collective verification', channel_type: 'broadcast' },
];

const _ensureChannels = db.transaction(() => {
  const insert = db.prepare(`INSERT OR IGNORE INTO mesh_channels (id, name, description, channel_type) VALUES (?, ?, ?, ?)`);
  for (const ch of DEFAULT_CHANNELS) {
    insert.run(crypto.randomUUID(), ch.name, ch.description, ch.channel_type);
  }
});
_ensureChannels();

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertAgent: db.prepare(`INSERT INTO mesh_agents (id, site_id, agent_role, display_name, capabilities) VALUES (?, ?, ?, ?, ?)`),
  getAgent: db.prepare(`SELECT * FROM mesh_agents WHERE id = ?`),
  getAgentsByRole: db.prepare(`SELECT * FROM mesh_agents WHERE agent_role = ? AND status != 'offline'`),
  getActiveAgents: db.prepare(`SELECT * FROM mesh_agents WHERE status != 'offline' ORDER BY last_heartbeat DESC`),
  updateAgentStatus: db.prepare(`UPDATE mesh_agents SET status = ?, last_heartbeat = datetime('now') WHERE id = ?`),
  updateAgentCounters: db.prepare(`UPDATE mesh_agents SET messages_sent = messages_sent + ?, messages_received = messages_received + ?, knowledge_count = ? WHERE id = ?`),
  heartbeat: db.prepare(`UPDATE mesh_agents SET last_heartbeat = datetime('now'), status = 'active' WHERE id = ?`),

  getChannel: db.prepare(`SELECT * FROM mesh_channels WHERE name = ?`),
  getAllChannels: db.prepare(`SELECT * FROM mesh_channels`),

  insertMessage: db.prepare(`INSERT INTO mesh_messages (id, channel_id, sender_id, target_id, message_type, subject, payload, priority, ttl_seconds, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))`),
  getMessages: db.prepare(`SELECT m.*, a.agent_role as sender_role, a.display_name as sender_name FROM mesh_messages m LEFT JOIN mesh_agents a ON m.sender_id = a.id WHERE m.channel_id = ? AND m.expires_at > datetime('now') ORDER BY m.created_at DESC LIMIT ?`),
  getMessagesForAgent: db.prepare(`SELECT m.*, a.agent_role as sender_role, a.display_name as sender_name FROM mesh_messages m LEFT JOIN mesh_agents a ON m.sender_id = a.id WHERE (m.target_id = ? OR m.target_id IS NULL) AND m.channel_id = ? AND m.acknowledged = 0 AND m.expires_at > datetime('now') ORDER BY m.priority DESC, m.created_at DESC LIMIT ?`),
  ackMessage: db.prepare(`UPDATE mesh_messages SET acknowledged = 1 WHERE id = ? AND target_id = ?`),
  countUnread: db.prepare(`SELECT COUNT(*) as count FROM mesh_messages WHERE (target_id = ? OR target_id IS NULL) AND acknowledged = 0 AND expires_at > datetime('now')`),

  insertKnowledge: db.prepare(`INSERT INTO mesh_knowledge (id, agent_id, knowledge_type, domain, key, value, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getKnowledge: db.prepare(`SELECT * FROM mesh_knowledge WHERE domain = ? AND key = ? ORDER BY confidence DESC, updated_at DESC LIMIT 1`),
  searchKnowledge: db.prepare(`SELECT * FROM mesh_knowledge WHERE domain = ? ORDER BY confidence DESC, access_count DESC LIMIT ?`),
  searchKnowledgeByType: db.prepare(`SELECT * FROM mesh_knowledge WHERE knowledge_type = ? ORDER BY confidence DESC LIMIT ?`),
  updateKnowledge: db.prepare(`UPDATE mesh_knowledge SET value = ?, confidence = ?, verified_by = ?, updated_at = datetime('now') WHERE id = ?`),
  touchKnowledge: db.prepare(`UPDATE mesh_knowledge SET access_count = access_count + 1 WHERE id = ?`),
  getAgentKnowledgeCount: db.prepare(`SELECT COUNT(*) as count FROM mesh_knowledge WHERE agent_id = ?`),

  cleanExpired: db.prepare(`DELETE FROM mesh_messages WHERE expires_at < datetime('now')`),
  getStats: db.prepare(`SELECT (SELECT COUNT(*) FROM mesh_agents WHERE status != 'offline') as active_agents, (SELECT COUNT(*) FROM mesh_messages WHERE expires_at > datetime('now')) as active_messages, (SELECT COUNT(*) FROM mesh_knowledge) as total_knowledge, (SELECT COUNT(DISTINCT domain) FROM mesh_knowledge) as known_domains`),
};

// ─── In-Memory Event Bus ─────────────────────────────────────────────

const _listeners = {};

function _emit(event, data) {
  if (_listeners[event]) {
    for (const fn of _listeners[event]) {
      try { fn(data); } catch (_) { /* swallow */ }
    }
  }
}

// ─── API ──────────────────────────────────────────────────────────────

function registerAgent(siteId, role, displayName, capabilities = []) {
  const id = crypto.randomUUID();
  stmts.insertAgent.run(id, siteId, role, displayName || role, JSON.stringify(capabilities));
  _emit('agent:joined', { agentId: id, role, displayName });
  return { id, role, displayName, status: 'idle' };
}

function heartbeat(agentId) {
  stmts.heartbeat.run(agentId);
  return true;
}

function setAgentStatus(agentId, status) {
  stmts.updateAgentStatus.run(status, agentId);
  if (status === 'offline') _emit('agent:left', { agentId });
  return true;
}

function getActiveAgents() {
  return stmts.getActiveAgents.all().map(_parseAgent);
}

function getAgentsByRole(role) {
  return stmts.getAgentsByRole.all(role).map(_parseAgent);
}

function publish(senderId, channelName, messageType, subject, payload, options = {}) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) throw new Error(`Channel "${channelName}" not found`);

  const id = crypto.randomUUID();
  const priority = options.priority || 0;
  const ttl = options.ttl || 300;
  const targetId = options.targetId || null;

  stmts.insertMessage.run(id, channel.id, senderId, targetId, messageType, subject, JSON.stringify(payload), priority, ttl, ttl);

  // Update sender counters
  const kCount = stmts.getAgentKnowledgeCount.get(senderId);
  stmts.updateAgentCounters.run(1, 0, kCount ? kCount.count : 0, senderId);

  const msg = { id, channelName, senderId, targetId, messageType, subject, payload, priority };
  _emit('message', msg);
  _emit(`message:${channelName}`, msg);

  return msg;
}

function getMessages(channelName, limit = 50) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) return [];
  return stmts.getMessages.all(channel.id, limit).map(_parseMessage);
}

function getMessagesForAgent(agentId, channelName, limit = 20) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) return [];
  return stmts.getMessagesForAgent.all(agentId, channel.id, limit).map(_parseMessage);
}

function acknowledge(agentId, messageId) {
  stmts.ackMessage.run(messageId, agentId);
  const kCount = stmts.getAgentKnowledgeCount.get(agentId);
  stmts.updateAgentCounters.run(0, 1, kCount ? kCount.count : 0, agentId);
  return true;
}

function getUnreadCount(agentId) {
  return stmts.countUnread.get(agentId).count;
}

// ─── Knowledge Sharing ───────────────────────────────────────────────

function shareKnowledge(agentId, knowledgeType, domain, key, value, confidence = 1.0) {
  const id = crypto.randomUUID();
  const agent = stmts.getAgent.get(agentId);
  const source = agent ? agent.display_name : agentId;

  stmts.insertKnowledge.run(id, agentId, knowledgeType, domain, key, JSON.stringify(value), confidence, source);

  // Update agent knowledge count
  const kCount = stmts.getAgentKnowledgeCount.get(agentId);
  stmts.updateAgentCounters.run(0, 0, kCount ? kCount.count : 0, agentId);

  // Auto-publish discovery to mesh
  publish(agentId, 'discoveries', 'discovery', `New ${knowledgeType}: ${key}`, {
    knowledgeId: id, knowledgeType, domain, key, confidence
  }, { ttl: 600 });

  _emit('knowledge:shared', { id, agentId, knowledgeType, domain, key, confidence });
  return { id, knowledgeType, domain, key, confidence };
}

function queryKnowledge(domain, key) {
  const row = stmts.getKnowledge.get(domain, key);
  if (row) {
    stmts.touchKnowledge.run(row.id);
    return _parseKnowledge(row);
  }
  return null;
}

function searchKnowledge(domain, limit = 20) {
  return stmts.searchKnowledge.all(domain, limit).map(_parseKnowledge);
}

function searchKnowledgeByType(type, limit = 20) {
  return stmts.searchKnowledgeByType.all(type, limit).map(_parseKnowledge);
}

function verifyKnowledge(knowledgeId, verifierAgentId, newConfidence) {
  const agent = stmts.getAgent.get(verifierAgentId);
  const verifier = agent ? agent.display_name : verifierAgentId;
  stmts.updateKnowledge.run(null, newConfidence, verifier, knowledgeId);
  return true;
}

// ─── Alerts & Tactics ────────────────────────────────────────────────

function broadcastAlert(senderId, subject, details, priority = 2) {
  return publish(senderId, 'alerts', 'alert', subject, details, { priority, ttl: 600 });
}

function shareTactic(senderId, domain, tactic, confidence = 1.0) {
  shareKnowledge(senderId, 'tactic', domain, `tactic:${Date.now()}`, tactic, confidence);
  return publish(senderId, 'tactics', 'tactic', `Tactic for ${domain}`, { domain, tactic, confidence }, { ttl: 1800 });
}

function requestHelp(senderId, subject, question, targetRole = null) {
  const opts = { priority: 1, ttl: 120 };
  if (targetRole) {
    const agents = stmts.getAgentsByRole.all(targetRole);
    const results = [];
    for (const a of agents) {
      if (a.id !== senderId) {
        results.push(publish(senderId, 'alerts', 'request', subject, { question, targetRole }, { ...opts, targetId: a.id }));
      }
    }
    return results;
  }
  return [publish(senderId, 'alerts', 'request', subject, { question }, opts)];
}

function vote(senderId, subject, options) {
  return publish(senderId, 'votes', 'vote', subject, { options, votes: {} }, { ttl: 60, priority: 1 });
}

// ─── Event Subscriptions ─────────────────────────────────────────────

function on(event, callback) {
  if (!_listeners[event]) _listeners[event] = [];
  _listeners[event].push(callback);
}

function off(event, callback) {
  if (_listeners[event]) {
    _listeners[event] = _listeners[event].filter((fn) => fn !== callback);
  }
}

// ─── Maintenance ─────────────────────────────────────────────────────

function cleanup() {
  stmts.cleanExpired.run();
}

function getStats() {
  return stmts.getStats.get();
}

function getChannels() {
  return stmts.getAllChannels.all();
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _parseAgent(row) {
  if (!row) return null;
  return { ...row, capabilities: JSON.parse(row.capabilities || '[]') };
}

function _parseMessage(row) {
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload || '{}') };
}

function _parseKnowledge(row) {
  if (!row) return null;
  return { ...row, value: JSON.parse(row.value || '{}') };
}

// Cleanup expired messages every 2 minutes
const _cleanupInterval = setInterval(cleanup, 120000);
if (_cleanupInterval.unref) _cleanupInterval.unref();

module.exports = {
  registerAgent, heartbeat, setAgentStatus, getActiveAgents, getAgentsByRole,
  publish, getMessages, getMessagesForAgent, acknowledge, getUnreadCount,
  shareKnowledge, queryKnowledge, searchKnowledge, searchKnowledgeByType, verifyKnowledge,
  broadcastAlert, shareTactic, requestHelp, vote,
  on, off, cleanup, getStats, getChannels,
};
