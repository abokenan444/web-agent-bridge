/**
 * server/routes/intent.js
 * WAB Intent-Aware Routing + Privacy Budget System
 *
 * Mounted at /api/intent and /api/privacy
 *
 * Intent-Aware Routing endpoints:
 *   GET  /api/intent/schema/:domain           — Get intent schema for domain
 *   POST /api/intent/register                 — Site owner registers intent schema
 *   POST /api/intent/resolve                  — Agent resolves: {domain, intent, context}
 *   GET  /api/intent/popular/:domain          — Top intents + success rates
 *
 * Privacy Budget endpoints:
 *   GET  /api/privacy/budget/:domain          — Get privacy budget declaration
 *   POST /api/privacy/budget/declare          — Site owner declares budget
 *   POST /api/privacy/budget/check            — Agent checks a data request against budget
 *   GET  /api/privacy/compliance/:domain      — Compliance badges (GDPR/CCPA/LGPD)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const intentRouter  = express.Router();
const privacyRouter = express.Router();
const { db } = require('../models/db');

// ─── Schema bootstrap ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS intent_schemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    schema_json TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
    active INTEGER NOT NULL DEFAULT 1, owner_token_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_domain ON intent_schemas(domain);

  CREATE TABLE IF NOT EXISTS intent_resolutions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    intent_key TEXT NOT NULL, matched_action TEXT, confidence REAL,
    context_keys TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_intent_res_domain ON intent_resolutions(domain, created_at DESC);

  CREATE TABLE IF NOT EXISTS privacy_budgets (
    domain TEXT PRIMARY KEY, budget_json TEXT NOT NULL,
    gdpr_compliant INTEGER DEFAULT 0, ccpa_compliant INTEGER DEFAULT 0,
    lgpd_compliant INTEGER DEFAULT 0, data_residency TEXT,
    max_fields_per_session INTEGER DEFAULT 5, owner_token_hash TEXT,
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
function normDomain(d) {
  return String(d || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}
function validDomain(d) {
  return /^[a-z0-9.-]{3,253}$/.test(d) && d.includes('.');
}

/**
 * Natural-language intent matcher.
 * Scoring: exact key match (100) > keyword hit in label (80) > keyword hit in synonyms (60)
 * Returns { action_id, matched_intent_key, confidence, recommended_actions }
 */
function matchIntent(intentText, schema) {
  const intents = schema.intents || {};
  const lower = intentText.toLowerCase();
  let bestKey = null, bestScore = 0;

  for (const [key, def] of Object.entries(intents)) {
    let score = 0;
    // Exact key
    if (lower.includes(key.toLowerCase())) score = Math.max(score, 85);
    // Label match
    const label = (def.label || '').toLowerCase();
    if (label && lower.includes(label)) score = Math.max(score, 80);
    // Keyword array
    for (const kw of (def.keywords || [])) {
      if (lower.includes(kw.toLowerCase())) score = Math.max(score, 65);
    }
    // Synonym array
    for (const syn of (def.synonyms || [])) {
      if (lower.includes(syn.toLowerCase())) score = Math.max(score, 60);
    }
    if (score > bestScore) { bestScore = score; bestKey = key; }
  }

  if (!bestKey || bestScore < 30) return null;

  const def = intents[bestKey];
  const actions = (def.actions || []).length ? def.actions : def.action_id ? [{ id: def.action_id, label: def.label || bestKey }] : [];
  return {
    matched_intent_key: bestKey,
    confidence: bestScore / 100,
    recommended_actions: actions,
    required_fields: def.required_fields || [],
    optional_fields: def.optional_fields || [],
    description: def.description || null,
  };
}

// ─── Intent-Aware Routing ─────────────────────────────────────────────────────

// GET /api/intent/schema/:domain
intentRouter.get('/schema/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const row = db.prepare(`SELECT schema_json, version, updated_at FROM intent_schemas WHERE domain = ? AND active = 1`).get(domain);
  if (!row) return res.status(404).json({ error: 'no_intent_schema', domain });
  try {
    return res.json({ domain, version: row.version, updated_at: row.updated_at, schema: JSON.parse(row.schema_json) });
  } catch (_) {
    return res.status(500).json({ error: 'schema_parse_error' });
  }
});

// POST /api/intent/register
intentRouter.post('/register', express.json({ limit: '64kb' }), (req, res) => {
  const { domain, schema, owner_token } = req.body || {};
  if (!domain || !schema || typeof schema !== 'object') return res.status(400).json({ error: 'missing_fields', required: ['domain', 'schema'] });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  if (!schema.intents || typeof schema.intents !== 'object') return res.status(400).json({ error: 'schema_must_have_intents' });

  // Validate each intent entry
  for (const [key, def] of Object.entries(schema.intents)) {
    if (typeof def !== 'object') return res.status(400).json({ error: 'invalid_intent_definition', key });
    if (!def.label && !def.actions) return res.status(400).json({ error: 'intent_needs_label_or_actions', key });
  }

  const tokenHash = owner_token ? crypto.createHash('sha256').update(String(owner_token)).digest('hex') : null;
  const existing = db.prepare(`SELECT id, owner_token_hash, version FROM intent_schemas WHERE domain = ?`).get(d);

  if (existing) {
    // Allow update only if token matches (or no token was set originally)
    if (existing.owner_token_hash && tokenHash !== existing.owner_token_hash) {
      return res.status(403).json({ error: 'invalid_owner_token' });
    }
    db.prepare(`UPDATE intent_schemas SET schema_json=?, version=version+1, updated_at=datetime('now'), active=1 WHERE domain=?`)
      .run(JSON.stringify(schema), d);
    return res.json({ ok: true, domain: d, action: 'updated', version: existing.version + 1 });
  }

  db.prepare(`INSERT INTO intent_schemas (domain, schema_json, owner_token_hash) VALUES (?, ?, ?)`).run(d, JSON.stringify(schema), tokenHash);
  return res.status(201).json({ ok: true, domain: d, action: 'created', version: 1 });
});

// POST /api/intent/resolve
intentRouter.post('/resolve', express.json({ limit: '8kb' }), (req, res) => {
  const { domain, intent, context = {} } = req.body || {};
  if (!domain || !intent) return res.status(400).json({ error: 'missing_fields', required: ['domain', 'intent'] });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });

  const row = db.prepare(`SELECT schema_json FROM intent_schemas WHERE domain = ? AND active = 1`).get(d);
  if (!row) return res.status(404).json({ error: 'no_intent_schema', domain: d, hint: 'Register an intent schema via POST /api/intent/register' });

  let schema;
  try { schema = JSON.parse(row.schema_json); } catch (_) { return res.status(500).json({ error: 'schema_parse_error' }); }

  const match = matchIntent(String(intent).slice(0, 500), schema);

  // Log resolution (no PII — only domain, matched key, context keys)
  const contextKeys = Object.keys(context).slice(0, 20).map(k => String(k).slice(0, 64));
  db.prepare(`INSERT INTO intent_resolutions (domain, intent_key, matched_action, confidence, context_keys) VALUES (?, ?, ?, ?, ?)`)
    .run(d, match?.matched_intent_key || '(no_match)', match?.recommended_actions?.[0]?.id || null, match?.confidence || 0, JSON.stringify(contextKeys));

  if (!match) {
    const available = Object.keys(schema.intents || {});
    return res.status(200).json({
      domain: d, matched: false, intent,
      hint: 'No intent matched. Provide one of the available intents.',
      available_intents: available,
    });
  }

  return res.json({
    domain: d, matched: true, intent,
    matched_intent_key: match.matched_intent_key,
    confidence: match.confidence,
    recommended_actions: match.recommended_actions,
    required_fields: match.required_fields,
    optional_fields: match.optional_fields,
    description: match.description,
    resolved_at: new Date().toISOString(),
  });
});

// GET /api/intent/popular/:domain
intentRouter.get('/popular/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const rows = db.prepare(
    `SELECT intent_key, COUNT(*) as count, AVG(confidence) as avg_confidence,
       SUM(CASE WHEN matched_action IS NOT NULL THEN 1 ELSE 0 END) as matched_count
     FROM intent_resolutions WHERE domain = ? AND created_at > datetime('now', '-30 days')
     GROUP BY intent_key ORDER BY count DESC LIMIT 20`
  ).all(domain);
  return res.json({ domain, popular_intents: rows, window: '30d' });
});

// ─── Privacy Budget ───────────────────────────────────────────────────────────

// Default budget template
const DEFAULT_BUDGET = {
  budget_version: '1.0',
  allowed_data_categories: ['navigation', 'preferences'],
  disallowed_data_categories: ['biometric', 'financial', 'health'],
  max_fields_per_session: 5,
  max_calls_per_minute: 60,
  retention_policy: 'session_only',
  purpose_limitation: 'agent_assistance_only',
  gdpr_compliant: true,
  ccpa_compliant: true,
  lgpd_compliant: false,
  data_residency: 'GLOBAL',
};

// GET /api/privacy/budget/:domain
privacyRouter.get('/budget/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const row = db.prepare(`SELECT * FROM privacy_budgets WHERE domain = ?`).get(domain);
  if (!row) {
    return res.json({ domain, budget: DEFAULT_BUDGET, source: 'default', hint: 'This domain has not declared a custom privacy budget. Defaults apply.' });
  }
  let budget;
  try { budget = JSON.parse(row.budget_json); } catch (_) { budget = DEFAULT_BUDGET; }
  return res.json({
    domain, budget, source: 'declared', version: row.version,
    gdpr_compliant: !!row.gdpr_compliant, ccpa_compliant: !!row.ccpa_compliant,
    lgpd_compliant: !!row.lgpd_compliant, data_residency: row.data_residency,
    updated_at: row.updated_at,
  });
});

// POST /api/privacy/budget/declare
privacyRouter.post('/budget/declare', express.json({ limit: '16kb' }), (req, res) => {
  const { domain, budget, owner_token } = req.body || {};
  if (!domain || !budget || typeof budget !== 'object') return res.status(400).json({ error: 'missing_fields', required: ['domain', 'budget'] });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });

  // Validate critical fields
  if (budget.max_fields_per_session != null && (budget.max_fields_per_session < 1 || budget.max_fields_per_session > 100))
    return res.status(400).json({ error: 'max_fields_per_session must be 1-100' });

  const tokenHash = owner_token ? crypto.createHash('sha256').update(String(owner_token)).digest('hex') : null;
  const existing = db.prepare(`SELECT owner_token_hash, version FROM privacy_budgets WHERE domain = ?`).get(d);
  if (existing?.owner_token_hash && tokenHash !== existing.owner_token_hash)
    return res.status(403).json({ error: 'invalid_owner_token' });

  const merged = { ...DEFAULT_BUDGET, ...budget };
  const gdpr = merged.gdpr_compliant ? 1 : 0;
  const ccpa = merged.ccpa_compliant ? 1 : 0;
  const lgpd = merged.lgpd_compliant ? 1 : 0;

  db.prepare(`
    INSERT INTO privacy_budgets (domain, budget_json, gdpr_compliant, ccpa_compliant, lgpd_compliant,
      data_residency, max_fields_per_session, owner_token_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(domain) DO UPDATE SET
      budget_json=excluded.budget_json, gdpr_compliant=excluded.gdpr_compliant,
      ccpa_compliant=excluded.ccpa_compliant, lgpd_compliant=excluded.lgpd_compliant,
      data_residency=excluded.data_residency, max_fields_per_session=excluded.max_fields_per_session,
      version=version+1, updated_at=datetime('now')
  `).run(d, JSON.stringify(merged), gdpr, ccpa, lgpd, merged.data_residency || 'GLOBAL', merged.max_fields_per_session || 5, tokenHash);

  return res.status(201).json({ ok: true, domain: d, version: (existing?.version || 0) + 1 });
});

// POST /api/privacy/budget/check — Agent checks if a data request is within budget
privacyRouter.post('/budget/check', express.json({ limit: '8kb' }), (req, res) => {
  const { domain, requested_fields = [], purpose } = req.body || {};
  if (!domain) return res.status(400).json({ error: 'missing_domain' });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });

  const row = db.prepare(`SELECT * FROM privacy_budgets WHERE domain = ?`).get(d);
  let budget;
  try { budget = row ? JSON.parse(row.budget_json) : DEFAULT_BUDGET; } catch (_) { budget = DEFAULT_BUDGET; }

  const fields = Array.isArray(requested_fields) ? requested_fields.slice(0, 50).map(f => String(f)) : [];
  const maxFields = budget.max_fields_per_session || 5;
  const disallowed = (budget.disallowed_data_categories || []);
  const allowed = (budget.allowed_data_categories || []);

  const withinLimit = fields.length <= maxFields;
  const violations = [];

  for (const field of fields) {
    if (disallowed.some(cat => field.toLowerCase().includes(cat.toLowerCase()))) {
      violations.push({ field, reason: 'disallowed_category' });
    }
  }

  const approved = withinLimit && violations.length === 0;

  return res.json({
    domain: d, approved, field_count: fields.length, max_allowed: maxFields,
    within_field_limit: withinLimit, violations,
    gdpr_compliant: !!(row?.gdpr_compliant ?? budget.gdpr_compliant),
    ccpa_compliant: !!(row?.ccpa_compliant ?? budget.ccpa_compliant),
    purpose_ok: !purpose || (budget.purpose_limitation === 'any' || budget.purpose_limitation?.includes('agent') !== false),
    budget_source: row ? 'declared' : 'default',
    checked_at: new Date().toISOString(),
  });
});

// GET /api/privacy/compliance/:domain — Badge data
privacyRouter.get('/compliance/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const row = db.prepare(`SELECT gdpr_compliant, ccpa_compliant, lgpd_compliant, data_residency, updated_at FROM privacy_budgets WHERE domain = ?`).get(domain);
  const badges = [];
  if (row?.gdpr_compliant) badges.push({ standard: 'GDPR', region: 'EU', color: '#003399' });
  if (row?.ccpa_compliant) badges.push({ standard: 'CCPA', region: 'US-CA', color: '#003366' });
  if (row?.lgpd_compliant) badges.push({ standard: 'LGPD', region: 'BR', color: '#009c3b' });
  return res.json({ domain, badges, declared: !!row, updated_at: row?.updated_at });
});

module.exports = { intentRouter, privacyRouter };
