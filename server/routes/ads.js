const express = require('express');
const router = express.Router();
const crypto = require('crypto');
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

// ─── Public Routes ────────────────────────────────────────────────────

// GET /api/ads/active — returns active approved ads for browser
router.get('/active', (req, res) => {
  const position = req.query.position || null;
  const ads = getActiveAds(position);
  res.json(ads);
});

// POST /api/ads/impression — record ad impression
router.post('/impression', (req, res) => {
  const { adId } = req.body;
  if (!adId) return res.status(400).json({ error: 'adId required' });
  const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
  recordAdEvent(adId, 'impression', ipHash);
  res.json({ ok: true });
});

// POST /api/ads/click — record ad click
router.post('/click', (req, res) => {
  const { adId } = req.body;
  if (!adId) return res.status(400).json({ error: 'adId required' });
  const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
  recordAdEvent(adId, 'click', ipHash);
  res.json({ ok: true });
});

// POST /api/ads/submit — public ad submission (advertiser applies)
router.post('/submit', (req, res) => {
  const { title, description, imageUrl, targetUrl, advertiserName, advertiserEmail, position, budget, costPerClick, costPerImpression, expiresAt } = req.body;
  if (!title || !targetUrl || !advertiserName || !advertiserEmail) {
    return res.status(400).json({ error: 'title, targetUrl, advertiserName, advertiserEmail required' });
  }
  // Basic URL validation
  try { new URL(targetUrl); } catch { return res.status(400).json({ error: 'Invalid targetUrl' }); }
  if (imageUrl) { try { new URL(imageUrl); } catch { return res.status(400).json({ error: 'Invalid imageUrl' }); } }

  const ad = submitAd({ title, description, imageUrl, targetUrl, advertiserName, advertiserEmail, position, budget, costPerClick, costPerImpression, expiresAt });
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
