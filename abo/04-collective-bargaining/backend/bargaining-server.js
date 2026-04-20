/**
 * WAB Collective Bargaining Engine
 * Groups buyers anonymously to negotiate bulk discounts from platforms.
 * Matches users wanting the same product, aggregates demand, and
 * triggers automated negotiation requests to sellers.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const url = require('url');

// ─── In-memory stores ─────────────────────────────────────────────────────────
const demandPools = new Map();   // poolId → DemandPool
const userPools = new Map();     // userToken → Set<poolId>
const deals = new Map();         // dealId → NegotiatedDeal
const notifications = new Map(); // userToken → [notification]

// ─── Thresholds for triggering negotiation ────────────────────────────────────
const NEGOTIATION_THRESHOLDS = {
  electronics: { minBuyers: 10, targetDiscount: 0.15 },
  travel: { minBuyers: 5, targetDiscount: 0.20 },
  fashion: { minBuyers: 20, targetDiscount: 0.25 },
  software: { minBuyers: 50, targetDiscount: 0.30 },
  default: { minBuyers: 15, targetDiscount: 0.15 },
};

// ─── Demand Pool ──────────────────────────────────────────────────────────────
class DemandPool {
  constructor({ platform, productId, productName, category, currentPrice, currency }) {
    this.id = 'POOL-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    this.platform = platform;
    this.productId = productId;
    this.productName = productName;
    this.category = category || 'default';
    this.currentPrice = parseFloat(currentPrice);
    this.currency = currency || 'USD';
    this.createdAt = Date.now();
    this.expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    this.members = new Map(); // userToken → { joinedAt, maxPrice, anonymous }
    this.status = 'OPEN'; // OPEN | NEGOTIATING | DEAL_REACHED | EXPIRED | FAILED
    this.negotiationAttempts = 0;
    this.dealId = null;

    const threshold = NEGOTIATION_THRESHOLDS[this.category] || NEGOTIATION_THRESHOLDS.default;
    this.minBuyers = threshold.minBuyers;
    this.targetDiscountPct = threshold.targetDiscount;
    this.targetPrice = parseFloat((this.currentPrice * (1 - threshold.targetDiscount)).toFixed(2));
  }

  get memberCount() { return this.members.size; }
  get progressPct() { return Math.min(100, Math.round(this.memberCount / this.minBuyers * 100)); }
  get isReady() { return this.memberCount >= this.minBuyers && this.status === 'OPEN'; }

  join(userToken, maxPrice) {
    if (this.status !== 'OPEN') return { success: false, reason: 'Pool is not open for joining' };
    if (this.members.has(userToken)) return { success: false, reason: 'Already in this pool' };
    if (Date.now() > this.expiresAt) {
      this.status = 'EXPIRED';
      return { success: false, reason: 'Pool has expired' };
    }

    this.members.set(userToken, {
      joinedAt: Date.now(),
      maxPrice: maxPrice || this.currentPrice,
      anonymous: true,
    });

    // Check if we hit the threshold
    if (this.isReady) {
      this.triggerNegotiation();
    }

    return {
      success: true,
      pool_id: this.id,
      member_count: this.memberCount,
      progress_pct: this.progressPct,
      members_needed: Math.max(0, this.minBuyers - this.memberCount),
      target_price: this.targetPrice,
      target_discount_pct: Math.round(this.targetDiscountPct * 100),
    };
  }

  leave(userToken) {
    if (!this.members.has(userToken)) return { success: false, reason: 'Not in this pool' };
    this.members.delete(userToken);
    return { success: true, member_count: this.memberCount };
  }

  triggerNegotiation() {
    if (this.status !== 'OPEN') return;
    this.status = 'NEGOTIATING';
    this.negotiationAttempts++;

    // Calculate weighted average max price from all members
    const memberPrices = Array.from(this.members.values()).map(m => m.maxPrice);
    const avgMaxPrice = memberPrices.reduce((a, b) => a + b, 0) / memberPrices.length;
    const negotiationPrice = Math.min(avgMaxPrice, this.targetPrice);

    // Simulate negotiation (in production: send API request to platform)
    setTimeout(() => {
      this.resolveNegotiation(negotiationPrice);
    }, 2000 + Math.random() * 3000);
  }

  resolveNegotiation(negotiationPrice) {
    // Simulate platform response (in production: parse actual API response)
    const platformAccepts = Math.random() > 0.3; // 70% acceptance rate in simulation
    const finalDiscount = platformAccepts
      ? this.targetDiscountPct * (0.7 + Math.random() * 0.3) // 70-100% of target
      : this.targetDiscountPct * (0.1 + Math.random() * 0.3); // 10-40% partial

    const finalPrice = parseFloat((this.currentPrice * (1 - finalDiscount)).toFixed(2));
    const savings = parseFloat((this.currentPrice - finalPrice).toFixed(2));

    if (platformAccepts || finalDiscount > 0.05) {
      this.status = 'DEAL_REACHED';
      const dealId = 'DEAL-' + crypto.randomBytes(8).toString('hex').toUpperCase();
      this.dealId = dealId;

      const deal = {
        id: dealId,
        pool_id: this.id,
        platform: this.platform,
        product_id: this.productId,
        product_name: this.productName,
        original_price: this.currentPrice,
        final_price: finalPrice,
        savings_per_unit: savings,
        discount_pct: parseFloat((finalDiscount * 100).toFixed(1)),
        total_buyers: this.memberCount,
        total_savings: parseFloat((savings * this.memberCount).toFixed(2)),
        currency: this.currency,
        deal_code: 'WAB-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        valid_until: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        created_at: new Date().toISOString(),
        status: 'ACTIVE',
      };

      deals.set(dealId, deal);

      // Notify all members
      this.members.forEach((_, token) => {
        if (!notifications.has(token)) notifications.set(token, []);
        notifications.get(token).push({
          type: 'DEAL_REACHED',
          deal_id: dealId,
          message: `Deal reached! Save ${deal.discount_pct}% on ${this.productName}`,
          deal_code: deal.deal_code,
          final_price: finalPrice,
          timestamp: Date.now(),
        });
      });
    } else {
      this.status = 'FAILED';
      this.members.forEach((_, token) => {
        if (!notifications.has(token)) notifications.set(token, []);
        notifications.get(token).push({
          type: 'NEGOTIATION_FAILED',
          pool_id: this.id,
          message: `Negotiation for ${this.productName} did not reach target. Retrying...`,
          timestamp: Date.now(),
        });
      });

      // Auto-retry after 24 hours
      setTimeout(() => {
        if (this.memberCount >= this.minBuyers) {
          this.status = 'OPEN';
          this.triggerNegotiation();
        }
      }, 24 * 60 * 60 * 1000);
    }
  }

  toJSON() {
    return {
      id: this.id,
      platform: this.platform,
      product_id: this.productId,
      product_name: this.productName,
      category: this.category,
      current_price: this.currentPrice,
      target_price: this.targetPrice,
      target_discount_pct: Math.round(this.targetDiscountPct * 100),
      currency: this.currency,
      member_count: this.memberCount,
      min_buyers_needed: this.minBuyers,
      members_still_needed: Math.max(0, this.minBuyers - this.memberCount),
      progress_pct: this.progressPct,
      status: this.status,
      deal_id: this.dealId,
      created_at: new Date(this.createdAt).toISOString(),
      expires_at: new Date(this.expiresAt).toISOString(),
    };
  }
}

// ─── Pool Manager ─────────────────────────────────────────────────────────────
class CollectiveBargainingEngine {
  constructor() {
    this.stats = {
      totalPools: 0,
      totalDeals: 0,
      totalSavings: 0,
      totalBuyers: 0,
      startTime: Date.now(),
    };
    // Seed with some demo pools
    this._seedDemoPools();
  }

  _seedDemoPools() {
    const demoPools = [
      { platform: 'amazon.com', productId: 'B08N5WRWNW', productName: 'Apple AirPods Pro (2nd Gen)', category: 'electronics', currentPrice: 249.99, currency: 'USD' },
      { platform: 'booking.com', productId: 'hotel-paris-001', productName: 'Paris Marriott Hotel — 3 nights', category: 'travel', currentPrice: 450.00, currency: 'EUR' },
      { platform: 'adobe.com', productId: 'creative-cloud-annual', productName: 'Adobe Creative Cloud Annual', category: 'software', currentPrice: 599.88, currency: 'USD' },
      { platform: 'nike.com', productId: 'air-max-2024', productName: 'Nike Air Max 2024', category: 'fashion', currentPrice: 180.00, currency: 'USD' },
    ];

    demoPools.forEach(data => {
      const pool = new DemandPool(data);
      // Add some fake members to show progress
      const fakeCount = Math.floor(Math.random() * pool.minBuyers * 0.8);
      for (let i = 0; i < fakeCount; i++) {
        pool.members.set('demo-user-' + i, { joinedAt: Date.now(), maxPrice: data.currentPrice * 0.9, anonymous: true });
      }
      demandPools.set(pool.id, pool);
      this.stats.totalPools++;
    });
  }

  findOrCreatePool(data) {
    // Find existing open pool for same product
    for (const [, pool] of demandPools) {
      if (pool.platform === data.platform &&
          pool.productId === data.productId &&
          pool.status === 'OPEN') {
        return pool;
      }
    }
    // Create new pool
    const pool = new DemandPool(data);
    demandPools.set(pool.id, pool);
    this.stats.totalPools++;
    return pool;
  }

  getActivePools(filters = {}) {
    const result = [];
    for (const [, pool] of demandPools) {
      if (filters.status && pool.status !== filters.status) continue;
      if (filters.platform && pool.platform !== filters.platform) continue;
      if (filters.category && pool.category !== filters.category) continue;
      result.push(pool.toJSON());
    }
    return result.sort((a, b) => b.progress_pct - a.progress_pct);
  }
}

const engine = new CollectiveBargainingEngine();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WAB-User-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);
  const userToken = req.headers['x-wab-user-token'] ||
    parsedUrl.query.token ||
    'anon-' + crypto.randomBytes(8).toString('hex');

  // GET /bargain/pools — List all active pools
  if (req.method === 'GET' && parsedUrl.pathname === '/bargain/pools') {
    const pools = engine.getActivePools({
      status: parsedUrl.query.status || 'OPEN',
      platform: parsedUrl.query.platform,
      category: parsedUrl.query.category,
    });
    res.writeHead(200);
    res.end(JSON.stringify({ pools, total: pools.length }));
    return;
  }

  // POST /bargain/join — Join or create a pool
  if (req.method === 'POST' && parsedUrl.pathname === '/bargain/join') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.platform || !data.productId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'platform and productId required' }));
          return;
        }
        const pool = engine.findOrCreatePool(data);
        const result = pool.join(userToken, data.maxPrice);

        if (result.success) {
          if (!userPools.has(userToken)) userPools.set(userToken, new Set());
          userPools.get(userToken).add(pool.id);
          engine.stats.totalBuyers++;
        }

        res.writeHead(result.success ? 200 : 400);
        res.end(JSON.stringify({ ...result, pool: pool.toJSON() }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // DELETE /bargain/leave/:poolId — Leave a pool
  const leaveMatch = parsedUrl.pathname.match(/^\/bargain\/leave\/(.+)$/);
  if (req.method === 'DELETE' && leaveMatch) {
    const pool = demandPools.get(leaveMatch[1]);
    if (!pool) { res.writeHead(404); res.end(JSON.stringify({ error: 'Pool not found' })); return; }
    const result = pool.leave(userToken);
    res.writeHead(200);
    res.end(JSON.stringify(result));
    return;
  }

  // GET /bargain/deal/:dealId — Get deal details
  const dealMatch = parsedUrl.pathname.match(/^\/bargain\/deal\/(.+)$/);
  if (req.method === 'GET' && dealMatch) {
    const deal = deals.get(dealMatch[1]);
    if (!deal) { res.writeHead(404); res.end(JSON.stringify({ error: 'Deal not found' })); return; }
    res.writeHead(200);
    res.end(JSON.stringify(deal));
    return;
  }

  // GET /bargain/notifications — Get user notifications
  if (req.method === 'GET' && parsedUrl.pathname === '/bargain/notifications') {
    const userNotifs = notifications.get(userToken) || [];
    notifications.set(userToken, []); // Clear after reading
    res.writeHead(200);
    res.end(JSON.stringify({ notifications: userNotifs, count: userNotifs.length }));
    return;
  }

  // GET /bargain/stats
  if (parsedUrl.pathname === '/bargain/stats') {
    res.writeHead(200);
    res.end(JSON.stringify({
      total_pools: engine.stats.totalPools,
      active_pools: engine.getActivePools({ status: 'OPEN' }).length,
      deals_reached: deals.size,
      total_buyers_served: engine.stats.totalBuyers,
      total_savings_usd: engine.stats.totalSavings,
    }));
    return;
  }

  if (parsedUrl.pathname === '/bargain/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_BARGAIN_PORT) || 3004;
server.listen(PORT, () => {
  console.log(`[WAB Collective Bargaining] Running on port ${PORT}`);
  console.log(`[WAB Collective Bargaining] Active pools: ${demandPools.size}`);
});

module.exports = { CollectiveBargainingEngine, DemandPool };
