'use strict';

/**
 * URL Policy — guards public endpoints (e.g. /api/universal/extract) that
 * accept arbitrary user URLs. Layered on top of the SSRF guard in
 * server/utils/safe-fetch.js, this module enforces:
 *
 *   1. Scheme allow-list (https only by default).
 *   2. TLD/host denylist (configurable via WAB_URL_DENY_HOSTS / DEFAULT_DENY).
 *   3. Path denylist for obvious admin/credential/wp-login style targets that
 *      would suggest abuse.
 *   4. Per-actor (IP / API-key / siteId) rate-limit independent of express
 *      router-level rate limiting.
 *
 * Decisions are recorded in `url_policy_audit` for review.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

const DEFAULT_DENY_HOSTS = [
  // Local/private/metadata is already blocked by safe-fetch; these are
  // additional public hosts that have no legitimate scraping use case.
  'login.microsoftonline.com',
  'accounts.google.com',
  'appleid.apple.com',
];

const DEFAULT_DENY_PATH_RE = /\/(?:wp-(?:login|admin)|administrator|phpmyadmin|\.git|\.env)(?:\/|\.|$|\?)/i;

const RATE_WINDOW_MS = 60_000;
const RATE_MAX = parseInt(process.env.WAB_URL_POLICY_RATE_MAX || '30', 10);

function _envHosts() {
  return String(process.env.WAB_URL_DENY_HOSTS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS url_policy_audit (
    id TEXT PRIMARY KEY,
    actor TEXT,
    url TEXT,
    decision TEXT NOT NULL CHECK(decision IN ('allowed','blocked','rate_limited')),
    reason TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_urlpolicy_decision ON url_policy_audit(decision);
`);

const _rate = new Map(); // actor → [ts]

function _hit(actor) {
  const now = Date.now();
  const arr = (_rate.get(actor) || []).filter((t) => now - t < RATE_WINDOW_MS);
  arr.push(now);
  _rate.set(actor, arr);
  return arr.length;
}

function _audit(actor, url, decision, reason) {
  try {
    db.prepare(`INSERT INTO url_policy_audit (id, actor, url, decision, reason)
                VALUES (?, ?, ?, ?, ?)`).run(
      crypto.randomUUID(), actor || null, url || null, decision, reason || null);
  } catch (_) { /* never block on audit failure */ }
}

/**
 * @param {string} rawUrl
 * @param {object} opts
 * @param {string} [opts.actor] - IP, API key id, or site id
 * @returns {{ ok:boolean, reason?:string, code?:string, parsed?:URL }}
 */
function check(rawUrl, opts = {}) {
  const actor = opts.actor || 'anon';

  if (typeof rawUrl !== 'string' || rawUrl.length === 0) {
    _audit(actor, String(rawUrl).slice(0, 200), 'blocked', 'missing_url');
    return { ok: false, reason: 'URL is required', code: 'MISSING_URL' };
  }
  if (rawUrl.length > 2048) {
    _audit(actor, rawUrl.slice(0, 200), 'blocked', 'url_too_long');
    return { ok: false, reason: 'URL exceeds 2048 characters', code: 'URL_TOO_LONG' };
  }

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch {
    _audit(actor, rawUrl.slice(0, 200), 'blocked', 'invalid_url');
    return { ok: false, reason: 'Invalid URL', code: 'INVALID_URL' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    _audit(actor, rawUrl, 'blocked', `scheme:${parsed.protocol}`);
    return { ok: false, reason: `Scheme ${parsed.protocol} not allowed`, code: 'BAD_SCHEME' };
  }
  if (process.env.WAB_URL_POLICY_HTTPS_ONLY === '1' && parsed.protocol !== 'https:') {
    _audit(actor, rawUrl, 'blocked', 'http_disallowed');
    return { ok: false, reason: 'HTTPS required', code: 'HTTPS_REQUIRED' };
  }

  const host = parsed.hostname.toLowerCase();
  const deny = new Set([...DEFAULT_DENY_HOSTS, ..._envHosts()]);
  if (deny.has(host)) {
    _audit(actor, rawUrl, 'blocked', `host_denied:${host}`);
    return { ok: false, reason: `Host ${host} is denied by policy`, code: 'HOST_DENIED' };
  }

  if (DEFAULT_DENY_PATH_RE.test(parsed.pathname)) {
    _audit(actor, rawUrl, 'blocked', `path_denied:${parsed.pathname}`);
    return { ok: false, reason: 'Path matches abuse pattern', code: 'PATH_DENIED' };
  }

  const count = _hit(actor);
  if (count > RATE_MAX) {
    _audit(actor, rawUrl, 'rate_limited', `count:${count}`);
    return { ok: false, reason: `Rate limit exceeded (${RATE_MAX} URLs/min per actor)`, code: 'RATE_LIMITED' };
  }

  _audit(actor, rawUrl, 'allowed', null);
  return { ok: true, parsed };
}

function getRecentAudits(limit = 100, decision) {
  if (decision) {
    return db.prepare(`SELECT * FROM url_policy_audit WHERE decision = ? ORDER BY rowid DESC LIMIT ?`).all(decision, limit);
  }
  return db.prepare(`SELECT * FROM url_policy_audit ORDER BY rowid DESC LIMIT ?`).all(limit);
}

function actorFromReq(req) {
  return (req.wabAuth && req.wabAuth.key_id) ||
         (req.user && req.user.id) ||
         req.ip ||
         'anon';
}

module.exports = { check, getRecentAudits, actorFromReq, RATE_MAX };
