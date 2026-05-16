'use strict';

/**
 * ATP Merchant Commission — v3.10.0
 *
 * WAB charges a small platform commission on every successful merchant
 * transaction settled through ATP, when the merchant is on a paid plan
 * and the transaction is real (not a platform self-payment).
 *
 * Defaults:
 *   - Rate: 10 bps (0.10%), overridable via env WAB_COMMISSION_BPS or
 *     platform_settings('commission_bps').
 *   - Minimum tier: 'starter' (free sites exempt), overridable via env
 *     WAB_COMMISSION_MIN_TIER.
 *   - Platform self-payments (intent.metadata.platform = 1) always exempt.
 *
 * Idempotency: atp_commissions.transaction_id is UNIQUE, so duplicate
 * settle events become a no-op.
 */

const crypto = require('crypto');
const { db, getPlatformSetting, findSiteById } = require('../models/db');

const TIER_RANK = { free: 0, starter: 1, pro: 2, business: 3, enterprise: 4 };

function ulid(prefix) {
  const t = Date.now().toString(36).padStart(8, '0');
  const r = crypto.randomBytes(10).toString('hex');
  return `${prefix}_${t}${r}`;
}

function getCommissionBps() {
  // Priority: env > platform_setting > default
  const envBps = parseInt(process.env.WAB_COMMISSION_BPS, 10);
  if (Number.isFinite(envBps) && envBps >= 0 && envBps <= 10000) return envBps;
  try {
    const setting = getPlatformSetting('commission_bps');
    if (setting != null) {
      const n = parseInt(setting, 10);
      if (Number.isFinite(n) && n >= 0 && n <= 10000) return n;
    }
  } catch { /* table may not exist in some tests */ }
  return 10; // default 0.10%
}

function getMinTier() {
  const env = (process.env.WAB_COMMISSION_MIN_TIER || '').toLowerCase().trim();
  if (env && TIER_RANK[env] != null) return env;
  return 'starter';
}

function calcCommissionCents(amountCents, bps) {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  // round half-up to nearest cent
  return Math.floor((amountCents * bps + 5000) / 10000);
}

function safeJson(s, fallback) {
  if (s == null) return fallback;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return fallback; }
}

/**
 * Record a commission row for a settled merchant transaction.
 * Idempotent: safe to call multiple times for the same tx.
 * Returns the commission row (or null when not applicable).
 */
function recordCommissionForTransaction(tx) {
  if (!tx || !tx.id || !tx.intent_id) return null;
  if (!Number.isFinite(tx.amount_cents) || tx.amount_cents <= 0) return null;

  // Already recorded?
  const existing = db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(tx.id);
  if (existing) return existing;

  const intent = db.prepare('SELECT user_id, site_id, metadata FROM atp_intents WHERE id=?').get(tx.intent_id);
  if (!intent) return null;

  // Platform self-payment? Skip.
  const meta = safeJson(intent.metadata, {});
  if (meta && meta.platform) return null;

  // Need a merchant site to bill against.
  if (!intent.site_id) return null;

  let site;
  try { site = findSiteById.get(intent.site_id); } catch { site = null; }
  if (!site) return null;

  const tier = (site.tier || 'free').toLowerCase();
  const minTier = getMinTier();
  if ((TIER_RANK[tier] ?? 0) < (TIER_RANK[minTier] ?? 1)) return null;

  const bps = getCommissionBps();
  if (bps <= 0) return null;

  const commissionCents = calcCommissionCents(tx.amount_cents, bps);
  if (commissionCents <= 0) return null;

  const id = ulid('atp_com');
  const externalRef =
    (tx.metadata && safeJson(tx.metadata, {}).external_ref) ||
    tx.idempotency_key || null;

  db.prepare(`
    INSERT INTO atp_commissions
      (id, transaction_id, intent_id, merchant_user_id, merchant_site_id,
       merchant_tier, gross_amount_cents, currency, commission_bps, commission_cents,
       status, external_ref)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
  `).run(
    id, tx.id, tx.intent_id, site.user_id, site.id,
    tier, tx.amount_cents, tx.currency || 'EUR', bps, commissionCents,
    externalRef
  );

  return db.prepare('SELECT * FROM atp_commissions WHERE id=?').get(id);
}

/**
 * Flip a commission to 'refunded' when the underlying tx is compensated.
 */
function markCommissionRefunded(txId, reason = null) {
  const row = db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(txId);
  if (!row) return null;
  if (row.status === 'refunded' || row.status === 'waived') return row;
  db.prepare(`
    UPDATE atp_commissions
       SET status='refunded',
           notes = COALESCE(notes || ' | ', '') || ?,
           updated_at = datetime('now')
     WHERE transaction_id=?
  `).run(`refund: ${reason || 'tx_compensated'}`, txId);
  return db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(txId);
}

function listCommissionsForMerchant(userId, { limit = 50, offset = 0, status = null } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const off = Math.max(0, Number(offset) || 0);
  if (status) {
    return db.prepare(`
      SELECT * FROM atp_commissions
       WHERE merchant_user_id=? AND status=?
       ORDER BY created_at DESC LIMIT ? OFFSET ?
    `).all(userId, status, lim, off);
  }
  return db.prepare(`
    SELECT * FROM atp_commissions
     WHERE merchant_user_id=?
     ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).all(userId, lim, off);
}

function getMerchantCommissionStats(userId) {
  const overall = db.prepare(`
    SELECT COUNT(*)                                AS count_total,
           COALESCE(SUM(commission_cents), 0)      AS commission_total_cents,
           COALESCE(SUM(gross_amount_cents), 0)    AS gross_total_cents
      FROM atp_commissions
     WHERE merchant_user_id = ?
       AND status IN ('pending','invoiced','collected')
  `).get(userId);
  const byStatus = db.prepare(`
    SELECT status,
           COUNT(*) AS n,
           COALESCE(SUM(commission_cents), 0) AS commission_cents
      FROM atp_commissions
     WHERE merchant_user_id = ?
     GROUP BY status
  `).all(userId);
  return { ...overall, by_status: byStatus, rate_bps: getCommissionBps() };
}

function getPlatformCommissionStats() {
  const row = db.prepare(`
    SELECT COUNT(*)                                AS count_total,
           COALESCE(SUM(commission_cents), 0)      AS commission_total_cents,
           COALESCE(SUM(gross_amount_cents), 0)    AS gross_total_cents,
           MIN(created_at)                         AS first_at,
           MAX(created_at)                         AS last_at
      FROM atp_commissions
     WHERE status IN ('pending','invoiced','collected')
  `).get();
  const byStatus = db.prepare(`
    SELECT status, COUNT(*) AS n, COALESCE(SUM(commission_cents),0) AS commission_cents
      FROM atp_commissions GROUP BY status
  `).all();
  const byTier = db.prepare(`
    SELECT merchant_tier AS tier, COUNT(*) AS n,
           COALESCE(SUM(commission_cents),0) AS commission_cents
      FROM atp_commissions
     WHERE status IN ('pending','invoiced','collected')
     GROUP BY merchant_tier
     ORDER BY commission_cents DESC
  `).all();
  return { ...row, by_status: byStatus, by_tier: byTier, rate_bps: getCommissionBps() };
}

module.exports = {
  recordCommissionForTransaction,
  markCommissionRefunded,
  listCommissionsForMerchant,
  getMerchantCommissionStats,
  getPlatformCommissionStats,
  getCommissionBps,
  getMinTier,
  _calcCommissionCents: calcCommissionCents,
};
