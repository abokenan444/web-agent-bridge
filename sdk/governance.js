/**
 * WAB Agent Governance — Client SDK
 * ─────────────────────────────────
 * The Layer-3 piece that sits ABOVE the WAB Protocol.
 *
 *   ┌─────────────────────────────────┐
 *   │   WABGovernance  (this module)   │  ← permissions / approval / audit
 *   ├─────────────────────────────────┤
 *   │   WAB Protocol  (AICommands)     │
 *   ├─────────────────────────────────┤
 *   │   Dynamic Shield (price / OCR)   │
 *   └─────────────────────────────────┘
 *
 * Five governance primitives every agent should call:
 *
 *   1) Permission Boundary   await gov.check({resource,action,scope,amount})
 *   2) Human Approval Gate   await gov.requestApproval({...}) + waitForDecision()
 *   3) Audit Log             await gov.audit({eventType,...})
 *   4) Kill Switch           await gov.isAlive()  /  await gov.kill('reason')
 *   5) Spend / Rate Limits   enforced server-side via policies
 *
 * Convenience: gov.guard(actionDesc, fn) wraps an action with all 5 at once.
 *
 * Usage:
 *   const { WABGovernance } = require('web-agent-bridge/sdk');
 *   const gov = new WABGovernance({
 *     apiBase: 'https://webagentbridge.com',
 *     agentId: process.env.AGENT_ID,
 *     agentToken: process.env.AGENT_TOKEN,
 *   });
 *
 *   await gov.guard(
 *     { resource: 'stripe', action: 'write', scope: 'refunds', amount: 49.99, currency: 'USD' },
 *     async () => stripe.refunds.create({ ... }),
 *   );
 */

'use strict';

const DEFAULT_API = 'https://webagentbridge.com';

class WABGovernanceError extends Error {
  constructor(message, decision) {
    super(message);
    this.name = 'WABGovernanceError';
    this.decision = decision || null;
  }
}

class WABGovernance {
  /**
   * @param {object} opts
   * @param {string} opts.apiBase
   * @param {string} opts.agentId
   * @param {string} opts.agentToken
   * @param {function} [opts.onApprovalRequired]  — async (request) => 'approved'|'rejected'
   *        If provided, guard() will block until human decides; otherwise it
   *        polls the approval endpoint up to opts.approvalTimeoutMs.
   * @param {number} [opts.approvalTimeoutMs=300000]   — 5 min default
   * @param {number} [opts.approvalPollMs=2000]
   * @param {number} [opts.timeoutMs=10000]
   * @param {function} [opts.fetch]
   */
  constructor(opts = {}) {
    this.apiBase    = (opts.apiBase || DEFAULT_API).replace(/\/+$/, '');
    this.agentId    = opts.agentId;
    this.agentToken = opts.agentToken;
    this.onApprovalRequired = typeof opts.onApprovalRequired === 'function' ? opts.onApprovalRequired : null;
    this.approvalTimeoutMs  = Number.isFinite(opts.approvalTimeoutMs) ? opts.approvalTimeoutMs : 300_000;
    this.approvalPollMs     = Number.isFinite(opts.approvalPollMs)    ? opts.approvalPollMs    : 2_000;
    this.timeoutMs          = Number.isFinite(opts.timeoutMs)         ? opts.timeoutMs         : 10_000;
    this._fetch = opts.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!this._fetch) {
      try { this._fetch = require('node-fetch'); } catch { /* user must supply */ }
    }
    if (!this.agentId)    throw new Error('WABGovernance: agentId required');
    if (!this.agentToken) throw new Error('WABGovernance: agentToken required');
  }

  // ────────────────────────────────────── HTTP plumbing ────
  async _req(method, path, body) {
    if (!this._fetch) throw new Error('WABGovernance: fetch not available');
    const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), this.timeoutMs) : null;
    try {
      const r = await this._fetch(this.apiBase + path, {
        method,
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + this.agentToken,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctl ? ctl.signal : undefined,
      });
      const text = await r.text();
      const data = text ? safeParse(text) : null;
      if (!r.ok) {
        const e = new Error(`gov_http_${r.status}: ${data?.error || r.statusText}`);
        e.status = r.status; e.body = data;
        throw e;
      }
      return data;
    } finally { if (timer) clearTimeout(timer); }
  }

  // ────────────────────────────────────────── lifecycle ────
  /** Static helper to register a brand-new agent and capture its token. */
  static async register({ apiBase = DEFAULT_API, displayName, ownerId, metadata, fetch: f } = {}) {
    const fn = f || (typeof fetch !== 'undefined' ? fetch : require('node-fetch'));
    const r = await fn(apiBase.replace(/\/+$/, '') + '/api/governance/agents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ display_name: displayName, owner_id: ownerId, metadata }),
    });
    if (!r.ok) throw new Error('register_failed_' + r.status);
    return r.json();   // { agent_id, agent_token, message }
  }

  status()        { return this._req('GET',  `/api/governance/agents/${this.agentId}/status`); }
  async isAlive() {
    const s = await this.status().catch(() => null);
    return !!s && s.status === 'alive';
  }
  kill(reason)    { return this._req('POST', `/api/governance/agents/${this.agentId}/kill`,   { reason }); }
  revive(reason)  { return this._req('POST', `/api/governance/agents/${this.agentId}/revive`, { reason }); }

  // ─────────────────────────────────────── policies ────
  policies()             { return this._req('GET',  `/api/governance/agents/${this.agentId}/policies`); }
  definePolicy(p)        { return this._req('POST', `/api/governance/agents/${this.agentId}/policies`, p); }
  removePolicy(id)       { return this._req('DELETE', `/api/governance/agents/${this.agentId}/policies/${id}`); }

  // ────────────────────────────────────── decision ────
  /** Pre-action permission check. */
  check({ resource, action, scope, amount, currency }) {
    return this._req('POST', `/api/governance/agents/${this.agentId}/check`,
      { resource, action, scope, amount, currency });
  }

  /** Report executed action — feeds audit + spend tracker. */
  reportExecute(payload) {
    return this._req('POST', `/api/governance/agents/${this.agentId}/execute`, payload);
  }

  // ────────────────────────────────────── audit ────
  audit({ eventType = 'note', resource, action, scope, decision, reason, params, result } = {}) {
    // Convenience wrapper around reportExecute() for non-execute events.
    return this._req('POST', `/api/governance/agents/${this.agentId}/execute`, {
      resource: resource || 'note', action: action || eventType, scope,
      decision: decision || 'allow', reason, params, result,
    });
  }
  getAudit(opts = {}) {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.since) q.set('since', opts.since);
    if (opts.event) q.set('event', opts.event);
    const qs = q.toString();
    return this._req('GET', `/api/governance/agents/${this.agentId}/audit${qs ? '?' + qs : ''}`);
  }
  verifyAudit() {
    return this._req('GET', `/api/governance/agents/${this.agentId}/audit/verify`);
  }

  // ─────────────────────────────────── approvals ────
  requestApproval(payload) {
    return this._req('POST', `/api/governance/agents/${this.agentId}/approvals`, payload);
  }
  pendingApprovals() {
    return this._req('GET', `/api/governance/agents/${this.agentId}/approvals/pending`);
  }
  getApproval(requestId) {
    return this._req('GET', `/api/governance/approvals/${requestId}`);
  }
  decideApproval(requestId, decision, note) {
    return this._req('POST', `/api/governance/approvals/${requestId}/decide`,
      { decision, note });
  }

  /** Block until an approval is decided or times out. */
  async waitForDecision(requestId, { timeoutMs, pollMs } = {}) {
    const tEnd = Date.now() + (timeoutMs || this.approvalTimeoutMs);
    const step = pollMs || this.approvalPollMs;
    while (Date.now() < tEnd) {
      const r = await this.getApproval(requestId).catch(() => null);
      if (r && r.status !== 'pending') return r;
      await sleep(step);
    }
    return { request_id: requestId, status: 'timeout' };
  }

  // ────────────────────────────────────── guard (the big one) ────
  /**
   * Wrap an action. Runs the full governance pipeline:
   *   1) check permission
   *   2) if approval_required → request + wait for human
   *   3) execute the function
   *   4) record execute (audit + spend)
   *   5) on throw → audit deny + rethrow
   */
  async guard(actionDesc, fn) {
    const { resource, action, scope, amount, currency } = actionDesc || {};
    if (!resource || !action) throw new WABGovernanceError('guard: resource and action required');

    // 1) Pre-check
    const v = await this.check({ resource, action, scope, amount, currency });

    // 2) Approval gate
    if (v.decision === 'approval_required') {
      const req = await this.requestApproval({
        resource, action, scope, amount, currency,
        params: actionDesc.params || null,
        reason: actionDesc.reason || 'policy_required_approval',
        ttl_ms: actionDesc.ttlMs || null,
      });
      let outcome;
      if (this.onApprovalRequired) {
        outcome = await this.onApprovalRequired({ request_id: req.requestId, ...actionDesc });
        if (outcome === 'approved' || outcome === 'rejected') {
          await this.decideApproval(req.requestId, outcome, 'callback_decision');
        }
      }
      const decided = await this.waitForDecision(req.requestId);
      if (decided.status !== 'approved') {
        throw new WABGovernanceError(
          `Approval ${decided.status} for ${resource}/${action}`,
          { ...v, approval: decided },
        );
      }
    } else if (v.decision !== 'allow') {
      throw new WABGovernanceError(
        `Governance denied ${resource}/${action}: ${v.reason}`, v,
      );
    }

    // 3) Execute
    let result, error;
    const t0 = Date.now();
    try { result = await fn(v); }
    catch (e) { error = e; }
    const elapsed = Date.now() - t0;

    // 4) Audit (always, even on error)
    try {
      await this.reportExecute({
        resource, action, scope, amount, currency,
        decision: error ? 'deny' : 'allow',
        reason:   error ? ('exec_error: ' + (error.message || 'unknown')) : 'guard_executed',
        params:   actionDesc.params || null,
        result:   error ? null : (typeof result === 'object' ? result : { value: result }),
      });
    } catch { /* audit best-effort; don't mask the original outcome */ }

    if (error) throw error;
    return { result, elapsed_ms: elapsed };
  }
}

// ─────────────────────────────────────────── helpers ────
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

module.exports = { WABGovernance, WABGovernanceError };
