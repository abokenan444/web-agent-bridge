/**
 * WAB Price Time Machine (06-price-time-machine) — PUBLIC API, PRIVATE ENGINE
 * Historical price tracking and fake discount detection.
 * API is open, database and detection algorithm are closed.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');

const priceStore = new Map();
const alertStore = new Map();

let priceEngine;
try { priceEngine = require('./price-engine'); } catch { priceEngine = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/track', (req, res) => {
    const { platform, product_id, product_name, price, currency, url: productUrl } = req.body;
    if (!platform || !product_id || price === undefined) {
      return res.status(400).json({ error: 'platform, product_id, and price are required' });
    }

    const key = `${platform}:${product_id}`;
    if (!priceStore.has(key)) priceStore.set(key, { entries: [], metadata: { platform, product_id, product_name, currency: currency || 'USD', url: productUrl } });
    const record = priceStore.get(key);
    record.entries.push({ price: parseFloat(price), timestamp: Date.now(), date: new Date().toISOString() });
    if (record.entries.length > 5000) record.entries.splice(0, record.entries.length - 5000);

    const prices = record.entries.map(e => e.price);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    const min = Math.min(...prices);
    const max = Math.max(...prices);

    let fakeDiscount = null;
    if (priceEngine) {
      fakeDiscount = priceEngine.detectFakeDiscount(record.entries);
    }

    res.json({
      tracked: true, product_id, platform, current_price: price, data_points: record.entries.length,
      statistics: { average: parseFloat(avg.toFixed(2)), min, max, range_pct: parseFloat(((max - min) / avg * 100).toFixed(1)) },
      fake_discount: fakeDiscount,
    });
  });

  router.get('/history/:platform/:productId', (req, res) => {
    const key = `${req.params.platform}:${req.params.productId}`;
    const record = priceStore.get(key);
    if (!record) return res.status(404).json({ error: 'No price history for this product' });
    const days = parseInt(req.query.days) || 30;
    const cutoff = Date.now() - days * 86400000;
    const filtered = record.entries.filter(e => e.timestamp >= cutoff);
    res.json({ ...record.metadata, period_days: days, data_points: filtered.length, history: filtered });
  });

  router.get('/compare', (req, res) => {
    const { product_name } = req.query;
    if (!product_name) return res.status(400).json({ error: 'product_name query param required' });
    const results = [];
    const search = product_name.toLowerCase();
    for (const [key, record] of priceStore) {
      if (record.metadata.product_name && record.metadata.product_name.toLowerCase().includes(search)) {
        const prices = record.entries.map(e => e.price);
        results.push({ platform: record.metadata.platform, product_id: record.metadata.product_id, product_name: record.metadata.product_name,
          current_price: prices[prices.length - 1], lowest_price: Math.min(...prices), highest_price: Math.max(...prices), data_points: prices.length });
      }
    }
    res.json({ query: product_name, results: results.sort((a, b) => a.current_price - b.current_price) });
  });

  router.get('/stats', (req, res) => {
    let totalPoints = 0;
    for (const r of priceStore.values()) totalPoints += r.entries.length;
    res.json({ products_tracked: priceStore.size, total_data_points: totalPoints, alerts_active: alertStore.size });
  });

  return router;
}

module.exports = { createRouter };
