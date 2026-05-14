// ═══════════════════════════════════════════════════════════════════════════
// WAB Certified Partner Program
//
//   POST   /api/partners/apply         — self-serve application (any tier)
//   GET    /api/partners               — public directory (approved partners)
//   GET    /api/partners/:partner_id   — public partner profile (badge data)
//   GET    /api/partners/badge/:token  — embeddable SVG badge
//   GET    /api/partners/admin/applications  — admin list (token-gated)
//   POST   /api/partners/admin/approve       — admin decision
//
//   Tiers:
//     basic     — €0   — auto-approved if Ring4 status + DNS look healthy
//     verified  — €499 — manual review, requires handshake ≥ 9/9
//     premium   — €2.9k+/yr — manual review + DPA, sales motion
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../models/db');

const router = express.Router();

const DOMAIN_RE  = /^[a-z0-9.-]{3,253}$/i;
const SLUG_RE    = /^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/;
const EMAIL_RE   = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIER_SET   = new Set(['basic', 'verified', 'premium']);
const CAT_SET    = new Set(['bank','fintech','ecommerce','messaging','healthcare','government','media','saas','telecom','other']);

function slug(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}
function hashIp(ip) {
  return crypto.createHash('sha256').update(String(ip || '') + (process.env.IP_HASH_SALT || 'wab-default-salt')).digest('hex').slice(0, 32);
}
function clip(s, n = 2000) { return typeof s === 'string' ? s.slice(0, n) : ''; }

function adminGate(req, res, next) {
  const expected = process.env.WAB_PARTNERS_ADMIN_TOKEN || process.env.WAB_RING4_ADMIN_TOKEN;
  if (!expected) return res.status(503).json({ error: 'admin_disabled' });
  const presented = req.headers['x-admin-token'] || '';
  if (presented !== expected) return res.status(401).json({ error: 'unauthorized' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /apply
router.post('/apply', (req, res) => {
  const b = req.body || {};
  const display_name = clip(b.display_name, 120);
  const domain = String(b.domain || '').toLowerCase().trim();
  const contact_email = String(b.contact_email || '').toLowerCase().trim();
  const contact_name = clip(b.contact_name, 120);
  const requested_tier = String(b.requested_tier || 'basic').toLowerCase();
  const country = clip(b.country, 4);
  const category = String(b.category || 'other').toLowerCase();
  const website  = clip(b.website, 200);
  const use_case = clip(b.use_case, 1000);
  const handshake_score = Math.max(0, Math.min(9, parseInt(b.handshake_score, 10) || 0));

  if (!display_name)               return res.status(400).json({ error: 'display_name required' });
  if (!DOMAIN_RE.test(domain))     return res.status(400).json({ error: 'invalid domain' });
  if (!EMAIL_RE.test(contact_email)) return res.status(400).json({ error: 'invalid contact_email' });
  if (!TIER_SET.has(requested_tier)) return res.status(400).json({ error: 'invalid requested_tier' });
  if (!CAT_SET.has(category))      return res.status(400).json({ error: 'invalid category' });

  // Snapshot Ring 4 status if available
  let ring4_status = null;
  try {
    const r = db.prepare(`SELECT trust_score, expires_at FROM ring4_trust_profiles WHERE domain = ?`).get(domain);
    if (r) ring4_status = JSON.stringify(r);
  } catch { /* table might not exist in some test envs */ }

  const application_id = 'app_' + crypto.randomBytes(9).toString('base64url');
  try {
    db.prepare(`
      INSERT INTO wab_partner_applications
        (application_id, display_name, domain, requested_tier, contact_email, contact_name, country, category, website, use_case, ring4_status, handshake_score, ip_hash, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(application_id, display_name, domain, requested_tier, contact_email, contact_name, country, category, website, use_case, ring4_status, handshake_score, hashIp(req.ip), clip(req.headers['user-agent'], 200));
  } catch (e) {
    return res.status(500).json({ error: 'apply_failed', detail: e.message });
  }

  // Auto-approval rule for Basic tier when handshake_score ≥ 8 AND Ring 4 status known.
  let auto_approved = false;
  let partner_id = null;
  if (requested_tier === 'basic' && handshake_score >= 8 && ring4_status) {
    partner_id = slug(display_name) || ('partner-' + crypto.randomBytes(3).toString('hex'));
    const badge_token = crypto.randomBytes(18).toString('base64url');
    try {
      db.prepare(`
        INSERT INTO wab_partners (partner_id, display_name, domain, tier, status, contact_email, country, category, website, badge_token, approved_at, approved_by)
        VALUES (?, ?, ?, 'basic', 'active', ?, ?, ?, ?, ?, datetime('now'), 'auto')
        ON CONFLICT(partner_id) DO UPDATE SET
          display_name=excluded.display_name, domain=excluded.domain,
          contact_email=excluded.contact_email, updated_at=datetime('now')
      `).run(partner_id, display_name, domain, contact_email, country, category, website, badge_token);
      db.prepare(`UPDATE wab_partner_applications SET status='approved', decided_at=datetime('now'), decided_by='auto' WHERE application_id = ?`).run(application_id);
      auto_approved = true;
    } catch (e) {
      // Race / unique constraint — surface but keep application
      return res.status(202).json({ ok: true, application_id, auto_approved: false, note: 'queued (slug collision)' });
    }
  }

  return res.status(200).json({
    ok: true,
    application_id,
    requested_tier,
    auto_approved,
    partner_id,
    next_steps: auto_approved
      ? { badge_endpoint: `/api/partners/badge/${partner_id}.svg`, listing: `/api/partners/${partner_id}` }
      : { eta_hours: requested_tier === 'verified' ? 72 : 168, contact: 'partners@webagentbridge.com' }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET / — public directory
router.get('/', (req, res) => {
  const tier = req.query.tier && TIER_SET.has(String(req.query.tier)) ? String(req.query.tier) : null;
  let rows;
  try {
    if (tier) {
      rows = db.prepare(`SELECT partner_id, display_name, domain, tier, country, category, website, approved_at FROM wab_partners WHERE status='active' AND tier=? ORDER BY approved_at DESC`).all(tier);
    } else {
      rows = db.prepare(`SELECT partner_id, display_name, domain, tier, country, category, website, approved_at FROM wab_partners WHERE status='active' ORDER BY tier DESC, approved_at DESC`).all();
    }
  } catch (e) { return res.status(503).json({ error: 'directory_unavailable' }); }
  res.json({ partners: rows, total: rows.length });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:partner_id
router.get('/:partner_id([a-z0-9-]{3,42})', (req, res) => {
  const row = db.prepare(`SELECT partner_id, display_name, domain, tier, status, country, category, website, approved_at FROM wab_partners WHERE partner_id = ? AND status='active'`).get(req.params.partner_id);
  if (!row) return res.status(404).json({ error: 'partner_not_found' });
  res.json(row);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /badge/:slug.svg — embeddable SVG (tier-coloured)
router.get('/badge/:slug([a-z0-9-]{3,42}\\.svg)', (req, res) => {
  const partner_id = req.params.slug.replace(/\.svg$/, '');
  const row = db.prepare(`SELECT tier, display_name FROM wab_partners WHERE partner_id = ? AND status='active'`).get(partner_id);
  if (!row) return res.status(404).type('text/plain').send('not found');
  const color = row.tier === 'premium' ? '#7c3aed' : row.tier === 'verified' ? '#0ea5e9' : '#10b981';
  const label = row.tier === 'premium' ? 'WAB Certified Partner' : row.tier === 'verified' ? 'WAB Verified' : 'WAB Compatible';
  const safe = String(row.display_name).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="48" role="img" aria-label="${label}: ${safe}">
  <rect width="240" height="48" rx="6" fill="${color}"/>
  <text x="12" y="20" font-family="Inter,system-ui,sans-serif" font-size="11" fill="#fff" font-weight="700">${label}</text>
  <text x="12" y="38" font-family="Inter,system-ui,sans-serif" font-size="13" fill="#fff">${safe}</text>
</svg>`;
  res.set('Cache-Control', 'public, max-age=3600');
  res.type('image/svg+xml').send(svg);
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin — list pending applications
router.get('/admin/applications', adminGate, (req, res) => {
  const status = String(req.query.status || 'pending');
  if (!['pending','approved','rejected','withdrawn'].includes(status)) return res.status(400).json({ error: 'invalid status' });
  const rows = db.prepare(`SELECT application_id, display_name, domain, requested_tier, contact_email, country, category, handshake_score, status, created_at FROM wab_partner_applications WHERE status = ? ORDER BY created_at DESC LIMIT 200`).all(status);
  res.json({ applications: rows });
});

// Admin — approve / reject
router.post('/admin/approve', adminGate, (req, res) => {
  const { application_id, decision, notes, override_tier } = req.body || {};
  if (!application_id || !['approve','reject'].includes(decision)) return res.status(400).json({ error: 'application_id + decision required' });
  const app = db.prepare(`SELECT * FROM wab_partner_applications WHERE application_id = ?`).get(application_id);
  if (!app) return res.status(404).json({ error: 'application_not_found' });
  if (app.status !== 'pending') return res.status(409).json({ error: 'already_' + app.status });

  if (decision === 'reject') {
    db.prepare(`UPDATE wab_partner_applications SET status='rejected', decision_notes=?, decided_at=datetime('now'), decided_by='admin' WHERE application_id=?`).run(clip(notes, 500), application_id);
    return res.json({ ok: true, application_id, status: 'rejected' });
  }

  const tier = TIER_SET.has(String(override_tier || '').toLowerCase()) ? String(override_tier).toLowerCase() : app.requested_tier;
  const partner_id = slug(app.display_name) || ('partner-' + crypto.randomBytes(3).toString('hex'));
  const badge_token = crypto.randomBytes(18).toString('base64url');
  try {
    db.prepare(`
      INSERT INTO wab_partners (partner_id, display_name, domain, tier, status, contact_email, country, category, website, badge_token, approved_at, approved_by, notes)
      VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, datetime('now'), 'admin', ?)
      ON CONFLICT(partner_id) DO UPDATE SET
        tier=excluded.tier, status='active', updated_at=datetime('now')
    `).run(partner_id, app.display_name, app.domain, tier, app.contact_email, app.country, app.category, app.website, badge_token, clip(notes, 500));
    db.prepare(`UPDATE wab_partner_applications SET status='approved', decision_notes=?, decided_at=datetime('now'), decided_by='admin' WHERE application_id=?`).run(clip(notes, 500), application_id);
  } catch (e) {
    return res.status(500).json({ error: 'approve_failed', detail: e.message });
  }
  res.json({ ok: true, application_id, partner_id, tier, status: 'approved' });
});

module.exports = router;
