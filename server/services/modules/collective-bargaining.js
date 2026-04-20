/**
 * WAB Collective Bargaining (04-collective-bargaining) — PUBLIC JOIN API, PRIVATE MATCHING ENGINE
 * Groups buyers to negotiate bulk discounts.
 * Join interface is open, matching engine is closed.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');

const demandPools = new Map();
const NEGOTIATION_THRESHOLDS = {
  electronics: { minBuyers: 10, targetDiscount: 0.15 },
  travel: { minBuyers: 5, targetDiscount: 0.20 },
  fashion: { minBuyers: 20, targetDiscount: 0.25 },
  software: { minBuyers: 50, targetDiscount: 0.30 },
  default: { minBuyers: 15, targetDiscount: 0.15 },
};

let matchingEngine;
try { matchingEngine = require('./bargaining-engine'); } catch { matchingEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/join', (req, res) => {
    const { platform, product_id, product_name, category, current_price, currency, max_price } = req.body;
    if (!platform || !product_id || !current_price) {
      return res.status(400).json({ error: 'platform, product_id, and current_price required' });
    }

    const poolKey = `${platform}:${product_id}`;
    if (!demandPools.has(poolKey)) {
      const cat = category || 'default';
      const threshold = NEGOTIATION_THRESHOLDS[cat] || NEGOTIATION_THRESHOLDS.default;
      demandPools.set(poolKey, {
        id: 'POOL-' + crypto.randomBytes(8).toString('hex').toUpperCase(),
        platform, product_id, product_name: product_name || product_id,
        category: cat, current_price: parseFloat(current_price), currency: currency || 'USD',
        target_price: parseFloat((current_price * (1 - threshold.targetDiscount)).toFixed(2)),
        target_discount_pct: Math.round(threshold.targetDiscount * 100),
        min_buyers: threshold.minBuyers, members: 0, status: 'OPEN',
        created_at: new Date().toISOString(),
      });
    }

    const pool = demandPools.get(poolKey);
    if (pool.status !== 'OPEN') return res.status(400).json({ error: 'Pool is not open' });
    pool.members++;

    if (matchingEngine && pool.members >= pool.min_buyers) {
      const deal = matchingEngine.negotiate(pool);
      pool.status = deal ? 'DEAL_REACHED' : 'NEGOTIATING';
    }

    res.json({
      success: true, pool_id: pool.id, member_count: pool.members, status: pool.status,
      progress_pct: Math.min(100, Math.round(pool.members / pool.min_buyers * 100)),
      members_needed: Math.max(0, pool.min_buyers - pool.members),
      target_price: pool.target_price, target_discount_pct: pool.target_discount_pct,
    });
  });

  router.get('/pools', (req, res) => {
    const pools = Array.from(demandPools.values()).map(p => ({
      pool_id: p.id, platform: p.platform, product_name: p.product_name,
      current_price: p.current_price, target_price: p.target_price,
      members: p.members, min_buyers: p.min_buyers, status: p.status,
      progress_pct: Math.min(100, Math.round(p.members / p.min_buyers * 100)),
    }));
    res.json({ total: pools.length, pools: pools.filter(p => p.status === 'OPEN').slice(0, 50) });
  });

  router.get('/pool/:id', (req, res) => {
    const pool = Array.from(demandPools.values()).find(p => p.id === req.params.id);
    if (!pool) return res.status(404).json({ error: 'Pool not found' });
    res.json(pool);
  });

  router.get('/stats', (req, res) => {
    let totalMembers = 0, activePoolsCount = 0;
    for (const p of demandPools.values()) { totalMembers += p.members; if (p.status === 'OPEN') activePoolsCount++; }
    res.json({ total_pools: demandPools.size, active_pools: activePoolsCount, total_participants: totalMembers });
  });

  return router;
}

module.exports = { createRouter };
