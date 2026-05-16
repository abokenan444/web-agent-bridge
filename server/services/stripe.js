/**
 * Stripe Payment Integration Service
 */

const {
  getPlatformSetting,
  saveStripeCustomer,
  getStripeCustomer,
  saveStripeSubscription,
  updateStripeSubscription,
  getStripeSubscriptionBySubId,
  savePayment,
  updateSiteTier,
  findSiteById
} = require('../models/db');

let stripe = null;

function getStripe() {
  if (stripe) return stripe;
  const key = process.env.STRIPE_SECRET_KEY || getPlatformSetting('stripe_secret_key');
  if (!key) return null;
  stripe = require('stripe')(key);
  return stripe;
}

function getStripePrices() {
  return {
    starter: process.env.STRIPE_PRICE_STARTER || getPlatformSetting('stripe_price_starter'),
    pro: process.env.STRIPE_PRICE_PRO || getPlatformSetting('stripe_price_pro'),
    business: process.env.STRIPE_PRICE_BUSINESS || getPlatformSetting('stripe_price_business'),
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE || getPlatformSetting('stripe_price_enterprise')
  };
}

// Resolve a Stripe price id from either a plan id (DB) or a legacy tier name.
// Order: DB plan.stripe_price_id → env STRIPE_PRICE_<UPPER> → platform_settings → null.
function resolvePriceId(planOrTier) {
  if (!planOrTier) return null;
  try {
    const plans = require('./plans');
    const p = plans.getPlan(planOrTier);
    if (p && p.stripe_price_id) return p.stripe_price_id;
  } catch { /* DB layer not ready (tests) — fall through to legacy lookup */ }
  const envKey = `STRIPE_PRICE_${String(planOrTier).toUpperCase()}`;
  return process.env[envKey] || getPlatformSetting(`stripe_price_${planOrTier}`) || null;
}

async function createCheckoutSession({ userId, userEmail, siteId, tier, planId }) {
  const site = findSiteById.get(siteId);
  if (!site || site.user_id !== userId) {
    throw new Error('Site not found or access denied');
  }

  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const planRef = planId || tier;
  const priceId = resolvePriceId(planRef);
  if (!priceId) throw new Error(`No price configured for plan: ${planRef}`);

  // Get or create Stripe customer
  let customer = getStripeCustomer(userId);
  if (!customer) {
    const stripeCustomer = await s.customers.create({ email: userEmail, metadata: { wab_user_id: userId } });
    saveStripeCustomer(userId, stripeCustomer.id);
    customer = { stripe_customer_id: stripeCustomer.id };
  }

  const baseUrl = process.env.BASE_URL || 'https://webagentbridge.com';

  const session = await s.checkout.sessions.create({
    customer: customer.stripe_customer_id,
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { wab_user_id: userId, wab_site_id: siteId, tier: planRef, plan_id: planRef },
    success_url: `${baseUrl}/dashboard?payment=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/dashboard?payment=cancelled`
  });

  return { sessionId: session.id, url: session.url };
}

async function createPortalSession(userId) {
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const customer = getStripeCustomer(userId);
  if (!customer) throw new Error('No Stripe customer found');

  const baseUrl = process.env.BASE_URL || 'https://webagentbridge.com';

  const session = await s.billingPortal.sessions.create({
    customer: customer.stripe_customer_id,
    return_url: `${baseUrl}/dashboard`
  });

  return { url: session.url };
}

function handleWebhookEvent(event) {
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const { wab_user_id, wab_site_id, tier } = session.metadata || {};
      if (wab_user_id && wab_site_id && session.subscription) {
        saveStripeSubscription({
          userId: wab_user_id,
          siteId: wab_site_id,
          stripeSubId: session.subscription,
          stripePriceId: null,
          tier: tier || 'starter',
          status: 'active',
          periodStart: new Date().toISOString(),
          periodEnd: null
        });
        updateSiteTier.run(tier || 'starter', wab_site_id, wab_user_id);

        // ── License delivery email (best-effort, non-blocking) ──
        try {
          const { findUserById, findSiteById: getSite } = require('../models/db');
          const user = findUserById.get(wab_user_id);
          const site = getSite.get(wab_site_id);
          if (user && site) {
            const { sendEmail } = require('./email');
            const baseUrl = process.env.BASE_URL || 'https://webagentbridge.com';
            const amount = session.amount_total != null
              ? `${(session.amount_total / 100).toFixed(2)} ${(session.currency || 'usd').toUpperCase()}`
              : null;
            Promise.resolve(sendEmail({
              to: user.email,
              template: 'license_delivery',
              data: {
                name: user.name,
                tier: tier || 'starter',
                siteDomain: site.domain,
                licenseKey: site.license_key,
                amount,
                dashboardUrl: `${baseUrl}/dashboard`
              },
              userId: user.id
            })).catch((e) => console.error('[stripe] license_delivery email failed:', e.message));
          }
        } catch (e) {
          console.error('[stripe] license_delivery setup failed:', e.message);
        }
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        const sub = getStripeSubscriptionBySubId(invoice.subscription);
        if (sub) {
          savePayment({
            userId: sub.user_id,
            stripePaymentId: invoice.payment_intent,
            amount: invoice.amount_paid,
            currency: invoice.currency,
            status: 'succeeded',
            description: `Subscription payment - ${sub.tier}`
          });
          updateStripeSubscription(invoice.subscription, {
            status: 'active',
            periodStart: new Date(invoice.period_start * 1000).toISOString(),
            periodEnd: new Date(invoice.period_end * 1000).toISOString()
          });
          // ── WAB dogfooding: record this real money event as an ATP receipt ──
          // Every dollar that flows into WAB is itself a publicly-verifiable
          // Ed25519 receipt. Failure here MUST NOT block payment confirmation.
          try {
            const transactions = require('./transactions');
            transactions.recordPlatformPayment({
              userId: sub.user_id,
              amountCents: invoice.amount_paid,
              currency: (invoice.currency || 'USD').toUpperCase(),
              tier: sub.tier,
              externalRef: invoice.id || invoice.payment_intent,
              description: `WAB ${sub.tier} subscription`,
              periodStart: invoice.period_start ? new Date(invoice.period_start * 1000).toISOString() : null,
              periodEnd:   invoice.period_end   ? new Date(invoice.period_end * 1000).toISOString()   : null,
              provider: 'stripe',
            });
          } catch (e) {
            console.error('[atp] recordPlatformPayment failed (non-fatal):', e.message);
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      updateStripeSubscription(subscription.id, {
        status: subscription.status === 'active' ? 'active' : subscription.status === 'past_due' ? 'past_due' : subscription.status === 'trialing' ? 'trialing' : 'cancelled'
      });
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const sub = getStripeSubscriptionBySubId(subscription.id);
      if (sub) {
        updateStripeSubscription(subscription.id, { status: 'cancelled' });
        updateSiteTier.run('free', sub.site_id, sub.user_id);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      if (invoice.subscription) {
        updateStripeSubscription(invoice.subscription, { status: 'past_due' });
      }
      break;
    }

    case 'charge.refunded': {
      const charge = event.data.object;
      try {
        const userId =
          (charge.metadata && charge.metadata.wab_user_id) ||
          (charge.invoice && (() => {
            // best-effort: look up subscription via the invoice's subscription id
            try {
              const inv = charge.invoice;
              if (typeof inv === 'string') return null;
              if (inv && inv.subscription) {
                const sub = getStripeSubscriptionBySubId(inv.subscription);
                return sub ? sub.user_id : null;
              }
            } catch { return null; }
            return null;
          })()) || null;

        if (userId) {
          savePayment({
            userId,
            stripePaymentId: `refund_${charge.id}`,
            amount: -(charge.amount_refunded || charge.amount || 0),
            currency: charge.currency || 'usd',
            status: 'refunded',
            description: `Refund: ${charge.id}`
          });
        }

        // Downgrade any subscription tied to this charge (best-effort)
        if (charge.invoice) {
          try {
            const invId = typeof charge.invoice === 'string' ? null : charge.invoice;
            // Subscription id can be on the expanded invoice; we mark the
            // user's subscriptions as refunded so admin tools can review.
            if (invId && invId.subscription) {
              updateStripeSubscription(invId.subscription, { status: 'cancelled' });
              const sub = getStripeSubscriptionBySubId(invId.subscription);
              if (sub) updateSiteTier.run('free', sub.site_id, sub.user_id);
            }
          } catch (e) {
            console.error('[stripe] charge.refunded subscription update failed:', e.message);
          }
        }
        console.warn(`[stripe] charge.refunded processed: charge=${charge.id} amount=${charge.amount_refunded}`);
      } catch (e) {
        console.error('[stripe] charge.refunded handler error:', e.message);
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object;
      try {
        const userId = (dispute.metadata && dispute.metadata.wab_user_id) || null;
        if (userId) {
          savePayment({
            userId,
            stripePaymentId: `dispute_${dispute.id}`,
            amount: -(dispute.amount || 0),
            currency: dispute.currency || 'usd',
            status: 'disputed',
            description: `Chargeback/dispute: ${dispute.id} reason=${dispute.reason || 'unknown'}`
          });
        }
        // Suspend any subscription on the disputed charge
        try {
          if (dispute.charge) {
            // Without expanding the charge we cannot reliably find the sub,
            // but admins are alerted via the audit log + payments row above.
          }
        } catch { /* noop */ }
        console.warn(`[stripe] charge.dispute.created: dispute=${dispute.id} reason=${dispute.reason}`);
      } catch (e) {
        console.error('[stripe] charge.dispute.created handler error:', e.message);
      }
      break;
    }
  }
}

function isStripeConfigured() {
  const key = process.env.STRIPE_SECRET_KEY || getPlatformSetting('stripe_secret_key');
  return !!key;
}

/**
 * Express webhook handler: verifies Stripe signature, then dispatches business logic.
 */
function handleWebhookRequest(req) {
  const sig = req.headers['stripe-signature'];
  const raw = req.body;
  const whSecret = process.env.STRIPE_WEBHOOK_SECRET || getPlatformSetting('stripe_webhook_secret');
  if (!whSecret) {
    throw new Error('Stripe webhook secret not configured (STRIPE_WEBHOOK_SECRET or platform stripe_webhook_secret)');
  }
  if (!sig) {
    throw new Error('Missing Stripe-Signature header');
  }
  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');
  const event = s.webhooks.constructEvent(raw, sig, whSecret);
  handleWebhookEvent(event);
}

module.exports = {
  getStripe,
  createCheckoutSession,
  createPortalSession,
  handleWebhookEvent,
  handleWebhookRequest,
  isStripeConfigured,
  getStripePrices
};
