/**
 * WAB Universal Scraper Engine
 * ═══════════════════════════════════════════════════════════════════
 * Works with ANY website — no script installation required.
 * Extracts prices, products, availability from raw HTML/DOM.
 *
 * Three extraction modes:
 *   1. Schema.org JSON-LD (structured, most reliable)
 *   2. Open Graph / Meta tags (semi-structured)
 *   3. DOM pattern matching (heuristic, any site)
 *
 * Used by: WAB Browser (webview), Chrome Extension (content script),
 *          Server-side fetch (Node.js)
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS scraped_prices (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    domain TEXT NOT NULL,
    product_name TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    original_price REAL,
    availability TEXT,
    rating REAL,
    review_count INTEGER,
    seller TEXT,
    category TEXT,
    extraction_method TEXT,
    raw_data TEXT DEFAULT '{}',
    scraped_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS universal_price_history (
    id TEXT PRIMARY KEY,
    url_hash TEXT NOT NULL,
    domain TEXT NOT NULL,
    product_name TEXT,
    price REAL,
    currency TEXT DEFAULT 'USD',
    recorded_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scraped_domain ON scraped_prices(domain);
  CREATE INDEX IF NOT EXISTS idx_scraped_url ON scraped_prices(url);
  CREATE INDEX IF NOT EXISTS idx_uph_hash ON universal_price_history(url_hash);
`);

const stmts = {
  insertScraped: db.prepare(`INSERT OR REPLACE INTO scraped_prices
    (id, url, domain, product_name, price, currency, original_price,
     availability, rating, review_count, seller, category, extraction_method, raw_data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getByUrl: db.prepare('SELECT * FROM scraped_prices WHERE url = ? ORDER BY scraped_at DESC LIMIT 1'),
  getByDomain: db.prepare('SELECT * FROM scraped_prices WHERE domain = ? ORDER BY scraped_at DESC LIMIT ?'),
  insertHistory: db.prepare(`INSERT INTO universal_price_history
    (id, url_hash, domain, product_name, price, currency) VALUES (?, ?, ?, ?, ?, ?)`),
  getHistory: db.prepare('SELECT * FROM universal_price_history WHERE url_hash = ? ORDER BY recorded_at DESC LIMIT ?'),
};

// ─── Currency Normalization ──────────────────────────────────────────

const CURRENCY_MAP = {
  '$': 'USD', 'USD': 'USD', 'US$': 'USD',
  '€': 'EUR', 'EUR': 'EUR',
  '£': 'GBP', 'GBP': 'GBP',
  'SAR': 'SAR', 'ريال': 'SAR', 'ر.س': 'SAR',
  'AED': 'AED', 'درهم': 'AED', 'د.إ': 'AED',
  'TND': 'TND', 'دينار': 'TND', 'د.ت': 'TND',
  'EGP': 'EGP', 'ج.م': 'EGP',
  'MAD': 'MAD', 'د.م': 'MAD',
  'TRY': 'TRY', '₺': 'TRY',
  'JPY': 'JPY', '¥': 'JPY',
  'INR': 'INR', '₹': 'INR',
  'KRW': 'KRW', '₩': 'KRW',
};

// Approximate USD rates for comparison
const TO_USD = {
  USD: 1, EUR: 1.08, GBP: 1.27, SAR: 0.27, AED: 0.27,
  TND: 0.32, EGP: 0.032, MAD: 0.10, TRY: 0.031,
  JPY: 0.0067, INR: 0.012, KRW: 0.00074,
};

function normalizeCurrency(symbol) {
  if (!symbol) return 'USD';
  const s = symbol.trim().toUpperCase();
  return CURRENCY_MAP[s] || CURRENCY_MAP[symbol.trim()] || 'USD';
}

function toUSD(price, currency) {
  const rate = TO_USD[currency] || 1;
  return Math.round(price * rate * 100) / 100;
}

// ─── Price Extraction ────────────────────────────────────────────────

const PRICE_PATTERNS = [
  // $123.45 or $ 123.45
  /(?<currency>\$|USD|US\$)\s*(?<price>[\d,]+\.?\d*)/gi,
  // €123.45
  /(?<currency>€|EUR)\s*(?<price>[\d,]+\.?\d*)/gi,
  // £123.45
  /(?<currency>£|GBP)\s*(?<price>[\d,]+\.?\d*)/gi,
  // 123.45 SAR / ريال
  /(?<price>[\d,]+\.?\d*)\s*(?<currency>SAR|ريال|ر\.س|AED|درهم|د\.إ|TND|دينار|د\.ت|EGP|ج\.م|MAD|د\.م)/gi,
  // ₺ ₹ ¥ ₩ prefixed
  /(?<currency>[₺₹¥₩])\s*(?<price>[\d,]+\.?\d*)/gi,
  // 123.45$ (suffix dollar)
  /(?<price>[\d,]+\.?\d*)\s*(?<currency>\$|€|£)/gi,
];

function extractPrices(text) {
  const prices = [];
  const seen = new Set();

  for (const pattern of PRICE_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      const raw = m.groups?.price || m[2] || m[1];
      const currSymbol = m.groups?.currency || m[1] || m[2];
      if (!raw) continue;

      const num = parseFloat(raw.replace(/,/g, ''));
      if (isNaN(num) || num <= 0 || num > 1000000) continue;

      const currency = normalizeCurrency(currSymbol);
      const key = `${num}-${currency}`;
      if (seen.has(key)) continue;
      seen.add(key);

      prices.push({ price: num, currency, usd: toUSD(num, currency), raw: m[0].trim() });
    }
  }

  return prices.sort((a, b) => a.usd - b.usd);
}

// ─── Schema.org JSON-LD Extraction ───────────────────────────────────

function extractJsonLd(html) {
  const products = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;

  while ((m = regex.exec(html)) !== null) {
    try {
      let data = JSON.parse(m[1].trim());
      if (Array.isArray(data)) data.forEach(d => processJsonLd(d, products));
      else processJsonLd(data, products);
    } catch (_) {}
  }

  return products;
}

function processJsonLd(data, products) {
  if (!data || typeof data !== 'object') return;

  // Handle @graph arrays
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    data['@graph'].forEach(item => processJsonLd(item, products));
    return;
  }

  const type = (data['@type'] || '').toLowerCase();

  if (type === 'product' || type === 'hotel' || type === 'hotelroom' ||
      type === 'lodgingbusiness' || type === 'offer') {
    const offers = data.offers || data.priceSpecification || {};
    const offer = Array.isArray(offers) ? offers[0] : offers;

    products.push({
      name: data.name || data.headline || null,
      price: parseFloat(offer?.price || offer?.lowPrice || data.price) || null,
      originalPrice: parseFloat(offer?.highPrice) || null,
      currency: offer?.priceCurrency || 'USD',
      availability: offer?.availability?.replace('https://schema.org/', '').replace('http://schema.org/', '') || null,
      rating: parseFloat(data.aggregateRating?.ratingValue) || null,
      reviewCount: parseInt(data.aggregateRating?.reviewCount || data.aggregateRating?.ratingCount) || null,
      image: data.image?.url || (typeof data.image === 'string' ? data.image : null),
      description: (data.description || '').slice(0, 500),
      brand: data.brand?.name || data.brand || null,
      sku: data.sku || null,
      url: data.url || null,
      method: 'json-ld',
    });
  }

  // Recurse into nested objects
  for (const key of Object.keys(data)) {
    if (typeof data[key] === 'object' && data[key] !== null && key !== '@context') {
      if (Array.isArray(data[key])) {
        data[key].forEach(item => {
          if (typeof item === 'object') processJsonLd(item, products);
        });
      } else {
        processJsonLd(data[key], products);
      }
    }
  }
}

// ─── Open Graph / Meta Tag Extraction ────────────────────────────────

function extractMetaTags(html) {
  const meta = {};
  const metaRegex = /<meta\s+(?:[^>]*?(?:property|name)=["']([^"']+)["'][^>]*?content=["']([^"']*?)["']|[^>]*?content=["']([^"']*?)["'][^>]*?(?:property|name)=["']([^"']+)["'])[^>]*\/?>/gi;
  let m;

  while ((m = metaRegex.exec(html)) !== null) {
    const key = (m[1] || m[4] || '').toLowerCase();
    const value = m[2] || m[3] || '';
    if (key && value) meta[key] = value;
  }

  const product = {};
  if (meta['og:title']) product.name = meta['og:title'];
  if (meta['product:price:amount']) product.price = parseFloat(meta['product:price:amount']);
  if (meta['product:price:currency']) product.currency = meta['product:price:currency'];
  if (meta['og:description']) product.description = meta['og:description'].slice(0, 500);
  if (meta['og:image']) product.image = meta['og:image'];
  if (meta['product:availability']) product.availability = meta['product:availability'];
  if (meta['product:brand']) product.brand = meta['product:brand'];
  if (meta['og:type']) product.type = meta['og:type'];
  if (meta['og:url']) product.url = meta['og:url'];

  if (product.name || product.price) {
    product.method = 'meta-tags';
    return product;
  }
  return null;
}

// ─── DOM Heuristic Extraction ────────────────────────────────────────
// This runs either on server (from fetched HTML) or in browser (content script)

function extractFromHtml(html, url) {
  const results = [];
  const domain = _extractDomain(url);

  // 1. Try JSON-LD first (most reliable)
  const jsonLdProducts = extractJsonLd(html);
  if (jsonLdProducts.length > 0) {
    results.push(...jsonLdProducts);
  }

  // 2. Try Open Graph meta tags
  const metaProduct = extractMetaTags(html);
  if (metaProduct && metaProduct.price) {
    results.push(metaProduct);
  }

  // 3. Heuristic price extraction from common patterns
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';

  // Extract potential product containers
  const priceContainerPatterns = [
    // Common e-commerce price selectors reflected as class names
    /class="[^"]*(?:price|cost|amount|tarif|سعر|ثمن)[^"]*"[^>]*>([^<]{1,100})</g,
    /class="[^"]*(?:product-price|item-price|sale-price|offer-price|current-price)[^"]*"[^>]*>([^<]{1,100})</g,
    /class="[^"]*(?:room-price|rate-price|nightly-rate|total-price)[^"]*"[^>]*>([^<]{1,100})</g,
    // data-price attributes
    /data-price=["']([^"']+)["']/gi,
    /data-product-price=["']([^"']+)["']/gi,
  ];

  const rawPrices = [];
  for (const pattern of priceContainerPatterns) {
    let m;
    while ((m = pattern.exec(html)) !== null) {
      const extracted = extractPrices(m[1]);
      rawPrices.push(...extracted);
    }
  }

  // If no structured prices found, do a broad sweep
  if (results.length === 0 && rawPrices.length === 0) {
    // Extract from visible text areas (skip scripts/styles)
    const cleaned = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ');
    const broadPrices = extractPrices(cleaned);
    rawPrices.push(...broadPrices);
  }

  // Deduplicate and create heuristic results
  if (rawPrices.length > 0 && results.length === 0) {
    // Filter: likely product prices (not phone numbers, years, etc.)
    const validPrices = rawPrices.filter(p =>
      p.usd >= 1 && p.usd <= 50000 &&
      !`${p.price}`.match(/^(19|20)\d{2}$/) // not a year
    );

    if (validPrices.length > 0) {
      const sorted = validPrices.sort((a, b) => a.usd - b.usd);
      results.push({
        name: pageTitle || domain,
        price: sorted[0].price,
        currency: sorted[0].currency,
        originalPrice: sorted.length > 1 ? sorted[sorted.length - 1].price : null,
        method: 'heuristic',
        allPrices: sorted.slice(0, 10),
      });
    }
  }

  return results;
}

// ─── Server-side Fetch & Extract ─────────────────────────────────────

const UA_LIST = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

async function fetchAndExtract(url, options = {}) {
  const domain = _extractDomain(url);

  // Check cache (< 1 hour old)
  const cached = stmts.getByUrl.get(url);
  if (cached && !options.force) {
    const age = Date.now() - new Date(cached.scraped_at).getTime();
    if (age < 3600000) return { cached: true, ...JSON.parse(cached.raw_data), products: [cached] };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 10000);
    const ua = UA_LIST[Math.floor(Math.random() * UA_LIST.length)];

    const resp = await fetch(url, {
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!resp.ok) return { error: `HTTP ${resp.status}`, products: [] };

    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return { error: 'Not HTML', products: [] };
    }

    const html = await resp.text();
    const products = extractFromHtml(html, url);

    // Store results
    for (const p of products) {
      const id = crypto.randomUUID();
      stmts.insertScraped.run(
        id, url, domain,
        p.name || null, p.price || null, p.currency || 'USD',
        p.originalPrice || null, p.availability || null,
        p.rating || null, p.reviewCount || null,
        p.seller || p.brand || null, p.category || null,
        p.method || 'unknown', JSON.stringify(p)
      );

      // Record price history
      const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
      stmts.insertHistory.run(
        crypto.randomUUID(), urlHash, domain,
        p.name || null, p.price || null, p.currency || 'USD'
      );
    }

    return { products, domain, url, fetchedAt: new Date().toISOString() };
  } catch (err) {
    return { error: err.message, products: [] };
  }
}

// ─── Browser-side extraction (for content script / WAB Browser) ──────
// This generates a script that can be injected into any page via
// webview.executeJavaScript() or chrome content script

function getBrowserExtractionScript() {
  return `
(function() {
  'use strict';
  const WAB_EXTRACT = {
    // Extract JSON-LD products
    getJsonLd() {
      const products = [];
      document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
        try {
          let data = JSON.parse(el.textContent);
          if (Array.isArray(data)) data.forEach(d => this._processLd(d, products));
          else this._processLd(data, products);
        } catch(_) {}
      });
      return products;
    },

    _processLd(data, products) {
      if (!data || typeof data !== 'object') return;
      if (data['@graph']) { data['@graph'].forEach(i => this._processLd(i, products)); return; }
      const type = (data['@type'] || '').toLowerCase();
      if (['product','hotel','hotelroom','lodgingbusiness','offer'].includes(type)) {
        const offers = data.offers || {};
        const offer = Array.isArray(offers) ? offers[0] : offers;
        products.push({
          name: data.name || null,
          price: parseFloat(offer?.price || offer?.lowPrice || data.price) || null,
          originalPrice: parseFloat(offer?.highPrice) || null,
          currency: offer?.priceCurrency || 'USD',
          availability: (offer?.availability || '').replace(/https?:\\/\\/schema\\.org\\//,''),
          rating: parseFloat(data.aggregateRating?.ratingValue) || null,
          reviewCount: parseInt(data.aggregateRating?.reviewCount) || null,
          image: typeof data.image === 'string' ? data.image : data.image?.url || null,
          brand: data.brand?.name || data.brand || null,
          method: 'json-ld'
        });
      }
      for (const key of Object.keys(data)) {
        if (typeof data[key] === 'object' && data[key] !== null && key !== '@context') {
          if (Array.isArray(data[key])) data[key].forEach(i => { if (typeof i === 'object') this._processLd(i, products); });
          else this._processLd(data[key], products);
        }
      }
    },

    // Extract Open Graph meta
    getMeta() {
      const m = {};
      document.querySelectorAll('meta[property], meta[name]').forEach(el => {
        const key = (el.getAttribute('property') || el.getAttribute('name') || '').toLowerCase();
        const val = el.getAttribute('content');
        if (key && val) m[key] = val;
      });
      const p = {};
      if (m['og:title']) p.name = m['og:title'];
      if (m['product:price:amount']) p.price = parseFloat(m['product:price:amount']);
      if (m['product:price:currency']) p.currency = m['product:price:currency'];
      if (m['og:description']) p.description = m['og:description'];
      if (m['og:image']) p.image = m['og:image'];
      if (p.name || p.price) { p.method = 'meta-tags'; return p; }
      return null;
    },

    // Extract prices from visible text
    getPrices() {
      const patterns = [
        /(?:\\$|USD|US\\$)\\s*([\\d,]+\\.?\\d*)/g,
        /(?:€|EUR)\\s*([\\d,]+\\.?\\d*)/g,
        /(?:£|GBP)\\s*([\\d,]+\\.?\\d*)/g,
        /([\\d,]+\\.?\\d*)\\s*(?:SAR|ريال|AED|درهم|TND|دينار|EGP)/g,
        /(?:[₺₹¥₩])\\s*([\\d,]+\\.?\\d*)/g,
      ];
      const prices = [];
      const seen = new Set();

      // Target price-like containers first
      const priceEls = document.querySelectorAll(
        '[class*="price"], [class*="cost"], [class*="amount"], [class*="rate"], ' +
        '[data-price], [data-product-price], [itemprop="price"], ' +
        '[class*="tarif"], [class*="سعر"]'
      );
      priceEls.forEach(el => {
        const text = el.textContent || el.getAttribute('data-price') || '';
        for (const pat of patterns) {
          pat.lastIndex = 0;
          let m;
          while ((m = pat.exec(text)) !== null) {
            const num = parseFloat((m[1] || m[0].replace(/[^\\d.,]/g,'')).replace(/,/g,''));
            if (num > 0 && num < 100000 && !seen.has(num)) {
              seen.add(num);
              prices.push({ price: num, raw: m[0].trim(), el: el.className });
            }
          }
        }
      });

      return prices.sort((a,b) => a.price - b.price);
    },

    // Extract product cards (hotels, flights, items)
    getProductCards() {
      const cards = [];
      const selectors = [
        '[class*="product-card"]', '[class*="hotel-card"]', '[class*="listing-card"]',
        '[class*="search-result"]', '[class*="offer-card"]', '[class*="deal-card"]',
        '[class*="property-card"]', '[class*="sr_item"]', '[class*="result-item"]',
        '[data-testid*="property"]', '[data-testid*="product"]', '[data-testid*="listing"]',
      ];
      const allCards = document.querySelectorAll(selectors.join(','));
      allCards.forEach((el, i) => {
        if (i >= 20) return; // limit
        const title = el.querySelector('[class*="title"], [class*="name"], h2, h3, h4')?.textContent?.trim()?.slice(0, 200);
        const priceEl = el.querySelector('[class*="price"], [data-price], [itemprop="price"]');
        const priceText = priceEl?.textContent?.trim() || priceEl?.getAttribute('data-price') || '';
        const ratingEl = el.querySelector('[class*="rating"], [class*="score"], [aria-label*="rating"], [aria-label*="score"]');
        const rating = ratingEl?.textContent?.trim() || ratingEl?.getAttribute('aria-label') || '';
        const link = el.querySelector('a[href]')?.href || '';
        const img = el.querySelector('img')?.src || '';

        if (title || priceText) {
          cards.push({ title, price: priceText, rating, link, image: img, index: i });
        }
      });
      return cards;
    },

    // Full extraction — called by WAB Browser or extension
    extract() {
      const hasWabBridge = typeof window.AICommands !== 'undefined' || typeof window.__wab_bidi !== 'undefined';
      return {
        url: location.href,
        domain: location.hostname,
        title: document.title,
        jsonLd: this.getJsonLd(),
        meta: this.getMeta(),
        prices: this.getPrices(),
        cards: this.getProductCards(),
        timestamp: Date.now(),
        hasWabBridge,
        wabBridgeType: hasWabBridge
          ? (typeof window.__wab_bidi !== 'undefined' ? 'bidi' : 'standard')
          : null,
      };
    }
  };

  // Expose for WAB Browser / extension
  window.__wab_universal = WAB_EXTRACT;

  // Auto-report if WAB extension is present
  if (window.__wab_extension_ready) {
    window.postMessage({ type: 'wab-extract', data: WAB_EXTRACT.extract() }, '*');
  }

  return WAB_EXTRACT.extract();
})();
`;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function getPriceHistory(url, limit = 30) {
  const urlHash = crypto.createHash('sha256').update(url).digest('hex').slice(0, 16);
  return stmts.getHistory.all(urlHash, limit);
}

function getScrapedByDomain(domain, limit = 50) {
  return stmts.getByDomain.all(domain.replace(/^www\./, ''), limit);
}

// ─── Process browser extraction data ─────────────────────────────────
// Data sent from WAB Browser webview or Chrome extension content script

function processBrowserExtraction(data) {
  if (!data || !data.url) return { error: 'No URL' };

  const domain = _extractDomain(data.url);
  const products = [];

  // Process JSON-LD products
  if (data.jsonLd && data.jsonLd.length > 0) {
    products.push(...data.jsonLd);
  }

  // Process meta tags
  if (data.meta && data.meta.price) {
    products.push(data.meta);
  }

  // Process product cards from DOM
  if (data.cards && data.cards.length > 0) {
    for (const card of data.cards) {
      const prices = extractPrices(card.price || '');
      if (prices.length > 0 || card.title) {
        products.push({
          name: card.title || 'Unknown',
          price: prices[0]?.price || null,
          currency: prices[0]?.currency || 'USD',
          rating: parseFloat(card.rating) || null,
          url: card.link || data.url,
          image: card.image || null,
          method: 'dom-cards',
        });
      }
    }
  }

  // Fallback: use raw prices
  if (products.length === 0 && data.prices && data.prices.length > 0) {
    products.push({
      name: data.title || domain,
      price: data.prices[0].price,
      currency: 'USD',
      method: 'dom-prices',
      allPrices: data.prices,
    });
  }

  // Store in database
  for (const p of products) {
    const id = crypto.randomUUID();
    try {
      stmts.insertScraped.run(
        id, data.url, domain,
        p.name || null, p.price || null, p.currency || 'USD',
        p.originalPrice || null, p.availability || null,
        p.rating || null, p.reviewCount || null,
        p.seller || p.brand || null, p.category || null,
        p.method || 'browser', JSON.stringify(p)
      );

      const urlHash = crypto.createHash('sha256').update(data.url).digest('hex').slice(0, 16);
      stmts.insertHistory.run(
        crypto.randomUUID(), urlHash, domain,
        p.name || null, p.price || null, p.currency || 'USD'
      );
    } catch (_) {}
  }

  return { products, domain, url: data.url, hasWabBridge: data.hasWabBridge };
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  extractPrices,
  extractJsonLd,
  extractMetaTags,
  extractFromHtml,
  fetchAndExtract,
  getBrowserExtractionScript,
  processBrowserExtraction,
  getPriceHistory,
  getScrapedByDomain,
  normalizeCurrency,
  toUSD,
};
