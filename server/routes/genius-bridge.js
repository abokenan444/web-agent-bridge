/**
 * Genius Platform Payment Bridge (v1.0.0)
 *
 * Backend-only proxy — genius-platform sends billing requests here using a
 * shared internal secret. WAB owns the Stripe keys; genius never needs them.
 *
 * Endpoints:
 *   POST /api/genius/checkout       — create Stripe checkout session
 *   POST /api/genius/portal         — create Stripe customer portal session
 *   POST /api/genius/stripe-webhook — Stripe webhook for genius-tagged events
 *
 * WAB env vars required:
 *   GENIUS_BRIDGE_SECRET        — shared secret (also in genius as WAB_GENIUS_SECRET)
 *   GENIUS_APP_URL              — https://thecodegenius.com
 *   GENIUS_CALLBACK_URL         — http://localhost:3004 (internal only)
 *   STRIPE_GENIUS_WEBHOOK_SECRET — separate Stripe webhook secret for this endpoint
 *   STRIPE_GENIUS_PRICE_PRO      — Stripe price ID for genius PRO (falls back to STRIPE_PRICE_PRO)
 *   STRIPE_GENIUS_PRICE_BUSINESS — Stripe price ID for genius BUSINESS (falls back to STRIPE_PRICE_BUSINESS)
 *   STRIPE_GENIUS_PRICE_STARTER  — (optional) Stripe price ID for genius STARTER
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

const BRIDGE_SECRET       = () => process.env.GENIUS_BRIDGE_SECRET;
const GENIUS_APP_URL      = () => process.env.GENIUS_APP_URL      || 'https://thecodegenius.com';
const GENIUS_CALLBACK_URL = () => process.env.GENIUS_CALLBACK_URL || 'http://localhost:3004';

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || key.startsWith('sk_disabled')) return null;
  // Cache the instance to avoid re-init on every request
  if (!getStripe._instance) {
    getStripe._instance = require('stripe')(key);
  }
  return getStripe._instance;
}

// Invalidate cached Stripe instance when key changes (hot reload)
let _lastKey = null;
function stripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key !== _lastKey) { getStripe._instance = null; _lastKey = key; }
  return getStripe();
}

function resolvePriceId(tier) {
  const t = (tier || '').toUpperCase();
  const lookup = {
    STARTER:  process.env.STRIPE_GENIUS_PRICE_STARTER  || process.env.STRIPE_PRICE_STARTER,
    PRO:      process.env.STRIPE_GENIUS_PRICE_PRO      || process.env.STRIPE_PRICE_PRO,
    BUSINESS: process.env.STRIPE_GENIUS_PRICE_BUSINESS || process.env.STRIPE_PRICE_BUSINESS,
  };
  return lookup[t] || null;
}

// Middleware — validate shared internal secret
function bridgeAuth(req, res, next) {
  const secret = BRIDGE_SECRET();
  if (!secret) {
    // Bridge secret not configured → treat as disabled
    return res.status(503).json({ error: 'Genius payment bridge not configured on this server' });
  }
  if (req.headers['x-internal-secret'] !== secret) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

// ── POST /api/genius/checkout ─────────────────────────────────────────────────
router.post('/checkout', bridgeAuth, express.json({ limit: '8kb' }), async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Stripe not configured on this server' });

  const { orgId, userId, email, name, tier, existingCustomerId } = req.body;

  if (!orgId || !tier || !email) {
    return res.status(400).json({ error: 'orgId, tier, and email are required' });
  }

  const priceId = resolvePriceId(tier);
  if (!priceId) {
    return res.status(400).json({ error: `No Stripe price ID configured for tier: ${tier}` });
  }

  try {
    // Re-use existing customer or create a new one
    let customerId = existingCustomerId || null;
    if (!customerId) {
      const customer = await s.customers.create({
        email,
        name: name || email,
        metadata: {
          genius_org_id:  orgId,
          genius_user_id: userId || '',
          source:         'genius-platform',
        },
      });
      customerId = customer.id;
    }

    const baseUrl = GENIUS_APP_URL();
    const session = await s.checkout.sessions.create({
      customer:             customerId,
      mode:                 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        genius_org_id:  orgId,
        genius_user_id: userId || '',
        tier:           tier.toUpperCase(),
        source:         'genius-platform',
      },
      subscription_data: {
        metadata: {
          genius_org_id:  orgId,
          genius_user_id: userId || '',
          tier:           tier.toUpperCase(),
          source:         'genius-platform',
        },
      },
      success_url: `${baseUrl}/dashboard/user/billing?success=1&plan=${tier.toUpperCase()}`,
      cancel_url:  `${baseUrl}/pricing?canceled=1`,
    });

    res.json({ url: session.url, customerId });
  } catch (err) {
    console.error('[genius-bridge] checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/genius/portal ───────────────────────────────────────────────────
router.post('/portal', bridgeAuth, express.json({ limit: '8kb' }), async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Stripe not configured on this server' });

  const { customerId } = req.body;
  if (!customerId) {
    return res.status(400).json({ error: 'customerId is required' });
  }

  try {
    const baseUrl = GENIUS_APP_URL();
    const session = await s.billingPortal.sessions.create({
      customer:   customerId,
      return_url: `${baseUrl}/dashboard/user/billing`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('[genius-bridge] portal error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/genius/stripe-webhook ──────────────────────────────────────────
// Register a SEPARATE Stripe webhook pointing here:
//   https://webagentbridge.com/api/genius/stripe-webhook
// Use STRIPE_GENIUS_WEBHOOK_SECRET (different from WAB's own webhook secret).
router.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const s = stripe();
  if (!s) return res.status(503).json({ error: 'Stripe not configured' });

  const sig           = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_GENIUS_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return res.status(400).json({ error: 'Missing Stripe signature or STRIPE_GENIUS_WEBHOOK_SECRET' });
  }

  let event;
  try {
    event = s.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('[genius-bridge] webhook signature failed:', err.message);
    return res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
  }

  // Only process events originating from genius-platform
  const meta = event.data.object?.metadata ?? {};
  if (meta.source !== 'genius-platform') {
    return res.json({ received: true, skipped: 'not a genius event' });
  }

  let payload = null;

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const sess = event.data.object;
        payload = {
          event:          'checkout.completed',
          orgId:          sess.metadata?.genius_org_id,
          tier:           sess.metadata?.tier,
          customerId:     sess.customer,
          subscriptionId: sess.subscription,
        };
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        payload = {
          event:          'subscription.updated',
          orgId:          sub.metadata?.genius_org_id,
          tier:           sub.metadata?.tier,
          subscriptionId: sub.id,
          status:         sub.status,
        };
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        payload = {
          event:          'subscription.deleted',
          orgId:          sub.metadata?.genius_org_id,
          subscriptionId: sub.id,
        };
        break;
      }
      default:
        return res.json({ received: true });
    }

    if (payload?.orgId) {
      const callbackUrl = `${GENIUS_CALLBACK_URL()}/api/wab/billing-callback`;
      const secret      = BRIDGE_SECRET();
      const r = await fetch(callbackUrl, {
        method:  'POST',
        headers: {
          'Content-Type':     'application/json',
          'X-Internal-Secret': secret,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      }).catch(err => {
        console.error('[genius-bridge] callback to genius failed:', err.message);
        return null;
      });

      if (r && !r.ok) {
        console.error('[genius-bridge] callback returned', r.status);
      }
    }
  } catch (err) {
    console.error('[genius-bridge] webhook handler error:', err);
    return res.status(500).json({ error: 'Internal error processing event' });
  }

  res.json({ received: true });
});

module.exports = router;
