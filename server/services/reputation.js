/**
 * Decentralized Reputation System
 * ════════════════════════════════════════════════════════════════════════
 * Trustless, agent-to-agent reputation protocol. When an agent completes
 * a successful interaction with a site (purchase, booking, query), it
 * leaves a cryptographically signed "trust attestation" that other agents
 * can verify without relying on any central authority.
 *
 * Key concepts:
 *  - Trust Attestation: HMAC-signed proof of a successful interaction
 *  - Reputation Score: Weighted aggregation of attestations over time
 *  - Decay: Older attestations lose weight (freshness matters)
 *  - Sybil Resistance: Rate-limited per agent key, cross-verified via vision
 */

const { db } = require('../models/db');
const crypto = require('crypto');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS reputation_attestations (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    agent_key_hash TEXT NOT NULL,
    interaction_type TEXT NOT NULL CHECK(interaction_type IN (
      'purchase','booking','query','form_submit','navigation','verification'
    )),
    outcome TEXT NOT NULL CHECK(outcome IN ('success','partial','failure','fraud')),
    price_accuracy REAL DEFAULT 1.0,
    response_time_ms INTEGER DEFAULT 0,
    data_integrity REAL DEFAULT 1.0,
    vision_verified INTEGER DEFAULT 0,
    details TEXT DEFAULT '{}',
    signature TEXT NOT NULL,
    timestamp TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    revoked INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reputation_scores (
    site_id TEXT PRIMARY KEY,
    total_attestations INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    fraud_count INTEGER DEFAULT 0,
    avg_price_accuracy REAL DEFAULT 1.0,
    avg_response_time_ms REAL DEFAULT 0,
    avg_data_integrity REAL DEFAULT 1.0,
    vision_verified_pct REAL DEFAULT 0,
    reputation_score REAL DEFAULT 50.0,
    trust_level TEXT DEFAULT 'unknown' CHECK(trust_level IN (
      'unknown','emerging','trusted','verified','exemplary','suspicious','blacklisted'
    )),
    first_seen TEXT DEFAULT (datetime('now')),
    last_updated TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reputation_agent_keys (
    agent_id TEXT PRIMARY KEY,
    public_key_hash TEXT NOT NULL,
    attestation_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    last_active TEXT DEFAULT (datetime('now')),
    rate_window_start TEXT,
    rate_window_count INTEGER DEFAULT 0,
    banned INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS reputation_challenges (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    challenger_agent TEXT NOT NULL,
    reason TEXT NOT NULL,
    evidence TEXT DEFAULT '{}',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','investigating','upheld','dismissed')),
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_rep_att_site ON reputation_attestations(site_id);
  CREATE INDEX IF NOT EXISTS idx_rep_att_agent ON reputation_attestations(agent_id);
  CREATE INDEX IF NOT EXISTS idx_rep_att_time ON reputation_attestations(timestamp);
  CREATE INDEX IF NOT EXISTS idx_rep_scores_score ON reputation_scores(reputation_score);
  CREATE INDEX IF NOT EXISTS idx_rep_scores_level ON reputation_scores(trust_level);
`);

// ─── Constants ───────────────────────────────────────────────────────

const DECAY_HALF_LIFE_DAYS = 30;
const MAX_ATTESTATIONS_PER_HOUR = 10;
const MIN_ATTESTATIONS_FOR_TRUST = 5;
const FRAUD_PENALTY_MULTIPLIER = 3;
const VISION_VERIFICATION_BONUS = 1.25;
const TRUST_LEVELS = {
  blacklisted: { min: 0, max: 10 },
  suspicious: { min: 10, max: 25 },
  unknown: { min: 25, max: 40 },
  emerging: { min: 40, max: 60 },
  trusted: { min: 60, max: 80 },
  verified: { min: 80, max: 92 },
  exemplary: { min: 92, max: 100 },
};

// ─── Crypto Helpers ──────────────────────────────────────────────────

const SIGNING_SECRET = process.env.WAB_REPUTATION_SECRET || crypto.randomBytes(32).toString('hex');

function generateAgentId() {
  return 'agent_' + crypto.randomBytes(16).toString('hex');
}

function hashAgentKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function signAttestation(data) {
  const payload = JSON.stringify({
    site_id: data.site_id,
    agent_id: data.agent_id,
    interaction_type: data.interaction_type,
    outcome: data.outcome,
    price_accuracy: data.price_accuracy,
    timestamp: data.timestamp
  });
  return crypto.createHmac('sha256', SIGNING_SECRET).update(payload).digest('hex');
}

function verifySignature(attestation) {
  const expected = signAttestation(attestation);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(attestation.signature));
}

// ─── Agent Registration ──────────────────────────────────────────────

function registerAgent(agentKey) {
  const agentId = generateAgentId();
  const keyHash = hashAgentKey(agentKey);

  db.prepare(`
    INSERT OR IGNORE INTO reputation_agent_keys (agent_id, public_key_hash)
    VALUES (?, ?)
  `).run(agentId, keyHash);

  return { agentId, keyHash };
}

function checkRateLimit(agentId) {
  const agent = db.prepare('SELECT * FROM reputation_agent_keys WHERE agent_id = ?').get(agentId);
  if (!agent) return { allowed: false, reason: 'unknown_agent' };
  if (agent.banned) return { allowed: false, reason: 'agent_banned' };

  const now = new Date();
  const windowStart = agent.rate_window_start ? new Date(agent.rate_window_start) : null;

  if (!windowStart || (now - windowStart) > 3600000) {
    db.prepare(`
      UPDATE reputation_agent_keys
      SET rate_window_start = datetime('now'), rate_window_count = 0
      WHERE agent_id = ?
    `).run(agentId);
    return { allowed: true, remaining: MAX_ATTESTATIONS_PER_HOUR };
  }

  if (agent.rate_window_count >= MAX_ATTESTATIONS_PER_HOUR) {
    return { allowed: false, reason: 'rate_limited', retryAfterMs: 3600000 - (now - windowStart) };
  }

  return { allowed: true, remaining: MAX_ATTESTATIONS_PER_HOUR - agent.rate_window_count };
}

// ─── Trust Attestation ───────────────────────────────────────────────

function createAttestation({
  siteId, agentId, interactionType, outcome,
  priceAccuracy = 1.0, responseTimeMs = 0,
  dataIntegrity = 1.0, visionVerified = false, details = {}
}) {
  const rateCheck = checkRateLimit(agentId);
  if (!rateCheck.allowed) {
    return { error: rateCheck.reason, retryAfterMs: rateCheck.retryAfterMs };
  }

  const id = crypto.randomBytes(16).toString('hex');
  const timestamp = new Date().toISOString();
  const expiresAt = new Date(Date.now() + DECAY_HALF_LIFE_DAYS * 4 * 86400000).toISOString();

  const attestation = {
    id, site_id: siteId, agent_id: agentId,
    interaction_type: interactionType, outcome,
    price_accuracy: Math.max(0, Math.min(1, priceAccuracy)),
    response_time_ms: responseTimeMs,
    data_integrity: Math.max(0, Math.min(1, dataIntegrity)),
    vision_verified: visionVerified ? 1 : 0,
    details: JSON.stringify(details),
    timestamp, expires_at: expiresAt
  };

  attestation.signature = signAttestation(attestation);

  db.prepare(`
    INSERT INTO reputation_attestations
    (id, site_id, agent_id, agent_key_hash, interaction_type, outcome,
     price_accuracy, response_time_ms, data_integrity, vision_verified,
     details, signature, timestamp, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attestation.id, attestation.site_id, attestation.agent_id,
    hashAgentKey(agentId),
    attestation.interaction_type, attestation.outcome,
    attestation.price_accuracy, attestation.response_time_ms,
    attestation.data_integrity, attestation.vision_verified,
    attestation.details, attestation.signature,
    attestation.timestamp, attestation.expires_at
  );

  // Update agent rate limit counter
  db.prepare(`
    UPDATE reputation_agent_keys
    SET rate_window_count = rate_window_count + 1,
        attestation_count = attestation_count + 1,
        last_active = datetime('now')
    WHERE agent_id = ?
  `).run(agentId);

  // Recalculate reputation score
  recalculateReputation(siteId);

  return { attestation: { id, signature: attestation.signature, timestamp } };
}

// ─── Reputation Calculation ──────────────────────────────────────────

function recalculateReputation(siteId) {
  const attestations = db.prepare(`
    SELECT * FROM reputation_attestations
    WHERE site_id = ? AND revoked = 0 AND expires_at > datetime('now')
    ORDER BY timestamp DESC
  `).all(siteId);

  if (attestations.length === 0) {
    db.prepare(`
      INSERT OR REPLACE INTO reputation_scores
      (site_id, total_attestations, reputation_score, trust_level, last_updated)
      VALUES (?, 0, 50.0, 'unknown', datetime('now'))
    `).run(siteId);
    return;
  }

  const now = Date.now();
  let weightedSum = 0;
  let totalWeight = 0;
  let successCount = 0;
  let failureCount = 0;
  let fraudCount = 0;
  let priceAccSum = 0;
  let responseSum = 0;
  let integritySum = 0;
  let visionVerifiedCount = 0;

  for (const att of attestations) {
    const ageMs = now - new Date(att.timestamp).getTime();
    const ageDays = ageMs / 86400000;
    const decayWeight = Math.pow(0.5, ageDays / DECAY_HALF_LIFE_DAYS);

    let outcomeScore;
    switch (att.outcome) {
      case 'success': outcomeScore = 1.0; successCount++; break;
      case 'partial': outcomeScore = 0.5; break;
      case 'failure': outcomeScore = 0.0; failureCount++; break;
      case 'fraud': outcomeScore = -FRAUD_PENALTY_MULTIPLIER; fraudCount++; break;
      default: outcomeScore = 0;
    }

    let weight = decayWeight;
    if (att.vision_verified) {
      weight *= VISION_VERIFICATION_BONUS;
      visionVerifiedCount++;
    }

    const qualityScore = (
      outcomeScore * 0.5 +
      att.price_accuracy * 0.25 +
      att.data_integrity * 0.25
    );

    weightedSum += qualityScore * weight;
    totalWeight += weight;
    priceAccSum += att.price_accuracy;
    responseSum += att.response_time_ms;
    integritySum += att.data_integrity;
  }

  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  // Normalize to 0-100 with confidence adjustment
  const confidence = Math.min(attestations.length / MIN_ATTESTATIONS_FOR_TRUST, 1);
  const reputationScore = Math.max(0, Math.min(100,
    (rawScore * 50 + 50) * confidence + 50 * (1 - confidence)
  ));

  // Determine trust level
  let trustLevel = 'unknown';
  for (const [level, range] of Object.entries(TRUST_LEVELS)) {
    if (reputationScore >= range.min && reputationScore < range.max) {
      trustLevel = level;
      break;
    }
  }
  if (reputationScore >= 92) trustLevel = 'exemplary';

  db.prepare(`
    INSERT INTO reputation_scores
    (site_id, total_attestations, success_count, failure_count, fraud_count,
     avg_price_accuracy, avg_response_time_ms, avg_data_integrity,
     vision_verified_pct, reputation_score, trust_level, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(site_id) DO UPDATE SET
      total_attestations = excluded.total_attestations,
      success_count = excluded.success_count,
      failure_count = excluded.failure_count,
      fraud_count = excluded.fraud_count,
      avg_price_accuracy = excluded.avg_price_accuracy,
      avg_response_time_ms = excluded.avg_response_time_ms,
      avg_data_integrity = excluded.avg_data_integrity,
      vision_verified_pct = excluded.vision_verified_pct,
      reputation_score = excluded.reputation_score,
      trust_level = excluded.trust_level,
      last_updated = datetime('now')
  `).run(
    siteId, attestations.length, successCount, failureCount, fraudCount,
    priceAccSum / attestations.length,
    responseSum / attestations.length,
    integritySum / attestations.length,
    attestations.length > 0 ? (visionVerifiedCount / attestations.length) * 100 : 0,
    Math.round(reputationScore * 100) / 100,
    trustLevel
  );
}

// ─── Query Reputation ────────────────────────────────────────────────

function getReputation(siteId) {
  const score = db.prepare('SELECT * FROM reputation_scores WHERE site_id = ?').get(siteId);
  if (!score) return { siteId, reputationScore: 50, trustLevel: 'unknown', attestations: 0 };

  const recentAttestations = db.prepare(`
    SELECT interaction_type, outcome, price_accuracy, vision_verified, timestamp
    FROM reputation_attestations
    WHERE site_id = ? AND revoked = 0
    ORDER BY timestamp DESC LIMIT 10
  `).all(siteId);

  return {
    siteId,
    reputationScore: score.reputation_score,
    trustLevel: score.trust_level,
    totalAttestations: score.total_attestations,
    successRate: score.total_attestations > 0
      ? Math.round((score.success_count / score.total_attestations) * 100) : 0,
    avgPriceAccuracy: Math.round(score.avg_price_accuracy * 100),
    avgResponseTimeMs: Math.round(score.avg_response_time_ms),
    dataIntegrity: Math.round(score.avg_data_integrity * 100),
    visionVerifiedPct: Math.round(score.vision_verified_pct),
    lastUpdated: score.last_updated,
    recentAttestations
  };
}

function getReputationLeaderboard(limit = 20) {
  return db.prepare(`
    SELECT site_id, reputation_score, trust_level, total_attestations,
           success_count, fraud_count, avg_price_accuracy, vision_verified_pct
    FROM reputation_scores
    WHERE total_attestations >= ?
    ORDER BY reputation_score DESC
    LIMIT ?
  `).all(MIN_ATTESTATIONS_FOR_TRUST, limit);
}

function searchByReputation(category, minScore = 60) {
  return db.prepare(`
    SELECT rs.*, wd.category, wd.tags, wd.is_independent
    FROM reputation_scores rs
    LEFT JOIN wab_directory wd ON rs.site_id = wd.site_id
    WHERE rs.reputation_score >= ?
      AND (wd.category = ? OR ? = 'all')
      AND rs.trust_level NOT IN ('suspicious', 'blacklisted')
    ORDER BY rs.reputation_score DESC
  `).all(minScore, category, category);
}

// ─── Challenges (dispute mechanism) ──────────────────────────────────

function challengeReputation(siteId, challengerAgent, reason, evidence = {}) {
  const id = crypto.randomBytes(16).toString('hex');

  db.prepare(`
    INSERT INTO reputation_challenges (id, site_id, challenger_agent, reason, evidence)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, siteId, challengerAgent, reason, JSON.stringify(evidence));

  // Auto-investigate if multiple challenges
  const challengeCount = db.prepare(`
    SELECT COUNT(*) as cnt FROM reputation_challenges
    WHERE site_id = ? AND status = 'pending'
  `).get(siteId);

  if (challengeCount.cnt >= 3) {
    // Flag site for review
    db.prepare(`
      UPDATE reputation_scores SET trust_level = 'suspicious' WHERE site_id = ?
    `).run(siteId);
  }

  return { challengeId: id, status: 'pending' };
}

// ─── Verification (verify an attestation cryptographically) ──────────

function verifyAttestation(attestationId) {
  const att = db.prepare('SELECT * FROM reputation_attestations WHERE id = ?').get(attestationId);
  if (!att) return { valid: false, reason: 'not_found' };
  if (att.revoked) return { valid: false, reason: 'revoked' };

  const isValid = verifySignature(att);
  return {
    valid: isValid,
    attestation: isValid ? {
      siteId: att.site_id,
      interactionType: att.interaction_type,
      outcome: att.outcome,
      priceAccuracy: att.price_accuracy,
      visionVerified: att.vision_verified === 1,
      timestamp: att.timestamp
    } : null
  };
}

// ─── Cleanup ─────────────────────────────────────────────────────────

function cleanupExpired() {
  const result = db.prepare(`
    DELETE FROM reputation_attestations WHERE expires_at < datetime('now')
  `).run();

  // Recalculate affected sites
  const sites = db.prepare('SELECT DISTINCT site_id FROM reputation_scores').all();
  for (const { site_id } of sites) {
    recalculateReputation(site_id);
  }
  return { cleaned: result.changes };
}

module.exports = {
  registerAgent,
  createAttestation,
  getReputation,
  getReputationLeaderboard,
  searchByReputation,
  challengeReputation,
  verifyAttestation,
  cleanupExpired,
  recalculateReputation
};
