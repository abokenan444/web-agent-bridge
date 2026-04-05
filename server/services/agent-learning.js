/**
 * Agent Learning Engine — Local Reinforcement Learning
 *
 * Agents learn from user decisions, building behavioral models locally
 * without sending data to external LLMs. The engine tracks:
 *   - Decision patterns (what the user chooses and when)
 *   - Reward signals (accepted/rejected/modified outcomes)
 *   - Policy weights (which factors matter most to this user)
 *   - Prediction accuracy over time
 *
 * Learning algorithms:
 *   - Multi-armed bandit for action selection
 *   - Exponential decay for preference freshness
 *   - Bayesian confidence updates
 *   - Pattern sequence mining for behavior chains
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS learning_decisions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    action TEXT NOT NULL,
    context TEXT DEFAULT '{}',
    outcome TEXT DEFAULT 'pending',
    reward REAL DEFAULT 0.0,
    predicted_reward REAL,
    features TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS learning_policies (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    feature TEXT NOT NULL,
    weight REAL DEFAULT 0.0,
    update_count INTEGER DEFAULT 0,
    last_error REAL DEFAULT 0.0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, agent_id, domain, feature)
  );

  CREATE TABLE IF NOT EXISTS learning_patterns (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    pattern_type TEXT NOT NULL,
    sequence TEXT NOT NULL,
    frequency INTEGER DEFAULT 1,
    confidence REAL DEFAULT 0.5,
    last_seen TEXT DEFAULT (datetime('now')),
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS learning_bandit_arms (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    action TEXT NOT NULL,
    pulls INTEGER DEFAULT 0,
    total_reward REAL DEFAULT 0.0,
    avg_reward REAL DEFAULT 0.0,
    ucb_score REAL DEFAULT 1000.0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(site_id, agent_id, domain, action)
  );

  CREATE TABLE IF NOT EXISTS learning_sessions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    decisions_made INTEGER DEFAULT 0,
    correct_predictions INTEGER DEFAULT 0,
    accuracy REAL DEFAULT 0.0,
    started_at TEXT DEFAULT (datetime('now')),
    ended_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_learn_dec_site ON learning_decisions(site_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_learn_dec_domain ON learning_decisions(domain);
  CREATE INDEX IF NOT EXISTS idx_learn_dec_outcome ON learning_decisions(outcome);
  CREATE INDEX IF NOT EXISTS idx_learn_pol_lookup ON learning_policies(site_id, agent_id, domain);
  CREATE INDEX IF NOT EXISTS idx_learn_pat_seq ON learning_patterns(site_id, agent_id, pattern_type);
  CREATE INDEX IF NOT EXISTS idx_learn_bandit ON learning_bandit_arms(site_id, agent_id, domain);
`);

// ─── Config ──────────────────────────────────────────────────────────

const LEARNING_RATE = 0.1;
const DISCOUNT_FACTOR = 0.95;
const DECAY_RATE = 0.01;
const UCB_EXPLORATION = 1.414;
const MIN_CONFIDENCE = 0.01;
const MAX_SEQUENCE_LENGTH = 5;

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertDecision: db.prepare(`INSERT INTO learning_decisions (id, site_id, agent_id, domain, action, context, predicted_reward, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  updateOutcome: db.prepare(`UPDATE learning_decisions SET outcome = ?, reward = ? WHERE id = ?`),
  getDecision: db.prepare(`SELECT * FROM learning_decisions WHERE id = ?`),
  getRecentDecisions: db.prepare(`SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY created_at DESC LIMIT ?`),
  getDecisionsByOutcome: db.prepare(`SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = ? ORDER BY created_at DESC LIMIT ?`),
  getAllDomainDecisions: db.prepare(`SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY created_at DESC`),
  countDecisions: db.prepare(`SELECT COUNT(*) as count FROM learning_decisions WHERE site_id = ? AND agent_id = ?`),

  upsertPolicy: db.prepare(`INSERT INTO learning_policies (id, site_id, agent_id, domain, feature, weight) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, agent_id, domain, feature) DO UPDATE SET weight = ?, update_count = update_count + 1, last_error = ?, updated_at = datetime('now')`),
  getPolicies: db.prepare(`SELECT * FROM learning_policies WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY ABS(weight) DESC`),
  getPolicy: db.prepare(`SELECT * FROM learning_policies WHERE site_id = ? AND agent_id = ? AND domain = ? AND feature = ?`),

  insertPattern: db.prepare(`INSERT INTO learning_patterns (id, site_id, agent_id, pattern_type, sequence, confidence) VALUES (?, ?, ?, ?, ?, ?)`),
  findPattern: db.prepare(`SELECT * FROM learning_patterns WHERE site_id = ? AND agent_id = ? AND sequence = ?`),
  updatePattern: db.prepare(`UPDATE learning_patterns SET frequency = frequency + 1, confidence = ?, last_seen = datetime('now') WHERE id = ?`),
  getTopPatterns: db.prepare(`SELECT * FROM learning_patterns WHERE site_id = ? AND agent_id = ? AND pattern_type = ? ORDER BY frequency DESC, confidence DESC LIMIT ?`),

  upsertArm: db.prepare(`INSERT INTO learning_bandit_arms (id, site_id, agent_id, domain, action) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, agent_id, domain, action) DO NOTHING`),
  getArms: db.prepare(`SELECT * FROM learning_bandit_arms WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY ucb_score DESC`),
  updateArm: db.prepare(`UPDATE learning_bandit_arms SET pulls = pulls + 1, total_reward = total_reward + ?, avg_reward = (total_reward + ?) / (pulls + 1), ucb_score = ?, updated_at = datetime('now') WHERE site_id = ? AND agent_id = ? AND domain = ? AND action = ?`),
  getTotalPulls: db.prepare(`SELECT SUM(pulls) as total FROM learning_bandit_arms WHERE site_id = ? AND agent_id = ? AND domain = ?`),

  insertSession: db.prepare(`INSERT INTO learning_sessions (id, site_id, agent_id) VALUES (?, ?, ?)`),
  updateSession: db.prepare(`UPDATE learning_sessions SET decisions_made = ?, correct_predictions = ?, accuracy = ?, ended_at = datetime('now') WHERE id = ?`),
  getSessionHistory: db.prepare(`SELECT * FROM learning_sessions WHERE site_id = ? AND agent_id = ? ORDER BY started_at DESC LIMIT ?`),

  getStats: db.prepare(`SELECT
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ?) as total_decisions,
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = 'accepted') as accepted,
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = 'rejected') as rejected,
    (SELECT AVG(reward) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome != 'pending') as avg_reward,
    (SELECT COUNT(DISTINCT domain) FROM learning_policies WHERE site_id = ? AND agent_id = ?) as policy_domains,
    (SELECT COUNT(*) FROM learning_patterns WHERE site_id = ? AND agent_id = ?) as total_patterns`),
};

// ─── Core Learning API ───────────────────────────────────────────────

/**
 * Record a decision the agent is about to make, with predicted reward.
 */
function recordDecision(siteId, agentId, domain, action, context = {}, features = {}) {
  const id = crypto.randomUUID();
  const predictedReward = _predict(siteId, agentId, domain, features);

  stmts.insertDecision.run(id, siteId, agentId, domain, action, JSON.stringify(context), predictedReward, JSON.stringify(features));

  // Ensure bandit arm exists
  stmts.upsertArm.run(crypto.randomUUID(), siteId, agentId, domain, action);

  return { decisionId: id, predictedReward, confidence: _getConfidence(siteId, agentId, domain) };
}

/**
 * Provide feedback on a decision — the outcome and actual reward.
 * This is the core learning signal.
 */
function feedback(decisionId, outcome, reward) {
  const decision = stmts.getDecision.get(decisionId);
  if (!decision) throw new Error('Decision not found');

  stmts.updateOutcome.run(outcome, reward, decisionId);

  const features = JSON.parse(decision.features || '{}');
  const predError = reward - (decision.predicted_reward || 0);

  // Update policy weights via gradient descent
  _updatePolicies(decision.site_id, decision.agent_id, decision.domain, features, predError);

  // Update bandit arm
  _updateBanditArm(decision.site_id, decision.agent_id, decision.domain, decision.action, reward);

  // Mine patterns from recent decisions
  _minePatterns(decision.site_id, decision.agent_id, decision.domain);

  return {
    predictionError: predError,
    updatedConfidence: _getConfidence(decision.site_id, decision.agent_id, decision.domain),
  };
}

/**
 * Get the best action for a domain using learned policies + bandit scores.
 */
function recommend(siteId, agentId, domain, availableActions, context = {}) {
  const features = _extractFeatures(context);

  // Score each action
  const scored = availableActions.map((action) => {
    const arm = _getOrCreateArm(siteId, agentId, domain, action);
    const policyScore = _predict(siteId, agentId, domain, { ...features, action });
    const banditScore = arm.ucb_score || 0;

    // Blend policy prediction with bandit exploration
    const blended = 0.6 * policyScore + 0.4 * banditScore;

    return { action, score: blended, policyScore, banditScore, pulls: arm.pulls };
  });

  scored.sort((a, b) => b.score - a.score);

  const confidence = _getConfidence(siteId, agentId, domain);
  const topPatterns = stmts.getTopPatterns.all(siteId, agentId, 'action_sequence', 3);

  return {
    recommended: scored[0]?.action || availableActions[0],
    rankings: scored,
    confidence,
    patterns: topPatterns.map((p) => ({ sequence: p.sequence, frequency: p.frequency, confidence: p.confidence })),
  };
}

/**
 * Get learned preference summary for a domain.
 */
function getPreferences(siteId, agentId, domain) {
  const policies = stmts.getPolicies.all(siteId, agentId, domain);
  const decisions = stmts.getRecentDecisions.all(siteId, agentId, domain, 50);
  const patterns = stmts.getTopPatterns.all(siteId, agentId, 'action_sequence', 10);

  const accepted = decisions.filter((d) => d.outcome === 'accepted');
  const rejected = decisions.filter((d) => d.outcome === 'rejected');

  // Build preference profile
  const profile = {};
  for (const p of policies) {
    if (Math.abs(p.weight) > 0.05) {
      profile[p.feature] = {
        weight: Math.round(p.weight * 1000) / 1000,
        direction: p.weight > 0 ? 'preferred' : 'avoided',
        strength: Math.abs(p.weight) > 0.5 ? 'strong' : Math.abs(p.weight) > 0.2 ? 'moderate' : 'weak',
        updates: p.update_count,
      };
    }
  }

  return {
    domain,
    profile,
    acceptRate: decisions.length > 0 ? accepted.length / decisions.length : 0,
    totalDecisions: decisions.length,
    avgReward: decisions.length > 0 ? decisions.reduce((s, d) => s + d.reward, 0) / decisions.length : 0,
    topPatterns: patterns.map((p) => ({ sequence: p.sequence, frequency: p.frequency })),
    confidence: _getConfidence(siteId, agentId, domain),
  };
}

// ─── Learning Sessions ───────────────────────────────────────────────

function startSession(siteId, agentId) {
  const id = crypto.randomUUID();
  stmts.insertSession.run(id, siteId, agentId);
  return { sessionId: id };
}

function endSession(sessionId, decisionsMade, correctPredictions) {
  const accuracy = decisionsMade > 0 ? correctPredictions / decisionsMade : 0;
  stmts.updateSession.run(decisionsMade, correctPredictions, accuracy, sessionId);
  return { accuracy };
}

// ─── Stats ───────────────────────────────────────────────────────────

function getStats(siteId, agentId) {
  const row = stmts.getStats.get(siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId);
  const sessions = stmts.getSessionHistory.all(siteId, agentId, 10);
  const recentAccuracy = sessions.length > 0 ? sessions.reduce((s, sess) => s + sess.accuracy, 0) / sessions.length : 0;

  return {
    ...row,
    recentAccuracy: Math.round(recentAccuracy * 1000) / 1000,
    sessionsCount: sessions.length,
    acceptRate: row.total_decisions > 0 ? Math.round((row.accepted / row.total_decisions) * 1000) / 1000 : 0,
  };
}

// ─── Internal: Prediction via Linear Model ───────────────────────────

function _predict(siteId, agentId, domain, features) {
  const policies = stmts.getPolicies.all(siteId, agentId, domain);
  if (policies.length === 0) return 0.5; // No data yet — neutral prediction

  let score = 0;
  for (const p of policies) {
    const featureVal = features[p.feature];
    if (featureVal !== undefined) {
      const fv = typeof featureVal === 'number' ? featureVal : (featureVal ? 1 : 0);
      score += p.weight * fv;
    }
  }

  // Sigmoid squash to [0, 1]
  return 1 / (1 + Math.exp(-score));
}

function _updatePolicies(siteId, agentId, domain, features, error) {
  for (const [feature, value] of Object.entries(features)) {
    const fv = typeof value === 'number' ? value : (value ? 1 : 0);
    const gradient = error * fv * LEARNING_RATE;

    const existing = stmts.getPolicy.get(siteId, agentId, domain, feature);
    const newWeight = existing ? existing.weight + gradient : gradient;

    stmts.upsertPolicy.run(
      crypto.randomUUID(), siteId, agentId, domain, feature, newWeight,
      newWeight, Math.abs(error)
    );
  }
}

// ─── Internal: Multi-Armed Bandit ────────────────────────────────────

function _getOrCreateArm(siteId, agentId, domain, action) {
  stmts.upsertArm.run(crypto.randomUUID(), siteId, agentId, domain, action);
  const arms = stmts.getArms.all(siteId, agentId, domain);
  return arms.find((a) => a.action === action) || { pulls: 0, ucb_score: 1000, avg_reward: 0 };
}

function _updateBanditArm(siteId, agentId, domain, action, reward) {
  const totalPullsRow = stmts.getTotalPulls.get(siteId, agentId, domain);
  const totalPulls = (totalPullsRow?.total || 0) + 1;

  const arms = stmts.getArms.all(siteId, agentId, domain);
  const arm = arms.find((a) => a.action === action);
  const armPulls = arm ? arm.pulls + 1 : 1;

  // UCB1 formula
  const avgReward = arm ? (arm.total_reward + reward) / armPulls : reward;
  const exploration = UCB_EXPLORATION * Math.sqrt(Math.log(totalPulls) / armPulls);
  const ucbScore = avgReward + exploration;

  stmts.updateArm.run(reward, reward, ucbScore, siteId, agentId, domain, action);
}

// ─── Internal: Pattern Mining ────────────────────────────────────────

function _minePatterns(siteId, agentId, domain) {
  const decisions = stmts.getRecentDecisions.all(siteId, agentId, domain, 20);
  if (decisions.length < 3) return;

  // Extract action sequences of length 2-5
  for (let len = 2; len <= Math.min(MAX_SEQUENCE_LENGTH, decisions.length); len++) {
    const sequence = decisions.slice(0, len).map((d) => d.action).reverse().join(' → ');
    const existing = stmts.findPattern.get(siteId, agentId, sequence);

    if (existing) {
      const newConf = Math.min(0.99, existing.confidence + 0.05 * (1 - existing.confidence));
      stmts.updatePattern.run(newConf, existing.id);
    } else {
      stmts.insertPattern.run(crypto.randomUUID(), siteId, agentId, 'action_sequence', sequence, 0.3);
    }
  }
}

// ─── Internal: Feature Extraction ────────────────────────────────────

function _extractFeatures(context) {
  const features = {};

  if (context.price !== undefined) features.price = context.price;
  if (context.quantity !== undefined) features.quantity = context.quantity;
  if (context.discount !== undefined) features.discount = context.discount;
  if (context.category) features[`category:${context.category}`] = 1;
  if (context.timeOfDay !== undefined) {
    features.morning = context.timeOfDay < 12 ? 1 : 0;
    features.afternoon = context.timeOfDay >= 12 && context.timeOfDay < 18 ? 1 : 0;
    features.evening = context.timeOfDay >= 18 ? 1 : 0;
  }
  if (context.isRepeat !== undefined) features.repeat_visit = context.isRepeat ? 1 : 0;
  if (context.urgency !== undefined) features.urgency = context.urgency;

  // Pass through any raw features
  for (const [k, v] of Object.entries(context)) {
    if (features[k] === undefined && typeof v === 'number') {
      features[k] = v;
    }
  }

  return features;
}

// ─── Internal: Confidence Estimation ─────────────────────────────────

function _getConfidence(siteId, agentId, domain) {
  const decisions = stmts.getRecentDecisions.all(siteId, agentId, domain, 50);
  if (decisions.length === 0) return 0;

  const withOutcome = decisions.filter((d) => d.outcome !== 'pending');
  if (withOutcome.length === 0) return MIN_CONFIDENCE;

  // Confidence = f(data volume, prediction accuracy, recency)
  const volumeConf = Math.min(1, withOutcome.length / 30);

  let accuracySum = 0;
  for (const d of withOutcome) {
    if (d.predicted_reward !== null) {
      const error = Math.abs(d.reward - d.predicted_reward);
      accuracySum += Math.max(0, 1 - error);
    }
  }
  const accuracyConf = withOutcome.length > 0 ? accuracySum / withOutcome.length : 0.5;

  // Recency — decay confidence for old data
  const latestTs = new Date(withOutcome[0].created_at).getTime();
  const ageHours = (Date.now() - latestTs) / 3600000;
  const recencyConf = Math.exp(-DECAY_RATE * ageHours);

  return Math.max(MIN_CONFIDENCE, Math.min(0.99, volumeConf * 0.3 + accuracyConf * 0.5 + recencyConf * 0.2));
}

module.exports = {
  recordDecision, feedback, recommend, getPreferences,
  startSession, endSession, getStats,
};
