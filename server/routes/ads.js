const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { authenticateAdmin } = require('../middleware/adminAuth');
const {
  submitAd,
  getActiveAds,
  getAllAds,
  getPendingAds,
  getAdById,
  updateAdStatus,
  deleteAd,
  recordAdEvent,
  getAdStats
} = require('../models/db');

// ─── Rate Limiters ────────────────────────────────────────────────────
const eventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many ad events, slow down' }
});

const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many ad submissions, try again later' }
});

// ─── Public Routes ────────────────────────────────────────────────────

// GET /api/ads/active — returns active approved ads for browser
router.get('/active', (req, res) => {
  const position = req.query.position || null;
  const ads = getActiveAds(position);
  res.json(ads);
});

// POST /api/ads/impression — record ad impression
router.post('/impression', eventLimiter, (req, res) => {
  const { adId } = req.body;
  if (!adId || typeof adId !== 'string' || adId.length > 50) return res.status(400).json({ error: 'adId required' });
  const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
  recordAdEvent(adId, 'impression', ipHash);
  res.json({ ok: true });
});

// POST /api/ads/click — record ad click
router.post('/click', eventLimiter, (req, res) => {
  const { adId } = req.body;
  if (!adId || typeof adId !== 'string' || adId.length > 50) return res.status(400).json({ error: 'adId required' });
  const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
  recordAdEvent(adId, 'click', ipHash);
  res.json({ ok: true });
});

// POST /api/ads/submit — public ad submission (advertiser applies)
router.post('/submit', submitLimiter, (req, res) => {
  const { title, description, imageUrl, targetUrl, advertiserName, advertiserEmail, position, budgetCents, cpcCents, cpiCents, expiresAt } = req.body;
  if (!title || !targetUrl || !advertiserName || !advertiserEmail) {
    return res.status(400).json({ error: 'title, targetUrl, advertiserName, advertiserEmail required' });
  }
  // Input length validation
  if (title.length > 200 || (description && description.length > 1000) || advertiserName.length > 100 || advertiserEmail.length > 254) {
    return res.status(400).json({ error: 'Field too long' });
  }
  // Email format validation
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(advertiserEmail)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  // URL validation
  try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid targetUrl' }); }
  if (imageUrl) { try { new URL(imageUrl); } catch { return res.status(400).json({ error: 'Invalid imageUrl' }); } }

  const ad = submitAd({ title, description, imageUrl, targetUrl, advertiserName, advertiserEmail, position, budgetCents, cpcCents, cpiCents, expiresAt });
  res.json({ ok: true, ad });
});

// ─── Admin Routes ─────────────────────────────────────────────────────

// GET /api/ads/admin/all — list all ads
router.get('/admin/all', authenticateAdmin, (req, res) => {
  res.json(getAllAds());
});

// GET /api/ads/admin/pending — list pending ads
router.get('/admin/pending', authenticateAdmin, (req, res) => {
  res.json(getPendingAds());
});

// GET /api/ads/admin/stats — ad system stats
router.get('/admin/stats', authenticateAdmin, (req, res) => {
  res.json(getAdStats());
});

// GET /api/ads/admin/:id — single ad details
router.get('/admin/:id', authenticateAdmin, (req, res) => {
  const ad = getAdById(req.params.id);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  res.json(ad);
});

// PUT /api/ads/admin/:id/status — approve/reject/pause
router.put('/admin/:id/status', authenticateAdmin, (req, res) => {
  const { status } = req.body;
  if (!['approved', 'rejected', 'paused', 'expired'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  const ad = getAdById(req.params.id);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  updateAdStatus(req.params.id, status, req.admin.id);
  res.json({ ok: true, status });
});

// DELETE /api/ads/admin/:id — delete ad
router.delete('/admin/:id', authenticateAdmin, (req, res) => {
  const ad = getAdById(req.params.id);
  if (!ad) return res.status(404).json({ error: 'Ad not found' });
  deleteAd(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
