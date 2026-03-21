/**
 * Billing Routes (Customer-facing Stripe integration)
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getPlatformSetting } = require('../models/db');
const { createCheckoutSession, createPortalSession, handleWebhookEvent, isStripeConfigured } = require('../services/stripe');

// ─── Create Checkout Session ──────────────────────────────────────────
router.post('/checkout', authenticateToken, async (req, res) => {
  const { siteId, tier } = req.body;
  if (!siteId || !tier) return res.status(400).json({ error: 'siteId and tier required' });
  if (!['starter', 'pro', 'enterprise'].includes(tier)) return res.status(400).json({ error: 'Invalid tier' });

  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  try {
    const session = await createCheckoutSession({ userId: req.user.id, userEmail: req.user.email, siteId, tier });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Customer Portal ──────────────────────────────────────────────────
router.post('/portal', authenticateToken, async (req, res) => {
  try {
    const session = await createPortalSession(req.user.id);
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Stripe Config (public key for frontend) ─────────────────────────
router.get('/config', (req, res) => {
  const publishableKey = getPlatformSetting('stripe_publishable_key');
  res.json({ configured: isStripeConfigured(), publishableKey: publishableKey || null });
});

module.exports = router;
