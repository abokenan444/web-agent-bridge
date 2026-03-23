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
    enterprise: process.env.STRIPE_PRICE_ENTERPRISE || getPlatformSetting('stripe_price_enterprise')
  };
}

async function createCheckoutSession({ userId, userEmail, siteId, tier }) {
  const site = findSiteById.get(siteId);
  if (!site || site.user_id !== userId) {
    throw new Error('Site not found or access denied');
  }

  const s = getStripe();
  if (!s) throw new Error('Stripe not configured');

  const prices = getStripePrices();
  const priceId = prices[tier];
  if (!priceId) throw new Error(`No price configured for tier: ${tier}`);

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
    metadata: { wab_user_id: userId, wab_site_id: siteId, tier },
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
