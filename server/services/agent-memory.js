'use strict';

const { db } = require('../models/db');
const { randomUUID } = require('crypto');

// ─── Schema ──────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_memories (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    memory_type TEXT CHECK(memory_type IN ('preference','interaction','correction','pattern')),
    category TEXT CHECK(category IN ('navigation','purchase','search','form','custom')),
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    embedding TEXT,
    importance REAL DEFAULT 0.5,
    access_count INTEGER DEFAULT 0,
    last_accessed TEXT,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS memory_sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    agent_id TEXT,
    context TEXT,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE TABLE IF NOT EXISTS memory_associations (
    id TEXT PRIMARY KEY,
    source_memory_id TEXT,
    target_memory_id TEXT,
    relationship TEXT CHECK(relationship IN ('leads_to','similar_to','replaces','depends_on')),
    strength REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_memory_id) REFERENCES agent_memories(id) ON DELETE CASCADE,
    FOREIGN KEY (target_memory_id) REFERENCES agent_memories(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_mem_site ON agent_memories(site_id);
  CREATE INDEX IF NOT EXISTS idx_mem_agent ON agent_memories(agent_id);
  CREATE INDEX IF NOT EXISTS idx_mem_type ON agent_memories(memory_type);
  CREATE INDEX IF NOT EXISTS idx_mem_category ON agent_memories(category);
  CREATE INDEX IF NOT EXISTS idx_mem_importance ON agent_memories(importance);
  CREATE INDEX IF NOT EXISTS idx_mem_sessions_site ON memory_sessions(site_id);
  CREATE INDEX IF NOT EXISTS idx_mem_sessions_agent ON memory_sessions(agent_id);
  CREATE INDEX IF NOT EXISTS idx_mem_assoc_source ON memory_associations(source_memory_id);
  CREATE INDEX IF NOT EXISTS idx_mem_assoc_target ON memory_associations(target_memory_id);
`);

// ─── Prepared Statements ─────────────────────────────────────────────────────

const stmts = {
  insertMemory: db.prepare(`
    INSERT INTO agent_memories (id, site_id, agent_id, memory_type, category, key, value, embedding, importance, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getMemory: db.prepare(`SELECT * FROM agent_memories WHERE id = ?`),
  queryMemories: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC, updated_at DESC
  `),
  queryByCategory: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND category = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC, updated_at DESC
  `),
  queryByType: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND memory_type = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC, updated_at DESC
  `),
  queryByCategoryAndType: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND category = ? AND memory_type = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC, updated_at DESC
  `),
  touchMemory: db.prepare(`
    UPDATE agent_memories SET access_count = access_count + 1, last_accessed = datetime('now') WHERE id = ?
  `),
  softDelete: db.prepare(`
    UPDATE agent_memories SET expires_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
  `),
  updateImportance: db.prepare(`
    UPDATE agent_memories SET importance = ?, updated_at = datetime('now') WHERE id = ?
  `),
  deleteExpired: db.prepare(`
    DELETE FROM agent_memories WHERE expires_at IS NOT NULL AND expires_at <= datetime('now')
  `),
  findDuplicates: db.prepare(`
    SELECT key, category, COUNT(*) as cnt, GROUP_CONCAT(id) as ids
    FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    GROUP BY key, category HAVING cnt > 1
  `),
  deleteMemoryById: db.prepare(`DELETE FROM agent_memories WHERE id = ?`),

  insertAssociation: db.prepare(`
    INSERT INTO memory_associations (id, source_memory_id, target_memory_id, relationship, strength)
    VALUES (?, ?, ?, ?, ?)
  `),
  getAssociationsFrom: db.prepare(`
    SELECT ma.*, am.key, am.value, am.memory_type, am.category, am.importance
    FROM memory_associations ma
    JOIN agent_memories am ON am.id = ma.target_memory_id
    WHERE ma.source_memory_id = ?
    ORDER BY ma.strength DESC
  `),
  getAssociationsFromFiltered: db.prepare(`
    SELECT ma.*, am.key, am.value, am.memory_type, am.category, am.importance
    FROM memory_associations ma
    JOIN agent_memories am ON am.id = ma.target_memory_id
    WHERE ma.source_memory_id = ? AND ma.relationship = ?
    ORDER BY ma.strength DESC
  `),

  insertSession: db.prepare(`
    INSERT INTO memory_sessions (id, site_id, agent_id, context) VALUES (?, ?, ?, ?)
  `),
  endSession: db.prepare(`
    UPDATE memory_sessions SET ended_at = datetime('now'), context = json_patch(COALESCE(context, '{}'), ?) WHERE id = ?
  `),
  getSessionHistory: db.prepare(`
    SELECT * FROM memory_sessions WHERE site_id = ? AND agent_id = ? ORDER BY started_at DESC LIMIT ?
  `),

  countAll: db.prepare(`
    SELECT COUNT(*) as total FROM agent_memories WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  `),
  countByType: db.prepare(`
    SELECT memory_type, COUNT(*) as count FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    GROUP BY memory_type
  `),
  countByCategory: db.prepare(`
    SELECT category, COUNT(*) as count FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    GROUP BY category
  `),
  avgImportance: db.prepare(`
    SELECT AVG(importance) as avg FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
  `),
  storageEstimate: db.prepare(`
    SELECT SUM(LENGTH(key) + LENGTH(value) + COALESCE(LENGTH(embedding), 0)) as bytes
    FROM agent_memories WHERE site_id = ? AND agent_id = ?
  `),

  allActiveMemories: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY created_at ASC
  `),
  getPreferences: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND memory_type = 'preference' AND (expires_at IS NULL OR expires_at > datetime('now'))
    ORDER BY importance DESC
  `),
  findPreference: db.prepare(`
    SELECT * FROM agent_memories
    WHERE site_id = ? AND agent_id = ? AND memory_type = 'preference' AND key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
    LIMIT 1
  `),
  updateMemoryValue: db.prepare(`
    UPDATE agent_memories SET value = ?, embedding = ?, importance = ?, updated_at = datetime('now') WHERE id = ?
  `),
};

// ─── Vector Utilities ────────────────────────────────────────────────────────

const EMBED_DIM = 128;

/**
 * Tokenizes text into lowercase alphanumeric tokens.
 * @param {string} text
 * @returns {string[]}
 */
function tokenize(text) {
  return String(text).toLowerCase().match(/[a-z0-9]+/g) || [];
}

/**
 * Deterministic hash of a string to a 32-bit unsigned integer.
 * @param {string} str
 * @returns {number}
 */
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Computes a TF-IDF-style embedding: hashes tokens into a fixed-size vector and L2-normalizes.
 * @param {string} text
 * @returns {number[]} 128-dimensional unit vector
 */
function computeEmbedding(text) {
  const tokens = tokenize(text);
  const vec = new Float64Array(EMBED_DIM);
  if (tokens.length === 0) return Array.from(vec);

  const tf = {};
  for (const t of tokens) tf[t] = (tf[t] || 0) + 1;

  for (const [token, count] of Object.entries(tf)) {
    const idx = hashStr(token) % EMBED_DIM;
    const sign = (hashStr(token + '_sign') & 1) ? 1 : -1;
    const weight = (1 + Math.log(count)) * sign;
    vec[idx] += weight;
  }

  let norm = 0;
  for (let i = 0; i < EMBED_DIM; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < EMBED_DIM; i++) vec[i] /= norm;

  return Array.from(vec);
}

/**
 * Standard cosine similarity between two equal-length vectors.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} similarity in [-1, 1]
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Core Memory Operations ──────────────────────────────────────────────────

/**
 * Stores a memory entry for an agent on a site.
 * @param {string} siteId
 * @param {string} agentId
 * @param {{ type?: string, category?: string, key: string, value: any, importance?: number, ttlSeconds?: number }} opts
 * @returns {object} the stored memory row
 */
function storeMemory(siteId, agentId, { type, category, key, value, importance, ttlSeconds }) {
  const id = randomUUID();
  const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
  const embedding = computeEmbedding(`${key} ${typeof value === 'string' ? value : JSON.stringify(value)}`);
  const expiresAt = ttlSeconds
    ? new Date(Date.now() + ttlSeconds * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : null;

  stmts.insertMemory.run(
    id, siteId, agentId,
    type || null, category || null,
    key, jsonValue,
    JSON.stringify(embedding),
    importance ?? 0.5,
    expiresAt
  );

  return stmts.getMemory.get(id);
}

/**
 * Recalls memories matching filters, optionally ranked by semantic similarity.
 * @param {string} siteId
 * @param {string} agentId
 * @param {{ query?: string, category?: string, type?: string, limit?: number, minImportance?: number }} opts
 * @returns {object[]}
 */
function recallMemories(siteId, agentId, { query, category, type, limit, minImportance } = {}) {
  let rows;
  if (category && type) {
    rows = stmts.queryByCategoryAndType.all(siteId, agentId, category, type);
  } else if (category) {
    rows = stmts.queryByCategory.all(siteId, agentId, category);
  } else if (type) {
    rows = stmts.queryByType.all(siteId, agentId, type);
  } else {
    rows = stmts.queryMemories.all(siteId, agentId);
  }

  if (minImportance != null) {
    rows = rows.filter(r => r.importance >= minImportance);
  }

  if (query) {
    const queryEmbed = computeEmbedding(query);
    rows = rows.map(r => {
      const memEmbed = r.embedding ? JSON.parse(r.embedding) : null;
      const similarity = memEmbed ? cosineSimilarity(queryEmbed, memEmbed) : 0;
      return { ...r, similarity };
    });
    rows.sort((a, b) => b.similarity - a.similarity);
  }

  const maxRows = limit || 20;
  rows = rows.slice(0, maxRows);

  const touchTx = db.transaction((ids) => {
    for (const id of ids) stmts.touchMemory.run(id);
  });
  touchTx(rows.map(r => r.id));

  return rows;
}

// ─── Associations ────────────────────────────────────────────────────────────

/**
 * Creates a directional link between two memories.
 * @param {string} sourceId
 * @param {string} targetId
 * @param {string} relationship - leads_to | similar_to | replaces | depends_on
 * @param {number} [strength=0.5]
 * @returns {object}
 */
function associateMemories(sourceId, targetId, relationship, strength = 0.5) {
  const id = randomUUID();
  stmts.insertAssociation.run(id, sourceId, targetId, relationship, strength);
  return { id, sourceId, targetId, relationship, strength };
}

/**
 * Retrieves memories associated with a given memory.
 * @param {string} memoryId
 * @param {{ relationship?: string, minStrength?: number }} [opts]
 * @returns {object[]}
 */
function getAssociatedMemories(memoryId, { relationship, minStrength } = {}) {
  let rows;
  if (relationship) {
    rows = stmts.getAssociationsFromFiltered.all(memoryId, relationship);
  } else {
    rows = stmts.getAssociationsFrom.all(memoryId);
  }
  if (minStrength != null) {
    rows = rows.filter(r => r.strength >= minStrength);
  }
  return rows;
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

/**
 * Soft-deletes a memory by setting its expiration to now.
 * @param {string} memoryId
 * @returns {boolean}
 */
function forgetMemory(memoryId) {
  const info = stmts.softDelete.run(memoryId);
  return info.changes > 0;
}

/**
 * Consolidates memories: merges duplicates, adjusts importance, purges expired.
 * @param {string} siteId
 * @param {string} agentId
 * @returns {{ merged: number, boosted: number, decayed: number, expired: number }}
 */
function consolidateMemories(siteId, agentId) {
  const stats = { merged: 0, boosted: 0, decayed: 0, expired: 0 };

  const expiredInfo = stmts.deleteExpired.run();
  stats.expired = expiredInfo.changes;

  const dupes = stmts.findDuplicates.all(siteId, agentId);
  const mergeTx = db.transaction(() => {
    for (const group of dupes) {
      const ids = group.ids.split(',');
      const memories = ids.map(id => stmts.getMemory.get(id)).filter(Boolean);
      if (memories.length < 2) continue;

      memories.sort((a, b) => b.access_count - a.access_count || b.importance - a.importance);
      const keeper = memories[0];

      let mergedValues;
      try {
        const parsed = memories.map(m => JSON.parse(m.value));
        if (typeof parsed[0] === 'object' && parsed[0] !== null && !Array.isArray(parsed[0])) {
          mergedValues = JSON.stringify(Object.assign({}, ...parsed.reverse()));
        } else {
          mergedValues = keeper.value;
        }
      } catch {
        mergedValues = keeper.value;
      }

      const newImportance = Math.min(1, keeper.importance + 0.05 * (memories.length - 1));
      const newEmbedding = computeEmbedding(`${keeper.key} ${mergedValues}`);
      stmts.updateMemoryValue.run(mergedValues, JSON.stringify(newEmbedding), newImportance, keeper.id);

      for (let i = 1; i < memories.length; i++) {
        stmts.deleteMemoryById.run(memories[i].id);
        stats.merged++;
      }
    }
  });
  mergeTx();

  const active = stmts.allActiveMemories.all(siteId, agentId);
  const now = Date.now();

  const adjustTx = db.transaction(() => {
    for (const mem of active) {
      const ageMs = now - new Date(mem.created_at).getTime();
      const ageDays = ageMs / 86400000;

      if (mem.access_count >= 5) {
        const boost = Math.min(1, mem.importance + 0.02 * Math.log2(mem.access_count));
        if (boost > mem.importance) {
          stmts.updateImportance.run(Math.min(1, boost), mem.id);
          stats.boosted++;
        }
      }

      if (ageDays > 30 && mem.access_count < 3) {
        const decayFactor = Math.max(0.1, 1 - 0.01 * (ageDays - 30));
        const decayed = mem.importance * decayFactor;
        if (decayed < mem.importance) {
          stmts.updateImportance.run(Math.max(0, decayed), mem.id);
          stats.decayed++;
        }
      }
    }
  });
  adjustTx();

  return stats;
}

// ─── Stats ───────────────────────────────────────────────────────────────────

/**
 * Returns aggregate statistics for an agent's memories on a site.
 * @param {string} siteId
 * @param {string} agentId
 * @returns {object}
 */
function getMemoryStats(siteId, agentId) {
  const total = stmts.countAll.get(siteId, agentId).total;
  const byType = stmts.countByType.all(siteId, agentId);
  const byCategory = stmts.countByCategory.all(siteId, agentId);
  const avgImportance = stmts.avgImportance.get(siteId, agentId).avg || 0;
  const storageBytes = stmts.storageEstimate.get(siteId, agentId).bytes || 0;

  return {
    total,
    byType: Object.fromEntries(byType.map(r => [r.memory_type, r.count])),
    byCategory: Object.fromEntries(byCategory.map(r => [r.category, r.count])),
    avgImportance: Math.round(avgImportance * 1000) / 1000,
    storageEstimateBytes: storageBytes,
  };
}

// ─── Sessions ────────────────────────────────────────────────────────────────

/**
 * Starts an agent memory session.
 * @param {string} siteId
 * @param {string} agentId
 * @param {object} [context]
 * @returns {{ id: string, siteId: string, agentId: string, startedAt: string }}
 */
function startSession(siteId, agentId, context = {}) {
  const id = randomUUID();
  stmts.insertSession.run(id, siteId, agentId, JSON.stringify(context));
  return { id, siteId, agentId, startedAt: new Date().toISOString() };
}

/**
 * Ends a session, optionally attaching a summary to the context.
 * @param {string} sessionId
 * @param {string} [summary]
 * @returns {boolean}
 */
function endSession(sessionId, summary) {
  const patch = summary ? JSON.stringify({ summary }) : '{}';
  const info = stmts.endSession.run(patch, sessionId);
  return info.changes > 0;
}

/**
 * Returns recent sessions for a site/agent pair.
 * @param {string} siteId
 * @param {string} agentId
 * @param {{ limit?: number }} [opts]
 * @returns {object[]}
 */
function getSessionHistory(siteId, agentId, { limit } = {}) {
  return stmts.getSessionHistory.all(siteId, agentId, limit || 20);
}

// ─── Import / Export ─────────────────────────────────────────────────────────

/**
 * Exports all active memories as JSON or CSV.
 * @param {string} siteId
 * @param {string} agentId
 * @param {{ format?: 'json'|'csv' }} [opts]
 * @returns {string}
 */
function exportMemories(siteId, agentId, { format } = {}) {
  const rows = stmts.allActiveMemories.all(siteId, agentId);

  if (format === 'csv') {
    const cols = ['id', 'site_id', 'agent_id', 'memory_type', 'category', 'key', 'value', 'importance', 'access_count', 'created_at', 'updated_at'];
    const escape = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const header = cols.join(',');
    const lines = rows.map(r => cols.map(c => escape(r[c])).join(','));
    return [header, ...lines].join('\n');
  }

  return JSON.stringify(rows, null, 2);
}

/**
 * Bulk-imports memories from an array of objects.
 * @param {string} siteId
 * @param {string} agentId
 * @param {object[]} data
 * @returns {{ imported: number }}
 */
function importMemories(siteId, agentId, data) {
  let imported = 0;
  const tx = db.transaction(() => {
    for (const item of data) {
      const id = item.id || randomUUID();
      const jsonValue = typeof item.value === 'string' ? item.value : JSON.stringify(item.value);
      const embedding = item.embedding
        ? (typeof item.embedding === 'string' ? item.embedding : JSON.stringify(item.embedding))
        : JSON.stringify(computeEmbedding(`${item.key} ${jsonValue}`));

      stmts.insertMemory.run(
        id, siteId, agentId,
        item.type || item.memory_type || null,
        item.category || null,
        item.key,
        jsonValue,
        embedding,
        item.importance ?? 0.5,
        item.expires_at || null
      );
      imported++;
    }
  });
  tx();
  return { imported };
}

// ─── Preference Shortcuts ────────────────────────────────────────────────────

/**
 * Returns all 'preference' type memories for a site/agent.
 * @param {string} siteId
 * @param {string} agentId
 * @returns {object[]}
 */
function getPreferences(siteId, agentId) {
  return stmts.getPreferences.all(siteId, agentId);
}

/**
 * Stores or updates a preference memory. Upserts if the same key exists.
 * @param {string} siteId
 * @param {string} agentId
 * @param {string} key
 * @param {any} value
 * @returns {object}
 */
function recordPreference(siteId, agentId, key, value) {
  const existing = stmts.findPreference.get(siteId, agentId, key);
  const jsonValue = typeof value === 'string' ? value : JSON.stringify(value);
  const embedding = computeEmbedding(`${key} ${jsonValue}`);

  if (existing) {
    const newImportance = Math.min(1, existing.importance + 0.05);
    stmts.updateMemoryValue.run(jsonValue, JSON.stringify(embedding), newImportance, existing.id);
    return stmts.getMemory.get(existing.id);
  }

  return storeMemory(siteId, agentId, {
    type: 'preference',
    category: 'custom',
    key,
    value: jsonValue,
    importance: 0.7,
  });
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  storeMemory,
  recallMemories,
  computeEmbedding,
  cosineSimilarity,
  associateMemories,
  getAssociatedMemories,
  forgetMemory,
  consolidateMemories,
  getMemoryStats,
  startSession,
  endSession,
  getSessionHistory,
  exportMemories,
  importMemories,
  getPreferences,
  recordPreference,
};
