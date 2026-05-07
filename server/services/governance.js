/**
 * WAB Agent Governance Service
 * ────────────────────────────
 * Permission Boundaries · Approval Gates · Tamper-Evident Audit Log
 * Kill Switch · Spend & Rate Limits.
 *
 * Tables (created by migrations/007_governance.sql):
 *   gov_agents, gov_policies, gov_audit, gov_approvals, gov_spend, gov_rate
 *
 * Audit log uses an HMAC hash chain:
 *   hash_n = HMAC(secret, prev_hash || row_payload_n)
 * Tampering with any row breaks subsequent hashes; verifyAuditChain()
 * re-runs the chain and reports the first divergence.
 */

'use strict';

const crypto = require('crypto');
const { db } = require('../models/db');

// ─────────────────────────────────────────── secrets ────
const AUDIT_SECRET = process.env.WAB_GOV_AUDIT_SECRET
  || process.env.WAB_HMAC_SECRET
  || 'wab-governance-audit-default-secret-change-me';

const TOKEN_PREFIX = 'wabag_';        // visible prefix for agent tokens
const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;  // 24h default

// ─────────────────────────────────────────── helpers ────
function newId(bytes = 16) { return crypto.randomBytes(bytes).toString('hex'); }
function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }
function hmac(payload, prevHash) {
  return crypto.createHmac('sha256', AUDIT_SECRET)
    .update(String(prevHash || '') + '|' + String(payload))
    .digest('hex');
}
function nowIso() { return new Date().toISOString(); }
function safeJson(v) {
  try { return v == null ? null : JSON.stringify(v); } catch { return null; }
}
function parseJson(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

// Redact obviously sensitive params before persisting to audit.
const REDACT_KEYS = /^(password|secret|token|api[_-]?key|authorization|cookie|cvv|pan|ssn)$/i;
function redact(obj, depth = 0) {
  if (depth > 4 || obj == null) return obj;
  if (Array.isArray(obj)) return obj.map((x) => redact(x, depth + 1));
  if (typeof obj === 'object') {
    const out = {};
    for (const k of Object.keys(obj)) {
      out[k] = REDACT_KEYS.test(k) ? '[redacted]' : redact(obj[k], depth + 1);
    }
    return out;
  }
  if (typeof obj === 'string' && obj.length > 2000) return obj.slice(0, 2000) + '…[truncated]';
  return obj;
}

// ──────────────────────────────────────── agent registry ────
function registerAgent({ agentId, ownerId = null, displayName = null, metadata = null } = {}) {
  const id = agentId || ('agent_' + newId(8));
  const token = TOKEN_PREFIX + newId(24);
  const tokenHash = sha256(token);
  db.prepare(`
    INSERT INTO gov_agents (agent_id, owner_id, display_name, token_hash, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, ownerId, displayName, tokenHash, safeJson(metadata));
  appendAudit({ agentId: id, eventType: 'note', reason: 'agent_registered',
    paramsJson: safeJson({ ownerId, displayName }) });
  return { agentId: id, agentToken: token };  // token shown ONCE
}

function getAgent(agentId) {
  return db.prepare('SELECT * FROM gov_agents WHERE agent_id = ?').get(agentId) || null;
}

/** Validate agent's bearer token. Returns agent row or null. */
function authAgent(agentId, agentToken) {
  if (!agentId || !agentToken) return null;
  const a = getAgent(agentId);
  if (!a) return null;
  if (sha256(agentToken) !== a.token_hash) return null;
  return a;
}

function isAlive(agentId) {
  const a = getAgent(agentId);
  return !!a && a.status === 'alive';
}

// ──────────────────────────────────────────── policies ────
function definePolicy(p) {
  const stmt = db.prepare(`
    INSERT INTO gov_policies
      (agent_id, resource, action, scope, max_amount, currency,
       daily_cap, per_call_rate, requires_approval, effect, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    p.agentId, p.resource, p.action,
    p.scope || null,
    p.maxAmount == null ? null : Number(p.maxAmount),
    p.currency || 'USD',
    p.dailyCap == null ? null : Number(p.dailyCap),
    p.perCallRate == null ? null : Number(p.perCallRate),
    p.requiresApproval ? 1 : 0,
    p.effect === 'deny' ? 'deny' : 'allow',
    p.expiresAt || null,
  );
  appendAudit({
    agentId: p.agentId, eventType: 'policy_change',
    resource: p.resource, action: p.action, scope: p.scope,
    paramsJson: safeJson({ id: info.lastInsertRowid, ...p }),
    reason: 'policy_added',
  });
  return { id: info.lastInsertRowid };
}

function listPolicies(agentId) {
  return db.prepare(
    'SELECT * FROM gov_policies WHERE agent_id = ? ORDER BY id'
  ).all(agentId);
}

function deletePolicy(agentId, id) {
  const info = db.prepare(
    'DELETE FROM gov_policies WHERE id = ? AND agent_id = ?'
  ).run(id, agentId);
  if (info.changes) {
    appendAudit({ agentId, eventType: 'policy_change',
      paramsJson: safeJson({ removed: id }), reason: 'policy_removed' });
  }
  return info.changes > 0;
}

/**
 * Match an action descriptor against the policy table.
 * Returns the matched policy row or null. Most-specific wins:
 *   exact-scope > scope-null,  exact-action > '*'.
 */
function matchPolicy(agentId, { resource, action, scope }) {
  const rows = db.prepare(`
    SELECT * FROM gov_policies
     WHERE agent_id = ?
       AND (expires_at IS NULL OR datetime(expires_at) > datetime('now'))
       AND resource = ?
       AND (action = ? OR action = '*')
       AND (scope IS NULL OR scope = ?)
  `).all(agentId, resource, action, scope || null);
  if (!rows.length) return null;
  rows.sort((a, b) => {
    const aSpec = (a.scope ? 2 : 0) + (a.action !== '*' ? 1 : 0);
    const bSpec = (b.scope ? 2 : 0) + (b.action !== '*' ? 1 : 0);
    return bSpec - aSpec;
  });
  return rows[0];
}

// ─────────────────────────────────────── spend & rates ────
function rollingSpend(agentId, resource, windowMs = 24 * 60 * 60 * 1000) {
  const since = new Date(Date.now() - windowMs).toISOString();
  const r = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
      FROM gov_spend WHERE agent_id = ? AND resource = ? AND ts >= ?
  `).get(agentId, resource, since);
  return r ? Number(r.total) : 0;
}

function recordSpend(agentId, resource, amount, currency = 'USD', ref = null) {
  if (!amount || amount <= 0) return;
  db.prepare(`
    INSERT INTO gov_spend (agent_id, resource, amount, currency, ref)
    VALUES (?, ?, ?, ?, ?)
  `).run(agentId, resource, Number(amount), currency, ref);
}

function bumpRate(agentId, resource) {
  // Use a sliding 60-second window with 1-second buckets (epoch seconds as
  // window_start). Legacy ISO-minute rows cast to a small integer (the year)
  // and therefore never fall inside `nowSec - 60`, so they are ignored.
  const nowSec = Math.floor(Date.now() / 1000);
  db.prepare(`
    INSERT INTO gov_rate (agent_id, resource, window_start, count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(agent_id, resource, window_start) DO UPDATE SET count = count + 1
  `).run(agentId, resource, String(nowSec));
  // Garbage-collect rows older than 5 minutes for this (agent, resource).
  db.prepare(`
    DELETE FROM gov_rate
     WHERE agent_id = ? AND resource = ?
       AND CAST(window_start AS INTEGER) <= ?
  `).run(agentId, resource, nowSec - 300);
  const row = db.prepare(`
    SELECT COALESCE(SUM(count), 0) AS c FROM gov_rate
     WHERE agent_id = ? AND resource = ?
       AND CAST(window_start AS INTEGER) > ?
  `).get(agentId, resource, nowSec - 60);
  return row?.c || 0;
}

// ───────────────────────────────────────── audit chain ────
function lastAuditHash(agentId) {
  const r = db.prepare(`
    SELECT hash FROM gov_audit WHERE agent_id = ? ORDER BY id DESC LIMIT 1
  `).get(agentId);
  return r ? r.hash : null;
}

function appendAudit(ev) {
  const ts = nowIso();
  const prev = lastAuditHash(ev.agentId);
  const payload = [
    ev.agentId, ts, ev.eventType, ev.resource || '', ev.action || '',
    ev.scope || '', ev.amount || '', ev.currency || '',
    ev.decision || '', ev.reason || '',
    ev.paramsJson || '', ev.resultJson || '',
  ].join('|');
  const hash = hmac(payload, prev);
  const info = db.prepare(`
    INSERT INTO gov_audit (
      agent_id, ts, event_type, resource, action, scope, amount, currency,
      decision, reason, params_json, result_json, prev_hash, hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    ev.agentId, ts, ev.eventType,
    ev.resource || null, ev.action || null, ev.scope || null,
    ev.amount == null ? null : Number(ev.amount),
    ev.currency || null,
    ev.decision || null, ev.reason || null,
    ev.paramsJson || null, ev.resultJson || null,
    prev, hash,
  );
  return { id: info.lastInsertRowid, ts, hash, prev_hash: prev };
}

function getAudit(agentId, { limit = 200, since = null, eventType = null } = {}) {
  const filters = ['agent_id = ?'];
  const params = [agentId];
  if (since)     { filters.push('ts >= ?'); params.push(since); }
  if (eventType) { filters.push('event_type = ?'); params.push(eventType); }
  return db.prepare(
    `SELECT * FROM gov_audit WHERE ${filters.join(' AND ')}
     ORDER BY id DESC LIMIT ?`
  ).all(...params, Math.min(1000, limit));
}

/** Recompute the chain and detect tampering. */
function verifyAuditChain(agentId) {
  const rows = db.prepare(
    'SELECT * FROM gov_audit WHERE agent_id = ? ORDER BY id ASC'
  ).all(agentId);
  let prev = null;
  for (const r of rows) {
    const payload = [
      r.agent_id, r.ts, r.event_type, r.resource || '', r.action || '',
      r.scope || '', r.amount || '', r.currency || '',
      r.decision || '', r.reason || '',
      r.params_json || '', r.result_json || '',
    ].join('|');
    const expect = hmac(payload, prev);
    if (r.prev_hash !== prev || r.hash !== expect) {
      return { ok: false, broken_at: r.id, expected_prev: prev, expected_hash: expect };
    }
    prev = r.hash;
  }
  return { ok: true, count: rows.length, head: prev };
}

// ──────────────────────────────────────── kill switch ────
function killAgent(agentId, reason = 'manual') {
  const info = db.prepare(`
    UPDATE gov_agents
       SET status = 'killed', killed_at = datetime('now'),
           killed_reason = ?, updated_at = datetime('now')
     WHERE agent_id = ?
  `).run(reason, agentId);
  if (info.changes) {
    appendAudit({ agentId, eventType: 'kill', reason, decision: 'deny' });
    // Cancel any pending approvals so an attacker can't resurrect via approval.
    db.prepare(`
      UPDATE gov_approvals SET status = 'cancelled', decided_at = datetime('now'),
             decided_note = 'agent_killed'
       WHERE agent_id = ? AND status = 'pending'
    `).run(agentId);
  }
  return info.changes > 0;
}

function reviveAgent(agentId, reason = 'manual_revive') {
  const info = db.prepare(`
    UPDATE gov_agents SET status = 'alive', killed_at = NULL, killed_reason = NULL,
           updated_at = datetime('now') WHERE agent_id = ?
  `).run(agentId);
  if (info.changes) appendAudit({ agentId, eventType: 'note', reason, decision: 'allow' });
  return info.changes > 0;
}

function getStatus(agentId) {
  const a = getAgent(agentId);
  if (!a) return null;
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN event_type='execute' AND decision='allow' THEN 1 ELSE 0 END) AS allow24h,
      SUM(CASE WHEN decision='deny' THEN 1 ELSE 0 END) AS deny24h,
      SUM(CASE WHEN event_type='approval_request' THEN 1 ELSE 0 END) AS approvals24h,
      COUNT(*) AS total24h
    FROM gov_audit WHERE agent_id = ? AND ts >= ?
  `).get(agentId, since24h);
  const pending = db.prepare(
    'SELECT COUNT(*) AS n FROM gov_approvals WHERE agent_id = ? AND status = ?'
  ).get(agentId, 'pending');
  return {
    agent_id: a.agent_id,
    status: a.status,
    killed_at: a.killed_at,
    killed_reason: a.killed_reason,
    display_name: a.display_name,
    metadata: parseJson(a.metadata),
    stats_24h: {
      allow: stats?.allow24h || 0,
      deny:  stats?.deny24h  || 0,
      approvals: stats?.approvals24h || 0,
      total: stats?.total24h || 0,
    },
    pending_approvals: pending?.n || 0,
  };
}

// ──────────────────────────────────────────── approvals ────
function requestApproval({ agentId, resource, action, scope, amount, currency, params, reason, ttlMs }) {
  const requestId = 'req_' + newId(12);
  const expires = new Date(Date.now() + (ttlMs || APPROVAL_TTL_MS)).toISOString();
  db.prepare(`
    INSERT INTO gov_approvals
      (request_id, agent_id, resource, action, scope, amount, currency,
       params_json, reason, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    requestId, agentId, resource, action, scope || null,
    amount == null ? null : Number(amount),
    currency || null,
    safeJson(redact(params || null)),
    reason || null,
    expires,
  );
  appendAudit({
    agentId, eventType: 'approval_request',
    resource, action, scope, amount, currency,
    decision: 'pending', reason,
    paramsJson: safeJson({ requestId, expires }),
  });
  return { requestId, status: 'pending', expiresAt: expires };
}

function expireOldApprovals() {
  db.prepare(`
    UPDATE gov_approvals SET status = 'expired'
     WHERE status = 'pending' AND expires_at < datetime('now')
  `).run();
}

function getApproval(requestId) {
  expireOldApprovals();
  return db.prepare('SELECT * FROM gov_approvals WHERE request_id = ?').get(requestId) || null;
}

function listPendingApprovals(agentId, limit = 100) {
  expireOldApprovals();
  return db.prepare(`
    SELECT * FROM gov_approvals
     WHERE agent_id = ? AND status = 'pending'
     ORDER BY created_at DESC LIMIT ?
  `).all(agentId, Math.min(500, limit));
}

function decideApproval(requestId, { decision, decidedBy, note }) {
  expireOldApprovals();
  const row = getApproval(requestId);
  if (!row) return { ok: false, error: 'not_found' };
  if (row.status !== 'pending') return { ok: false, error: 'not_pending', status: row.status };
  const next = decision === 'approved' ? 'approved' : 'rejected';
  db.prepare(`
    UPDATE gov_approvals
       SET status = ?, decided_by = ?, decided_at = datetime('now'), decided_note = ?
     WHERE request_id = ?
  `).run(next, decidedBy || null, note || null, requestId);
  appendAudit({
    agentId: row.agent_id, eventType: 'approval_decision',
    resource: row.resource, action: row.action, scope: row.scope,
    amount: row.amount, currency: row.currency,
    decision: next, reason: note || null,
    paramsJson: safeJson({ requestId, decidedBy }),
  });
  return { ok: true, status: next };
}

// ─────────────────────────────────── core authorisation ────
/**
 * The single decision point an agent calls before executing any action.
 * Returns: { decision: 'allow'|'deny'|'approval_required',
 *            reason, policy, requestId? }
 */
function check({ agentId, resource, action, scope, amount, currency }) {
  // 1) Agent must exist and be alive.
  const a = getAgent(agentId);
  if (!a)               return _decide('deny', 'unknown_agent');
  if (a.status !== 'alive') return _decide('deny', 'agent_' + a.status);

  // 2) Match a policy.
  const pol = matchPolicy(agentId, { resource, action, scope });
  if (!pol)                    return _decide('deny', 'no_policy', null);
  if (pol.effect === 'deny')   return _decide('deny', 'policy_deny', pol);

  // 3) Per-call rate limit.
  if (pol.per_call_rate) {
    const c = bumpRate(agentId, resource);
    if (c > pol.per_call_rate) return _decide('deny', 'rate_limit', pol);
  }

  // 4) Monetary caps.
  if (amount != null && amount > 0) {
    if (pol.max_amount != null && amount > pol.max_amount) {
      return _decide('deny', 'over_max_amount', pol);
    }
    if (pol.daily_cap != null) {
      const used = rollingSpend(agentId, resource);
      if (used + amount > pol.daily_cap) {
        return _decide('deny', 'over_daily_cap', pol, { used, cap: pol.daily_cap });
      }
    }
  }

  // 5) Human approval required?
  if (pol.requires_approval) {
    return { decision: 'approval_required', reason: 'approval_gate', policy: pol };
  }

  return _decide('allow', 'policy_match', pol);
}

function _decide(decision, reason, policy = null, extra = null) {
  return { decision, reason, policy, ...(extra ? { extra } : {}) };
}

// ─────────────────────────────────── public API surface ────
module.exports = {
  // agent lifecycle
  registerAgent, getAgent, authAgent, isAlive,
  killAgent, reviveAgent, getStatus,
  // policies
  definePolicy, listPolicies, deletePolicy, matchPolicy,
  // approvals
  requestApproval, getApproval, listPendingApprovals, decideApproval,
  // audit
  appendAudit, getAudit, verifyAuditChain,
  // spend / rate
  recordSpend, rollingSpend, bumpRate,
  // core
  check,
  // helpers (exposed for tests)
  _internals: { redact, hmac, sha256 },
};
