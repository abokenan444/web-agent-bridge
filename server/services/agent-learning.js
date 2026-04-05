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
 *   - Multi-armed bandit (UCB1) for exploration/exploitation
 *   - Linear policy model with sigmoid activation and gradient descent
 *   - Temporal discount for preference freshness (recent > old)
 *   - Sequential pattern mining for behavior chains
 *   - Confidence estimation: volume × accuracy × recency
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
    ucb_score REAL DEFAULT 0.0,
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
const DISCOUNT_FACTOR = 0.95;     // Temporal discount per decision step
const DECAY_RATE = 0.01;          // Recency decay per hour
const UCB_EXPLORATION = 1.414;    // √2 for UCB1
const MIN_CONFIDENCE = 0.01;
const MAX_SEQUENCE_LENGTH = 5;

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertDecision: db.prepare('INSERT INTO learning_decisions (id, site_id, agent_id, domain, action, context, predicted_reward, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
  updateOutcome: db.prepare('UPDATE learning_decisions SET outcome = ?, reward = ? WHERE id = ?'),
  getDecision: db.prepare('SELECT * FROM learning_decisions WHERE id = ?'),
  getRecentDecisions: db.prepare('SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY created_at DESC LIMIT ?'),
  getDecisionsByOutcome: db.prepare("SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = ? ORDER BY created_at DESC LIMIT ?"),
  getAllDomainDecisions: db.prepare('SELECT * FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY created_at DESC'),
  countDecisions: db.prepare('SELECT COUNT(*) as count FROM learning_decisions WHERE site_id = ? AND agent_id = ?'),
  getRecentRewards: db.prepare("SELECT reward, created_at FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome != 'pending' ORDER BY created_at DESC LIMIT ?"),

  upsertPolicy: db.prepare("INSERT INTO learning_policies (id, site_id, agent_id, domain, feature, weight) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(site_id, agent_id, domain, feature) DO UPDATE SET weight = ?, update_count = update_count + 1, last_error = ?, updated_at = datetime('now')"),
  getPolicies: db.prepare('SELECT * FROM learning_policies WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY ABS(weight) DESC'),
  getPolicy: db.prepare('SELECT * FROM learning_policies WHERE site_id = ? AND agent_id = ? AND domain = ? AND feature = ?'),

  insertPattern: db.prepare('INSERT INTO learning_patterns (id, site_id, agent_id, pattern_type, sequence, confidence) VALUES (?, ?, ?, ?, ?, ?)'),
  findPattern: db.prepare('SELECT * FROM learning_patterns WHERE site_id = ? AND agent_id = ? AND sequence = ?'),
  updatePattern: db.prepare("UPDATE learning_patterns SET frequency = frequency + 1, confidence = ?, last_seen = datetime('now') WHERE id = ?"),
  getTopPatterns: db.prepare('SELECT * FROM learning_patterns WHERE site_id = ? AND agent_id = ? AND pattern_type = ? ORDER BY frequency DESC, confidence DESC LIMIT ?'),

  upsertArm: db.prepare('INSERT INTO learning_bandit_arms (id, site_id, agent_id, domain, action) VALUES (?, ?, ?, ?, ?) ON CONFLICT(site_id, agent_id, domain, action) DO NOTHING'),
  getArms: db.prepare('SELECT * FROM learning_bandit_arms WHERE site_id = ? AND agent_id = ? AND domain = ? ORDER BY ucb_score DESC'),
  getArm: db.prepare('SELECT * FROM learning_bandit_arms WHERE site_id = ? AND agent_id = ? AND domain = ? AND action = ?'),
  updateArm: db.prepare("UPDATE learning_bandit_arms SET pulls = pulls + 1, total_reward = total_reward + ?, avg_reward = ?, ucb_score = ?, updated_at = datetime('now') WHERE site_id = ? AND agent_id = ? AND domain = ? AND action = ?"),

  insertSession: db.prepare('INSERT INTO learning_sessions (id, site_id, agent_id) VALUES (?, ?, ?)'),
  updateSession: db.prepare("UPDATE learning_sessions SET decisions_made = ?, correct_predictions = ?, accuracy = ?, ended_at = datetime('now') WHERE id = ?"),
  getSessionHistory: db.prepare('SELECT * FROM learning_sessions WHERE site_id = ? AND agent_id = ? ORDER BY started_at DESC LIMIT ?'),

  getStats: db.prepare(`SELECT
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ?) as total_decisions,
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = 'accepted') as accepted,
    (SELECT COUNT(*) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome = 'rejected') as rejected,
    (SELECT AVG(reward) FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND outcome != 'pending') as avg_reward,
    (SELECT COUNT(DISTINCT domain) FROM learning_policies WHERE site_id = ? AND agent_id = ?) as policy_domains,
    (SELECT COUNT(*) FROM learning_patterns WHERE site_id = ? AND agent_id = ?) as total_patterns`),

  deletePolicies: db.prepare('DELETE FROM learning_policies WHERE site_id = ? AND agent_id = ? AND domain = ?'),
  deletePatterns: db.prepare('DELETE FROM learning_patterns WHERE site_id = ? AND agent_id = ?'),
  deleteArms: db.prepare('DELETE FROM learning_bandit_arms WHERE site_id = ? AND agent_id = ? AND domain = ?'),
  deleteDecisions: db.prepare('DELETE FROM learning_decisions WHERE site_id = ? AND agent_id = ? AND domain = ?'),
};

// ─── Core Learning API ───────────────────────────────────────────────

/**
 * Record a decision the agent is about to make, with predicted reward.
 */
function recordDecision(siteId, agentId, domain, action, context = {}, features = {}) {
  const id = crypto.randomUUID();
  const extractedFeatures = { ..._extractFeatures(context), ...features };
  const predictedReward = _predict(siteId, agentId, domain, extractedFeatures);

  stmts.insertDecision.run(id, siteId, agentId, domain, action,
    JSON.stringify(context), predictedReward, JSON.stringify(extractedFeatures));

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

  // Update policy weights via gradient descent with temporal discount
  _updatePolicies(decision.site_id, decision.agent_id, decision.domain, features, predError);

  // Update bandit arm with actual reward
  _updateBanditArm(decision.site_id, decision.agent_id, decision.domain, decision.action, reward);

  // Mine patterns from recent decisions
  _minePatterns(decision.site_id, decision.agent_id, decision.domain);

  return {
    decisionId,
    predictionError: Math.round(predError * 1000) / 1000,
    updatedConfidence: _getConfidence(decision.site_id, decision.agent_id, decision.domain),
    accuracy: Math.round((1 - Math.abs(predError)) * 1000) / 1000,
  };
}

/**
 * Batch feedback — provide multiple outcomes at once.
 */
function batchFeedback(feedbackList) {
  const results = [];
  const txn = db.transaction(() => {
    for (const fb of feedbackList) {
      try {
        results.push(feedback(fb.decisionId, fb.outcome, fb.reward));
      } catch (err) {
        results.push({ decisionId: fb.decisionId, error: err.message });
      }
    }
  });
  txn();
  return results;
}

/**
 * Get the best action for a domain using learned policies + bandit scores.
 * UCB scores are normalized to [0,1] before blending with policy prediction.
 */
function recommend(siteId, agentId, domain, availableActions, context = {}) {
  const features = _extractFeatures(context);

  // Get all arms to find normalization bounds
  const allArms = stmts.getArms.all(siteId, agentId, domain);
  const armMap = {};
  for (const arm of allArms) armMap[arm.action] = arm;

  // Normalize UCB scores to [0,1]
  let minUCB = Infinity, maxUCB = -Infinity;
  for (const arm of allArms) {
    if (arm.pulls > 0) {
      if (arm.ucb_score < minUCB) minUCB = arm.ucb_score;
      if (arm.ucb_score > maxUCB) maxUCB = arm.ucb_score;
    }
  }
  const ucbRange = maxUCB - minUCB;

  const scored = availableActions.map((action) => {
    const arm = armMap[action] || _getOrCreateArm(siteId, agentId, domain, action);
    const policyScore = _predict(siteId, agentId, domain, { ...features, [`action:${action}`]: 1 });

    // Normalize bandit score to [0,1]
    let normalizedBandit;
    if (arm.pulls === 0) {
      normalizedBandit = 1.0; // unexplored arms get maximum exploration bonus
    } else if (ucbRange > 0) {
      normalizedBandit = (arm.ucb_score - minUCB) / ucbRange;
    } else {
      normalizedBandit = arm.avg_reward; // single arm — use raw avg
    }

    // Blend: as confidence grows, lean more on policy, less on exploration
    const confidence = _getConfidence(siteId, agentId, domain);
    const policyWeight = 0.4 + confidence * 0.4; // [0.4, 0.8]
    const banditWeight = 1 - policyWeight;        // [0.2, 0.6]
    const blended = policyWeight * policyScore + banditWeight * normalizedBandit;

    return {
      action,
      score: Math.round(blended * 1000) / 1000,
      policyScore: Math.round(policyScore * 1000) / 1000,
      banditScore: Math.round(normalizedBandit * 1000) / 1000,
      pulls: arm.pulls,
      avgReward: Math.round((arm.avg_reward || 0) * 1000) / 1000,
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const confidence = _getConfidence(siteId, agentId, domain);
  const topPatterns = stmts.getTopPatterns.all(siteId, agentId, 'action_sequence', 5);

  return {
    recommended: scored[0]?.action || availableActions[0],
    rankings: scored,
    confidence,
    explorationLevel: confidence < 0.3 ? 'high' : confidence < 0.6 ? 'medium' : 'low',
    patterns: topPatterns.map((p) => ({
      sequence: p.sequence, frequency: p.frequency, confidence: p.confidence
    })),
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

  // Build preference profile from weights
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

  // Compute action frequencies
  const actionFreqs = {};
  for (const d of decisions) {
    actionFreqs[d.action] = (actionFreqs[d.action] || 0) + 1;
  }

  return {
    domain,
    profile,
    acceptRate: decisions.length > 0 ? Math.round((accepted.length / decisions.length) * 1000) / 1000 : 0,
    rejectRate: decisions.length > 0 ? Math.round((rejected.length / decisions.length) * 1000) / 1000 : 0,
    totalDecisions: decisions.length,
    avgReward: decisions.length > 0
      ? Math.round((decisions.reduce((s, d) => s + d.reward, 0) / decisions.length) * 1000) / 1000
      : 0,
    topActions: Object.entries(actionFreqs)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([action, count]) => ({ action, count, percentage: Math.round((count / decisions.length) * 100) })),
    topPatterns: patterns.map((p) => ({ sequence: p.sequence, frequency: p.frequency })),
    confidence: _getConfidence(siteId, agentId, domain),
  };
}

/**
 * Get reward history — recent rewards over time for charting.
 */
function getRewardHistory(siteId, agentId, limit = 30) {
  return stmts.getRecentRewards.all(siteId, agentId, limit).reverse();
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
  return { accuracy: Math.round(accuracy * 1000) / 1000 };
}

// ─── Reset ───────────────────────────────────────────────────────────

/**
 * Reset all learned data for a specific domain.
 */
function resetDomain(siteId, agentId, domain) {
  const txn = db.transaction(() => {
    stmts.deletePolicies.run(siteId, agentId, domain);
    stmts.deleteArms.run(siteId, agentId, domain);
    stmts.deleteDecisions.run(siteId, agentId, domain);
  });
  txn();
  return { reset: true, domain };
}

/**
 * Reset all patterns for an agent.
 */
function resetPatterns(siteId, agentId) {
  stmts.deletePatterns.run(siteId, agentId);
  return { reset: true };
}

// ─── Stats ───────────────────────────────────────────────────────────

function getStats(siteId, agentId) {
  const row = stmts.getStats.get(siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId, siteId, agentId);
  const sessions = stmts.getSessionHistory.all(siteId, agentId, 10);
  const recentAccuracy = sessions.length > 0 ? sessions.reduce((s, sess) => s + sess.accuracy, 0) / sessions.length : 0;
  const rewardHistory = stmts.getRecentRewards.all(siteId, agentId, 30).reverse();

  return {
    ...row,
    avg_reward: row.avg_reward !== null ? Math.round(row.avg_reward * 1000) / 1000 : 0,
    recentAccuracy: Math.round(recentAccuracy * 1000) / 1000,
    sessionsCount: sessions.length,
    acceptRate: row.total_decisions > 0
      ? Math.round((row.accepted / row.total_decisions) * 1000) / 1000
      : 0,
    rewardHistory,
  };
}

// ─── Internal: Prediction via Linear Model ───────────────────────────

function _predict(siteId, agentId, domain, features) {
  const policies = stmts.getPolicies.all(siteId, agentId, domain);
  if (policies.length === 0) return 0.5; // No data yet — neutral prediction

  let score = 0;
  let matchedFeatures = 0;
  for (const p of policies) {
    const featureVal = features[p.feature];
    if (featureVal !== undefined) {
      const fv = typeof featureVal === 'number' ? featureVal : (featureVal ? 1 : 0);

      // Apply temporal discount: older policies (fewer recent updates) matter less
      const recencyBoost = p.update_count > 0 ? Math.pow(DISCOUNT_FACTOR, Math.max(0, 10 - p.update_count)) : 1;
      score += p.weight * fv * recencyBoost;
      matchedFeatures++;
    }
  }

  // Sigmoid squash to [0, 1]
  return 1 / (1 + Math.exp(-score));
}

function _updatePolicies(siteId, agentId, domain, features, error) {
  for (const [feature, value] of Object.entries(features)) {
    const fv = typeof value === 'number' ? value : (value ? 1 : 0);
    if (fv === 0) continue; // Skip zero-valued features

    const gradient = error * fv * LEARNING_RATE;
    const existing = stmts.getPolicy.get(siteId, agentId, domain, feature);

    // Apply weight decay to prevent unbounded growth
    const currentWeight = existing ? existing.weight * DISCOUNT_FACTOR : 0;
    const newWeight = currentWeight + gradient;

    // Clamp weights to [-5, 5] to prevent extreme values
    const clampedWeight = Math.max(-5, Math.min(5, newWeight));

    stmts.upsertPolicy.run(
      crypto.randomUUID(), siteId, agentId, domain, feature, clampedWeight,
      clampedWeight, Math.abs(error)
    );
  }
}

// ─── Internal: Multi-Armed Bandit ────────────────────────────────────

function _getOrCreateArm(siteId, agentId, domain, action) {
  stmts.upsertArm.run(crypto.randomUUID(), siteId, agentId, domain, action);
  const arm = stmts.getArm.get(siteId, agentId, domain, action);
  return arm || { pulls: 0, ucb_score: 0, avg_reward: 0, total_reward: 0 };
}

function _updateBanditArm(siteId, agentId, domain, action, reward) {
  const arm = stmts.getArm.get(siteId, agentId, domain, action);
  if (!arm) {
    stmts.upsertArm.run(crypto.randomUUID(), siteId, agentId, domain, action);
    return;
  }

  const newPulls = arm.pulls + 1;
  const newTotalReward = arm.total_reward + reward;
  const newAvgReward = newTotalReward / newPulls;

  // UCB1: avg_reward + C * sqrt(ln(N) / n_i)
  // We need total pulls across all arms in this domain
  const arms = stmts.getArms.all(siteId, agentId, domain);
  const totalPulls = arms.reduce((s, a) => s + a.pulls, 0) + 1; // +1 for this pull

  const exploration = UCB_EXPLORATION * Math.sqrt(Math.log(totalPulls) / newPulls);
  const ucbScore = newAvgReward + exploration;

  stmts.updateArm.run(reward, newAvgReward, ucbScore, siteId, agentId, domain, action);
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
      // Asymptotic approach to 1.0 — confidence grows slower as it increases
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

  if (context.price !== undefined) {
    features.price = context.price;
    // Bucketize price for discrete learning
    if (context.price < 10) features['price_bucket:cheap'] = 1;
    else if (context.price < 50) features['price_bucket:moderate'] = 1;
    else if (context.price < 200) features['price_bucket:premium'] = 1;
    else features['price_bucket:luxury'] = 1;
  }
  if (context.quantity !== undefined) features.quantity = context.quantity;
  if (context.discount !== undefined) {
    features.discount = context.discount;
    features.has_discount = context.discount > 0 ? 1 : 0;
  }
  if (context.rating !== undefined) {
    features.rating = context.rating;
    features.high_rated = context.rating >= 4.0 ? 1 : 0;
  }
  if (context.category) features[`category:${context.category}`] = 1;
  if (context.brand) features[`brand:${context.brand}`] = 1;
  if (context.timeOfDay !== undefined) {
    features.morning = context.timeOfDay < 12 ? 1 : 0;
    features.afternoon = context.timeOfDay >= 12 && context.timeOfDay < 18 ? 1 : 0;
    features.evening = context.timeOfDay >= 18 ? 1 : 0;
  }
  if (context.isRepeat !== undefined) features.repeat_visit = context.isRepeat ? 1 : 0;
  if (context.urgency !== undefined) features.urgency = context.urgency;
  if (context.inStock !== undefined) features.in_stock = context.inStock ? 1 : 0;

  // Pass through any raw numeric features
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

  // Volume component: log scale, saturates around 30 decisions
  const volumeConf = Math.min(1, withOutcome.length / 30);

  // Accuracy component: how close predictions were to actual rewards
  let accuracySum = 0;
  for (const d of withOutcome) {
    if (d.predicted_reward !== null) {
      const error = Math.abs(d.reward - d.predicted_reward);
      accuracySum += Math.max(0, 1 - error);
    }
  }
  const accuracyConf = withOutcome.length > 0 ? accuracySum / withOutcome.length : 0.5;

  // Recency component: exponential decay based on age of newest data
  const latestTs = new Date(withOutcome[0].created_at).getTime();
  const ageHours = (Date.now() - latestTs) / 3600000;
  const recencyConf = Math.exp(-DECAY_RATE * ageHours);

  return Math.max(MIN_CONFIDENCE, Math.min(0.99,
    volumeConf * 0.3 + accuracyConf * 0.5 + recencyConf * 0.2
  ));
}

module.exports = {
  recordDecision, feedback, batchFeedback, recommend, getPreferences,
  getRewardHistory, startSession, endSession,
  resetDomain, resetPatterns, getStats,
};
