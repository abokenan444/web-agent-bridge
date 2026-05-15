'use strict';

/**
 * WAB ATP Client — Agent Transaction Primitive (v3.9.0)
 *
 * A tiny, zero-dependency client (uses global fetch from Node 18+) that
 * lets agents drive the four ATP lifecycle steps against a WAB server:
 *
 *   1. createIntent()    — declare what the user authorized
 *   2. authorizeIntent() — user confirms the contract
 *   3. beginTransaction() / step() / transition() — idempotent execution
 *   4. issueReceipt()    — fetch the signed receipt
 *   5. verifyReceipt()   — public verification (no auth)
 *
 * Example:
 *   const atp = new ATPClient({ baseUrl: 'https://webagentbridge.com', token: jwt });
 *   const intent = await atp.createIntent({
 *     purpose: 'Buy a book ≤ €30',
 *     scope: { actions: ['search','add_to_cart','checkout'] },
 *     spend_cap_cents: 3000, ttl_seconds: 600,
 *   });
 *   await atp.authorizeIntent(intent.id);
 *   const tx = await atp.beginTransaction({
 *     intent_id: intent.id, amount_cents: 1500,
 *     idempotency_key: `order-${Date.now()}`,
 *   });
 *   await atp.transition(tx.id, 'executing');
 *   await atp.step(tx.id, { action: 'checkout.confirm', evidence: { order_id: 'X1' } });
 *   await atp.transition(tx.id, 'executed');
 *   await atp.transition(tx.id, 'settled');
 *   const receipt = await atp.issueReceipt(tx.id);
 *   const ok = await atp.verifyReceipt(receipt.id);
 *   console.log('verified?', ok.verification.ok);
 */

class ATPError extends Error {
  constructor(message, { status, code, body } = {}) {
    super(message);
    this.name = 'ATPError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

class ATPClient {
  constructor({ baseUrl, token = null, fetchImpl = null } = {}) {
    if (!baseUrl) throw new Error('ATPClient: baseUrl required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
    this._fetch = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!this._fetch) throw new Error('ATPClient: no fetch available (Node 18+ or supply fetchImpl)');
  }

  async _req(method, path, { body, headers = {}, auth = true } = {}) {
    const h = { 'content-type': 'application/json', ...headers };
    if (auth && this.token) h.authorization = `Bearer ${this.token}`;
    const res = await this._fetch(this.baseUrl + path, {
      method,
      headers: h,
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok || (json && json.ok === false)) {
      throw new ATPError(json?.message || `HTTP ${res.status}`, {
        status: res.status, code: json?.error, body: json,
      });
    }
    return json && json.data !== undefined ? json.data : json;
  }

  // ── Intents ───────────────────────────────────────────────────────────────
  createIntent(body)            { return this._req('POST', '/api/atp/intents', { body }); }
  listIntents(params = {})      {
    const q = new URLSearchParams(params).toString();
    return this._req('GET', '/api/atp/intents' + (q ? '?' + q : ''));
  }
  getIntent(id)                 { return this._req('GET', `/api/atp/intents/${encodeURIComponent(id)}`); }
  authorizeIntent(id)           { return this._req('POST', `/api/atp/intents/${encodeURIComponent(id)}/authorize`); }
  revokeIntent(id, reason)      { return this._req('POST', `/api/atp/intents/${encodeURIComponent(id)}/revoke`, { body: { reason } }); }

  // ── Transactions ──────────────────────────────────────────────────────────
  beginTransaction(body) {
    const { idempotency_key, ...rest } = body;
    const headers = idempotency_key ? { 'idempotency-key': idempotency_key } : {};
    return this._req('POST', '/api/atp/transactions', { body: rest, headers });
  }
  getTransaction(id)            { return this._req('GET', `/api/atp/transactions/${encodeURIComponent(id)}`); }
  step(id, body)                { return this._req('POST', `/api/atp/transactions/${encodeURIComponent(id)}/steps`, { body }); }
  transition(id, to, extra = {}) { return this._req('POST', `/api/atp/transactions/${encodeURIComponent(id)}/transition`, { body: { to, ...extra } }); }
  compensate(id, reason)        { return this._req('POST', `/api/atp/transactions/${encodeURIComponent(id)}/compensate`, { body: { reason } }); }

  // ── Receipts ──────────────────────────────────────────────────────────────
  issueReceipt(txId)            { return this._req('POST', `/api/atp/transactions/${encodeURIComponent(txId)}/receipt`); }
  getReceipt(receiptId)         { return this._req('GET', `/api/atp/receipts/${encodeURIComponent(receiptId)}`, { auth: false }); }
  verifyReceipt(input) {
    const body = typeof input === 'string' ? { id: input } : { receipt: input };
    return this._req('POST', '/api/atp/receipts/verify', { body, auth: false });
  }
}

module.exports = { ATPClient, ATPError };
