/**
 * WAB Extension — Content Script
 * Runs on EVERY page. Extracts prices, products, and schema data.
 * Sends data to background worker for analysis.
 */

(function () {
  'use strict';

  // Avoid double injection
  if (window.__wab_content_loaded) return;
  window.__wab_content_loaded = true;

  // ─── Extraction Logic ──────────────────────────────────────────────

  function extractJsonLd() {
    const products = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        let data = JSON.parse(el.textContent);
        if (Array.isArray(data)) data.forEach(d => processLd(d, products));
        else processLd(data, products);
      } catch (_) { }
    });
    return products;
  }

  function processLd(data, products) {
    if (!data || typeof data !== 'object') return;
    if (data['@graph']) { data['@graph'].forEach(i => processLd(i, products)); return; }
    const type = (data['@type'] || '').toLowerCase();
    if (['product', 'hotel', 'hotelroom', 'lodgingbusiness', 'offer'].includes(type)) {
      const offers = data.offers || {};
      const offer = Array.isArray(offers) ? offers[0] : offers;
      products.push({
        name: data.name || null,
        price: parseFloat(offer?.price || offer?.lowPrice || data.price) || null,
        originalPrice: parseFloat(offer?.highPrice) || null,
        currency: offer?.priceCurrency || 'USD',
        availability: (offer?.availability || '').replace(/https?:\/\/schema\.org\//, ''),
        rating: parseFloat(data.aggregateRating?.ratingValue) || null,
        reviewCount: parseInt(data.aggregateRating?.reviewCount) || null,
        image: typeof data.image === 'string' ? data.image : data.image?.url || null,
        brand: data.brand?.name || data.brand || null,
        method: 'json-ld',
      });
    }
    for (const key of Object.keys(data)) {
      if (typeof data[key] === 'object' && data[key] !== null && key !== '@context') {
        if (Array.isArray(data[key])) data[key].forEach(i => { if (typeof i === 'object') processLd(i, products); });
        else processLd(data[key], products);
      }
    }
  }

  function extractMeta() {
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
  }

  function extractPrices() {
    const patterns = [
      /(?:\$|USD|US\$)\s*([\d,]+\.?\d*)/g,
      /(?:€|EUR)\s*([\d,]+\.?\d*)/g,
      /(?:£|GBP)\s*([\d,]+\.?\d*)/g,
      /([\d,]+\.?\d*)\s*(?:SAR|ريال|AED|درهم|TND|دينار|EGP)/g,
      /(?:[₺₹¥₩])\s*([\d,]+\.?\d*)/g,
    ];
    const prices = [];
    const seen = new Set();

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
          const num = parseFloat((m[1] || m[0].replace(/[^\d.,]/g, '')).replace(/,/g, ''));
          if (num > 0 && num < 100000 && !seen.has(num)) {
            seen.add(num);
            prices.push({ price: num, raw: m[0].trim(), context: el.className?.slice(0, 50) });
          }
        }
      }
    });

    return prices.sort((a, b) => a.price - b.price);
  }

  function extractProductCards() {
    const cards = [];
    const selectors = [
      '[class*="product-card"]', '[class*="hotel-card"]', '[class*="listing-card"]',
      '[class*="search-result"]', '[class*="offer-card"]', '[class*="deal-card"]',
      '[class*="property-card"]', '[class*="sr_item"]', '[class*="result-item"]',
      '[data-testid*="property"]', '[data-testid*="product"]', '[data-testid*="listing"]',
    ];

    document.querySelectorAll(selectors.join(',')).forEach((el, i) => {
      if (i >= 20) return;
      const title = el.querySelector('[class*="title"], [class*="name"], h2, h3, h4')?.textContent?.trim()?.slice(0, 200);
      const priceEl = el.querySelector('[class*="price"], [data-price], [itemprop="price"]');
      const priceText = priceEl?.textContent?.trim() || priceEl?.getAttribute('data-price') || '';
      const ratingEl = el.querySelector('[class*="rating"], [class*="score"], [aria-label*="rating"]');
      const rating = ratingEl?.textContent?.trim() || ratingEl?.getAttribute('aria-label') || '';
      const link = el.querySelector('a[href]')?.href || '';
      const img = el.querySelector('img')?.src || '';

      if (title || priceText) {
        cards.push({ title, price: priceText, rating, link, image: img, index: i });
      }
    });

    return cards;
  }

  // ─── Dark Pattern Detection ────────────────────────────────────────

  function detectDarkPatterns() {
    const bodyText = document.body?.innerText?.toLowerCase() || '';
    const patterns = [];

    // Urgency/scarcity
    const urgency = ['only \\d+ left', 'book now', 'limited time', 'selling fast', 'hurry',
      'last chance', 'ends soon', 'عرض محدود', 'آخر فرصة'];
    if (urgency.some(p => new RegExp(p, 'i').test(bodyText))) {
      patterns.push({ type: 'urgency', severity: 'medium' });
    }

    // Hidden costs (fees mentioned but not in main price)
    const fees = ['resort fee', 'cleaning fee', 'service charge', 'booking fee', 'processing fee'];
    const foundFees = fees.filter(f => bodyText.includes(f));
    if (foundFees.length > 0) {
      patterns.push({ type: 'hiddenCosts', fees: foundFees, severity: 'high' });
    }

    // Countdown timers
    if (document.querySelector('[class*="countdown"], [class*="timer"], [class*="urgent"]')) {
      patterns.push({ type: 'fakeUrgency', severity: 'medium' });
    }

    return patterns;
  }

  // ─── Full extraction ───────────────────────────────────────────────

  function fullExtract() {
    const hasWabBridge = typeof window.AICommands !== 'undefined' || typeof window.__wab_bidi !== 'undefined';
    return {
      url: location.href,
      domain: location.hostname,
      title: document.title,
      jsonLd: extractJsonLd(),
      meta: extractMeta(),
      prices: extractPrices(),
      cards: extractProductCards(),
      darkPatterns: detectDarkPatterns(),
      hasWabBridge,
      wabBridgeType: hasWabBridge
        ? (typeof window.__wab_bidi !== 'undefined' ? 'bidi' : 'standard')
        : null,
      timestamp: Date.now(),
    };
  }

  // ─── Send extraction to background ─────────────────────────────────

  function reportExtraction() {
    const data = fullExtract();

    // Only report if there's something useful
    if (data.jsonLd.length > 0 || data.prices.length > 0 || data.cards.length > 0) {
      chrome.runtime.sendMessage({ type: 'wab-extraction', data }, (response) => {
        if (chrome.runtime.lastError) return; // Extension context invalidated
        if (response && response.alerts && response.alerts.length > 0) {
          showAlertBanner(response.alerts);
        }
      });
    }
  }

  // ─── Visual alert banner ───────────────────────────────────────────

  function showAlertBanner(alerts) {
    const high = alerts.filter(a => a.severity === 'high');
    if (high.length === 0) return;

    const banner = document.createElement('div');
    banner.id = 'wab-alert-banner';
    banner.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
      background: linear-gradient(135deg, #dc2626, #b91c1c); color: white;
      padding: 10px 16px; font-family: -apple-system, sans-serif; font-size: 14px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
      animation: wab-slide-down 0.3s ease-out;
    `;

    const style = document.createElement('style');
    style.textContent = '@keyframes wab-slide-down { from { transform: translateY(-100%); } to { transform: translateY(0); } }';
    document.head.appendChild(style);

    banner.innerHTML = `
      <span style="font-size: 18px;">⚠️</span>
      <span style="flex: 1;">
        <strong>WAB Alert:</strong> ${high[0].title || high[0].title_ar || 'Potential fraud detected'}
      </span>
      <button id="wab-alert-close" style="
        background: rgba(255,255,255,0.2); border: none; color: white;
        padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 13px;
      ">✕</button>
    `;

    document.body.prepend(banner);
    document.getElementById('wab-alert-close')?.addEventListener('click', () => banner.remove());

    // Auto-hide after 10 seconds
    setTimeout(() => banner.remove(), 10000);
  }

  // ─── Listen for messages from popup/sidepanel ──────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'wab-extract-now') {
      sendResponse(fullExtract());
      return false;
    }
    if (msg.type === 'wab-get-page-data') {
      sendResponse(fullExtract());
      return false;
    }
  });

  // ─── Run extraction on page load ───────────────────────────────────

  // Wait for page to settle (SPA pages may load data dynamically)
  if (document.readyState === 'complete') {
    setTimeout(reportExtraction, 1500);
  } else {
    window.addEventListener('load', () => setTimeout(reportExtraction, 1500));
  }

  // Re-extract on significant DOM changes (SPA navigation)
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(reportExtraction, 3000);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: false,
    characterData: false,
  });
})();
