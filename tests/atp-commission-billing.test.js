/**
 * ATP Commission Billing — v3.10.1
 *
 * Verifies the dry-run planner groups pending commissions correctly and
 * filters out merchants without a Stripe customer.
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

const TEST_DB_FILE = path.join(__dirname, '..', 'data-test', `wab-test-${process.env.JEST_WORKER_ID || '1'}.db`);

let billing, dbModule;

beforeAll(() => {
  if (fs.existsSync(TEST_DB_FILE)) {
    try { fs.rmSync(TEST_DB_FILE); } catch { /* ignore */ }
  }
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(path.sep + 'server' + path.sep) || k.includes(path.sep + 'data-test' + path.sep)) {
      delete require.cache[k];
    }
  });

  dbModule = require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
  billing = require('../server/services/commission-billing');

  // Two merchants, one with a Stripe customer, one without.
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, password, created_at)
    VALUES ('user_bill_a', 'a@test.local', 'A', 'x', datetime('now')),
           ('user_bill_b', 'b@test.local', 'B', 'x', datetime('now'))
  `).run();
  dbModule.saveStripeCustomer('user_bill_a', 'cus_test_a');

  // Sites
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config, active)
    VALUES ('site_bill_a', 'user_bill_a', 'a.test.local', 'A', '', 'pro', 'l_a', 'k_a', '{}', 1),
           ('site_bill_b', 'user_bill_b', 'b.test.local', 'B', '', 'pro', 'l_b', 'k_b', '{}', 1)
  `).run();

  // Seed a parent transaction + intent for FK to pass.
  function seed(userId, siteId, n) {
    for (let i = 0; i < n; i++) {
      const intentId = `atp_int_test_${userId}_${i}`;
      const txId = `atp_tx_test_${userId}_${i}`;
      const commId = `atp_com_test_${userId}_${i}`;
      dbModule.db.prepare(`
        INSERT INTO atp_intents (id, user_id, site_id, purpose, scope, spend_cap_cents, spend_currency,
                                 max_executions, expires_at, nonce, status, metadata)
        VALUES (?, ?, ?, 'test', '{"actions":["pay"]}', 10000, 'EUR', 1,
                datetime('now','+1 hour'), ?, 'authorized', '{}')
      `).run(intentId, userId, siteId, `nonce_${userId}_${i}`);
      dbModule.db.prepare(`
        INSERT INTO atp_transactions (id, intent_id, idempotency_key, status, amount_cents, currency,
                                       summary, metadata, started_at, completed_at, settled_at)
        VALUES (?, ?, ?, 'settled', 10000, 'EUR', '', '{}', datetime('now'), datetime('now'), datetime('now'))
      `).run(txId, intentId, `idem_${userId}_${i}`);
      dbModule.db.prepare(`
        INSERT INTO atp_commissions
          (id, transaction_id, intent_id, merchant_user_id, merchant_site_id,
           merchant_tier, gross_amount_cents, currency, commission_bps, commission_cents,
           status, external_ref)
        VALUES (?, ?, ?, ?, ?, 'pro', 10000, 'EUR', 10, 10, 'pending', NULL)
      `).run(commId, txId, intentId, userId, siteId);
    }
  }
  seed('user_bill_a', 'site_bill_a', 15); // total 150 cents — above floor
  seed('user_bill_b', 'site_bill_b', 15); // same, but no Stripe customer
});

describe('ATP commission billing — planner', () => {
  test('planBillingCycle groups by merchant + currency', () => {
    const batches = billing.planBillingCycle();
    expect(batches.length).toBe(2);
    const a = batches.find((b) => b.merchantUserId === 'user_bill_a');
    const b = batches.find((b) => b.merchantUserId === 'user_bill_b');
    expect(a.rowCount).toBe(15);
    expect(a.totalCents).toBe(150);
    expect(a.stripeCustomerId).toBe('cus_test_a');
    expect(a.skipReason).toBeNull();
    expect(b.skipReason).toBe('no_stripe_customer');
  });

  test('dry-run summary marks merchant_b as skipped, never writes', async () => {
    const before = dbModule.db.prepare(
      `SELECT COUNT(*) AS n FROM atp_commissions WHERE status='pending'`,
    ).get().n;
    const summary = await billing.runBillingCycle({ dryRun: true });
    const after = dbModule.db.prepare(
      `SELECT COUNT(*) AS n FROM atp_commissions WHERE status='pending'`,
    ).get().n;
    expect(after).toBe(before);
    expect(summary.dry_run).toBe(true);
    expect(summary.batches_total).toBe(2);
    expect(summary.batches_billed).toBe(1);
    expect(summary.batches_skipped).toBe(1);
    expect(summary.rows_invoiced).toBe(15);
    expect(summary.total_commission_cents).toBe(150);
  });
});
