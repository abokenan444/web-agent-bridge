'use strict';

/**
 * ATP Commission Billing — v3.10.1
 *
 * Converts `pending` rows in atp_commissions into real Stripe invoices.
 *
 * Strategy:
 *   - Group pending commissions by merchant_user_id + currency.
 *   - One Stripe invoice per (merchant, currency) per cycle.
 *   - One Stripe invoice item per commission row, so the merchant sees
 *     a line-by-line breakdown.
 *   - Mark rows `invoiced` and stamp the stripe invoice id into `notes`
 *     inside the same transaction.
 *
 * Idempotency:
 *   - Skips rows whose merchant has no Stripe customer yet.
 *   - Aborts a merchant's batch on any Stripe error; rows stay `pending`.
 *   - dry-run mode just returns the plan without touching Stripe or the DB.
 *
 * Trigger:
 *   - Admin endpoint POST /api/admin/commissions/run-billing
 *   - Optional periodic timer (env WAB_COMMISSION_BILLING_INTERVAL_HOURS).
 */

const { db, getStripeCustomer } = require('../models/db');

function getMinAgeDays() {
  const n = parseInt(process.env.WAB_COMMISSION_MIN_AGE_DAYS, 10);
  if (Number.isFinite(n) && n >= 0 && n <= 365) return n;
  return 0; // by default bill anything that's pending
}

function getMinAmountCents() {
  const n = parseInt(process.env.WAB_COMMISSION_MIN_INVOICE_CENTS, 10);
  if (Number.isFinite(n) && n >= 0) return n;
  return 100; // 1 EUR/USD floor — Stripe rejects sub-50c invoices anyway
}

/**
 * Build the per-merchant batches that would be billed in this cycle.
 * Returns an array: [{ merchantUserId, currency, rows[], totalCents, stripeCustomerId|null, skipReason|null }]
 */
function planBillingCycle() {
  const minAgeDays = getMinAgeDays();
  const ageClause = minAgeDays > 0
    ? `AND datetime(created_at) < datetime('now', '-${minAgeDays} days')`
    : '';

  const groups = db.prepare(`
    SELECT merchant_user_id, currency,
           COUNT(*) AS n,
           COALESCE(SUM(commission_cents), 0) AS total_cents
      FROM atp_commissions
     WHERE status = 'pending'
       ${ageClause}
     GROUP BY merchant_user_id, currency
     ORDER BY total_cents DESC
  `).all();

  const minAmount = getMinAmountCents();

  const batches = [];
  for (const g of groups) {
    if (g.total_cents < minAmount) {
      batches.push({
        merchantUserId: g.merchant_user_id,
        currency: g.currency,
        rows: [],
        totalCents: g.total_cents,
        rowCount: g.n,
        stripeCustomerId: null,
        skipReason: `below_min_invoice (${g.total_cents}c < ${minAmount}c)`,
      });
      continue;
    }
    const cust = getStripeCustomer(g.merchant_user_id);
    if (!cust || !cust.stripe_customer_id) {
      batches.push({
        merchantUserId: g.merchant_user_id,
        currency: g.currency,
        rows: [],
        totalCents: g.total_cents,
        rowCount: g.n,
        stripeCustomerId: null,
        skipReason: 'no_stripe_customer',
      });
      continue;
    }
    const rows = db.prepare(`
      SELECT id, transaction_id, gross_amount_cents, commission_cents, commission_bps, created_at
        FROM atp_commissions
       WHERE merchant_user_id = ? AND currency = ? AND status = 'pending'
       ${ageClause}
       ORDER BY created_at ASC
    `).all(g.merchant_user_id, g.currency);

    batches.push({
      merchantUserId: g.merchant_user_id,
      currency: g.currency,
      rows,
      totalCents: g.total_cents,
      rowCount: rows.length,
      stripeCustomerId: cust.stripe_customer_id,
      skipReason: null,
    });
  }
  return batches;
}

/**
 * Execute a billing cycle. When dryRun=true, returns the plan without
 * touching Stripe or the DB.
 */
async function runBillingCycle({ dryRun = false } = {}) {
  const startedAt = new Date().toISOString();
  const batches = planBillingCycle();
  const summary = {
    started_at: startedAt,
    dry_run: !!dryRun,
    batches_total: batches.length,
    batches_billed: 0,
    batches_skipped: 0,
    rows_invoiced: 0,
    total_commission_cents: 0,
    invoices: [],
    errors: [],
  };

  if (dryRun) {
    summary.batches_skipped = batches.filter((b) => b.skipReason).length;
    summary.batches_billed  = batches.length - summary.batches_skipped;
    summary.rows_invoiced   = batches.reduce((s, b) => s + (b.skipReason ? 0 : b.rowCount), 0);
    summary.total_commission_cents = batches.reduce(
      (s, b) => s + (b.skipReason ? 0 : b.totalCents),
      0,
    );
    summary.plan = batches.map((b) => ({
      merchant_user_id: b.merchantUserId,
      currency: b.currency,
      rows: b.rowCount,
      total_cents: b.totalCents,
      stripe_customer_id: b.stripeCustomerId,
      skip_reason: b.skipReason,
    }));
    summary.finished_at = new Date().toISOString();
    return summary;
  }

  const { getStripe, isStripeConfigured } = require('./stripe');
  if (!isStripeConfigured()) {
    summary.errors.push({ reason: 'stripe_not_configured' });
    summary.finished_at = new Date().toISOString();
    return summary;
  }
  const stripe = getStripe();

  for (const batch of batches) {
    if (batch.skipReason) {
      summary.batches_skipped++;
      continue;
    }

    try {
      // 1) One invoice item per commission row → merchant gets a full ledger.
      for (const r of batch.rows) {
        await stripe.invoiceItems.create({
          customer: batch.stripeCustomerId,
          amount: r.commission_cents,
          currency: (batch.currency || 'eur').toLowerCase(),
          description: `WAB ATP commission (${(r.commission_bps / 100).toFixed(2)}%) · tx ${r.transaction_id} · ${r.created_at}`,
          metadata: {
            wab_commission_id: r.id,
            wab_transaction_id: r.transaction_id,
            wab_kind: 'atp_commission',
          },
        });
      }

      // 2) Finalize a single invoice for all the items above.
      const invoice = await stripe.invoices.create({
        customer: batch.stripeCustomerId,
        collection_method: 'charge_automatically',
        auto_advance: true,
        description: `WAB ATP merchant commission · ${batch.rowCount} transactions`,
        metadata: {
          wab_kind: 'atp_commission_batch',
          wab_merchant_user_id: batch.merchantUserId,
          wab_currency: batch.currency,
          wab_row_count: String(batch.rowCount),
        },
      });

      // 3) Mark all rows invoiced inside a single DB transaction.
      const ids = batch.rows.map((r) => r.id);
      const stamp = `stripe_invoice:${invoice.id}@${new Date().toISOString()}`;
      const markTx = db.transaction((commIds) => {
        const upd = db.prepare(`
          UPDATE atp_commissions
             SET status = 'invoiced',
                 notes = COALESCE(notes || ' | ', '') || ?,
                 updated_at = datetime('now')
           WHERE id = ? AND status = 'pending'
        `);
        for (const id of commIds) upd.run(stamp, id);
      });
      markTx(ids);

      summary.batches_billed++;
      summary.rows_invoiced += batch.rowCount;
      summary.total_commission_cents += batch.totalCents;
      summary.invoices.push({
        merchant_user_id: batch.merchantUserId,
        currency: batch.currency,
        rows: batch.rowCount,
        total_cents: batch.totalCents,
        stripe_invoice_id: invoice.id,
        stripe_invoice_status: invoice.status,
      });
    } catch (e) {
      summary.errors.push({
        merchant_user_id: batch.merchantUserId,
        currency: batch.currency,
        message: e && e.message ? e.message : String(e),
      });
    }
  }

  summary.finished_at = new Date().toISOString();
  return summary;
}

/**
 * Webhook hook — called from stripe.js when an invoice tied to a wab
 * commission batch is paid or fails. Flips matching atp_commissions rows
 * to 'collected' (paid) or leaves at 'invoiced' (failed → manual).
 */
function onStripeInvoicePaid(invoice) {
  try {
    const meta = invoice && invoice.metadata;
    if (!meta || meta.wab_kind !== 'atp_commission_batch') return 0;
    const r = db.prepare(`
      UPDATE atp_commissions
         SET status = 'collected',
             notes  = COALESCE(notes || ' | ', '') || ?,
             updated_at = datetime('now')
       WHERE status = 'invoiced'
         AND notes LIKE ?
    `).run(`paid:${invoice.id}@${new Date().toISOString()}`, `%stripe_invoice:${invoice.id}%`);
    return r.changes;
  } catch (e) {
    console.error('[commission-billing] onStripeInvoicePaid failed:', e.message);
    return 0;
  }
}

let _timer = null;
function startPeriodicBilling() {
  const hours = parseFloat(process.env.WAB_COMMISSION_BILLING_INTERVAL_HOURS);
  if (!Number.isFinite(hours) || hours <= 0) return null;
  const ms = Math.max(60_000, hours * 3_600_000);
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => {
    runBillingCycle({ dryRun: false })
      .then((s) => console.log(
        `[commission-billing] cycle done: billed=${s.batches_billed} rows=${s.rows_invoiced} total_cents=${s.total_commission_cents} errors=${s.errors.length}`,
      ))
      .catch((e) => console.error('[commission-billing] cycle failed:', e.message));
  }, ms);
  if (_timer.unref) _timer.unref();
  return { intervalHours: hours };
}

module.exports = {
  planBillingCycle,
  runBillingCycle,
  onStripeInvoicePaid,
  startPeriodicBilling,
};
