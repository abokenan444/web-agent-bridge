/**
 * WAB Safety-Shield Client Helper (SPEC §8.10–§8.13)
 *
 * Wraps the 2-phase dry-run + human-gate protocol for HTTP API consumers
 * so agents don't have to reimplement plan_id / confirmation_id juggling.
 *
 * Usage:
 *   const { SafetyShieldClient } = require('@webagentbridge/sdk/safety-shield');
 *   const client = new SafetyShieldClient({
 *     baseUrl: 'https://webagentbridge.com',
 *     sessionToken: '<bearer-token>',
 *   });
 *
 *   // Single call — handles dry-run automatically, returns plan for review:
 *   const plan = await client.dryRun('deleteUser', { id: 42 });
 *   console.log(plan.simulation.summary);
 *
 *   // Confirm with the plan_id (and code if human-gate engaged):
 *   const result = await client.confirmAction(plan, { code: '123456' });
 */

'use strict';

const DEFAULT_HEADERS = { 'Content-Type': 'application/json' };

class SafetyShieldClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl — e.g. 'https://webagentbridge.com'
   * @param {string} opts.sessionToken — Bearer token from /sessions
   * @param {string} [opts.actionsPath='/api/wab/actions'] — endpoint root
   * @param {string} [opts.humanGatePath='/api/wab/human-gate'] — endpoint root
   * @param {function} [opts.fetchImpl=globalThis.fetch]
   */
  constructor(opts = {}) {
    if (!opts.baseUrl) throw new Error('SafetyShieldClient: baseUrl required');
    if (!opts.sessionToken) throw new Error('SafetyShieldClient: sessionToken required');
    this.baseUrl = String(opts.baseUrl).replace(/\/$/, '');
    this.sessionToken = opts.sessionToken;
    this.actionsPath = opts.actionsPath || '/api/wab/actions';
    this.humanGatePath = opts.humanGatePath || '/api/wab/human-gate';
    this.fetch = opts.fetchImpl || globalThis.fetch;
    if (typeof this.fetch !== 'function') {
      throw new Error('SafetyShieldClient: no fetch implementation available (Node 18+ or pass fetchImpl)');
    }
  }

  _headers() {
    return {
      ...DEFAULT_HEADERS,
      Authorization: `Bearer ${this.sessionToken}`,
    };
  }

  async _post(path, body) {
    const res = await this.fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body || {}),
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    return { status: res.status, ok: res.ok, body: json, raw: text };
  }

  async _get(path) {
    const res = await this.fetch(`${this.baseUrl}${path}`, { headers: this._headers() });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave null */ }
    return { status: res.status, ok: res.ok, body: json };
  }

  /**
   * Phase 1: Submit a dry-run for an action and return the plan envelope.
   * Throws if the server returns an error other than a successful plan.
   *
   * @param {string} actionName
   * @param {object} [params]
   * @returns {Promise<{plan_id:string, simulation:object, expires_at:string, raw:object}>}
   */
  async dryRun(actionName, params = {}) {
    const r = await this._post(`${this.actionsPath}/${encodeURIComponent(actionName)}`, {
      params,
      dry_run: true,
    });
    if (!r.ok) {
      throw shieldError('dry_run_failed', r);
    }
    const result = (r.body && (r.body.result || r.body)) || {};
    if (!result.plan_id) {
      throw shieldError('dry_run_no_plan', r);
    }
    return {
      action: actionName,
      params,
      plan_id: result.plan_id,
      simulation: result.simulation || null,
      expires_at: result.expires_at || null,
      raw: r.body,
    };
  }

  /**
   * Phase 2: Execute the action, automatically handling the human-gate
   * loop if the server returns HUMAN_GATE_REQUIRED.
   *
   * If a 6-digit `code` is supplied AND a challenge is issued, the helper
   * will call /human-gate/approve and then retry execution. If no code is
   * supplied and a challenge is issued, the helper returns a `pending`
   * envelope so the caller can prompt the human, then resume by calling
   * `confirmAction(plan, { code })` again.
   *
   * @param {{action:string, params?:object, plan_id:string}} plan — from dryRun()
   * @param {object} [opts]
   * @param {string} [opts.code] — 6-digit human-gate code
   * @param {string} [opts.confirmation_id] — pre-existing approval id
   * @returns {Promise<object>}
   */
  async confirmAction(plan, opts = {}) {
    if (!plan || !plan.action || !plan.plan_id) {
      throw new Error('confirmAction: plan must include {action, plan_id}');
    }
    const body = {
      params: plan.params || {},
      dry_run: false,
      plan_id: plan.plan_id,
    };
    if (opts.confirmation_id) body.confirmation_id = opts.confirmation_id;

    const r = await this._post(
      `${this.actionsPath}/${encodeURIComponent(plan.action)}`,
      body
    );

    const code = r.body && r.body.error && r.body.error.code;

    // Happy path — HTTP 2xx with no error envelope.
    if (r.ok && !code) return r.body;

    // Human-gate flow
    if (code === 'HUMAN_GATE_REQUIRED' && r.status === 202) {
      const err = r.body.error || {};
      const challengeId = err.challenge_id || err.details?.challenge_id;
      if (!challengeId) throw shieldError('human_gate_malformed', r);

      // No code provided — bubble up so caller can prompt human.
      if (!opts.code) {
        return {
          status: 'pending_human_gate',
          challenge_id: challengeId,
          expires_at: err.expires_at || err.details?.expires_at || null,
          dispatched_to: err.dispatched_to || err.details?.dispatched_to || null,
          plan,
        };
      }

      // Code supplied — approve and retry.
      const approve = await this._post(`${this.humanGatePath}/approve`, {
        challenge_id: challengeId,
        code: String(opts.code),
      });
      if (!approve.ok) {
        throw shieldError('human_gate_approve_failed', approve);
      }
      const confirmationId =
        approve.body?.result?.confirmation_id ||
        approve.body?.confirmation_id;
      if (!confirmationId) throw shieldError('human_gate_no_confirmation', approve);
      return this.confirmAction(plan, { confirmation_id: confirmationId });
    }

    if (code === 'HUMAN_GATE_PENDING') {
      // Retry by polling status.
      return {
        status: 'pending_human_gate',
        challenge_id: opts.confirmation_id,
        plan,
        message: r.body.error.message,
      };
    }

    throw shieldError(code || 'execute_failed', r);
  }

  /**
   * Convenience: dry-run + confirm in one call.
   * If a human-gate is required and no code is passed, returns the pending
   * envelope. Caller resumes by calling confirmAction(envelope.plan, {code}).
   */
  async safeExecute(actionName, params, opts = {}) {
    const plan = await this.dryRun(actionName, params);
    return this.confirmAction(plan, opts);
  }

  /**
   * Poll a human-gate challenge status (rarely needed — confirmAction
   * handles the round-trip). Returns the raw status envelope.
   */
  async humanGateStatus(challengeId) {
    const r = await this._get(
      `${this.humanGatePath}/${encodeURIComponent(challengeId)}/status`
    );
    return r.body;
  }
}

function shieldError(code, response) {
  const msg = response?.body?.error?.message ||
    `WAB safety-shield error: ${code} (HTTP ${response?.status})`;
  const err = new Error(msg);
  err.code = code;
  err.status = response?.status;
  err.response = response?.body;
  return err;
}

module.exports = { SafetyShieldClient };
