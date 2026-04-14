/**
 * WAB Price Intelligence Engine
 * ═══════════════════════════════════════════════════════════════════
 * Smart price analysis that works on ANY website:
 *
 * 1. Fraud Detection — detects fake discounts, price manipulation, hidden fees
 * 2. Price Comparison — compares across competing sources
 * 3. Hidden Deals — finds unadvertised deals, coupon codes, loyalty discounts
 * 4. Historical Analysis — tracks price trends over time
 * 5. Dynamic Pricing Shield — detects if a site changes prices based on user behavior
 *
 * Works without any script installation on target sites.
 */

const crypto = require('crypto');
const { db } = require('../models/db');
const scraper = require('./universal-scraper');
const { getWabBridgeInfo } = require('./fairness-engine');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS price_alerts (
    id TEXT PRIMARY KEY,
    url_hash TEXT NOT NULL,
    domain TEXT NOT NULL,
    alert_type TEXT NOT NULL,
    severity TEXT DEFAULT 'medium',
    title TEXT NOT NULL,
    description TEXT,
    evidence TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS deal_cache (
    id TEXT PRIMARY KEY,
    query TEXT NOT NULL,
    category TEXT,
    results TEXT DEFAULT '[]',
    sources_checked INTEGER DEFAULT 0,
    best_price REAL,
    best_source TEXT,
    fraud_flags INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_alerts_domain ON price_alerts(domain);
  CREATE INDEX IF NOT EXISTS idx_deal_cache_query ON deal_cache(query);
`);

const stmts = {
  insertAlert: db.prepare(`INSERT INTO price_alerts
    (id, url_hash, domain, alert_type, severity, title, description, evidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getAlerts: db.prepare('SELECT * FROM price_alerts WHERE domain = ? ORDER BY created_at DESC LIMIT ?'),
  insertDeal: db.prepare(`INSERT OR REPLACE INTO deal_cache
    (id, query, category, results, sources_checked, best_price, best_source, fraud_flags) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getDeal: db.prepare('SELECT * FROM deal_cache WHERE query = ? ORDER BY created_at DESC LIMIT 1'),
};

// ─── Competing Sources Database ──────────────────────────────────────

const COMPETING_SOURCES = {
  hotel: [
    { name: 'Booking.com', domain: 'booking.com', type: 'platform', size: 'big', url: 'https://www.booking.com/searchresults.html?ss=' },
    { name: 'Agoda', domain: 'agoda.com', type: 'platform', size: 'big', url: 'https://www.agoda.com/search?q=' },
    { name: 'Hotels.com', domain: 'hotels.com', type: 'platform', size: 'big', url: 'https://www.hotels.com/search.do?q=' },
    { name: 'Expedia', domain: 'expedia.com', type: 'platform', size: 'big', url: 'https://www.expedia.com/Hotel-Search?destination=' },
    { name: 'TripAdvisor', domain: 'tripadvisor.com', type: 'aggregator', size: 'big', url: 'https://www.tripadvisor.com/Hotels?q=' },
    { name: 'Kayak', domain: 'kayak.com', type: 'aggregator', size: 'medium', url: 'https://www.kayak.com/hotels?q=' },
    { name: 'Trivago', domain: 'trivago.com', type: 'aggregator', size: 'medium', url: 'https://www.trivago.com/search?q=' },
    { name: 'Hostelworld', domain: 'hostelworld.com', type: 'direct', size: 'small', url: 'https://www.hostelworld.com/find?q=' },
    { name: 'Almosafer', domain: 'almosafer.com', type: 'direct', size: 'small', url: 'https://www.almosafer.com/en/hotels?q=' },
    { name: 'Wego', domain: 'wego.com', type: 'aggregator', size: 'small', url: 'https://www.wego.com/hotels/search?q=' },
    // Direct hotel chains — small/independent get priority
    { name: 'Hotel Direct', domain: 'direct', type: 'direct', size: 'small', url: null },
  ],
  flight: [
    { name: 'Google Flights', domain: 'google.com/travel', type: 'aggregator', size: 'big', url: 'https://www.google.com/travel/flights?q=' },
    { name: 'Skyscanner', domain: 'skyscanner.com', type: 'aggregator', size: 'medium', url: 'https://www.skyscanner.com/transport/flights?q=' },
    { name: 'Kayak', domain: 'kayak.com', type: 'aggregator', size: 'medium', url: 'https://www.kayak.com/flights?search=' },
    { name: 'Kiwi.com', domain: 'kiwi.com', type: 'aggregator', size: 'small', url: 'https://www.kiwi.com/search?q=' },
    { name: 'Momondo', domain: 'momondo.com', type: 'aggregator', size: 'small', url: 'https://www.momondo.com/flight-search?q=' },
    { name: 'Wego', domain: 'wego.com', type: 'aggregator', size: 'small', url: 'https://www.wego.com/flights/search?q=' },
    { name: 'Almosafer', domain: 'almosafer.com', type: 'direct', size: 'small', url: 'https://www.almosafer.com/en/flights?q=' },
    { name: 'Flyin', domain: 'flyin.com', type: 'direct', size: 'small', url: 'https://www.flyin.com/flights?q=' },
  ],
  product: [
    { name: 'Amazon', domain: 'amazon.com', type: 'marketplace', size: 'big', url: 'https://www.amazon.com/s?k=' },
    { name: 'eBay', domain: 'ebay.com', type: 'marketplace', size: 'big', url: 'https://www.ebay.com/sch/?_nkw=' },
    { name: 'AliExpress', domain: 'aliexpress.com', type: 'marketplace', size: 'big', url: 'https://www.aliexpress.com/wholesale?SearchText=' },
    { name: 'Walmart', domain: 'walmart.com', type: 'marketplace', size: 'big', url: 'https://www.walmart.com/search?q=' },
    { name: 'Google Shopping', domain: 'shopping.google.com', type: 'aggregator', size: 'big', url: 'https://shopping.google.com/search?q=' },
    { name: 'PriceGrabber', domain: 'pricegrabber.com', type: 'aggregator', size: 'small', url: 'https://www.pricegrabber.com/search?q=' },
    { name: 'Shopzilla', domain: 'shopzilla.com', type: 'aggregator', size: 'small', url: 'https://www.shopzilla.com/search?q=' },
    { name: 'Etsy', domain: 'etsy.com', type: 'marketplace', size: 'medium', url: 'https://www.etsy.com/search?q=' },
  ],
};

// ─── Fraud Detection ─────────────────────────────────────────────────

const FRAUD_PATTERNS = {
  fakeDiscount: {
    name: 'Fake Discount',
    name_ar: 'خصم وهمي',
    detect: (product, history) => {
      // If "original price" is the same as what it's always been, the discount is fake
      if (!product.originalPrice || !product.price) return null;
      const discount = ((product.originalPrice - product.price) / product.originalPrice) * 100;

      // Check: is the "original price" actually the normal price?
      if (history.length >= 3) {
        const avgHistorical = history.reduce((sum, h) => sum + h.price, 0) / history.length;
        const originalNearAvg = Math.abs(product.originalPrice - avgHistorical) / avgHistorical < 0.1;
        if (originalNearAvg && discount > 5) {
          return {
            severity: discount > 30 ? 'high' : 'medium',
            title: `Fake ${Math.round(discount)}% discount detected`,
            title_ar: `تم كشف خصم وهمي ${Math.round(discount)}%`,
            description: `The "original price" $${product.originalPrice} is actually the normal price (avg: $${Math.round(avgHistorical)}). The real discount is ~0%.`,
            description_ar: `"السعر الأصلي" $${product.originalPrice} هو السعر العادي فعلياً (المتوسط: $${Math.round(avgHistorical)}). الخصم الحقيقي ~0%.`,
          };
        }
      }

      // Suspiciously high discount
      if (discount > 70) {
        return {
          severity: 'high',
          title: `Suspicious ${Math.round(discount)}% discount`,
          title_ar: `خصم مريب ${Math.round(discount)}%`,
          description: `A ${Math.round(discount)}% discount is unusually high and may be deceptive.`,
          description_ar: `خصم ${Math.round(discount)}% مرتفع بشكل غير عادي وقد يكون مخادعاً.`,
        };
      }
      return null;
    },
  },

  priceInflation: {
    name: 'Price Inflation',
    name_ar: 'تضخم الأسعار',
    detect: (product, history) => {
      if (history.length < 5 || !product.price) return null;
      const recentAvg = history.slice(0, 3).reduce((s, h) => s + h.price, 0) / 3;
      const olderAvg = history.slice(-3).reduce((s, h) => s + h.price, 0) / Math.min(3, history.length);
      const increase = ((recentAvg - olderAvg) / olderAvg) * 100;

      if (increase > 20) {
        return {
          severity: increase > 50 ? 'high' : 'medium',
          title: `Price inflated ${Math.round(increase)}% recently`,
          title_ar: `ارتفاع السعر ${Math.round(increase)}% مؤخراً`,
          description: `Price jumped from ~$${Math.round(olderAvg)} to ~$${Math.round(recentAvg)}. May be demand-based surge pricing.`,
          description_ar: `ارتفع السعر من ~$${Math.round(olderAvg)} إلى ~$${Math.round(recentAvg)}. قد يكون تسعيراً ديناميكياً.`,
        };
      }
      return null;
    },
  },

  hiddenFees: {
    name: 'Hidden Fees',
    name_ar: 'رسوم مخفية',
    detect: (product) => {
      // Check for common hidden fee indicators in product text
      const text = (product.description || '').toLowerCase() + ' ' + (product.name || '').toLowerCase();
      const feeWords = ['resort fee', 'cleaning fee', 'service fee', 'booking fee',
        'processing fee', 'facility fee', 'رسوم', 'ضريبة', 'خدمة'];
      const found = feeWords.filter(w => text.includes(w));

      if (found.length > 0) {
        return {
          severity: 'low',
          title: `Possible hidden fees: ${found.join(', ')}`,
          title_ar: `رسوم مخفية محتملة: ${found.join(', ')}`,
          description: `This listing mentions additional fees that may not be included in the displayed price.`,
          description_ar: `هذا العرض يذكر رسوماً إضافية قد لا تكون مضمنة في السعر المعروض.`,
        };
      }
      return null;
    },
  },

  dynamicPricing: {
    name: 'Dynamic Pricing',
    name_ar: 'تسعير ديناميكي',
    detect: (product, history) => {
      if (history.length < 3) return null;
      // Check if price changes frequently (more than 3 changes in last 10 records)
      let changes = 0;
      for (let i = 1; i < Math.min(history.length, 10); i++) {
        if (Math.abs(history[i].price - history[i - 1].price) > 1) changes++;
      }
      if (changes >= 3) {
        return {
          severity: 'medium',
          title: `Dynamic pricing detected (${changes} price changes)`,
          title_ar: `تسعير ديناميكي مكتشف (${changes} تغييرات)`,
          description: `This site changes prices frequently. Use Ghost Mode for best results.`,
          description_ar: `هذا الموقع يغير أسعاره بشكل متكرر. استخدم وضع الشبح للحصول على أفضل النتائج.`,
        };
      }
      return null;
    },
  },

  tooGoodToBeTrue: {
    name: 'Too Good To Be True',
    name_ar: 'أرخص من الطبيعي',
    detect: (product, _history, comparisons) => {
      if (!product.price || !comparisons || comparisons.length < 2) return null;
      const avgPrice = comparisons.reduce((s, c) => s + (c.priceUsd || 0), 0) / comparisons.length;
      if (avgPrice > 0 && product.price < avgPrice * 0.4) {
        return {
          severity: 'high',
          title: `Price is ${Math.round((1 - product.price / avgPrice) * 100)}% below market average`,
          title_ar: `السعر أقل من متوسط السوق بنسبة ${Math.round((1 - product.price / avgPrice) * 100)}%`,
          description: `Average across ${comparisons.length} sources: $${Math.round(avgPrice)}. This price ($${product.price}) may be a scam or bait-and-switch.`,
          description_ar: `المتوسط عبر ${comparisons.length} مصادر: $${Math.round(avgPrice)}. هذا السعر ($${product.price}) قد يكون احتيالاً.`,
        };
      }
      return null;
    },
  },
};

// ─── Analyze a single product/URL ────────────────────────────────────

async function analyzePrice(url, extractedData = null) {
  const domain = _extractDomain(url);
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);

  // Get or extract product data
  let products;
  if (extractedData && extractedData.products) {
    products = extractedData.products;
  } else {
    const result = await scraper.fetchAndExtract(url);
    products = result.products || [];
  }

  if (products.length === 0) {
    return { url, domain, products: [], alerts: [], message: 'No products found on this page' };
  }

  // Get price history
  const history = scraper.getPriceHistory(url, 30);

  // Run fraud detection on each product
  const alerts = [];
  for (const product of products) {
    for (const [key, detector] of Object.entries(FRAUD_PATTERNS)) {
      const alert = detector.detect(product, history, null);
      if (alert) {
        const id = crypto.randomUUID();
        alerts.push({ id, type: key, ...alert });
        try {
          stmts.insertAlert.run(id, urlHash, domain, key, alert.severity, alert.title, alert.description, JSON.stringify(alert));
        } catch (_) {}
      }
    }
  }

  return {
    url, domain, products, alerts, history: history.slice(0, 10),
    trustScore: _calculateTrustScore(domain, alerts, history),
  };
}

// ─── Cross-source Price Comparison ───────────────────────────────────

async function compareAcrossSources(query, category = 'product', options = {}) {
  const sources = COMPETING_SOURCES[category] || COMPETING_SOURCES.product;
  const results = [];
  const alerts = [];

  // Try to fetch from each source
  const fetchPromises = sources
    .filter(s => s.url) // skip null-URL sources
    .slice(0, options.maxSources || 8)
    .map(async (source) => {
      const searchUrl = source.url + encodeURIComponent(query);
      try {
        const data = await scraper.fetchAndExtract(searchUrl, { timeout: 8000 });
        if (data.products && data.products.length > 0) {
          // Check if this source has WAB bridge installed
          let wabBridge = null;
          try { wabBridge = getWabBridgeInfo(source.domain); } catch (_) {}

          for (const p of data.products) {
            results.push({
              source: source.name,
              domain: source.domain,
              type: source.type,
              size: source.size,
              url: searchUrl,
              name: p.name || query,
              price: p.price,
              currency: p.currency || 'USD',
              priceUsd: scraper.toUSD(p.price || 0, p.currency || 'USD'),
              rating: p.rating,
              availability: p.availability,
              method: p.method || 'fetch',
              wabBridge: !!wabBridge,
              canNegotiate: wabBridge?.hasNegotiation || false,
            });
          }
        }
      } catch (_) {
        // Source unavailable — skip
      }
    });

  await Promise.allSettled(fetchPromises);

  // Cross-source fraud detection
  if (results.length >= 2) {
    const avgPrice = results.reduce((s, r) => s + (r.priceUsd || 0), 0) / results.length;
    for (const r of results) {
      const tooGood = FRAUD_PATTERNS.tooGoodToBeTrue.detect({ price: r.priceUsd }, [], results);
      if (tooGood) alerts.push({ ...tooGood, source: r.source });
    }
  }

  // Cache the comparison
  const dealId = crypto.randomUUID();
  const best = results.sort((a, b) => (a.priceUsd || Infinity) - (b.priceUsd || Infinity))[0];
  try {
    stmts.insertDeal.run(
      dealId, query, category, JSON.stringify(results),
      results.length, best?.priceUsd || null, best?.source || null, alerts.length
    );
  } catch (_) {}

  return {
    query, category, results, alerts,
    best: best || null,
    sourcesChecked: results.length,
    avgPrice: results.length > 0 ? Math.round(results.reduce((s, r) => s + (r.priceUsd || 0), 0) / results.length) : null,
  };
}

// ─── Smart Deal Finder ───────────────────────────────────────────────
// Finds the best deals by combining comparison + fraud detection + fairness

async function findBestDeals(query, category = 'product', options = {}) {
  // Step 1: Compare across sources
  const comparison = await compareAcrossSources(query, category, options);

  // Step 2: Score each result
  const scored = comparison.results.map(r => {
    let score = 100;

    // Price score (lower is better) — 40 points max
    if (comparison.avgPrice && r.priceUsd) {
      const priceRatio = r.priceUsd / comparison.avgPrice;
      score += Math.round((1 - priceRatio) * 40);
    }

    // Source size bonus — small sites get +15, medium +5
    if (r.size === 'small') score += 15;
    else if (r.size === 'medium') score += 5;
    else if (r.size === 'big') score -= 5;

    // Direct booking bonus
    if (r.type === 'direct') score += 10;

    // Rating bonus
    if (r.rating && r.rating >= 4.0) score += 5;
    if (r.rating && r.rating >= 4.5) score += 5;

    // Availability bonus
    if (r.availability === 'InStock') score += 5;

    // ── WAB Bridge Priority ─────────────────────────────────────────
    // Sites with the WAB script installed get priority in deals ranking
    let wabBridge = null;
    try { wabBridge = getWabBridgeInfo(r.domain); } catch (_) {}

    if (wabBridge) {
      score += 20; // Base bridge bonus
      if (wabBridge.hasNegotiation) score += 15; // Negotiation = potential better deal
      if (wabBridge.isListed) score += 5; // Listed in WAB directory
      r.wabBridge = true;
      r.canNegotiate = wabBridge.hasNegotiation;
    }

    // Fraud penalty
    const fraudAlerts = comparison.alerts.filter(a => a.source === r.source);
    score -= fraudAlerts.length * 20;

    return { ...r, score, fraudAlerts };
  });

  // Step 3: Sort by score (fairness-weighted)
  scored.sort((a, b) => b.score - a.score);

  // Step 4: Generate insights
  const insights = _generateInsights(scored, comparison, options.lang || 'en');

  return {
    query,
    category,
    deals: scored,
    best: scored[0] || null,
    alerts: comparison.alerts,
    insights,
    sourcesChecked: comparison.sourcesChecked,
  };
}

// ─── Insights Generator ─────────────────────────────────────────────

function _generateInsights(deals, comparison, lang) {
  const insights = [];
  const ar = lang === 'ar';

  if (deals.length === 0) {
    insights.push({
      icon: '🔍',
      text: ar ? 'لم يتم العثور على نتائج. جرب تعديل البحث.' : 'No results found. Try modifying your search.',
    });
    return insights;
  }

  // Price range insight
  const prices = deals.filter(d => d.priceUsd > 0).map(d => d.priceUsd);
  if (prices.length >= 2) {
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const savings = max - min;
    if (savings > 0) {
      insights.push({
        icon: '💰',
        text: ar
          ? `فارق الأسعار بين المصادر: $${Math.round(savings)} (من $${Math.round(min)} إلى $${Math.round(max)})`
          : `Price range across sources: $${Math.round(savings)} spread ($${Math.round(min)} to $${Math.round(max)})`,
        type: 'savings',
      });
    }
  }

  // Small business recommendation
  const smallDeals = deals.filter(d => d.size === 'small' && d.priceUsd > 0);
  if (smallDeals.length > 0 && comparison.avgPrice) {
    const bestSmall = smallDeals[0];
    if (bestSmall.priceUsd <= comparison.avgPrice * 1.05) {
      insights.push({
        icon: '🏪',
        text: ar
          ? `${bestSmall.source} (موقع مستقل) يقدم سعراً منافساً: $${Math.round(bestSmall.priceUsd)} — ادعم الأعمال الصغيرة!`
          : `${bestSmall.source} (independent site) offers competitive pricing: $${Math.round(bestSmall.priceUsd)} — support small business!`,
        type: 'fairness',
      });
    }
  }

  // Fraud warnings
  if (comparison.alerts.length > 0) {
    insights.push({
      icon: '⚠️',
      text: ar
        ? `تم اكتشاف ${comparison.alerts.length} تحذير(ات) احتيال. تحقق من التفاصيل أدناه.`
        : `${comparison.alerts.length} fraud warning(s) detected. Check details below.`,
      type: 'warning',
    });
  }

  // Direct booking tip
  const directDeals = deals.filter(d => d.type === 'direct');
  if (directDeals.length > 0) {
    insights.push({
      icon: '🔗',
      text: ar
        ? 'الحجز المباشر متاح — غالباً أرخص من المنصات الكبيرة وبدون عمولات مخفية.'
        : 'Direct booking available — often cheaper than big platforms with no hidden commissions.',
      type: 'tip',
    });
  }

  // Ghost Mode tip if dynamic pricing detected
  const dynamicAlert = comparison.alerts.find(a => a.type === 'dynamicPricing');
  if (dynamicAlert) {
    insights.push({
      icon: '👻',
      text: ar
        ? 'تم اكتشاف تسعير ديناميكي! استخدم وضع الشبح (Ghost Mode) للحصول على أسعار أفضل.'
        : 'Dynamic pricing detected! Use Ghost Mode to get better prices.',
      type: 'ghost',
    });
  }

  // WAB Bridge sites — negotiation available
  const bridgeDeals = deals.filter(d => d.wabBridge);
  if (bridgeDeals.length > 0) {
    const negotiable = bridgeDeals.filter(d => d.canNegotiate);
    if (negotiable.length > 0) {
      insights.push({
        icon: '🤝',
        text: ar
          ? `${negotiable.map(d => d.source).join(', ')} — مواقع متعاونة مع WAB! يمكن التفاوض على السعر تلقائياً للحصول على خصم أفضل.`
          : `${negotiable.map(d => d.source).join(', ')} — WAB-enabled sites! Auto-negotiation available for better prices.`,
        type: 'wab-bridge',
      });
    } else {
      insights.push({
        icon: '🌉',
        text: ar
          ? `${bridgeDeals.map(d => d.source).join(', ')} — مواقع مثبت عليها جسر WAB. بيانات أكثر دقة وموثوقية.`
          : `${bridgeDeals.map(d => d.source).join(', ')} — WAB Bridge sites. More accurate and reliable data.`,
        type: 'wab-bridge',
      });
    }
  }

  return insights;
}

// ─── Trust Score ─────────────────────────────────────────────────────

function _calculateTrustScore(domain, alerts, history) {
  let score = 70; // neutral start

  // More history = more trustworthy
  if (history.length >= 10) score += 10;
  else if (history.length >= 5) score += 5;

  // Alerts reduce trust
  for (const a of alerts) {
    if (a.severity === 'high') score -= 25;
    else if (a.severity === 'medium') score -= 15;
    else score -= 5;
  }

  // Known trustworthy domains
  const trusted = ['booking.com', 'airbnb.com', 'hotels.com', 'expedia.com', 'amazon.com'];
  if (trusted.includes(domain)) score += 10;

  // Local/small indicators
  const smallTlds = ['.local', '.shop', '.store', '.boutique'];
  if (smallTlds.some(t => domain.endsWith(t))) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function getAlerts(domain, limit = 20) {
  return stmts.getAlerts.all(domain, limit);
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  analyzePrice,
  compareAcrossSources,
  findBestDeals,
  getAlerts,
  COMPETING_SOURCES,
  FRAUD_PATTERNS,
};
