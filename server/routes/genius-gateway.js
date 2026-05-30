/**
 * Genius Platform Payment Gateway
 *
 * Exposes WAB's existing Stripe service to genius-platform over a shared
 * secret. Uses WAB's configured Stripe keys and price IDs — no separate
 * Stripe account or duplicated logic required.
 *
 * Endpoints (prefix: /api/genius):
 *   POST /checkout          → create Stripe Checkout session for a genius org
 *   POST /portal            → create Customer Portal session for a genius org
 *
 * Stripe Webhook:
 *   Use the EXISTING WAB webhook:  POST /api/billing/webhook
 *   Same STRIPE_WEBHOOK_SECRET — no separate endpoint or secret needed.
 *   Events tagged with genius_org_id in metadata are automatically forwarded
 *   to genius-platform's /api/wab/billing-callback by stripe.js.
 *
 * Auth: X-Internal-Secret header must match GENIUS_BRIDGE_SECRET env var.
 * All endpoints are reachable only from localhost (blocked by nginx for external).
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ── Use WAB's existing Stripe service — single Stripe account for everything ──
// Note: customer storage stays in genius-platform's own DB (no WAB DB foreign key needed)
const { getStripe, getStripePrices, isStripeConfigured } = require('../services/stripe');

// ── Auth middleware — shared secret ──────────────────────────────────────────
function requireInternalSecret(req, res, next) {
  const secret = process.env.GENIUS_BRIDGE_SECRET;
  if (!secret) return res.status(503).json({ error: 'GENIUS_BRIDGE_SECRET not configured on WAB' });
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ── Resolve price ID for genius tiers ─────────────────────────────────────────
// Priority: STRIPE_GENIUS_PRICE_<TIER> → WAB's existing prices → null
function resolveGeniusPrice(tier) {
  const t = String(tier || '').toUpperCase();
  // Genius-specific override (optional)
  const override = process.env[`STRIPE_GENIUS_PRICE_${t}`];
  if (override) return override;
  // Fall back to WAB's own price IDs (same products, shared account)
  const prices = getStripePrices();
  return prices[t.toLowerCase()] || null;
}

// ── POST /checkout ────────────────────────────────────────────────────────────
router.post('/checkout', requireInternalSecret, express.json(), async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured on this server' });
  }

  const { orgId, userId, email, name, tier, existingCustomerId } = req.body || {};
  if (!orgId || !tier || !email) {
    return res.status(400).json({ error: 'orgId, tier, and email are required' });
  }

  const priceId = resolveGeniusPrice(tier);
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price configured for tier: ${tier}` });
  }

  try {
    const s = getStripe();

    // genius-platform stores and passes back its own Stripe customer ID
    let stripeCustomerId = existingCustomerId || null;

    if (!stripeCustomerId) {
      const stripeCustomer = await s.customers.create({
        email,
        name: name || email,
        metadata: { genius_org_id: orgId, source: 'thecodegenius' }
      });
      stripeCustomerId = stripeCustomer.id;
    }

    const appUrl  = process.env.GENIUS_APP_URL || 'https://thecodegenius.com';
    const session = await s.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { genius_org_id: orgId, genius_user_id: userId || '', tier },
      success_url: `${appUrl}/dashboard/user/billing?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${appUrl}/pricing?canceled=1`,
    });

    // Return customerId so genius-platform can persist it in its own DB
    res.json({ sessionId: session.id, url: session.url, customerId: stripeCustomerId });
  } catch (err) {
    console.error('[genius-gateway] checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /portal ──────────────────────────────────────────────────────────────
router.post('/portal', requireInternalSecret, express.json(), async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ error: 'Stripe not configured on this server' });
  }

  const { orgId, customerId } = req.body || {};
  if (!orgId && !customerId) {
    return res.status(400).json({ error: 'orgId or customerId is required' });
  }

  try {
    const s = getStripe();

    // genius-platform is expected to pass customerId from its own DB
    let stripeCustomerId = customerId;

    if (!stripeCustomerId) {
      return res.status(404).json({ error: 'No Stripe customer found for this org' });
    }

    const appUrl  = process.env.GENIUS_APP_URL || 'https://thecodegenius.com';
    const session = await s.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: `${appUrl}/dashboard/user/billing`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('[genius-gateway] portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
