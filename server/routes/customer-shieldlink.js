/**
 * Customer ShieldLink — issuer-side endpoints (premium plan required).
 * Mounted at /api/customer/shieldlink, behind authenticateToken.
 *
 *   POST   /sites/:siteId/brand            Apply for a verified brand (queue)
 *   GET    /sites/:siteId/brand            Get this site's brand record
 *   POST   /sites/:siteId/brand/check      Pre-check display name similarity
 *   POST   /sites/:siteId/sign             Sign a new link
 *   GET    /sites/:siteId/links            List links for a site
 *   POST   /sites/:siteId/links/:id/revoke Revoke a link
 *   POST   /sites/:siteId/keys/rotate      Rotate signing key (manual)
 *
 * Plan gating: tier must be `pro` or `enterprise`.
 */
'use strict';

const express = require('express');
const Database = require('better-sqlite3');
const path = require('path');
const { authenticateToken } = require('../middleware/auth');
const { hasFeature } = require('../config/plans');
const sl = require('../services/shieldlink');

const router = express.Router();

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : (process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data'));
const DB_FILE = process.env.NODE_ENV === 'test' ? `wab-test-${process.env.JEST_WORKER_ID || '1'}.db` : 'wab.db';
let _db = null;
function db() { if (!_db) _db = new Database(path.join(DATA_DIR, DB_FILE)); return _db; }

router.use(authenticateToken);

// Look up the site, ensure user owns it, and ensure the tier supports ShieldLink.
function loadSiteAndGate(req, res, next) {
  const siteId = req.params.siteId;
  const site = db().prepare(`SELECT id, user_id, domain, tier, name FROM sites WHERE id = ?`).get(siteId);
  if (!site) return res.status(404).json({ error: 'site_not_found' });
  if (String(site.user_id) !== String(req.user.id)) return res.status(403).json({ error: 'not_site_owner' });
  if (!hasFeature(site.tier, 'shieldlink')) {
    return res.status(402).json({
      error: 'plan_upgrade_required',
      feature: 'shieldlink',
      current_tier: site.tier,
      upgrade_to: ['pro', 'enterprise'],
    });
  }
  req.site = site;
  next();
}

// ─── Brand ──────────────────────────────────────────────────────────

router.get('/sites/:siteId/brand', loadSiteAndGate, (req, res) => {
  const brand = sl.getBrandBySite(req.site.id);
  if (!brand) return res.status(404).json({ error: 'brand_not_registered' });
  // Don't leak internal review notes to customer.
  const { notes, ...safe } = brand;
  res.json({ brand: safe });
});

router.post('/sites/:siteId/brand/check', loadSiteAndGate, express.json({ limit: '4kb' }), (req, res) => {
  const name = String((req.body && req.body.display_name) || '').trim();
  if (!name) return res.status(400).json({ error: 'display_name required' });
  res.json(sl.checkBrandSimilarity(name, req.site.domain));
});

router.post('/sites/:siteId/brand', loadSiteAndGate, express.json({ limit: '8kb' }), (req, res) => {
  const body = req.body || {};
  const r = sl.submitBrand({
    siteId: req.site.id,
    domain: req.site.domain,
    displayName: String(body.display_name || '').trim(),
    category: body.category || null,
    country: body.country || null,
    logoUrl: body.logo_url || null,
  });
  if (!r.ok) return res.status(400).json(r);
  res.status(201).json(r);
});

// ─── Sign ───────────────────────────────────────────────────────────

router.post('/sites/:siteId/sign', loadSiteAndGate, express.json({ limit: '16kb' }), (req, res) => {
  const body = req.body || {};
  const r = sl.signLink({
    siteId: req.site.id,
    purpose: body.purpose,
    targetUrl: body.target_url,
    amountCents: body.amount_cents,
    currency: body.currency,
    payeeName: body.payee_name,
    reference: body.reference,
    expiresInSec: body.expires_in_sec,
    createdBy: String(req.user.id),
  });
  if (!r.ok) return res.status(400).json(r);
  res.status(201).json(r);
});

// ─── Links ──────────────────────────────────────────────────────────

router.get('/sites/:siteId/links', loadSiteAndGate, (req, res) => {
  res.json({ links: sl.listLinksForSite(req.site.id, { limit: req.query.limit, status: req.query.status }) });
});

router.post('/sites/:siteId/links/:id/revoke', loadSiteAndGate, express.json({ limit: '4kb' }), (req, res) => {
  const linkId = parseInt(req.params.id, 10);
  if (!Number.isFinite(linkId)) return res.status(400).json({ error: 'bad_id' });
  const link = db().prepare(`SELECT id, site_id FROM shieldlink_links WHERE id = ?`).get(linkId);
  if (!link || String(link.site_id) !== String(req.site.id)) return res.status(404).json({ error: 'link_not_found' });
  sl.revokeLink(linkId, (req.body && req.body.reason) || 'owner_revoked');
  res.json({ ok: true });
});

// ─── Keys ───────────────────────────────────────────────────────────

router.post('/sites/:siteId/keys/rotate', loadSiteAndGate, (req, res) => {
  const brand = sl.getBrandBySite(req.site.id);
  if (!brand) return res.status(404).json({ error: 'brand_not_registered' });
  const k = sl.rotateKey(brand.id);
  res.json({ ok: true, fingerprint: k.fingerprint, public_key: k.public_key });
});

router.get('/sites/:siteId/keys', loadSiteAndGate, (req, res) => {
  const brand = sl.getBrandBySite(req.site.id);
  if (!brand) return res.status(404).json({ error: 'brand_not_registered' });
  const k = sl.getOrCreateActiveKey(brand.id);
  res.json({ active: { fingerprint: k.fingerprint, public_key: k.public_key, created_at: k.created_at } });
});

module.exports = router;
