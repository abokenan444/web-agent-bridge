'use strict';

/**
 * Regression tests for the Agent OS marketplace authorization advisory.
 *
 * Original issues (locally reproducible against public source):
 *   1. PUBLIC_PATHS included '/marketplace' and the matcher allowed any
 *      `GET /marketplace/<sub>` to bypass auth, so the following were
 *      publicly readable without any credential:
 *        - GET /marketplace/admin/pending
 *        - GET /marketplace/my/purchases?buyerId=...
 *        - GET /marketplace/my/earnings?sellerId=...
 *   2. POST /marketplace/admin/:listingId/(approve|reject) had no admin
 *      role check.
 *   3. The 'my/*' endpoints accepted arbitrary buyerId / sellerId query
 *      parameters from anonymous callers (no ownership enforcement).
 *   4. marketplace.purchase() credited seller earnings, listing revenue
 *      and the installs counter immediately on a paid purchase \u2014 even
 *      though the purchase status was still `pending_payment` and no
 *      money had moved. completePayment() did not credit anything,
 *      leaving accrual permanently inflatable by anyone able to call
 *      POST /marketplace/:id/purchase.
 *
 * Tests are static-source assertions plus one functional in-process
 * unit test against the marketplace service (no server boot).
 */

const fs = require('fs');
const path = require('path');

describe('runtime.js \u2014 marketplace admin / my authorization', () => {
  const routesPath = path.join(__dirname, '..', 'server', 'routes', 'runtime.js');
  const source = fs.readFileSync(routesPath, 'utf8');

  test('PUBLIC_DENY_PREFIXES blocks /marketplace/admin and /marketplace/my from the public allow-list', () => {
    expect(source).toMatch(/PUBLIC_DENY_PREFIXES\s*=\s*\[[\s\S]*?'\/marketplace\/admin'[\s\S]*?'\/marketplace\/my'[\s\S]*?\]/);
    // The matcher must consult the deny list BEFORE granting public access.
    expect(source).toMatch(/deniedFromPublic\s*=\s*PUBLIC_DENY_PREFIXES\.some/);
    expect(source).toMatch(/matchesPublic\s*=\s*!deniedFromPublic\s*&&\s*PUBLIC_PATHS\.some/);
  });

  test('GET /marketplace/admin/pending requires req.isAdmin', () => {
    expect(source).toMatch(
      /router\.get\(['"]\/marketplace\/admin\/pending['"][\s\S]{0,200}if\s*\(\s*!req\.isAdmin\s*\)\s*return\s+res\.status\(403\)/
    );
  });

  test('POST /marketplace/admin/:listingId/approve requires req.isAdmin', () => {
    expect(source).toMatch(
      /router\.post\(['"]\/marketplace\/admin\/:listingId\/approve['"][\s\S]{0,200}if\s*\(\s*!req\.isAdmin\s*\)\s*return\s+res\.status\(403\)/
    );
  });

  test('POST /marketplace/admin/:listingId/reject requires req.isAdmin', () => {
    expect(source).toMatch(
      /router\.post\(['"]\/marketplace\/admin\/:listingId\/reject['"][\s\S]{0,200}if\s*\(\s*!req\.isAdmin\s*\)\s*return\s+res\.status\(403\)/
    );
  });

  test('GET /marketplace/my/purchases binds buyerId to req.agentId for non-admins', () => {
    // Old: const buyerId = req.agentId || req.query.buyerId;
    // New: non-admin path must NOT honour req.query.buyerId.
    const block = source.match(
      /router\.get\(['"]\/marketplace\/my\/purchases['"][\s\S]{0,300}?\}\);/
    );
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/req\.isAdmin/);
    // The non-admin branch must resolve to req.agentId only (no fallback to query).
    expect(block[0]).toMatch(/req\.isAdmin\s*\?\s*\([^)]*req\.query\.buyerId[^)]*\)\s*:\s*req\.agentId/);
  });

  test('GET /marketplace/my/earnings binds sellerId to req.agentId for non-admins', () => {
    const block = source.match(
      /router\.get\(['"]\/marketplace\/my\/earnings['"][\s\S]{0,300}?\}\);/
    );
    expect(block).toBeTruthy();
    expect(block[0]).toMatch(/req\.isAdmin/);
    expect(block[0]).toMatch(/req\.isAdmin\s*\?\s*\([^)]*req\.query\.sellerId[^)]*\)\s*:\s*req\.agentId/);
  });
});

describe('marketplace service \u2014 earnings only accrue on completed purchases', () => {
  let MarketplaceEngine;
  beforeAll(() => {
    MarketplaceEngine = require('../server/services/marketplace').MarketplaceEngine;
  });

  test('paid purchase in pending_payment does NOT credit seller earnings, installs, or revenue', () => {
    const mkt = new MarketplaceEngine();
    const listing = mkt.publish({
      name: 'PoC paid adapter',
      type: 'plugin',
      category: 'automation',
      sellerId: 'seller-1',
      price: 100,
    });
    mkt.approve(listing.id);

    const purchase = mkt.purchase(listing.id, 'buyer-1');

    expect(purchase.status).toBe('pending_payment');
    expect(mkt.getEarnings('seller-1')).toEqual({ total: 0, pending: 0, paid: 0 });
    const after = mkt.getListing(listing.id);
    expect(after.installs).toBe(0);
    expect(after.revenue).toBe(0);
  });

  test('completePayment promotes pending_payment to completed and credits exactly once', () => {
    const mkt = new MarketplaceEngine();
    const listing = mkt.publish({
      name: 'PoC paid adapter',
      type: 'plugin',
      category: 'automation',
      sellerId: 'seller-1',
      price: 100,
    });
    mkt.approve(listing.id);
    const purchase = mkt.purchase(listing.id, 'buyer-1');

    mkt.completePayment(purchase.id);
    let earnings = mkt.getEarnings('seller-1');
    expect(earnings.total).toBe(85);
    expect(earnings.pending).toBe(85);
    const afterFirst = mkt.getListing(listing.id);
    expect(afterFirst.installs).toBe(1);
    expect(afterFirst.revenue).toBe(100);

    // Idempotent: a second completePayment must not double-credit.
    mkt.completePayment(purchase.id);
    earnings = mkt.getEarnings('seller-1');
    expect(earnings.total).toBe(85);
    expect(earnings.pending).toBe(85);
    const afterSecond = mkt.getListing(listing.id);
    expect(afterSecond.installs).toBe(1);
    expect(afterSecond.revenue).toBe(100);
  });

  test('free listing ($0) is auto-completed and credits installs/revenue immediately', () => {
    const mkt = new MarketplaceEngine();
    const listing = mkt.publish({
      name: 'Free template',
      type: 'template',
      category: 'automation',
      sellerId: 'seller-1',
      price: 0,
    });
    mkt.approve(listing.id);

    const purchase = mkt.purchase(listing.id, 'buyer-1');
    expect(purchase.status).toBe('completed');

    // Seller earning is $0 so earnings map stays empty, but installs/revenue
    // still reflect the completed transfer.
    const after = mkt.getListing(listing.id);
    expect(after.installs).toBe(1);
    expect(after.revenue).toBe(0);
    expect(mkt.getEarnings('seller-1')).toEqual({ total: 0, pending: 0, paid: 0 });
  });
});
