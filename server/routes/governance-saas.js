// ═══════════════════════════════════════════════════════════════════════════
// WAB Governance SaaS  (multi-tenant audit log + refusal exports)
//
//   POST  /api/governance/workspaces             — create workspace (admin)
//   GET   /api/governance/workspaces/:id         — workspace metadata (member)
//   POST  /api/governance/workspaces/:id/members — add member (owner/admin)
//   POST  /api/governance/workspaces/:id/events  — ingest audit event (key-gated)
//   GET   /api/governance/workspaces/:id/events  — query events (member)
//   GET   /api/governance/workspaces/:id/export  — JSONL export (EU AI Act Art.12)
//
//   Plans: team (€99/mo · 5 seats · 90d retention)
//          business (€499/mo · 25 seats · 365d retention)
//          enterprise (sales · unlimited · 7y retention + DPA)
//
//   Authorization model:
//     • workspace creation / admin endpoints — X-Admin-Token
//     • event ingestion                      — X-API-Key with governance:write scope
//                                              AND workspace.api_key_id == key.key_id
//     • read/query/export                    — X-Workspace-Token (HMAC of workspace_id)
//       (member tokens are issued at create time; rotated via admin endpoint)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../models/db');
const { hashKey } = require('../middleware/api-tier');

const router = express.Router();

const PLAN_DEFAULTS = {
  team:       { max_members: 5,  retention_days: 90,  max_events_per_month: 100_000 },
  business:   { max_members: 25, retention_days: 365, max_events_per_month: 2_000_000 },
  enterprise: { max_members: 500,retention_days: 2555,max_events_per_month: 1_000_000_000 }
};
const EVENT_TYPES = new Set(['refusal','approval','override','policy','audit','custom']);
const SEVERITIES  = new Set(['info','low','medium','high','critical']);

function adminGate(req, res, next) {
  const expected = process.env.WAB_GOVERNANCE_ADMIN_TOKEN || process.env.WAB_RING4_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  if ((req.headers['x-admin-token'] || '') !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function wsTokenSecret() { return process.env.WAB_WORKSPACE_TOKEN_SECRET || 'wab-default-ws-secret-change-me'; }
function signWorkspaceToken(workspace_id) {
  return crypto.createHmac('sha256', wsTokenSecret()).update(workspace_id).digest('base64url');
}
function verifyWorkspaceToken(workspace_id, token) {
  if (!token) return false;
  const expected = signWorkspaceToken(workspace_id);
  const a = Buffer.from(expected); const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function memberGate(req, res, next) {
  const ws = req.params.id;
  const tok = req.headers['x-workspace-token'] || '';
  if (!verifyWorkspaceToken(ws, tok)) return res.status(401).json({ error: 'unauthorized' });
  next();
}

function clip(s, n) { return typeof s === 'string' ? s.slice(0, n) : ''; }

// ─────────────────────────────────────────────────────────────────────────────
router.post('/workspaces', adminGate, (req, res) => {
  const b = req.body || {};
  const display_name = clip(b.display_name, 120);
  const owner_email  = String(b.owner_email || '').toLowerCase().trim();
  const plan = String(b.plan || 'team').toLowerCase();
  const region = String(b.region || 'eu').toLowerCase();
  const api_key_id = b.api_key_id ? String(b.api_key_id) : null;
  if (!display_name || !owner_email) return res.status(400).json({ error: 'display_name + owner_email required' });
  if (!PLAN_DEFAULTS[plan])           return res.status(400).json({ error: 'invalid plan' });

  if (api_key_id) {
    const k = db.prepare(`SELECT scopes, status FROM wab_api_keys WHERE key_id = ?`).get(api_key_id);
    if (!k || k.status !== 'active') return res.status(400).json({ error: 'api_key_invalid' });
    try {
      const sc = JSON.parse(k.scopes);
      if (!sc.includes('governance:write')) return res.status(400).json({ error: 'api_key_missing_scope', required: 'governance:write' });
    } catch { return res.status(400).json({ error: 'api_key_scopes_invalid' }); }
  }

  const d = PLAN_DEFAULTS[plan];
  const workspace_id = 'ws_' + crypto.randomBytes(9).toString('base64url');
  try {
    db.prepare(`
      INSERT INTO wab_governance_workspaces (workspace_id, display_name, plan, owner_email, retention_days, max_members, max_events_per_month, api_key_id, region)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspace_id, display_name, plan, owner_email, d.retention_days, d.max_members, d.max_events_per_month, api_key_id, region);
    db.prepare(`INSERT INTO wab_governance_members (workspace_id, email, role, accepted_at) VALUES (?, ?, 'owner', datetime('now'))`).run(workspace_id, owner_email);
  } catch (e) { return res.status(500).json({ error: 'create_failed', detail: e.message }); }

  res.json({
    ok: true,
    workspace_id,
    plan,
    workspace_token: signWorkspaceToken(workspace_id),
    notice: 'Store the workspace_token now — it grants read access to the audit log.'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
router.get('/workspaces/:id', memberGate, (req, res) => {
  const row = db.prepare(`SELECT workspace_id, display_name, plan, status, region, retention_days, max_members, max_events_per_month, created_at FROM wab_governance_workspaces WHERE workspace_id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const members = db.prepare(`SELECT email, role, accepted_at FROM wab_governance_members WHERE workspace_id = ? ORDER BY role`).all(req.params.id);
  const month = new Date().toISOString().slice(0,7);
  const counts = db.prepare(`SELECT COUNT(*) AS n FROM wab_governance_events WHERE workspace_id = ? AND created_at >= ?`).get(req.params.id, month + '-01');
  res.json({ ...row, members, events_this_month: counts.n });
});

// ─────────────────────────────────────────────────────────────────────────────
router.post('/workspaces/:id/members', memberGate, (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').toLowerCase().trim();
  const role  = String(b.role  || 'viewer').toLowerCase();
  if (!email || !['admin','reviewer','viewer'].includes(role)) return res.status(400).json({ error: 'email + valid role required' });
  const ws = db.prepare(`SELECT max_members FROM wab_governance_workspaces WHERE workspace_id = ?`).get(req.params.id);
  if (!ws) return res.status(404).json({ error: 'workspace_not_found' });
  const count = db.prepare(`SELECT COUNT(*) AS n FROM wab_governance_members WHERE workspace_id = ?`).get(req.params.id);
  if (count.n >= ws.max_members) return res.status(409).json({ error: 'seat_limit_reached', max: ws.max_members });
  try {
    db.prepare(`INSERT INTO wab_governance_members (workspace_id, email, role) VALUES (?, ?, ?)`).run(req.params.id, email, role);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return res.status(409).json({ error: 'already_member' });
    return res.status(500).json({ error: 'add_failed' });
  }
  res.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Event ingestion — API-key gated; key must match workspace.api_key_id
router.post('/workspaces/:id/events', (req, res) => {
  const secret = (req.headers['x-api-key'] || '').toString();
  if (!secret) return res.status(401).json({ error: 'missing X-API-Key' });
  const k = db.prepare(`SELECT key_id, scopes, status FROM wab_api_keys WHERE key_hash = ?`).get(hashKey(secret));
  if (!k || k.status !== 'active') return res.status(401).json({ error: 'invalid_api_key' });
  try {
    const sc = JSON.parse(k.scopes);
    if (!sc.includes('governance:write')) return res.status(403).json({ error: 'scope_required', required: 'governance:write' });
  } catch { return res.status(403).json({ error: 'scope_invalid' }); }

  const ws = db.prepare(`SELECT api_key_id, max_events_per_month, status FROM wab_governance_workspaces WHERE workspace_id = ?`).get(req.params.id);
  if (!ws) return res.status(404).json({ error: 'workspace_not_found' });
  if (ws.status !== 'active') return res.status(403).json({ error: 'workspace_' + ws.status });
  if (ws.api_key_id && ws.api_key_id !== k.key_id) return res.status(403).json({ error: 'api_key_not_bound_to_workspace' });

  const month = new Date().toISOString().slice(0,7);
  const cnt = db.prepare(`SELECT COUNT(*) AS n FROM wab_governance_events WHERE workspace_id = ? AND created_at >= ?`).get(req.params.id, month + '-01');
  if (cnt.n >= ws.max_events_per_month) return res.status(402).json({ error: 'event_quota_exceeded', limit: ws.max_events_per_month });

  const b = req.body || {};
  const event_type = String(b.event_type || '').toLowerCase();
  const severity   = String(b.severity   || 'info').toLowerCase();
  if (!EVENT_TYPES.has(event_type)) return res.status(400).json({ error: 'invalid event_type' });
  if (!SEVERITIES.has(severity))    return res.status(400).json({ error: 'invalid severity' });

  const event_id = 'ev_' + crypto.randomBytes(10).toString('base64url');
  try {
    db.prepare(`
      INSERT INTO wab_governance_events (event_id, workspace_id, source, event_type, severity, subject, article, outcome, detail, signature, signed_by_pk)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event_id, req.params.id,
      clip(b.source, 120) || 'unknown',
      event_type, severity,
      clip(b.subject, 200),
      clip(b.article, 60),
      clip(b.outcome, 40),
      clip(typeof b.detail === 'string' ? b.detail : JSON.stringify(b.detail || {}), 8000),
      clip(b.signature, 200),
      clip(b.signed_by_pk, 200)
    );
  } catch (e) { return res.status(500).json({ error: 'ingest_failed', detail: e.message }); }

  res.json({ ok: true, event_id });
});

// ─────────────────────────────────────────────────────────────────────────────
router.get('/workspaces/:id/events', memberGate, (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 100));
  const event_type = req.query.event_type && EVENT_TYPES.has(String(req.query.event_type)) ? String(req.query.event_type) : null;
  const sql = event_type
    ? `SELECT event_id, source, event_type, severity, subject, article, outcome, created_at FROM wab_governance_events WHERE workspace_id = ? AND event_type = ? ORDER BY id DESC LIMIT ?`
    : `SELECT event_id, source, event_type, severity, subject, article, outcome, created_at FROM wab_governance_events WHERE workspace_id = ? ORDER BY id DESC LIMIT ?`;
  const rows = event_type ? db.prepare(sql).all(req.params.id, event_type, limit) : db.prepare(sql).all(req.params.id, limit);
  res.json({ events: rows, total: rows.length });
});

// JSONL export — auditor-friendly, EU AI Act Article 12
router.get('/workspaces/:id/export', memberGate, (req, res) => {
  const rows = db.prepare(`SELECT event_id, source, event_type, severity, subject, article, outcome, detail, signature, signed_by_pk, created_at FROM wab_governance_events WHERE workspace_id = ? ORDER BY id ASC LIMIT 100000`).all(req.params.id);
  res.set('Content-Type', 'application/x-ndjson');
  res.set('Content-Disposition', `attachment; filename="wab-governance-${req.params.id}.jsonl"`);
  for (const r of rows) res.write(JSON.stringify(r) + '\n');
  res.end();
});

module.exports = router;
