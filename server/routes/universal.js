/**
 * WAB Universal Agent — Server Routes
 * ═══════════════════════════════════════════════════════════════════
 * API endpoints for the Universal Agent mode.
 * Used by: WAB Browser, Chrome Extension, direct API calls.
 *
 * All endpoints work WITHOUT requiring the target site to install any script.
 */

const express = require('express');
const router = express.Router();
const scraper = require('../services/universal-scraper');
const priceIntel = require('../services/price-intelligence');
let urlPolicy;
try { urlPolicy = require('../security/url-policy'); } catch { urlPolicy = null; }
let fairness;
try { fairness = require('../services/fairness-engine'); } catch {
  fairness = {
    calculateFairnessScore: () => ({ score: 0, label: 'unrated' }),
    rankWithFairness: (_items) => _items,
    detectDarkPatterns: () => [],
    getTopFairSites: () => []
  };
}

// ─── POST /api/universal/extract ─────────────────────────────────────
// Extract prices/products from a URL (server-side fetch)
router.post('/extract', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL required' });

  if (urlPolicy) {
    const v = urlPolicy.check(url, { actor: urlPolicy.actorFromReq(req) });
    if (!v.ok) {
      return res.status(v.code === 'RATE_LIMITED' ? 429 : 400).json({ error: v.reason, code: v.code });
    }
  }

  try {
    const result = await scraper.fetchAndExtract(url);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/universal/analyze ─────────────────────────────────────
// Full analysis: extract + fraud detection + trust score
// Accepts either a URL (server-side fetch) or pre-extracted data (from browser)
router.post('/analyze', async (req, res) => {
  const { url, extraction } = req.body;

  try {
    let result;

    if (extraction) {
      // Data already extracted by browser/extension
      const processed = scraper.processBrowserExtraction(extraction);
      result = await priceIntel.analyzePrice(extraction.url || url || '', processed);

      // Add dark pattern detection if text available
      if (extraction.darkPatterns) {
        result.darkPatterns = extraction.darkPatterns;
      }
    } else if (url) {
      // Server-side fetch and analyze
      if (urlPolicy) {
        const v = urlPolicy.check(url, { actor: urlPolicy.actorFromReq(req) });
        if (!v.ok) {
          return res.status(v.code === 'RATE_LIMITED' ? 429 : 400).json({ error: v.reason, code: v.code });
        }
      }
      result = await priceIntel.analyzePrice(url);
    } else {
      return res.status(400).json({ error: 'URL or extraction data required' });
    }

    // Add fairness score for the domain
    if (result.domain) {
      result.fairness = fairness.calculateFairnessScore(result.domain, {
        fraudAlerts: (result.alerts || []).length,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/universal/compare ─────────────────────────────────────
// Compare prices across multiple sources
router.post('/compare', async (req, res) => {
  const { query, category, maxSources } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const result = await priceIntel.compareAcrossSources(
      query,
      category || 'product',
      { maxSources: maxSources || 8 }
    );

    // Apply fairness ranking
    if (result.results && result.results.length > 0) {
      result.results = fairness.rankWithFairness(result.results, {
        avgPrice: result.avgPrice,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/universal/deals ───────────────────────────────────────
// Find best deals with fairness ranking + fraud detection
router.post('/deals', async (req, res) => {
  const { query, category, lang } = req.body;
  if (!query) return res.status(400).json({ error: 'Query required' });

  try {
    const result = await priceIntel.findBestDeals(
      query,
      category || 'product',
      { lang: lang || 'en' }
    );

    // Apply fairness ranking to deals
    if (result.deals && result.deals.length > 0) {
      result.deals = fairness.rankWithFairness(result.deals, {
        avgPrice: result.deals.reduce((s, d) => s + (d.priceUsd || 0), 0) / result.deals.length,
      });
    }

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── POST /api/universal/fairness ────────────────────────────────────
// Get fairness score for a domain
router.post('/fairness', (req, res) => {
  const { domain, url } = req.body;
  const d = domain || (url ? (() => { try { return new URL(url).hostname; } catch (_) { return ''; } })() : '');
  if (!d) return res.status(400).json({ error: 'Domain or URL required' });

  const score = fairness.calculateFairnessScore(d);
  res.json(score);
});

// ─── POST /api/universal/dark-patterns ───────────────────────────────
// Detect dark patterns in page text
router.post('/dark-patterns', (req, res) => {
  const { text, lang } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });

  const patterns = fairness.detectDarkPatterns(text, lang || 'en');
  res.json({ patterns, count: patterns.length });
});

// ─── GET /api/universal/history ──────────────────────────────────────
// Get price history for a URL
router.get('/history', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL required' });

  const history = scraper.getPriceHistory(url, 30);
  res.json({ url, history });
});

// ─── GET /api/universal/top-fair ─────────────────────────────────────
// Get top fairness-ranked sites
router.get('/top-fair', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const sites = fairness.getTopFairSites(limit);
  res.json({ sites });
});

// ─── GET /api/universal/extraction-script ────────────────────────────
// Get the browser extraction script (for dynamic injection)
router.get('/extraction-script', (req, res) => {
  res.set('Content-Type', 'application/javascript');
  res.send(scraper.getBrowserExtractionScript());
});

// ─── GET /api/universal/sources ──────────────────────────────────────
// List all competing sources by category
router.get('/sources', (req, res) => {
  const { category } = req.query;
  if (category && priceIntel.COMPETING_SOURCES[category]) {
    res.json({ category, sources: priceIntel.COMPETING_SOURCES[category] });
  } else {
    res.json(priceIntel.COMPETING_SOURCES);
  }
});

module.exports = router;
