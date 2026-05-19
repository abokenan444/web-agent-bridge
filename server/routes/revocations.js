/**
 * Site Revocations API (v3.11.0)
 *
 *   • Public  — anyone can read the transparency log + check a domain's status.
 *   • Owner   — site owners can self-disable, reinstate their own disable,
 *               and submit appeals against suspensions / revocations.
 *   • Admin   — open suspensions/revocations, decide appeals, manual reinstate.
 */

'use strict';

const express = require('express');
const router = express.Router();

const { authenticateToken } = require('../middleware/auth');
const { authenticateAdmin } = require('../middleware/adminAuth');
const { db } = require('../models/db');
const rev = require('../services/revocations');

function _handle(res, fn) {
  try {
    const out = fn();
    res.json({ ok: true, data: out });
  } catch (e) {
    const status = e.statusCode || 500;
    res.status(status).json({ ok: false, error: e.code || 'internal_error', message: e.message });
  }
}

// ─── PUBLIC ──────────────────────────────────────────────────────────────────

/** GET /api/revocations/transparency  — public log */
router.get('/transparency', (req, res) => {
  _handle(res, () => rev.listPublic({
    limit: parseInt(req.query.limit, 10) || 50,
    offset: parseInt(req.query.offset, 10) || 0,
  }));
});

/** GET /api/revocations/status?domain=example.com  — public per-domain status */
router.get('/status', (req, res) => {
  const domain = String(req.query.domain || '').trim().toLowerCase();
  if (!domain) return res.status(400).json({ ok: false, error: 'domain required' });
  const r = rev.getActiveByDomain(domain);
  res.json({
    ok: true,
    data: {
      domain,
      revoked: !!r,
      revocation: r ? {
        id: r.id,
        type: r.type,
        reason_code: r.reason_code,
        reason_text: r.reason_text,
        evidence_url: r.evidence_url,
        decided_at: r.decided_at,
        appeal_deadline: r.appeal_deadline,
        status: r.status,
      } : null,
    },
  });
});

// ─── OWNER (authenticated user) ──────────────────────────────────────────────

/** POST /api/revocations/sites/:siteId/disable  — owner self-disable */
router.post('/sites/:siteId/disable', authenticateToken, express.json({ limit: '8kb' }), (req, res) => {
  _handle(res, () => {
    const site = db.prepare(`SELECT * FROM sites WHERE id = ?`).get(req.params.siteId);
    if (!site) { const e = new Error('site not found'); e.statusCode = 404; e.code = 'not_found'; throw e; }
    if (site.user_id !== req.user.id) {
      const e = new Error('forbidden'); e.statusCode = 403; e.code = 'forbidden'; throw e;
    }
    return rev.openRevocation({
      siteId: site.id,
      type: 'owner_disable',
      reasonCode: 'owner_request',
      reasonText: (req.body.reason_text && String(req.body.reason_text).trim())
        || 'Owner requested self-disable.',
      decidedBy: `owner:${req.user.id}`,
    });
  });
});

/** POST /api/revocations/:id/appeal  — owner appeal */
router.post('/:id/appeal', authenticateToken, express.json({ limit: '32kb' }), (req, res) => {
  _handle(res, () => rev.submitAppeal({
    revocationId: req.params.id,
    ownerUserId: req.user.id,
    statement: String(req.body.statement || ''),
    remediationProof: req.body.remediation_proof || null,
  }));
});

/** POST /api/revocations/:id/reinstate  — owner re-enables their own disable */
router.post('/:id/reinstate', authenticateToken, express.json({ limit: '4kb' }), (req, res) => {
  _handle(res, () => {
    const r = rev.getById(req.params.id);
    if (!r) { const e = new Error('not found'); e.statusCode = 404; e.code = 'not_found'; throw e; }
    if (r.type !== 'owner_disable') {
      const e = new Error('only owner_disable can be self-reinstated'); e.statusCode = 403; e.code = 'forbidden'; throw e;
    }
    const site = db.prepare(`SELECT * FROM sites WHERE id = ?`).get(r.site_id);
    if (!site || site.user_id !== req.user.id) {
      const e = new Error('forbidden'); e.statusCode = 403; e.code = 'forbidden'; throw e;
    }
    return rev.reinstate({
      revocationId: r.id, actorId: req.user.id, actorType: 'user',
      reason: req.body.reason || 'owner_reinstated',
    });
  });
});

/** GET /api/revocations/:id  — owner/admin can view */
router.get('/:id', authenticateToken, (req, res) => {
  const r = rev.getById(req.params.id);
  if (!r) return res.status(404).json({ ok: false, error: 'not_found' });
  const site = db.prepare(`SELECT user_id FROM sites WHERE id = ?`).get(r.site_id);
  if (!site || site.user_id !== req.user.id) {
    return res.status(403).json({ ok: false, error: 'forbidden' });
  }
  res.json({ ok: true, data: { ...r, appeal: rev.getAppeal(r.id) } });
});

// ─── ADMIN ───────────────────────────────────────────────────────────────────

/** GET /api/revocations/admin/list  */
router.get('/admin/list', authenticateAdmin, (req, res) => {
  _handle(res, () => rev.listAdmin({
    status: req.query.status || undefined,
    type: req.query.type || undefined,
    limit: parseInt(req.query.limit, 10) || 100,
    offset: parseInt(req.query.offset, 10) || 0,
  }));
});

/** POST /api/revocations/admin/open  */
router.post('/admin/open', authenticateAdmin, express.json({ limit: '16kb' }), (req, res) => {
  _handle(res, () => {
    const b = req.body || {};
    let siteId = b.site_id;
    if (!siteId && b.domain) {
      const site = db.prepare(`SELECT id FROM sites WHERE domain = ? LIMIT 1`).get(String(b.domain).toLowerCase());
      siteId = site ? site.id : null;
    }
    if (!siteId) { const e = new Error('site_id or domain required'); e.statusCode = 400; e.code = 'bad_request'; throw e; }
    return rev.openRevocation({
      siteId,
      type: b.type || 'suspended',
      reasonCode: b.reason_code,
      reasonText: b.reason_text,
      evidenceUrl: b.evidence_url || null,
      decidedBy: `admin:${req.admin.id}`,
    });
  });
});

/** POST /api/revocations/admin/:id/decide  — decide an appeal */
router.post('/admin/:id/decide', authenticateAdmin, express.json({ limit: '8kb' }), (req, res) => {
  _handle(res, () => rev.decideAppeal({
    revocationId: req.params.id,
    decision: req.body.decision,
    decisionReason: req.body.decision_reason || null,
    adminId: req.admin.id,
  }));
});

/** POST /api/revocations/admin/:id/reinstate  — manual reinstate */
router.post('/admin/:id/reinstate', authenticateAdmin, express.json({ limit: '4kb' }), (req, res) => {
  _handle(res, () => rev.reinstate({
    revocationId: req.params.id,
    actorId: req.admin.id,
    actorType: 'admin',
    reason: req.body.reason || null,
  }));
});

/** POST /api/revocations/admin/sweep  — manually trigger expired-appeal sweep */
router.post('/admin/sweep', authenticateAdmin, (req, res) => {
  _handle(res, () => ({ swept: rev.sweepExpired() }));
});

module.exports = router;
