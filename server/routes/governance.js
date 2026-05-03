/**
 * WAB Agent Governance Routes
 * Mounted at /api/governance
 *
 * Auth model:
 *   - Agent endpoints: Bearer <agent_token> in Authorization header
 *     OR ?agent_id=...&agent_token=... query params (for SDKs without headers)
 *   - Owner/human endpoints (kill, decide approval): same agent token works
 *     for the owner of that agent. (Future: owner-level user auth.)
 */

'use strict';

const express = require('express');
const gov = require('../services/governance');

const router = express.Router();

// ───────────────────────── auth middleware ────
function requireAgent(req, res, next) {
  const auth = req.headers.authorization || '';
  const headerToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const agentId = req.params.agentId || req.body?.agent_id || req.query?.agent_id;
  const token   = headerToken || req.body?.agent_token || req.query?.agent_token;
  const a = gov.authAgent(agentId, token);
  if (!a) return res.status(401).json({ error: 'invalid_agent_credentials' });
  req.agent = a;
  next();
}

// ───────────────────────── lifecycle ────
// Register a new agent. Returns the one-time token. Public — anyone can create
// an agent identity for themselves; rate-limited by the parent app.
router.post('/agents', (req, res) => {
  try {
    const { agent_id, owner_id, display_name, metadata } = req.body || {};
    const out = gov.registerAgent({
      agentId: agent_id, ownerId: owner_id,
      displayName: display_name, metadata,
    });
    res.status(201).json({
      agent_id: out.agentId,
      agent_token: out.agentToken,   // shown ONCE — caller must store it
      message: 'Save the agent_token now; it cannot be retrieved later.',
    });
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'agent_id_exists' });
    }
    res.status(500).json({ error: 'register_failed', detail: e.message });
  }
});

router.get('/agents/:agentId/status', requireAgent, (req, res) => {
  const s = gov.getStatus(req.agent.agent_id);
  res.json(s);
});

// Kill switch — agent self-kill or external trigger with valid token.
router.post('/agents/:agentId/kill', requireAgent, (req, res) => {
  const reason = req.body?.reason || 'manual';
  const ok = gov.killAgent(req.agent.agent_id, reason);
  res.json({ ok, status: 'killed', reason });
});

router.post('/agents/:agentId/revive', requireAgent, (req, res) => {
  const reason = req.body?.reason || 'manual_revive';
  const ok = gov.reviveAgent(req.agent.agent_id, reason);
  res.json({ ok, status: 'alive', reason });
});

// ───────────────────────── policies ────
router.get('/agents/:agentId/policies', requireAgent, (req, res) => {
  res.json({ policies: gov.listPolicies(req.agent.agent_id) });
});

router.post('/agents/:agentId/policies', requireAgent, (req, res) => {
  const b = req.body || {};
  if (!b.resource || !b.action) {
    return res.status(400).json({ error: 'missing_fields', need: ['resource', 'action'] });
  }
  const r = gov.definePolicy({
    agentId:        req.agent.agent_id,
    resource:       String(b.resource),
    action:         String(b.action),
    scope:          b.scope || null,
    maxAmount:      b.max_amount,
    currency:       b.currency,
    dailyCap:       b.daily_cap,
    perCallRate:    b.per_call_rate,
    requiresApproval: !!b.requires_approval,
    effect:         b.effect === 'deny' ? 'deny' : 'allow',
    expiresAt:      b.expires_at || null,
  });
  res.status(201).json({ ok: true, id: r.id });
});

router.delete('/agents/:agentId/policies/:id', requireAgent, (req, res) => {
  const ok = gov.deletePolicy(req.agent.agent_id, Number(req.params.id));
  res.json({ ok });
});

// ───────────────────────── core check ────
// Pre-action authorisation. Agent calls this BEFORE executing.
router.post('/agents/:agentId/check', requireAgent, (req, res) => {
  const { resource, action, scope, amount, currency } = req.body || {};
  if (!resource || !action) {
    return res.status(400).json({ error: 'missing_fields', need: ['resource', 'action'] });
  }
  const r = gov.check({
    agentId: req.agent.agent_id, resource, action, scope, amount, currency,
  });
  // Audit the check itself (no params persisted by default).
  gov.appendAudit({
    agentId: req.agent.agent_id, eventType: 'check',
    resource, action, scope, amount, currency,
    decision: r.decision, reason: r.reason,
  });
  res.json({
    decision: r.decision,
    reason:   r.reason,
    policy_id: r.policy?.id || null,
    extra: r.extra || null,
  });
});

// Agent reports an executed action (for audit + spend tracking).
router.post('/agents/:agentId/execute', requireAgent, (req, res) => {
  const b = req.body || {};
  if (!b.resource || !b.action) {
    return res.status(400).json({ error: 'missing_fields', need: ['resource', 'action'] });
  }
  const audit = gov.appendAudit({
    agentId: req.agent.agent_id, eventType: 'execute',
    resource: b.resource, action: b.action, scope: b.scope,
    amount: b.amount, currency: b.currency,
    decision: b.decision || 'allow', reason: b.reason || null,
    paramsJson: b.params ? JSON.stringify(gov._internals.redact(b.params)) : null,
    resultJson: b.result ? JSON.stringify(gov._internals.redact(b.result)) : null,
  });
  if (b.amount && Number(b.amount) > 0) {
    gov.recordSpend(req.agent.agent_id, b.resource, Number(b.amount),
      b.currency || 'USD', String(audit.id));
  }
  res.json({ ok: true, audit_id: audit.id, hash: audit.hash });
});

// ───────────────────────── approvals ────
router.post('/agents/:agentId/approvals', requireAgent, (req, res) => {
  const b = req.body || {};
  if (!b.resource || !b.action) {
    return res.status(400).json({ error: 'missing_fields', need: ['resource', 'action'] });
  }
  const r = gov.requestApproval({
    agentId: req.agent.agent_id,
    resource: b.resource, action: b.action, scope: b.scope,
    amount: b.amount, currency: b.currency,
    params: b.params, reason: b.reason, ttlMs: b.ttl_ms,
  });
  res.status(201).json(r);
});

router.get('/agents/:agentId/approvals/pending', requireAgent, (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 100);
  res.json({ pending: gov.listPendingApprovals(req.agent.agent_id, limit) });
});

router.get('/approvals/:requestId', (req, res) => {
  const r = gov.getApproval(req.params.requestId);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(r);
});

// Human decision endpoint. Requires the agent's token (treated as owner-grade).
// Future hardening: separate owner-level user auth.
router.post('/approvals/:requestId/decide', (req, res) => {
  const r = gov.getApproval(req.params.requestId);
  if (!r) return res.status(404).json({ error: 'not_found' });
  // Authenticate as the owner-of-the-agent.
  const auth = req.headers.authorization || '';
  const headerToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  const token = headerToken || req.body?.agent_token || req.query?.agent_token;
  const a = gov.authAgent(r.agent_id, token);
  if (!a) return res.status(401).json({ error: 'invalid_credentials' });
  const decision = req.body?.decision === 'approved' ? 'approved' : 'rejected';
  const out = gov.decideApproval(req.params.requestId, {
    decision, decidedBy: req.body?.decided_by || a.owner_id || null,
    note: req.body?.note || null,
  });
  if (!out.ok) return res.status(409).json(out);
  res.json(out);
});

// ───────────────────────── audit ────
router.get('/agents/:agentId/audit', requireAgent, (req, res) => {
  const limit = Math.min(1000, Number(req.query.limit) || 200);
  const since = req.query.since || null;
  const eventType = req.query.event || null;
  res.json({
    audit: gov.getAudit(req.agent.agent_id, { limit, since, eventType }),
  });
});

router.get('/agents/:agentId/audit/verify', requireAgent, (req, res) => {
  res.json(gov.verifyAuditChain(req.agent.agent_id));
});

module.exports = router;
