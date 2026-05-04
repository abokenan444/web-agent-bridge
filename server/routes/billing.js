/**
 * Billing Routes (Customer-facing Stripe integration)
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { getPlatformSetting } = require('../models/db');
const { createCheckoutSession, createPortalSession, isStripeConfigured } = require('../services/stripe');
const plansService = require('../services/plans');

// ─── Create Checkout Session ──────────────────────────────────────────
router.post('/checkout', authenticateToken, async (req, res) => {
  const { siteId, tier, planId } = req.body;
  const planRef = planId || tier;
  if (!siteId || !planRef) return res.status(400).json({ error: 'siteId and planId (or tier) required' });

  // Validate against DB plans first; fall back to legacy tier whitelist if the
  // plans table is not yet populated (e.g. fresh install before migration).
  const dbPlan = plansService.getPlan(planRef);
  if (dbPlan) {
    if (dbPlan.is_archived || dbPlan.cta_type !== 'checkout') {
      return res.status(400).json({ error: 'plan is not purchasable' });
    }
  } else if (!['starter', 'pro', 'business', 'enterprise'].includes(planRef)) {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  try {
    const session = await createCheckoutSession({ userId: req.user.id, userEmail: req.user.email, siteId, tier: planRef, planId: planRef });
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
