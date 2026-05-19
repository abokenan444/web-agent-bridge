/**
 * Webhook Subscriptions Service (v3.16.0 — Phase 4)
 * ───────────────────────────────────────────────────────────────────────────
 * Lets users subscribe HTTPS endpoints to revocation events for instant push
 * delivery instead of polling /api/trusted-domains.json.
 *
 * Events:
 *   revocation.opened           — a new suspension/revocation is issued
 *   revocation.reinstated       — a revocation is lifted
 *   revocation.appeal_decided   — an admin ruled on an appeal
 *
 * Each delivery is signed with HMAC-SHA256:
 *   X-WAB-Webhook-Signature: t=<unix_ts>,v1=<hex>
 *   where hex = HMAC_SHA256(secret, `${t}.${body}`)
 *
 * Retry policy: 3 attempts at t+0, t+30s, t+5m.
 */

'use strict';

const crypto = require('crypto');
const { db } = require('../models/db');

const VALID_EVENTS = new Set([
  'revocation.opened',
  'revocation.reinstated',
  'revocation.appeal_decided',
]);

const RETRY_DELAYS_MS = [0, 30_000, 300_000];
const REQUEST_TIMEOUT_MS = Number(process.env.WAB_WEBHOOK_TIMEOUT_MS || 8000);
const MAX_SUBS_PER_USER = Number(process.env.WAB_WEBHOOK_MAX_PER_USER || 10);

function _ulid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

function _normalizeUrl(url) {
  if (!url || typeof url !== 'string') throw _err('url required', 'bad_request', 400);
  let u;
  try { u = new URL(url); } catch (_) { throw _err('invalid url', 'bad_request', 400); }
  if (u.protocol !== 'https:' && !(process.env.NODE_ENV === 'test' && u.protocol === 'http:')) {
    throw _err('url must be https', 'bad_request', 400);
  }
  return u.toString();
}

function _err(msg, code, status) {
  const e = new Error(msg); e.code = code; e.statusCode = status; return e;
}

function _normalizeEvents(events) {
  if (!events) return Array.from(VALID_EVENTS);
  const list = Array.isArray(events) ? events : String(events).split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length) return Array.from(VALID_EVENTS);
  for (const e of list) {
    if (!VALID_EVENTS.has(e)) throw _err(`unknown event: ${e}`, 'bad_event', 400);
  }
  return list;
}

function _publicView(row) {
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    events: (row.events || '').split(',').filter(Boolean),
    active: !!row.active,
    description: row.description || null,
    last_success_at: row.last_success_at,
    last_error_at: row.last_error_at,
    last_error: row.last_error,
    consecutive_failures: row.consecutive_failures || 0,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function createSubscription({ userId, url, events, description }) {
  if (!userId) throw _err('userId required', 'bad_request', 400);
  const normalized = _normalizeUrl(url);
  const eventList = _normalizeEvents(events);
  const existing = db.prepare(
    `SELECT COUNT(*) AS n FROM webhook_subscriptions WHERE user_id = ? AND active = 1`,
  ).get(userId).n;
  if (existing >= MAX_SUBS_PER_USER) {
    throw _err(`max ${MAX_SUBS_PER_USER} active subscriptions per user`, 'limit_exceeded', 429);
  }
  const id = _ulid('whsub');
  const secret = crypto.randomBytes(32).toString('base64');
  db.prepare(`
    INSERT INTO webhook_subscriptions (id, user_id, url, secret, events, description)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, String(userId), normalized, secret, eventList.join(','), description || null);
  const row = db.prepare(`SELECT * FROM webhook_subscriptions WHERE id = ?`).get(id);
  // Return secret only on create — never on list/get.
  return { ..._publicView(row), secret };
}

function listSubscriptions(userId) {
  return db.prepare(`
    SELECT * FROM webhook_subscriptions WHERE user_id = ? ORDER BY created_at DESC
  `).all(String(userId)).map(_publicView);
}

function getSubscription({ id, userId }) {
  const row = db.prepare(`SELECT * FROM webhook_subscriptions WHERE id = ?`).get(id);
  if (!row) throw _err('not found', 'not_found', 404);
  if (String(row.user_id) !== String(userId)) throw _err('forbidden', 'forbidden', 403);
  return _publicView(row);
}

function updateSubscription({ id, userId, url, events, active, description }) {
  const row = db.prepare(`SELECT * FROM webhook_subscriptions WHERE id = ?`).get(id);
  if (!row) throw _err('not found', 'not_found', 404);
  if (String(row.user_id) !== String(userId)) throw _err('forbidden', 'forbidden', 403);
  const patch = {};
  if (url !== undefined) patch.url = _normalizeUrl(url);
  if (events !== undefined) patch.events = _normalizeEvents(events).join(',');
  if (active !== undefined) patch.active = active ? 1 : 0;
  if (description !== undefined) patch.description = description || null;
  if (!Object.keys(patch).length) return _publicView(row);
  const sets = Object.keys(patch).map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE webhook_subscriptions SET ${sets}, updated_at = datetime('now') WHERE id = ?`)
    .run(...Object.values(patch), id);
  return _publicView(db.prepare(`SELECT * FROM webhook_subscriptions WHERE id = ?`).get(id));
}

function deleteSubscription({ id, userId }) {
  const row = db.prepare(`SELECT user_id FROM webhook_subscriptions WHERE id = ?`).get(id);
  if (!row) throw _err('not found', 'not_found', 404);
  if (String(row.user_id) !== String(userId)) throw _err('forbidden', 'forbidden', 403);
  db.prepare(`DELETE FROM webhook_subscriptions WHERE id = ?`).run(id);
  return { id, deleted: true };
}

function listDeliveries({ subscriptionId, userId, limit = 50 }) {
  const sub = db.prepare(`SELECT user_id FROM webhook_subscriptions WHERE id = ?`).get(subscriptionId);
  if (!sub) throw _err('not found', 'not_found', 404);
  if (String(sub.user_id) !== String(userId)) throw _err('forbidden', 'forbidden', 403);
  return db.prepare(`
    SELECT id, event_id, event_type, status, attempts, last_status_code,
           last_error, next_retry_at, created_at, delivered_at
      FROM webhook_deliveries
     WHERE subscription_id = ?
     ORDER BY created_at DESC LIMIT ?
  `).all(subscriptionId, Math.min(Math.max(limit, 1), 200));
}

// ── Dispatch ────────────────────────────────────────────────────────────────

function _sign(secret, body) {
  const t = Math.floor(Date.now() / 1000);
  const mac = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return { header: `t=${t},v1=${mac}`, t, mac };
}

async function _httpPost(url, body, headers) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
      signal: ctrl.signal,
      redirect: 'manual',
    });
    let text = '';
    try { text = await res.text(); } catch (_) {}
    return { ok: res.ok, status: res.status, body: text.slice(0, 512) };
  } finally {
    clearTimeout(timer);
  }
}

async function _attemptDelivery(deliveryId, subscription, body) {
  const { header } = _sign(subscription.secret, body);
  const headers = {
    'X-WAB-Webhook-Signature': header,
    'X-WAB-Webhook-Event': subscription._eventType,
    'X-WAB-Webhook-Id': subscription._eventId,
    'X-WAB-Webhook-Delivery': deliveryId,
    'User-Agent': 'web-agent-bridge-webhooks/1.0',
  };
  try {
    const res = await _httpPost(subscription.url, body, headers);
    if (res.ok) {
      db.prepare(`
        UPDATE webhook_deliveries
           SET status = 'success', attempts = attempts + 1,
               last_status_code = ?, last_error = NULL, delivered_at = datetime('now'),
               next_retry_at = NULL
         WHERE id = ?
      `).run(res.status, deliveryId);
      db.prepare(`
        UPDATE webhook_subscriptions
           SET last_success_at = datetime('now'), consecutive_failures = 0,
               updated_at = datetime('now')
         WHERE id = ?
      `).run(subscription.id);
      return true;
    }
    _recordFailure(deliveryId, subscription.id, res.status, `HTTP ${res.status}: ${res.body}`);
    return false;
  } catch (e) {
    _recordFailure(deliveryId, subscription.id, null, String(e.message || e));
    return false;
  }
}

function _recordFailure(deliveryId, subscriptionId, statusCode, errMsg) {
  const row = db.prepare(`SELECT attempts FROM webhook_deliveries WHERE id = ?`).get(deliveryId);
  const attempts = (row ? row.attempts : 0) + 1;
  const isFinal = attempts >= RETRY_DELAYS_MS.length;
  db.prepare(`
    UPDATE webhook_deliveries
       SET status = ?, attempts = ?, last_status_code = ?, last_error = ?,
           next_retry_at = ?
     WHERE id = ?
  `).run(
    isFinal ? 'failed' : 'pending',
    attempts,
    statusCode,
    errMsg.slice(0, 1024),
    isFinal ? null : new Date(Date.now() + RETRY_DELAYS_MS[attempts]).toISOString(),
    deliveryId,
  );
  db.prepare(`
    UPDATE webhook_subscriptions
       SET last_error_at = datetime('now'), last_error = ?,
           consecutive_failures = consecutive_failures + 1,
           updated_at = datetime('now')
     WHERE id = ?
  `).run(errMsg.slice(0, 512), subscriptionId);
}

function _scheduleRetry(deliveryId, subscription, body, attempt) {
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return;
  const t = setTimeout(async () => {
    const ok = await _attemptDelivery(deliveryId, subscription, body);
    if (!ok) _scheduleRetry(deliveryId, subscription, body, attempt + 1);
  }, delay);
  if (t.unref) t.unref();
}

/**
 * Emit an event to all matching active subscriptions. Non-blocking — schedules
 * deliveries via setImmediate so callers (revocation flows) return fast.
 */
function emit(eventType, data) {
  if (!VALID_EVENTS.has(eventType)) return 0;
  const subs = db.prepare(`
    SELECT * FROM webhook_subscriptions
     WHERE active = 1 AND (',' || events || ',') LIKE ?
  `).all(`%,${eventType},%`);
  if (!subs.length) return 0;

  const eventId = _ulid('evt');
  const payload = {
    id: eventId,
    type: eventType,
    created_at: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);

  for (const sub of subs) {
    const deliveryId = _ulid('whd');
    db.prepare(`
      INSERT INTO webhook_deliveries
        (id, subscription_id, event_id, event_type, payload, status, attempts)
      VALUES (?, ?, ?, ?, ?, 'pending', 0)
    `).run(deliveryId, sub.id, eventId, eventType, body);
    const enriched = { ...sub, _eventId: eventId, _eventType: eventType };
    setImmediate(async () => {
      const ok = await _attemptDelivery(deliveryId, enriched, body);
      if (!ok) _scheduleRetry(deliveryId, enriched, body, 1);
    });
  }
  return subs.length;
}

/** Verify a delivery signature server-side (for tests + receiver SDKs). */
function verifySignature({ secret, header, body, toleranceSec = 300 }) {
  if (!header || typeof header !== 'string') return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.split('=').map((s) => s.trim())),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!t || !v1) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(v1, 'hex'));
  } catch (_) { return false; }
}

module.exports = {
  createSubscription,
  listSubscriptions,
  getSubscription,
  updateSubscription,
  deleteSubscription,
  listDeliveries,
  emit,
  verifySignature,
  VALID_EVENTS,
  // exposed for tests
  _attemptDelivery,
};
