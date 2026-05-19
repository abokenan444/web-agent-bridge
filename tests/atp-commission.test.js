/**
 * ATP Merchant Commission — v3.10.0
 *
 * Asserts: settled merchant tx → commission row; compensation → refunded;
 * platform self-payments and free-tier sites are exempt; the rate matches
 * the configured bps.
 */
process.env.NODE_ENV = 'test';

const path = require('path');
const fs = require('fs');

const TEST_DB_FILE = path.join(__dirname, '..', 'data-test', `wab-test-${process.env.JEST_WORKER_ID || '1'}.db`);

let transactions, commissions, dbModule;

beforeAll(() => {
  if (fs.existsSync(TEST_DB_FILE)) {
    try { fs.rmSync(TEST_DB_FILE); } catch { /* ignore */ }
  }
  Object.keys(require.cache).forEach((k) => {
    if (k.includes(path.sep + 'server' + path.sep) || k.includes(path.sep + 'data-test' + path.sep)) {
      delete require.cache[k];
    }
  });

  dbModule    = require('../server/models/db');
  require('../server/utils/migrate').runMigrations();
  transactions = require('../server/services/transactions');
  commissions  = require('../server/services/commissions');

  // Two merchants: one pro (chargeable), one free (exempt).
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, password, created_at)
    VALUES ('user_com_pro', 'pro@test.local', 'Pro Merchant', 'x', datetime('now'))
  `).run();
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO users (id, email, name, password, created_at)
    VALUES ('user_com_free', 'free@test.local', 'Free Merchant', 'x', datetime('now'))
  `).run();
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config, active)
    VALUES ('site_com_pro', 'user_com_pro', 'pro.test.local', 'Pro Site', '', 'pro', 'lic_pro', 'key_pro', '{}', 1)
  `).run();
  dbModule.db.prepare(`
    INSERT OR IGNORE INTO sites (id, user_id, domain, name, description, tier, license_key, api_key, config, active)
    VALUES ('site_com_free', 'user_com_free', 'free.test.local', 'Free Site', '', 'free', 'lic_free', 'key_free', '{}', 1)
  `).run();
});

function runFullCycle({ userId, siteId, amountCents, idempotencyKey, metadata = {} }) {
  const intent = transactions.createIntent({
    userId,
    siteId,
    purpose: 'test commerce',
    scope: { actions: ['pay'] },
    spendCapCents: amountCents,
    maxExecutions: 1,
    ttlSeconds: 600,
    metadata,
  });
  transactions.authorizeIntent(intent.id, { userId });
  const tx = transactions.beginTransaction({
    intentId: intent.id,
    idempotencyKey,
    amountCents,
    currency: 'EUR',
    summary: 'unit test',
  });
  transactions.transitionTransaction(tx.id, 'executing');
  transactions.transitionTransaction(tx.id, 'executed');
  transactions.transitionTransaction(tx.id, 'settled');
  return tx;
}

describe('ATP commission — accrual', () => {
  test('default rate is 10 bps (0.10%)', () => {
    expect(commissions.getCommissionBps()).toBe(10);
  });

  test('rounding matches half-up cents', () => {
    expect(commissions._calcCommissionCents(10000, 10)).toBe(10); // €100 → 10c
    expect(commissions._calcCommissionCents(4999, 10)).toBe(5);   // €49.99 → 5c (round half-up)
    expect(commissions._calcCommissionCents(0, 10)).toBe(0);
  });

  test('settling a pro-tier tx records a commission row', () => {
    const tx = runFullCycle({
      userId: 'user_com_pro', siteId: 'site_com_pro',
      amountCents: 12345, idempotencyKey: 'com_pro_1',
    });
    const row = dbModule.db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(tx.id);
    expect(row).toBeTruthy();
    expect(row.merchant_user_id).toBe('user_com_pro');
    expect(row.merchant_site_id).toBe('site_com_pro');
    expect(row.commission_bps).toBe(10);
    expect(row.commission_cents).toBe(12); // 12345 * 10 / 10000 = 12.345 → 12
    expect(row.status).toBe('pending');
  });

  test('free-tier merchant tx is exempt', () => {
    const tx = runFullCycle({
      userId: 'user_com_free', siteId: 'site_com_free',
      amountCents: 50000, idempotencyKey: 'com_free_1',
    });
    const row = dbModule.db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(tx.id);
    expect(row).toBeFalsy();
  });

  test('platform self-payment is exempt', () => {
    const tx = runFullCycle({
      userId: 'user_com_pro', siteId: 'site_com_pro',
      amountCents: 9900, idempotencyKey: 'com_plat_1',
      metadata: { platform: true, kind: 'wab_subscription', tier: 'pro' },
    });
    const row = dbModule.db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(tx.id);
    expect(row).toBeFalsy();
  });

  test('compensation flips the commission to refunded', () => {
    const tx = runFullCycle({
      userId: 'user_com_pro', siteId: 'site_com_pro',
      amountCents: 20000, idempotencyKey: 'com_pro_refund',
    });
    transactions.compensateTransaction(tx.id, { reason: 'customer_refund' });
    const row = dbModule.db.prepare('SELECT * FROM atp_commissions WHERE transaction_id=?').get(tx.id);
    expect(row.status).toBe('refunded');
    expect(row.notes).toMatch(/tx_compensated|customer_refund/);
  });

  test('merchant stats aggregate correctly', () => {
    const stats = commissions.getMerchantCommissionStats('user_com_pro');
    expect(stats.count_total).toBeGreaterThan(0);
    expect(stats.commission_total_cents).toBeGreaterThan(0);
    expect(stats.rate_bps).toBe(10);
  });
});
