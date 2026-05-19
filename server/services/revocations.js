/**
 * Site Revocations & Appeals (v3.11.0)
 * ───────────────────────────────────────────────────────────────────────────
 * Governance primitive for transparently disabling WAB-registered domains
 * with a 1-week owner appeal window and a public transparency log.
 *
 * Authority tiers:
 *
 *   1. owner_disable
 *      The site owner self-pauses their domain. Instantaneous, no appeal
 *      window (they can re-enable themselves at any time by calling
 *      reinstate() on their own revocation).
 *
 *   2. suspended
 *      Platform-issued temporary suspension (community report, automated
 *      rule, partner takedown). Opens a 7-day appeal window during which
 *      the owner may submit a rebuttal + remediation proof. After the
 *      window the revocation auto-finalises unless overturned.
 *
 *   3. revoked
 *      Permanent revocation. Reserved for hard breaches (proven fraud,
 *      malware distribution, court order). Still gets a 7-day appeal —
 *      due process matters more than throughput.
 *
 * Every decision is Ed25519-signed by the operator key (if configured) and
 * mirrored into `audit_log` for HMAC-chained tamper-evidence.
 */

'use strict';

const crypto = require('crypto');
const { db } = require('../models/db');
const { canonicalize } = require('./canonical-json');
const { auditLog } = require('./security');

const APPEAL_WINDOW_DAYS = Number(process.env.WAB_REVOCATION_APPEAL_DAYS || 7);
const APPEAL_WINDOW_MS   = APPEAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
const OPERATOR_KEY_B64   = process.env.WAB_OPERATOR_ED25519_PRIV || '';

const VALID_TYPES   = new Set(['owner_disable', 'suspended', 'revoked']);
const REASON_CODES  = new Set([
  'fraud', 'abuse', 'policy_breach', 'malware', 'court_order',
  'owner_request', 'security_incident', 'spam', 'impersonation', 'other',
]);

function _ulid(prefix) {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(8).toString('hex')}`;
}

function _signDecision(payload) {
  if (!OPERATOR_KEY_B64) return null;
  try {
    const keyDer = Buffer.from(OPERATOR_KEY_B64, 'base64');
    const key = crypto.createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' });
    const sig = crypto.sign(null, Buffer.from(canonicalize(payload), 'utf8'), key);
    return sig.toString('base64');
  } catch (e) {
    console.warn('[revocations] signature failed (non-fatal):', e.message);
    return null;
  }
}

function _findSiteByDomain(domain) {
  return db.prepare(`SELECT * FROM sites WHERE domain = ? LIMIT 1`).get(domain);
}

function _findSiteById(id) {
  return db.prepare(`SELECT * FROM sites WHERE id = ? LIMIT 1`).get(id);
}

/**
 * Open a new revocation against a site.
 *
 * @param {object} args
 * @param {string} args.siteId
 * @param {'owner_disable'|'suspended'|'revoked'} args.type
 * @param {string} args.reasonCode
 * @param {string} args.reasonText
 * @param {string} args.decidedBy      e.g. 'admin:42', 'owner:user_id', 'system:rule_x'
 * @param {string} [args.evidenceUrl]
 * @returns the inserted row
 */
function openRevocation({ siteId, type, reasonCode, reasonText, decidedBy, evidenceUrl }) {
  if (!VALID_TYPES.has(type))       throw Object.assign(new Error('invalid type'), { code: 'bad_type' });
  if (!REASON_CODES.has(reasonCode)) throw Object.assign(new Error('invalid reason_code'), { code: 'bad_reason' });
  if (!reasonText || reasonText.length < 8) {
    throw Object.assign(new Error('reason_text must be at least 8 chars'), { code: 'bad_reason_text' });
  }
  const site = _findSiteById(siteId);
  if (!site) throw Object.assign(new Error('site not found'), { code: 'not_found', statusCode: 404 });

  // Block opening a duplicate active revocation of the same kind.
  const existing = db.prepare(`
    SELECT id FROM site_revocations
     WHERE site_id = ? AND status IN ('pending_appeal','appealed','final')
     LIMIT 1
  `).get(siteId);
  if (existing && type !== 'owner_disable') {
    throw Object.assign(new Error('site already has an active revocation'),
      { code: 'already_revoked', statusCode: 409 });
  }

  const id = _ulid('rev');
  const now = new Date();
  const appealDeadline = type === 'owner_disable'
    ? null
    : new Date(now.getTime() + APPEAL_WINDOW_MS).toISOString();

  const payload = {
    id, site_id: siteId, domain: site.domain, type,
    reason_code: reasonCode, reason_text: reasonText,
    evidence_url: evidenceUrl || null,
    decided_by: decidedBy, decided_at: now.toISOString(),
    appeal_deadline: appealDeadline,
  };
  const signature = _signDecision(payload);

  db.prepare(`
    INSERT INTO site_revocations
      (id, site_id, domain, type, reason_code, reason_text, evidence_url,
       decided_by, decided_at, appeal_deadline, status, signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, siteId, site.domain, type, reasonCode, reasonText, evidenceUrl || null,
    decidedBy, now.toISOString(), appealDeadline,
    type === 'owner_disable' ? 'final' : 'pending_appeal',
    signature,
  );

  // Flip the site itself to inactive so downstream lookups stop trusting it.
  db.prepare(`UPDATE sites SET active = 0 WHERE id = ?`).run(siteId);

  auditLog({
    actorType: decidedBy.startsWith('admin:') ? 'admin' : decidedBy.startsWith('owner:') ? 'user' : 'system',
    actorId: decidedBy.split(':')[1] || decidedBy,
    action: 'site_revocation_opened',
    resource: 'site', resourceId: siteId,
    details: { id, type, reason_code: reasonCode, domain: site.domain },
    severity: type === 'revoked' ? 'critical' : 'warning',
  });

  return db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(id);
}

/**
 * Submit an owner appeal. Only the site owner may call this, and only
 * within the appeal window. Re-submitting overwrites the open appeal.
 */
function submitAppeal({ revocationId, ownerUserId, statement, remediationProof }) {
  if (!statement || statement.length < 16) {
    throw Object.assign(new Error('statement must be at least 16 chars'),
      { code: 'bad_statement', statusCode: 400 });
  }
  const rev = db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(revocationId);
  if (!rev) throw Object.assign(new Error('revocation not found'), { code: 'not_found', statusCode: 404 });

  const site = _findSiteById(rev.site_id);
  if (!site || site.user_id !== ownerUserId) {
    throw Object.assign(new Error('forbidden'), { code: 'forbidden', statusCode: 403 });
  }
  if (rev.type === 'owner_disable') {
    throw Object.assign(new Error('owner_disable cannot be appealed (use reinstate)'),
      { code: 'not_appealable', statusCode: 400 });
  }
  if (!['pending_appeal', 'appealed'].includes(rev.status)) {
    throw Object.assign(new Error(`revocation in '${rev.status}' is not appealable`),
      { code: 'not_appealable', statusCode: 409 });
  }
  if (rev.appeal_deadline && new Date(rev.appeal_deadline).getTime() < Date.now()) {
    // Auto-finalise stale appeals lazily.
    db.prepare(`UPDATE site_revocations SET status='final', finalized_at=datetime('now'), updated_at=datetime('now') WHERE id=?`).run(revocationId);
    throw Object.assign(new Error('appeal window expired'),
      { code: 'appeal_expired', statusCode: 410 });
  }

  const existing = db.prepare(`SELECT id FROM revocation_appeals WHERE revocation_id = ?`).get(revocationId);
  if (existing) {
    db.prepare(`
      UPDATE revocation_appeals
         SET statement = ?, remediation_proof = ?, submitted_at = datetime('now'),
             decision = NULL, decision_reason = NULL, decided_by = NULL, decided_at = NULL
       WHERE revocation_id = ?
    `).run(statement, remediationProof || null, revocationId);
  } else {
    db.prepare(`
      INSERT INTO revocation_appeals (id, revocation_id, owner_user_id, statement, remediation_proof)
      VALUES (?, ?, ?, ?, ?)
    `).run(_ulid('app'), revocationId, ownerUserId, statement, remediationProof || null);
  }

  db.prepare(`UPDATE site_revocations SET status='appealed', updated_at=datetime('now') WHERE id=?`).run(revocationId);

  auditLog({
    actorType: 'user', actorId: String(ownerUserId),
    action: 'revocation_appeal_submitted',
    resource: 'site_revocation', resourceId: revocationId,
    details: { domain: rev.domain },
  });

  return db.prepare(`
    SELECT a.*, r.domain, r.type AS revocation_type
      FROM revocation_appeals a
      JOIN site_revocations r ON r.id = a.revocation_id
     WHERE a.revocation_id = ?
  `).get(revocationId);
}

/**
 * Admin decision on an appeal.
 *   decision = 'upheld'    → site reinstated
 *   decision = 'rejected'  → revocation finalised
 */
function decideAppeal({ revocationId, decision, decisionReason, adminId }) {
  if (!['upheld', 'rejected'].includes(decision)) {
    throw Object.assign(new Error('decision must be upheld|rejected'),
      { code: 'bad_decision', statusCode: 400 });
  }
  const rev = db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(revocationId);
  if (!rev) throw Object.assign(new Error('revocation not found'), { code: 'not_found', statusCode: 404 });
  const appeal = db.prepare(`SELECT * FROM revocation_appeals WHERE revocation_id = ?`).get(revocationId);
  if (!appeal) throw Object.assign(new Error('no appeal to decide'), { code: 'no_appeal', statusCode: 404 });
  if (rev.status !== 'appealed') {
    throw Object.assign(new Error(`revocation in '${rev.status}' has no open appeal`),
      { code: 'no_open_appeal', statusCode: 409 });
  }

  db.prepare(`
    UPDATE revocation_appeals
       SET decision = ?, decision_reason = ?, decided_by = ?, decided_at = datetime('now')
     WHERE revocation_id = ?
  `).run(decision, decisionReason || null, String(adminId), revocationId);

  if (decision === 'upheld') {
    db.prepare(`
      UPDATE site_revocations
         SET status='overturned', reinstated_at=datetime('now'), reinstated_by=?, updated_at=datetime('now')
       WHERE id=?
    `).run(`admin:${adminId}`, revocationId);
    db.prepare(`UPDATE sites SET active = 1 WHERE id = ?`).run(rev.site_id);
  } else {
    db.prepare(`
      UPDATE site_revocations
         SET status='final', finalized_at=datetime('now'), updated_at=datetime('now')
       WHERE id=?
    `).run(revocationId);
  }

  auditLog({
    actorType: 'admin', actorId: String(adminId),
    action: 'revocation_appeal_decided',
    resource: 'site_revocation', resourceId: revocationId,
    details: { decision, domain: rev.domain },
    severity: decision === 'rejected' ? 'warning' : 'info',
  });

  return db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(revocationId);
}

/**
 * Manually reinstate (governance override or owner re-enabling their own disable).
 */
function reinstate({ revocationId, actorId, actorType = 'admin', reason }) {
  const rev = db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(revocationId);
  if (!rev) throw Object.assign(new Error('revocation not found'), { code: 'not_found', statusCode: 404 });
  if (rev.status === 'reinstated' || rev.status === 'overturned') {
    return rev;  // idempotent
  }

  db.prepare(`
    UPDATE site_revocations
       SET status='reinstated', reinstated_at=datetime('now'), reinstated_by=?, updated_at=datetime('now')
     WHERE id=?
  `).run(`${actorType}:${actorId}`, revocationId);
  db.prepare(`UPDATE sites SET active = 1 WHERE id = ?`).run(rev.site_id);

  auditLog({
    actorType, actorId: String(actorId),
    action: 'site_revocation_reinstated',
    resource: 'site_revocation', resourceId: revocationId,
    details: { domain: rev.domain, reason: reason || null },
  });

  return db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(revocationId);
}

/**
 * Lazy sweep: any 'pending_appeal' whose deadline elapsed → 'final'.
 * Called from periodic worker AND from getActiveByDomain to keep state honest.
 */
function sweepExpired() {
  const r = db.prepare(`
    UPDATE site_revocations
       SET status='final', finalized_at=datetime('now'), updated_at=datetime('now')
     WHERE status='pending_appeal'
       AND appeal_deadline IS NOT NULL
       AND datetime(appeal_deadline) <= datetime('now')
  `).run();
  return r.changes || 0;
}

/** Returns the active (blocking) revocation for a domain, or null. */
function getActiveByDomain(domain) {
  sweepExpired();
  return db.prepare(`
    SELECT * FROM site_revocations
     WHERE domain = ? AND status IN ('pending_appeal','appealed','final')
     ORDER BY decided_at DESC LIMIT 1
  `).get(domain) || null;
}

/** Public transparency feed (newest first, redacts internal IDs). */
function listPublic({ limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(`
    SELECT id, domain, type, reason_code, reason_text, evidence_url,
           decided_at, appeal_deadline, status, finalized_at, reinstated_at
      FROM site_revocations
     WHERE type != 'owner_disable'
     ORDER BY decided_at DESC LIMIT ? OFFSET ?
  `).all(Math.min(limit, 200), Math.max(offset, 0));
  return rows;
}

/** Admin: full listing with optional filters. */
function listAdmin({ status, type, limit = 100, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (type)   { where.push('type = ?');   params.push(type); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(limit, 500), Math.max(offset, 0));
  return db.prepare(`
    SELECT * FROM site_revocations
     ${clause}
     ORDER BY decided_at DESC LIMIT ? OFFSET ?
  `).all(...params);
}

function getById(id) {
  return db.prepare(`SELECT * FROM site_revocations WHERE id = ?`).get(id);
}

function getAppeal(revocationId) {
  return db.prepare(`SELECT * FROM revocation_appeals WHERE revocation_id = ?`).get(revocationId);
}

/** Optional background worker — env-gated. */
function startPeriodicSweep() {
  const hours = Number(process.env.WAB_REVOCATION_SWEEP_INTERVAL_HOURS || 0);
  if (!hours || hours < 0.1) return null;
  const ms = hours * 60 * 60 * 1000;
  const t = setInterval(() => {
    try {
      const n = sweepExpired();
      if (n) console.log(`[revocations] swept ${n} expired appeal windows`);
    } catch (e) {
      console.error('[revocations] sweep failed:', e.message);
    }
  }, ms);
  t.unref?.();
  return { intervalHours: hours };
}

module.exports = {
  openRevocation,
  submitAppeal,
  decideAppeal,
  reinstate,
  sweepExpired,
  getActiveByDomain,
  listPublic,
  listAdmin,
  getById,
  getAppeal,
  startPeriodicSweep,
  APPEAL_WINDOW_DAYS,
  VALID_TYPES,
  REASON_CODES,
};
