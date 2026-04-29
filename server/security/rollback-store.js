'use strict';

/**
 * WAB Safety Shield — Snapshot & Rollback Store (SPEC §8.13)
 *
 * Persists a "before-image" snapshot for every destructive action that
 * site adapters opt into, plus a forward audit linking the snapshot to
 * the agent action that created it. Operators (or the site admin UI)
 * can then `restore` a snapshot to undo agent damage.
 *
 * The snapshot payload is opaque JSON provided by the site adapter
 * (e.g. a serialized DB row, a tombstoned file URL, an S3 version-id).
 * This module owns ONLY the durable index + lifecycle; it does not
 * know how to actually restore site data — that contract is delegated
 * to a per-site `restorer` callable registered via `setRestorer`.
 *
 * Tier: Enterprise.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// Schema is created lazily so this module can be required even on
// installations that do not enable rollback.
let _initialized = false;
function _ensureSchema() {
  if (_initialized) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS wab_snapshots (
      id              TEXT PRIMARY KEY,
      site_id         TEXT NOT NULL,
      action_name     TEXT NOT NULL,
      actor_id        TEXT,
      actor_type      TEXT NOT NULL DEFAULT 'agent',
      session_fingerprint TEXT,
      params_hash     TEXT,
      snapshot        TEXT NOT NULL,
      meta            TEXT DEFAULT '{}',
      reversible      INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'recorded'
                        CHECK(status IN ('recorded','restored','expired','failed')),
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      restored_at     TEXT,
      expires_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_wab_snapshots_site ON wab_snapshots (site_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wab_snapshots_status ON wab_snapshots (status);
  `);
  _initialized = true;
}

// ─── per-site restorers ──────────────────────────────────────────────
const _restorers = new Map();

/**
 * Register a restorer for a site. The function receives
 * `{ snapshot, action_name, params_hash, meta }` and must return either
 * `{ ok:true }` or `{ ok:false, error }`.
 */
function setRestorer(siteId, fn) {
  if (typeof fn !== 'function') throw new TypeError('restorer must be a function');
  _restorers.set(String(siteId), fn);
}

function _getRestorer(siteId) {
  return _restorers.get(String(siteId)) || null;
}

// ─── helpers ─────────────────────────────────────────────────────────

function _hashParams(params) {
  const canon = JSON.stringify(_canonicalize(params || {}));
  return crypto.createHash('sha256').update(canon).digest('hex').slice(0, 24);
}
function _canonicalize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(_canonicalize);
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = _canonicalize(value[k]);
  return out;
}
function _fingerprint(token) {
  if (!token) return null;
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 16);
}
function _genId() { return 'wabs_' + crypto.randomBytes(16).toString('hex'); }

// ─── public API ──────────────────────────────────────────────────────

/**
 * Record a snapshot just BEFORE the destructive action runs.
 *
 * @param {object} ctx        { siteId, actionName, actorId, sessionToken, params }
 * @param {object} payload    { snapshot, meta?, reversible?, ttlMs? }
 * @returns { snapshot_id, expires_at }
 */
function recordSnapshot(ctx, payload) {
  _ensureSchema();
  const id = _genId();
  const now = Date.now();
  const ttlMs = Math.max(0, payload.ttlMs || 30 * 24 * 60 * 60 * 1000); // 30 days default
  const expiresAt = ttlMs > 0 ? new Date(now + ttlMs).toISOString() : null;

  db.prepare(`
    INSERT INTO wab_snapshots
      (id, site_id, action_name, actor_id, actor_type, session_fingerprint, params_hash,
       snapshot, meta, reversible, status, expires_at)
    VALUES (?, ?, ?, ?, 'agent', ?, ?, ?, ?, ?, 'recorded', ?)
  `).run(
    id,
    String(ctx.siteId),
    String(ctx.actionName),
    ctx.actorId || null,
    _fingerprint(ctx.sessionToken),
    _hashParams(ctx.params),
    JSON.stringify(payload.snapshot ?? null),
    JSON.stringify(payload.meta || {}),
    payload.reversible === false ? 0 : 1,
    expiresAt
  );

  return { snapshot_id: id, expires_at: expiresAt };
}

function getSnapshot(snapshotId) {
  _ensureSchema();
  const row = db.prepare(`SELECT * FROM wab_snapshots WHERE id = ?`).get(snapshotId);
  if (!row) return null;
  return _hydrate(row);
}

function listSnapshots(siteId, opts = {}) {
  _ensureSchema();
  const limit = Math.min(Math.max(opts.limit || 50, 1), 500);
  const status = opts.status;
  const rows = status
    ? db.prepare(`SELECT * FROM wab_snapshots WHERE site_id=? AND status=? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(siteId, status, limit)
    : db.prepare(`SELECT * FROM wab_snapshots WHERE site_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(siteId, limit);
  return rows.map(_hydrate);
}

function _hydrate(row) {
  let snapshot = null;
  let meta = {};
  try { snapshot = JSON.parse(row.snapshot); } catch (_) {}
  try { meta = JSON.parse(row.meta || '{}'); } catch (_) {}
  return {
    id: row.id,
    site_id: row.site_id,
    action_name: row.action_name,
    actor_id: row.actor_id,
    actor_type: row.actor_type,
    session_fingerprint: row.session_fingerprint,
    params_hash: row.params_hash,
    snapshot,
    meta,
    reversible: !!row.reversible,
    status: row.status,
    created_at: row.created_at,
    restored_at: row.restored_at,
    expires_at: row.expires_at,
  };
}

/**
 * Restore a snapshot. Returns { ok:true } on success, or
 * { ok:false, code, message }. Restoration is single-use: a snapshot
 * already in `restored` cannot be replayed.
 */
async function restoreSnapshot(snapshotId, opts = {}) {
  _ensureSchema();
  const row = db.prepare(`SELECT * FROM wab_snapshots WHERE id = ?`).get(snapshotId);
  if (!row) return { ok: false, code: 'SNAPSHOT_NOT_FOUND' };
  if (row.status === 'restored') return { ok: false, code: 'SNAPSHOT_ALREADY_RESTORED' };
  if (row.status === 'expired') return { ok: false, code: 'SNAPSHOT_EXPIRED' };
  if (!row.reversible) return { ok: false, code: 'SNAPSHOT_IRREVERSIBLE' };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare(`UPDATE wab_snapshots SET status='expired' WHERE id=?`).run(snapshotId);
    return { ok: false, code: 'SNAPSHOT_EXPIRED' };
  }

  const restorer = opts.restorer || _getRestorer(row.site_id);
  if (!restorer) {
    return { ok: false, code: 'NO_RESTORER', message: `no restorer registered for site ${row.site_id}` };
  }

  let result;
  try {
    result = await restorer({
      snapshot_id: row.id,
      site_id: row.site_id,
      action_name: row.action_name,
      params_hash: row.params_hash,
      snapshot: JSON.parse(row.snapshot),
      meta: JSON.parse(row.meta || '{}'),
    });
  } catch (err) {
    db.prepare(`UPDATE wab_snapshots SET status='failed' WHERE id=?`).run(snapshotId);
    return { ok: false, code: 'RESTORER_THREW', message: err.message };
  }

  if (!result || result.ok !== true) {
    db.prepare(`UPDATE wab_snapshots SET status='failed' WHERE id=?`).run(snapshotId);
    return { ok: false, code: 'RESTORER_FAILED', message: result?.error || 'restorer reported failure' };
  }

  db.prepare(`UPDATE wab_snapshots SET status='restored', restored_at=datetime('now') WHERE id=?`).run(snapshotId);
  return { ok: true, snapshot_id: snapshotId };
}

/**
 * Expire snapshots past their TTL. Returns the count expired.
 */
function expireOld() {
  _ensureSchema();
  const r = db.prepare(`
    UPDATE wab_snapshots SET status='expired'
     WHERE status='recorded' AND expires_at IS NOT NULL AND expires_at < datetime('now')
  `).run();
  return r.changes || 0;
}

function _resetForTests() {
  _ensureSchema();
  db.prepare(`DELETE FROM wab_snapshots`).run();
  _restorers.clear();
}

module.exports = {
  recordSnapshot,
  getSnapshot,
  listSnapshots,
  restoreSnapshot,
  expireOld,
  setRestorer,
  // test helpers
  _resetForTests,
  _hashParams,
};
