/**
 * Plans Service — DB-backed plan & feature management.
 *
 * Source of truth for: pricing, feature matrix, Stripe price IDs, public
 * pricing page contents and feature-gate decisions.
 *
 * Tables (created by migrations/008_plans.sql):
 *   - plans
 *   - feature_catalog
 *
 * Falls back gracefully if the migration has not yet been applied (e.g.
 * during boot races or in unit tests that touch a fresh DB) by returning
 * empty arrays — callers stay alive and the legacy hard-coded PLANS object
 * in server/config/plans.js continues to work.
 */
'use strict';

const path = require('path');
const Database = require('better-sqlite3');

let _db = null;
function db() {
  if (_db) return _db;
  const DATA_DIR = process.env.NODE_ENV === 'test'
    ? path.join(__dirname, '..', '..', 'data-test')
    : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
  const dbFile = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';
  _db = new Database(path.join(DATA_DIR, dbFile));
  return _db;
}

function tableExists(name) {
  try {
    return !!db().prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
  } catch { return false; }
}

function safeJson(s, fallback) {
  if (s == null) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function rowToPlan(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    price_cents: row.price_cents,
    currency: row.currency,
    billing_period: row.billing_period,
    stripe_price_id: row.stripe_price_id,
    cta_type: row.cta_type,
    cta_label: row.cta_label,
    cta_url: row.cta_url,
    highlight: !!row.highlight,
    is_public: !!row.is_public,
    is_archived: !!row.is_archived,
    sort_order: row.sort_order,
    features: safeJson(row.features_json, {}),
    limits: safeJson(row.limits_json, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function listPlans({ includeArchived = false, publicOnly = false } = {}) {
  if (!tableExists('plans')) return [];
  const where = [];
  if (!includeArchived) where.push('is_archived = 0');
  if (publicOnly) where.push('is_public = 1');
  const sql = `SELECT * FROM plans ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY sort_order ASC, price_cents ASC, id ASC`;
  return db().prepare(sql).all().map(rowToPlan);
}

function getPlan(id) {
  if (!tableExists('plans')) return null;
  const row = db().prepare('SELECT * FROM plans WHERE id = ?').get(id);
  return rowToPlan(row);
}

function listFeatures() {
  if (!tableExists('feature_catalog')) return [];
  return db().prepare('SELECT * FROM feature_catalog ORDER BY sort_order ASC, label ASC').all()
    .map(r => ({
      key: r.feature_key,
      label: r.label,
      description: r.description,
      category: r.category,
      is_open_source: !!r.is_open_source,
      sort_order: r.sort_order,
    }));
}

const ALLOWED_FIELDS = new Set([
  'name','tagline','description','price_cents','currency','billing_period',
  'stripe_price_id','cta_type','cta_label','cta_url','highlight','is_public',
  'is_archived','sort_order','features','limits',
]);

const VALID_BILLING = new Set(['month','year','one_time','custom']);
const VALID_CTA = new Set(['checkout','register','contact','external']);

function validatePatch(patch) {
  const errs = [];
  if (patch.billing_period != null && !VALID_BILLING.has(patch.billing_period)) errs.push('invalid billing_period');
  if (patch.cta_type != null && !VALID_CTA.has(patch.cta_type)) errs.push('invalid cta_type');
  if (patch.price_cents != null && (!Number.isInteger(patch.price_cents) || patch.price_cents < 0)) errs.push('price_cents must be a non-negative integer');
  if (patch.currency != null && !/^[A-Z]{3}$/.test(patch.currency)) errs.push('currency must be a 3-letter code (e.g. EUR)');
  if (patch.features != null && (typeof patch.features !== 'object' || Array.isArray(patch.features))) errs.push('features must be an object');
  if (patch.limits != null && (typeof patch.limits !== 'object' || Array.isArray(patch.limits))) errs.push('limits must be an object');
  return errs;
}

function applyPatchToColumns(patch) {
  const cols = {};
  for (const k of Object.keys(patch)) {
    if (!ALLOWED_FIELDS.has(k)) continue;
    if (k === 'features')      cols.features_json = JSON.stringify(patch.features || {});
    else if (k === 'limits')   cols.limits_json   = JSON.stringify(patch.limits || {});
    else if (k === 'highlight' || k === 'is_public' || k === 'is_archived')
                               cols[k] = patch[k] ? 1 : 0;
    else                       cols[k] = patch[k];
  }
  return cols;
}

function createPlan(input) {
  if (!tableExists('plans')) throw new Error('plans table missing — run migrations');
  if (!input || !input.id || !/^[a-z0-9][a-z0-9_-]{1,40}$/.test(input.id)) {
    throw new Error('id is required (lowercase slug, 2–40 chars)');
  }
  if (!input.name) throw new Error('name is required');
  const errs = validatePatch(input);
  if (errs.length) throw new Error(errs.join('; '));

  const existing = getPlan(input.id);
  if (existing) throw new Error('plan already exists');

  const cols = applyPatchToColumns({
    name: input.name,
    tagline: input.tagline || null,
    description: input.description || null,
    price_cents: input.price_cents == null ? 0 : input.price_cents,
    currency: input.currency || 'EUR',
    billing_period: input.billing_period || 'month',
    stripe_price_id: input.stripe_price_id || null,
    cta_type: input.cta_type || 'checkout',
    cta_label: input.cta_label || null,
    cta_url: input.cta_url || null,
    highlight: !!input.highlight,
    is_public: input.is_public === false ? false : true,
    is_archived: false,
    sort_order: input.sort_order == null ? 100 : input.sort_order,
    features: input.features || {},
    limits: input.limits || {},
  });

  const fields = ['id', ...Object.keys(cols)];
  const placeholders = fields.map(() => '?').join(',');
  db().prepare(`INSERT INTO plans (${fields.join(',')}) VALUES (${placeholders})`)
      .run(input.id, ...Object.values(cols));
  return getPlan(input.id);
}

function updatePlan(id, patch) {
  if (!tableExists('plans')) throw new Error('plans table missing — run migrations');
  const existing = getPlan(id);
  if (!existing) throw new Error('plan not found');
  const errs = validatePatch(patch);
  if (errs.length) throw new Error(errs.join('; '));

  const cols = applyPatchToColumns(patch);
  if (!Object.keys(cols).length) return existing;

  cols.updated_at = new Date().toISOString().replace('T',' ').slice(0,19);
  const sets = Object.keys(cols).map(k => `${k} = ?`).join(', ');
  db().prepare(`UPDATE plans SET ${sets} WHERE id = ?`).run(...Object.values(cols), id);
  return getPlan(id);
}

function setPlanFeature(id, featureKey, included) {
  const plan = getPlan(id);
  if (!plan) throw new Error('plan not found');
  const features = Object.assign({}, plan.features);
  if (included) features[featureKey] = true;
  else delete features[featureKey];
  return updatePlan(id, { features });
}

function deletePlan(id) {
  if (!tableExists('plans')) throw new Error('plans table missing — run migrations');
  // Soft-delete by archiving so legacy tier references stay resolvable.
  return updatePlan(id, { is_archived: true, is_public: false });
}

function planHasFeature(id, featureKey) {
  const p = getPlan(id);
  if (!p) return false;
  return !!p.features[featureKey];
}

module.exports = {
  listPlans,
  getPlan,
  listFeatures,
  createPlan,
  updatePlan,
  setPlanFeature,
  deletePlan,
  planHasFeature,
};
