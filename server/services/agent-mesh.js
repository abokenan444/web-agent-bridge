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
 *   - Votes are tallied with deadline-based collection
 *   - Stale agents auto-expire after missed heartbeats
 *   - All communication is local — never leaves the WAB instance
 */

const crypto = require('crypto');
const { db } = require('../models/db');
let redactor;
try { redactor = require('../security/cross-site-redactor'); } catch { redactor = null; }

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
    metadata TEXT DEFAULT '{}',
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
    verification_count INTEGER DEFAULT 0,
    access_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS mesh_votes (
    id TEXT PRIMARY KEY,
    vote_message_id TEXT NOT NULL,
    voter_id TEXT NOT NULL,
    choice TEXT NOT NULL,
    weight REAL DEFAULT 1.0,
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(vote_message_id, voter_id)
  );

  CREATE INDEX IF NOT EXISTS idx_mesh_messages_channel ON mesh_messages(channel_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_messages_sender ON mesh_messages(sender_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_messages_target ON mesh_messages(target_id);
  CREATE INDEX IF NOT EXISTS idx_mesh_messages_expires ON mesh_messages(expires_at);
  CREATE INDEX IF NOT EXISTS idx_mesh_knowledge_domain ON mesh_knowledge(domain);
  CREATE INDEX IF NOT EXISTS idx_mesh_knowledge_key ON mesh_knowledge(key);
  CREATE INDEX IF NOT EXISTS idx_mesh_knowledge_type ON mesh_knowledge(knowledge_type);
  CREATE INDEX IF NOT EXISTS idx_mesh_agents_role ON mesh_agents(agent_role);
  CREATE INDEX IF NOT EXISTS idx_mesh_agents_status ON mesh_agents(status);
  CREATE INDEX IF NOT EXISTS idx_mesh_votes_msg ON mesh_votes(vote_message_id);
`);

// ─── Default Channels ───────────────────────────────────────────────

// Migration: add columns/tables that may not exist in older DBs
try { db.exec("ALTER TABLE mesh_agents ADD COLUMN metadata TEXT DEFAULT '{}'"); } catch (_) {}
try { db.exec("ALTER TABLE mesh_knowledge ADD COLUMN verified_by TEXT"); } catch (_) {}
try { db.exec("ALTER TABLE mesh_knowledge ADD COLUMN verification_count INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec("ALTER TABLE mesh_knowledge ADD COLUMN access_count INTEGER DEFAULT 0"); } catch (_) {}
try { db.exec(`CREATE TABLE IF NOT EXISTS mesh_votes (
  id TEXT PRIMARY KEY, vote_message_id TEXT NOT NULL, voter_id TEXT NOT NULL,
  choice TEXT NOT NULL, weight REAL DEFAULT 1.0, reason TEXT,
  created_at TEXT DEFAULT (datetime('now')), UNIQUE(vote_message_id, voter_id)
)`); } catch (_) {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_mesh_votes_msg ON mesh_votes(vote_message_id)"); } catch (_) {}

const DEFAULT_CHANNELS = [
  { name: 'alerts', description: 'Security alerts and site behavior warnings', channel_type: 'broadcast' },
  { name: 'discoveries', description: 'New site capabilities and schema changes', channel_type: 'broadcast' },
  { name: 'tactics', description: 'Successful strategies and approach patterns', channel_type: 'broadcast' },
  { name: 'negotiations', description: 'Price negotiations and deal coordination', channel_type: 'broadcast' },
  { name: 'votes', description: 'Consensus decisions and collective verification', channel_type: 'broadcast' },
];

const _ensureChannels = db.transaction(() => {
  const insert = db.prepare('INSERT OR IGNORE INTO mesh_channels (id, name, description, channel_type) VALUES (?, ?, ?, ?)');
  for (const ch of DEFAULT_CHANNELS) {
    insert.run(crypto.randomUUID(), ch.name, ch.description, ch.channel_type);
  }
});
_ensureChannels();

// ─── Config ──────────────────────────────────────────────────────────

const STALE_THRESHOLD_SECONDS = 90;

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertAgent: db.prepare('INSERT INTO mesh_agents (id, site_id, agent_role, display_name, capabilities, metadata) VALUES (?, ?, ?, ?, ?, ?)'),
  getAgent: db.prepare('SELECT * FROM mesh_agents WHERE id = ?'),
  getAgentsByRole: db.prepare("SELECT * FROM mesh_agents WHERE agent_role = ? AND status NOT IN ('offline','stale')"),
  getActiveAgents: db.prepare("SELECT * FROM mesh_agents WHERE status NOT IN ('offline','stale') ORDER BY last_heartbeat DESC"),
  getActiveAgentsBySite: db.prepare("SELECT * FROM mesh_agents WHERE site_id = ? AND status NOT IN ('offline','stale') ORDER BY last_heartbeat DESC"),
  updateAgentStatus: db.prepare("UPDATE mesh_agents SET status = ?, last_heartbeat = datetime('now') WHERE id = ?"),
  updateAgentMeta: db.prepare('UPDATE mesh_agents SET metadata = ? WHERE id = ?'),
  heartbeat: db.prepare("UPDATE mesh_agents SET last_heartbeat = datetime('now'), status = 'active' WHERE id = ?"),
  incrementSent: db.prepare('UPDATE mesh_agents SET messages_sent = messages_sent + 1 WHERE id = ?'),
  incrementReceived: db.prepare('UPDATE mesh_agents SET messages_received = messages_received + 1 WHERE id = ?'),
  updateKnowledgeCount: db.prepare('UPDATE mesh_agents SET knowledge_count = (SELECT COUNT(*) FROM mesh_knowledge WHERE agent_id = ?) WHERE id = ?'),
  removeAgent: db.prepare("UPDATE mesh_agents SET status = 'offline' WHERE id = ?"),
  markStaleAgents: db.prepare("UPDATE mesh_agents SET status = 'stale' WHERE status IN ('active','idle','busy') AND last_heartbeat < datetime('now', '-' || ? || ' seconds')"),

  getChannel: db.prepare('SELECT * FROM mesh_channels WHERE name = ?'),
  getAllChannels: db.prepare('SELECT * FROM mesh_channels'),
  createChannel: db.prepare('INSERT OR IGNORE INTO mesh_channels (id, name, description, channel_type) VALUES (?, ?, ?, ?)'),

  insertMessage: db.prepare("INSERT INTO mesh_messages (id, channel_id, sender_id, target_id, message_type, subject, payload, priority, ttl_seconds, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+' || ? || ' seconds'))"),
  getMessages: db.prepare("SELECT m.*, a.agent_role as sender_role, a.display_name as sender_name FROM mesh_messages m LEFT JOIN mesh_agents a ON m.sender_id = a.id WHERE m.channel_id = ? AND m.expires_at > datetime('now') ORDER BY m.created_at DESC LIMIT ?"),
  getMessagesForAgent: db.prepare("SELECT m.*, a.agent_role as sender_role, a.display_name as sender_name FROM mesh_messages m LEFT JOIN mesh_agents a ON m.sender_id = a.id WHERE (m.target_id = ? OR m.target_id IS NULL) AND m.channel_id = ? AND m.acknowledged = 0 AND m.expires_at > datetime('now') ORDER BY m.priority DESC, m.created_at DESC LIMIT ?"),
  ackMessageForAgent: db.prepare('UPDATE mesh_messages SET acknowledged = 1 WHERE id = ? AND (target_id = ? OR target_id IS NULL)'),
  getMessage: db.prepare('SELECT * FROM mesh_messages WHERE id = ?'),
  countUnread: db.prepare("SELECT COUNT(*) as count FROM mesh_messages WHERE (target_id = ? OR target_id IS NULL) AND acknowledged = 0 AND expires_at > datetime('now')"),
  countUnreadByChannel: db.prepare("SELECT c.name as channel, COUNT(m.id) as count FROM mesh_messages m JOIN mesh_channels c ON m.channel_id = c.id WHERE (m.target_id = ? OR m.target_id IS NULL) AND m.acknowledged = 0 AND m.expires_at > datetime('now') GROUP BY c.name"),

  insertKnowledge: db.prepare('INSERT INTO mesh_knowledge (id, agent_id, knowledge_type, domain, key, value, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  getKnowledge: db.prepare('SELECT * FROM mesh_knowledge WHERE domain = ? AND key = ? ORDER BY confidence DESC, updated_at DESC LIMIT 1'),
  getKnowledgeById: db.prepare('SELECT * FROM mesh_knowledge WHERE id = ?'),
  searchKnowledge: db.prepare('SELECT * FROM mesh_knowledge WHERE domain = ? ORDER BY confidence DESC, access_count DESC LIMIT ?'),
  searchKnowledgeByType: db.prepare('SELECT * FROM mesh_knowledge WHERE knowledge_type = ? ORDER BY confidence DESC LIMIT ?'),
  searchKnowledgeByAgent: db.prepare('SELECT * FROM mesh_knowledge WHERE agent_id = ? ORDER BY updated_at DESC LIMIT ?'),
  updateKnowledgeConfidence: db.prepare("UPDATE mesh_knowledge SET confidence = ?, verified_by = ?, verification_count = verification_count + 1, updated_at = datetime('now') WHERE id = ?"),
  updateKnowledgeValue: db.prepare("UPDATE mesh_knowledge SET value = ?, confidence = ?, updated_at = datetime('now') WHERE id = ?"),
  touchKnowledge: db.prepare('UPDATE mesh_knowledge SET access_count = access_count + 1 WHERE id = ?'),
  getAllKnowledgeDomains: db.prepare('SELECT domain, COUNT(*) as count, AVG(confidence) as avg_confidence FROM mesh_knowledge GROUP BY domain ORDER BY count DESC'),
  getRecentKnowledge: db.prepare('SELECT * FROM mesh_knowledge ORDER BY updated_at DESC LIMIT ?'),

  insertVote: db.prepare('INSERT OR REPLACE INTO mesh_votes (id, vote_message_id, voter_id, choice, weight, reason) VALUES (?, ?, ?, ?, ?, ?)'),
  getVotesForMessage: db.prepare('SELECT v.*, a.agent_role as voter_role, a.display_name as voter_name FROM mesh_votes v LEFT JOIN mesh_agents a ON v.voter_id = a.id WHERE v.vote_message_id = ? ORDER BY v.created_at'),
  countVotesForMessage: db.prepare('SELECT choice, SUM(weight) as total_weight, COUNT(*) as count FROM mesh_votes WHERE vote_message_id = ? GROUP BY choice ORDER BY total_weight DESC'),

  cleanExpired: db.prepare("DELETE FROM mesh_messages WHERE expires_at < datetime('now')"),
  getStats: db.prepare("SELECT (SELECT COUNT(*) FROM mesh_agents WHERE status NOT IN ('offline','stale')) as active_agents, (SELECT COUNT(*) FROM mesh_messages WHERE expires_at > datetime('now')) as active_messages, (SELECT COUNT(*) FROM mesh_knowledge) as total_knowledge, (SELECT COUNT(DISTINCT domain) FROM mesh_knowledge) as known_domains, (SELECT COUNT(*) FROM mesh_agents WHERE status = 'stale') as stale_agents, (SELECT COUNT(*) FROM mesh_votes) as total_votes"),
};

// ─── In-Memory Event Bus ─────────────────────────────────────────────

const _listeners = {};

function _emit(event, data) {
  const handlers = _listeners[event];
  if (!handlers) return;
  for (const fn of handlers) {
    try { fn(data); } catch (err) {
      console.error(`[mesh] event listener error on '${event}':`, err.message);
    }
  }
}

// ─── Agent Management ─────────────────────────────────────────────────

function registerAgent(siteId, role, displayName, capabilities = [], metadata = {}) {
  const id = crypto.randomUUID();
  stmts.insertAgent.run(id, siteId, role, displayName || role, JSON.stringify(capabilities), JSON.stringify(metadata));
  _emit('agent:joined', { agentId: id, role, displayName: displayName || role, siteId });
  return { id, role, displayName: displayName || role, status: 'idle', siteId };
}

function deregisterAgent(agentId) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return false;
  stmts.removeAgent.run(agentId);
  _emit('agent:left', { agentId, role: agent.agent_role, displayName: agent.display_name });
  return true;
}

function heartbeat(agentId) {
  const result = stmts.heartbeat.run(agentId);
  return result.changes > 0;
}

function setAgentStatus(agentId, status) {
  const validStatuses = ['active', 'idle', 'busy', 'offline'];
  if (!validStatuses.includes(status)) return false;
  stmts.updateAgentStatus.run(status, agentId);
  if (status === 'offline') _emit('agent:left', { agentId });
  return true;
}

function getAgent(agentId) {
  const row = stmts.getAgent.get(agentId);
  return row ? _parseAgent(row) : null;
}

function getActiveAgents(siteId) {
  stmts.markStaleAgents.run(STALE_THRESHOLD_SECONDS);
  const rows = siteId ? stmts.getActiveAgentsBySite.all(siteId) : stmts.getActiveAgents.all();
  return rows.map(_parseAgent);
}

function getAgentsByRole(role) {
  stmts.markStaleAgents.run(STALE_THRESHOLD_SECONDS);
  return stmts.getAgentsByRole.all(role).map(_parseAgent);
}

function updateAgentMeta(agentId, metadata) {
  const agent = stmts.getAgent.get(agentId);
  if (!agent) return false;
  const existing = JSON.parse(agent.metadata || '{}');
  const merged = { ...existing, ...metadata };
  stmts.updateAgentMeta.run(JSON.stringify(merged), agentId);
  return true;
}

// ─── Messaging ────────────────────────────────────────────────────────

function publish(senderId, channelName, messageType, subject, payload, options = {}) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) throw new Error(`Channel "${channelName}" not found`);

  const id = crypto.randomUUID();
  const priority = options.priority || 0;
  const ttl = options.ttl || 300;
  const targetId = options.targetId || null;

  stmts.insertMessage.run(id, channel.id, senderId, targetId, messageType, subject, JSON.stringify(payload), priority, ttl, ttl);
  stmts.incrementSent.run(senderId);

  const msg = { id, channelName, senderId, targetId, messageType, subject, payload, priority };
  _emit('message', msg);
  _emit(`message:${channelName}`, msg);
  _emit(`message:${messageType}`, msg);

  return msg;
}

function getMessages(channelName, limit = 50) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) return [];
  return stmts.getMessages.all(channel.id, Math.min(limit, 200)).map(_parseMessage);
}

function getMessagesForAgent(agentId, channelName, limit = 20) {
  const channel = stmts.getChannel.get(channelName);
  if (!channel) return [];
  return stmts.getMessagesForAgent.all(agentId, channel.id, Math.min(limit, 100)).map(_parseMessage);
}

function acknowledge(agentId, messageId) {
  stmts.ackMessageForAgent.run(messageId, agentId);
  stmts.incrementReceived.run(agentId);
  return true;
}

function getUnreadCount(agentId) {
  return stmts.countUnread.get(agentId).count;
}

function getUnreadByChannel(agentId) {
  return stmts.countUnreadByChannel.all(agentId);
}

// ─── Knowledge Sharing ───────────────────────────────────────────────

function shareKnowledge(agentId, knowledgeType, domain, key, value, confidence = 1.0) {
  const id = crypto.randomUUID();
  const agent = stmts.getAgent.get(agentId);
  const source = agent ? agent.display_name : agentId;

  // ── Redact PII / payment / credentials before mesh-broadcasting ──
  let safeValue = value;
  if (redactor) {
    safeValue = redactor.auditAndRedact({
      fromSite: agent?.site_id || agentId,
      toSite: '*mesh*',
      agentId,
      purpose: `share_knowledge:${knowledgeType}:${domain}:${key}`,
      payload: value,
      blockOnSensitive: false,
    });
    if (safeValue == null) safeValue = { redacted: true };
  }

  stmts.insertKnowledge.run(id, agentId, knowledgeType, domain, key, JSON.stringify(safeValue), confidence, source);
  stmts.updateKnowledgeCount.run(agentId, agentId);

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

function getKnowledgeById(id) {
  const row = stmts.getKnowledgeById.get(id);
  return row ? _parseKnowledge(row) : null;
}

function searchKnowledge(domain, limit = 20) {
  return stmts.searchKnowledge.all(domain, Math.min(limit, 100)).map(_parseKnowledge);
}

function searchKnowledgeByType(type, limit = 20) {
  return stmts.searchKnowledgeByType.all(type, Math.min(limit, 100)).map(_parseKnowledge);
}

function searchKnowledgeByAgent(agentId, limit = 20) {
  return stmts.searchKnowledgeByAgent.all(agentId, Math.min(limit, 100)).map(_parseKnowledge);
}

function getKnowledgeDomains() {
  return stmts.getAllKnowledgeDomains.all();
}

function getRecentKnowledge(limit = 30) {
  return stmts.getRecentKnowledge.all(Math.min(limit, 100)).map(_parseKnowledge);
}

function verifyKnowledge(knowledgeId, verifierAgentId, newConfidence) {
  const existing = stmts.getKnowledgeById.get(knowledgeId);
  if (!existing) return false;

  const agent = stmts.getAgent.get(verifierAgentId);
  const verifier = agent ? agent.display_name : verifierAgentId;

  // Weighted running average: merge existing confidence with verifier's assessment
  const count = existing.verification_count || 0;
  const mergedConfidence = count > 0
    ? (existing.confidence * count + newConfidence) / (count + 1)
    : (existing.confidence + newConfidence) / 2;

  stmts.updateKnowledgeConfidence.run(
    Math.min(0.99, Math.max(0.01, mergedConfidence)),
    verifier,
    knowledgeId
  );

  _emit('knowledge:verified', { knowledgeId, verifier, newConfidence: mergedConfidence });
  return { knowledgeId, confidence: mergedConfidence, verifiedBy: verifier };
}

function updateKnowledge(knowledgeId, newValue, newConfidence) {
  const existing = stmts.getKnowledgeById.get(knowledgeId);
  if (!existing) return false;
  stmts.updateKnowledgeValue.run(JSON.stringify(newValue), newConfidence, knowledgeId);
  return true;
}

// ─── Voting ──────────────────────────────────────────────────────────

function createVote(senderId, subject, options, ttl = 60) {
  return publish(senderId, 'votes', 'vote', subject, {
    options,
    deadline: new Date(Date.now() + ttl * 1000).toISOString()
  }, { ttl, priority: 1 });
}

function castVote(voteMessageId, voterId, choice, weight = 1.0, reason = '') {
  const message = stmts.getMessage.get(voteMessageId);
  if (!message) throw new Error('Vote message not found');

  const payload = JSON.parse(message.payload || '{}');
  if (payload.options && Array.isArray(payload.options) && !payload.options.includes(choice)) {
    throw new Error(`Invalid choice. Options: ${payload.options.join(', ')}`);
  }

  // Check deadline
  if (payload.deadline && new Date(payload.deadline) < new Date()) {
    throw new Error('Voting deadline has passed');
  }

  const id = crypto.randomUUID();
  stmts.insertVote.run(id, voteMessageId, voterId, choice, weight, reason);
  _emit('vote:cast', { voteMessageId, voterId, choice });
  return { id, voteMessageId, choice, weight };
}

function tallyVotes(voteMessageId) {
  const results = stmts.countVotesForMessage.all(voteMessageId);
  const votes = stmts.getVotesForMessage.all(voteMessageId);

  if (results.length === 0) {
    return { voteMessageId, totalVoters: 0, results: [], winner: null, votes: [] };
  }

  const totalWeight = results.reduce((sum, r) => sum + r.total_weight, 0);
  const ranked = results.map(r => ({
    choice: r.choice,
    votes: r.count,
    weight: r.total_weight,
    percentage: totalWeight > 0 ? Math.round((r.total_weight / totalWeight) * 10000) / 100 : 0
  }));

  return {
    voteMessageId,
    totalVoters: votes.length,
    totalWeight,
    results: ranked,
    winner: ranked[0]?.choice || null,
    margin: ranked.length > 1 ? ranked[0].percentage - ranked[1].percentage : 100,
    votes: votes.map(v => ({
      voter: v.voter_name || v.voter_role || v.voter_id,
      choice: v.choice,
      weight: v.weight,
      reason: v.reason
    }))
  };
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

// ─── Channels ────────────────────────────────────────────────────────

function createChannel(name, description, channelType = 'broadcast') {
  const id = crypto.randomUUID();
  stmts.createChannel.run(id, name, description, channelType);
  return { id, name, description, channelType };
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
  const result = stmts.cleanExpired.run();
  stmts.markStaleAgents.run(STALE_THRESHOLD_SECONDS);
  return { expiredMessages: result.changes };
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
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities || '[]'),
    metadata: JSON.parse(row.metadata || '{}')
  };
}

function _parseMessage(row) {
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload || '{}') };
}

function _parseKnowledge(row) {
  if (!row) return null;
  return { ...row, value: JSON.parse(row.value || '{}') };
}

const _cleanupInterval = setInterval(cleanup, 120000);
if (_cleanupInterval.unref) _cleanupInterval.unref();

module.exports = {
  registerAgent, deregisterAgent, heartbeat, setAgentStatus,
  getAgent, getActiveAgents, getAgentsByRole, updateAgentMeta,
  publish, getMessages, getMessagesForAgent, acknowledge, getUnreadCount, getUnreadByChannel,
  shareKnowledge, queryKnowledge, getKnowledgeById, searchKnowledge, searchKnowledgeByType,
  searchKnowledgeByAgent, getKnowledgeDomains, getRecentKnowledge, verifyKnowledge, updateKnowledge,
  createVote, castVote, tallyVotes,
  broadcastAlert, shareTactic, requestHelp,
  createChannel, on, off, cleanup, getStats, getChannels,
};
