'use strict';

/**
 * Reward Guard — defenses against reward-hacking in the local RL engine.
 *
 * Threats addressed:
 *   1. Out-of-bounds rewards (writers stuffing huge positive numbers).
 *   2. Sudden gradient explosions (sequence of large positive rewards on
 *      previously-low-confidence actions, indicative of a feedback loop).
 *   3. Per-actor abuse (one user/agent flooding rewards to skew a policy).
 *   4. Rewards on sensitive actions without HITL approval.
 *
 * Defenses:
 *   - Clamp reward to [REWARD_MIN, REWARD_MAX].
 *   - Per-(site,agent,domain) sliding window with EMA + variance check.
 *   - Per-actor rate limit (default 60 reward writes / 5 min).
 *   - Block rewards on actions in the SENSITIVE_VERBS set unless an
 *     `approvedBy` field is present and references a human user id.
 *   - Append-only `reward_audit` table for human review.
 */

const crypto = require('crypto');
const { db } = require('../models/db');
const { SENSITIVE_VERBS } = require('../middleware/sensitiveAction');

const REWARD_MIN = -1.0;
const REWARD_MAX = 1.0;
const ANOMALY_Z_SCORE = 4.0;          // |reward - mean| / std > 4 → anomaly
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_MAX = 60;

db.exec(`
  CREATE TABLE IF NOT EXISTS reward_audit (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    agent_id TEXT,
    domain TEXT,
    action TEXT,
    raw_reward REAL,
    final_reward REAL,
    decision TEXT NOT NULL CHECK(decision IN ('accepted','clamped','blocked','flagged')),
    reason TEXT,
    actor_id TEXT,
    approved_by TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reward_audit_site ON reward_audit(site_id, agent_id);
  CREATE INDEX IF NOT EXISTS idx_reward_audit_decision ON reward_audit(decision);
`);

const _rateBuckets = new Map(); // actorKey → [{ts}, ...]
const _emaState = new Map();    // bucketKey → { mean, var, n }

function _bucketKey(siteId, agentId, domain) {
  return `${siteId || ''}::${agentId || ''}::${domain || ''}`;
}

function _checkRate(actorKey) {
  const now = Date.now();
  const bucket = _rateBuckets.get(actorKey) || [];
  const fresh = bucket.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  fresh.push(now);
  _rateBuckets.set(actorKey, fresh);
  return fresh.length <= RATE_LIMIT_MAX;
}

function _updateEma(bucketKey, x) {
  // Welford-style streaming mean/variance.
  const s = _emaState.get(bucketKey) || { mean: 0, m2: 0, n: 0 };
  s.n += 1;
  const delta = x - s.mean;
  s.mean += delta / s.n;
  s.m2 += delta * (x - s.mean);
  _emaState.set(bucketKey, s);
  const variance = s.n > 1 ? s.m2 / (s.n - 1) : 1;
  return { mean: s.mean, std: Math.sqrt(Math.max(variance, 1e-6)), n: s.n };
}

function _audit(row) {
  db.prepare(`INSERT INTO reward_audit
    (id, site_id, agent_id, domain, action, raw_reward, final_reward, decision, reason, actor_id, approved_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    crypto.randomUUID(), row.siteId || null, row.agentId || null, row.domain || null,
    row.action || null, row.rawReward, row.finalReward, row.decision, row.reason || null,
    row.actorId || null, row.approvedBy || null
  );
}

function _isSensitive(action) {
  if (!action) return false;
  const tokens = String(action).toLowerCase().split(/[\s.\-_/:]+/);
  return tokens.some((t) => SENSITIVE_VERBS.has(t));
}

/**
 * Sanitize a reward emitted by an agent. Returns a `{ reward, decision }`
 * tuple. Always logs to reward_audit.
 *
 * @param {object} input
 * @param {string} input.siteId
 * @param {string} input.agentId
 * @param {string} input.domain
 * @param {string} input.action
 * @param {number} input.reward
 * @param {string} [input.actorId]
 * @param {string} [input.approvedBy]   - human user id approving the reward
 */
function sanitizeReward(input) {
  const { siteId, agentId, domain, action, reward, actorId, approvedBy } = input;
  const raw = Number(reward);

  if (!Number.isFinite(raw)) {
    _audit({ ...input, rawReward: reward, finalReward: 0, decision: 'blocked', reason: 'non-finite reward' });
    return { reward: 0, decision: 'blocked', reason: 'non-finite reward' };
  }

  const actorKey = actorId || agentId || 'anon';
  if (!_checkRate(actorKey)) {
    _audit({ ...input, rawReward: raw, finalReward: 0, decision: 'blocked', reason: 'rate limit exceeded' });
    return { reward: 0, decision: 'blocked', reason: 'reward rate limit exceeded' };
  }

  if (_isSensitive(action) && !approvedBy) {
    _audit({ ...input, rawReward: raw, finalReward: 0, decision: 'blocked', reason: 'sensitive action without HITL approval' });
    return { reward: 0, decision: 'blocked', reason: 'sensitive action requires approvedBy' };
  }

  // Clamp.
  let clamped = Math.max(REWARD_MIN, Math.min(REWARD_MAX, raw));
  let decision = clamped === raw ? 'accepted' : 'clamped';
  let reason = decision === 'clamped' ? `clamped from ${raw}` : null;

  // Anomaly detection vs rolling distribution.
  const stats = _updateEma(_bucketKey(siteId, agentId, domain), clamped);
  if (stats.n >= 10) {
    const z = Math.abs(clamped - stats.mean) / stats.std;
    if (z > ANOMALY_Z_SCORE) {
      decision = 'flagged';
      reason = `anomaly z=${z.toFixed(2)} (mean=${stats.mean.toFixed(3)}, std=${stats.std.toFixed(3)})`;
      // Pull large positive flagged values toward the mean to limit damage.
      if (clamped > stats.mean) clamped = stats.mean + stats.std * 2;
    }
  }

  _audit({ ...input, rawReward: raw, finalReward: clamped, decision, reason });
  return { reward: clamped, decision, reason };
}

function getRecentAudits(limit = 100, decision) {
  if (decision) {
    return db.prepare(`SELECT * FROM reward_audit WHERE decision = ? ORDER BY rowid DESC LIMIT ?`).all(decision, limit);
  }
  return db.prepare(`SELECT * FROM reward_audit ORDER BY rowid DESC LIMIT ?`).all(limit);
}

function getStats() {
  const counts = db.prepare(`SELECT decision, COUNT(*) as n FROM reward_audit GROUP BY decision`).all();
  return {
    bounds: { min: REWARD_MIN, max: REWARD_MAX, anomalyZ: ANOMALY_Z_SCORE },
    rateLimit: { windowMs: RATE_LIMIT_WINDOW_MS, max: RATE_LIMIT_MAX },
    counts: counts.reduce((acc, r) => ({ ...acc, [r.decision]: r.n }), {}),
  };
}

module.exports = {
  sanitizeReward,
  getRecentAudits,
  getStats,
  REWARD_MIN,
  REWARD_MAX,
};
