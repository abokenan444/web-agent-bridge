'use strict';
/**
 * WAB Platform Demo Showcase — /api/demo/* routes
 * Isolated simulated endpoints for the interactive demo at /demo-1
 * All responses are realistic in-memory simulations — no production DB
 */
const express = require('express');
const router = express.Router();
const START_TIME = Date.now();

// ─── In-memory Demo Stats ─────────────────────────────────────────────────────
const demoStats = {
  agentsConnected: 12847,
  scamBlocked: 0,
  adsBlocked: 1247,
  requestsServed: 0,
};
setInterval(() => {
  demoStats.agentsConnected += Math.floor(Math.random() * 3 - 1);
  demoStats.adsBlocked += Math.floor(Math.random() * 5);
}, 5000);

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Stats ────────────────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  demoStats.requestsServed++;
  const uptimeSecs = Math.floor((Date.now() - START_TIME) / 1000);
  res.json({
    agentsConnected: demoStats.agentsConnected,
    scamBlocked: demoStats.scamBlocked,
    adsBlocked: demoStats.adsBlocked,
    requestsServed: demoStats.requestsServed,
    uptime: '99.97%',
    avgResponseTime: `${142 + Math.floor(Math.random() * 20)}ms`,
    supportedSites: '50,000+',
    serverUptime: `${Math.floor(uptimeSecs / 60)}m`,
  });
});

// ─── AI Agent Chat ────────────────────────────────────────────────────────────
const agentResponses = {
  shopping: {
    intent: 'shopping', confidence: 0.94,
    replies: [
      "I found **23 results** across 8 platforms for your search. Here's what I recommend:\n\n**Best Value:** Dell Inspiron 15 at **$449** on Dell.com (direct) — Fairness Score: 87/100, no hidden fees.\n\n**Marketplace Option:** Same model on Amazon at $489 — but note the 15% seller commission is baked into the price.\n\n**My Recommendation:** Buy direct from Dell and save $40. I can navigate there and pre-fill your cart if you'd like.",
      "Great choice! I've scanned **50,000+ supported sites** for laptops under $500. The top pick is the **Acer Aspire 5** at $429 on Acer's direct store — Fairness Score 82/100.\n\nWould you like me to check availability, compare specs, or proceed to checkout?",
    ],
    suggestedActions: ['Show me the top 5 results', 'Compare specs side by side', 'Check if it ships to my location', 'Find a refurbished option'],
  },
  booking: {
    intent: 'travel_booking', confidence: 0.91,
    replies: [
      "I found **47 hotels in Paris** for your dates. Here's the key insight:\n\n**Booking.com** lists Hotel Le Marais at $189/night — but adds a **$28 service fee** at checkout (Fairness Score: 52/100).\n\n**Direct booking** at lemarais-hotel.com: **$171/night**, no fees (Fairness Score: 91/100).\n\n**You save $18/night** by booking direct. Want me to open the direct booking page?",
    ],
    suggestedActions: ['Show direct booking options', 'Compare all platforms', 'Check cancellation policies', 'Find cheaper alternatives'],
  },
  comparison: {
    intent: 'price_comparison', confidence: 0.96,
    replies: [
      "Here's a **real-time comparison** of Amazon vs eBay:\n\n| Platform | Avg. Commission | Fairness Score | Hidden Fees |\n|----------|----------------|----------------|-------------|\n| Amazon | 8–15% | 58/100 | Fulfillment fees |\n| eBay | 10–12% | 64/100 | Final value fee |\n\n**Key finding:** For electronics, eBay typically offers 8–12% lower final prices due to auction dynamics. For books and media, Amazon wins on selection.\n\nWant me to search for a specific product on both platforms?",
    ],
    suggestedActions: ['Search a specific product', 'Show me direct seller alternatives', 'Explain commission structures'],
  },
  safety: {
    intent: 'security_check', confidence: 0.98,
    replies: [
      "I'll run a **Scam Shield analysis** on that URL right now...\n\nChecking against 47 threat databases, analyzing domain age, SSL certificate, and reputation scores.\n\nSwitch to the **Scam Shield tab** above to run a live URL scan — or tell me the specific URL you want me to check!",
    ],
    suggestedActions: ['Check a specific URL', 'Learn about phishing detection', 'See recent scams blocked'],
  },
  default: {
    intent: 'general', confidence: 0.72,
    replies: [
      "I'm the **WAB Agent** — your intelligent web assistant powered by the Web Agent Bridge platform.\n\nI can help you:\n- 🛒 **Find the best deals** across 50,000+ websites\n- 🏨 **Book travel directly** and skip the middleman fees\n- 🛡️ **Check if a website is safe** before you share any information\n- 📊 **Compare prices** with full commission transparency\n\nWhat would you like to do today?",
      "Great question! The WAB platform works by sitting between your AI agent and any website — providing a **standardized API** for navigation, interaction, and data extraction.\n\nEvery action is:\n- ✅ **Permission-controlled** — you decide what agents can do\n- 📋 **Fully audited** — every click and form fill is logged\n- 🛡️ **Scam-protected** — malicious sites are blocked automatically\n- ⚖️ **Fairness-scored** — you know if a platform is treating you fairly\n\nWant to try a live demo of any specific feature?",
    ],
    suggestedActions: ['Find me the best laptop deal', 'Check if a website is safe', 'Compare Amazon vs eBay', 'Book a hotel directly'],
  },
};

function detectIntent(message) {
  const m = message.toLowerCase();
  if (m.includes('laptop') || m.includes('phone') || m.includes('buy') || m.includes('cheap') || m.includes('price') || m.includes('product') || m.includes('shop')) return 'shopping';
  if (m.includes('hotel') || m.includes('book') || m.includes('travel') || m.includes('flight') || m.includes('paris') || m.includes('trip')) return 'booking';
  if (m.includes('compare') || m.includes('amazon') || m.includes('ebay') || m.includes('vs') || m.includes('difference')) return 'comparison';
  if (m.includes('safe') || m.includes('scam') || m.includes('phish') || m.includes('secure') || m.includes('trust')) return 'safety';
  return 'default';
}

router.post('/agent', async (req, res) => {
  const { message, sessionId } = req.body;
  if (!message) return res.status(400).json({ error: 'message is required' });
  await sleep(800 + Math.random() * 600);
  const intentKey = detectIntent(message);
  const data = agentResponses[intentKey] || agentResponses.default;
  const reply = data.replies[Math.floor(Math.random() * data.replies.length)];
  demoStats.requestsServed++;
  res.json({
    reply, intent: data.intent, confidence: data.confidence,
    suggestedActions: data.suggestedActions,
    sessionId: sessionId || `demo_${Date.now()}`,
    processingTime: `${Math.floor(800 + Math.random() * 400)}ms`,
    model: 'wab-agent-v2.5',
  });
});

// ─── Fairness System ──────────────────────────────────────────────────────────
const fairnessDatabase = {
  'amazon.com': {
    domain: 'amazon.com', category: 'E-Commerce', platformSize: 'Enterprise',
    overall: 58, verdict: 'Moderate', color: '#f59e0b',
    breakdown: {
      trust: { label: 'Trust Score', score: 72, description: 'Generally reliable, established brand' },
      priceHonesty: { label: 'Price Honesty', score: 55, description: 'Prices often inflated before discounts' },
      transparency: { label: 'Fee Transparency', score: 48, description: 'Fulfillment fees added late in checkout' },
      commission: { label: 'Commission Load', score: 42, description: '8–15% seller commission baked into prices' },
      directBooking: { label: 'Direct Seller Access', score: 38, description: 'Discourages direct seller relationships' },
      hiddenFees: { label: 'Hidden Fee Score', score: 51, description: 'Subscribe & Save tricks, Prime upsells' },
    },
    recommendation: '⚠️ Amazon is a reliable platform but charges significant commissions (8–15%) that are embedded in product prices. Consider searching for the same product on the manufacturer\'s direct website — you may save 10–20%. WAB\'s Deals Engine can find direct alternatives automatically.',
  },
  'booking.com': {
    domain: 'booking.com', category: 'Travel & Hospitality', platformSize: 'Enterprise',
    overall: 52, verdict: 'Moderate', color: '#f59e0b',
    breakdown: {
      trust: { label: 'Trust Score', score: 78, description: 'Highly trusted, strong buyer protection' },
      priceHonesty: { label: 'Price Honesty', score: 44, description: 'Service fees added at checkout' },
      transparency: { label: 'Fee Transparency', score: 41, description: 'Taxes and fees revealed only at final step' },
      commission: { label: 'Commission Load', score: 35, description: '15–25% commission charged to hotels' },
      directBooking: { label: 'Direct Booking Access', score: 32, description: 'Rate parity clauses restrict direct pricing' },
      hiddenFees: { label: 'Hidden Fee Score', score: 48, description: 'Service fees, non-refundable traps' },
    },
    recommendation: '⚠️ Booking.com charges hotels 15–25% commission, which is passed on to you. Always check the hotel\'s direct website after finding it on Booking.com — direct rates are often 10–18% cheaper and include free cancellation.',
  },
  'etsy.com': {
    domain: 'etsy.com', category: 'Handmade & Vintage', platformSize: 'Large',
    overall: 74, verdict: 'Good', color: '#0ea5e9',
    breakdown: {
      trust: { label: 'Trust Score', score: 82, description: 'Strong community trust and seller ratings' },
      priceHonesty: { label: 'Price Honesty', score: 76, description: 'Prices generally reflect true costs' },
      transparency: { label: 'Fee Transparency', score: 71, description: 'Transaction fees disclosed upfront' },
      commission: { label: 'Commission Load', score: 68, description: '6.5% transaction fee — lower than peers' },
      directBooking: { label: 'Direct Seller Access', score: 72, description: 'Sellers can share direct contact info' },
      hiddenFees: { label: 'Hidden Fee Score', score: 74, description: 'Minimal surprise fees at checkout' },
    },
    recommendation: '✅ Etsy scores well on fairness. The 6.5% transaction fee is reasonable for the handmade marketplace. Sellers are relatively transparent and the platform supports direct communication.',
  },
  'ebay.com': {
    domain: 'ebay.com', category: 'Marketplace', platformSize: 'Enterprise',
    overall: 64, verdict: 'Good', color: '#0ea5e9',
    breakdown: {
      trust: { label: 'Trust Score', score: 74, description: 'Established platform with buyer protection' },
      priceHonesty: { label: 'Price Honesty', score: 68, description: 'Auction model can yield genuine deals' },
      transparency: { label: 'Fee Transparency', score: 62, description: 'Final value fees are clearly stated' },
      commission: { label: 'Commission Load', score: 58, description: '10–12% final value fee on most categories' },
      directBooking: { label: 'Direct Seller Access', score: 61, description: 'Seller contact allowed after purchase' },
      hiddenFees: { label: 'Hidden Fee Score', score: 60, description: 'Shipping costs sometimes hidden until checkout' },
    },
    recommendation: '🔵 eBay offers reasonable fairness, especially for used goods and auctions. The 10–12% final value fee is moderate. Watch out for shipping costs that aren\'t shown upfront.',
  },
  'airbnb.com': {
    domain: 'airbnb.com', category: 'Short-term Rental', platformSize: 'Enterprise',
    overall: 44, verdict: 'Poor', color: '#ef4444',
    breakdown: {
      trust: { label: 'Trust Score', score: 71, description: 'Trusted brand but declining host satisfaction' },
      priceHonesty: { label: 'Price Honesty', score: 31, description: 'Cleaning fees often exceed nightly rate' },
      transparency: { label: 'Fee Transparency', score: 28, description: 'Total price only shown at final checkout step' },
      commission: { label: 'Commission Load', score: 34, description: '14–16% guest service fee + 3% host fee' },
      directBooking: { label: 'Direct Booking Access', score: 38, description: 'Off-platform contact is against ToS' },
      hiddenFees: { label: 'Hidden Fee Score', score: 26, description: 'Cleaning fees, service fees, occupancy taxes' },
    },
    recommendation: '❌ Airbnb has significant fairness issues. The advertised nightly price is rarely the final price — cleaning fees ($50–$200) and service fees (14–16%) can double the cost.',
  },
};

function generateFairnessForUnknown(domain) {
  const seed = domain.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 45 + (seed % 40);
  return {
    domain, category: 'General Website', platformSize: 'Unknown',
    overall: base, verdict: base >= 75 ? 'Good' : base >= 55 ? 'Moderate' : 'Poor',
    color: base >= 75 ? '#10b981' : base >= 55 ? '#f59e0b' : '#ef4444',
    breakdown: {
      trust: { label: 'Trust Score', score: Math.min(95, base + 12), description: 'Based on domain age and SSL certificate' },
      priceHonesty: { label: 'Price Honesty', score: Math.max(10, base - 8), description: 'Limited data available' },
      transparency: { label: 'Fee Transparency', score: Math.max(10, base - 5), description: 'Checkout flow analysis pending' },
      commission: { label: 'Commission Load', score: base, description: 'Estimated from category benchmarks' },
      directBooking: { label: 'Direct Access', score: Math.min(90, base + 20), description: 'No intermediary detected' },
      hiddenFees: { label: 'Hidden Fee Score', score: Math.max(15, base - 3), description: 'Requires deeper checkout analysis' },
    },
    recommendation: `ℹ️ Limited data available for ${domain}. This is a demo simulation — real WAB scores are based on live crawl data.`,
  };
}

router.post('/fairness', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  await sleep(1200 + Math.random() * 800);
  const domain = extractDomain(url);
  demoStats.requestsServed++;
  res.json(fairnessDatabase[domain] || generateFairnessForUnknown(domain));
});

// ─── Scam Shield ──────────────────────────────────────────────────────────────
const shieldDatabase = {
  'amazon.com': { riskScore: 2, riskLevel: 'safe' },
  'google.com': { riskScore: 1, riskLevel: 'safe' },
  'booking.com': { riskScore: 4, riskLevel: 'safe' },
  'paypal.com': { riskScore: 3, riskLevel: 'safe' },
  'ebay.com': { riskScore: 5, riskLevel: 'safe' },
  'etsy.com': { riskScore: 3, riskLevel: 'safe' },
  'airbnb.com': { riskScore: 6, riskLevel: 'safe' },
  'paypa1-secure-login.xyz': { riskScore: 97, riskLevel: 'critical' },
  'amaz0n-verify.net': { riskScore: 95, riskLevel: 'critical' },
  'crypto-doubler.io': { riskScore: 78, riskLevel: 'high' },
  'secure-paypal-verify.com': { riskScore: 91, riskLevel: 'critical' },
};

function generateShieldResult(domain, riskScore, riskLevel) {
  const isSafe = riskScore < 20, isHigh = riskScore >= 70, isMedium = riskScore >= 40 && riskScore < 70;
  const checks = [
    { name: 'Domain Age', passed: isSafe || (!isHigh && domain.length > 8), detail: isSafe ? 'Domain registered 8+ years ago' : isHigh ? 'Domain registered < 30 days ago — suspicious' : 'Domain registered 6 months ago' },
    { name: 'SSL Certificate', passed: isSafe || isMedium, detail: isSafe ? 'Valid EV certificate from trusted CA' : isHigh ? 'Self-signed or expired certificate' : 'Valid DV certificate — basic security' },
    { name: 'Phishing Databases', passed: isSafe, detail: isSafe ? 'Not found in any of 47 phishing databases' : isHigh ? `Listed in ${Math.floor(riskScore / 10)} phishing databases` : 'Flagged in 2 monitoring lists' },
    { name: 'Homograph Detection', passed: isSafe || isMedium, detail: isSafe ? 'No lookalike characters detected' : isHigh ? 'Homograph attack detected: uses "0" instead of "o"' : 'No homograph characters found' },
    { name: 'Reputation Score', passed: isSafe, detail: isSafe ? 'Excellent reputation across all sources' : isHigh ? 'Negative reputation — reported by users' : 'Neutral reputation — insufficient data' },
    { name: 'Malware Scan', passed: isSafe || isMedium, detail: isSafe ? 'No malware or malicious scripts detected' : isHigh ? 'Credential harvesting script detected' : 'No malware detected — clean' },
  ];
  const rec = {
    safe: `✅ **${domain}** is safe to visit. Our analysis across 47 security databases found no threats.`,
    medium: `⚠️ **${domain}** shows some suspicious signals. Proceed with caution.`,
    high: `🚨 **DANGER: ${domain}** is a known threat. This domain has been flagged in multiple phishing databases. **Do not visit this site.**`,
    critical: `🚨 **CRITICAL THREAT: ${domain}** is an active phishing site. Flagged across ${Math.floor(riskScore / 10)} security databases. WAB Scam Shield has blocked this URL.`,
  };
  return { domain, riskScore, riskLevel, checks, recommendation: rec[riskLevel] || rec.medium, databasesChecked: 47, scanTime: `${120 + Math.floor(Math.random() * 80)}ms` };
}

router.post('/shield', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });
  await sleep(1000 + Math.random() * 700);
  const domain = extractDomain(url);
  const known = shieldDatabase[domain];
  let riskScore, riskLevel;
  if (known) { riskScore = known.riskScore; riskLevel = known.riskLevel; }
  else {
    const suspicious = /\d/.test(domain.replace(/\.\w+$/, '')) || domain.includes('-secure') || domain.includes('-verify') || domain.includes('-login') || domain.length > 30;
    riskScore = suspicious ? 55 + Math.floor(Math.random() * 30) : 8 + Math.floor(Math.random() * 15);
    riskLevel = riskScore >= 70 ? 'high' : riskScore >= 40 ? 'medium' : 'safe';
  }
  if (riskScore >= 70) demoStats.scamBlocked++;
  demoStats.requestsServed++;
  res.json(generateShieldResult(domain, riskScore, riskLevel));
});

// ─── Deals Engine ─────────────────────────────────────────────────────────────
const dealsDatabase = {
  laptop: [
    { platform: 'Dell Direct Store', domain: 'dell.com', price: 449.99, originalPrice: 549.99, savings: '18%', fairness: 87, badge: 'Best Value', hiddenFees: 'No hidden fees — free shipping included' },
    { platform: 'Acer Official Store', domain: 'acer.com', price: 429.00, originalPrice: 499.00, savings: '14%', fairness: 84, badge: 'Good Deal', hiddenFees: 'Free shipping on orders over $399' },
    { platform: 'Best Buy', domain: 'bestbuy.com', price: 479.99, originalPrice: 549.99, savings: '13%', fairness: 71, badge: 'Fair Price', hiddenFees: 'No hidden fees — in-store pickup available' },
    { platform: 'Amazon', domain: 'amazon.com', price: 499.00, originalPrice: 549.99, savings: '9%', fairness: 58, badge: null, hiddenFees: '⚠️ 15% seller commission embedded in price' },
    { platform: 'eBay (New)', domain: 'ebay.com', price: 461.00, originalPrice: 549.99, savings: '16%', fairness: 64, badge: null, hiddenFees: '⚠️ $12 shipping + 10% final value fee' },
  ],
  'wireless headphones': [
    { platform: 'Sony Direct', domain: 'sony.com', price: 279.99, originalPrice: 349.99, savings: '20%', fairness: 91, badge: 'Best Value', hiddenFees: 'No hidden fees — free 2-day shipping' },
    { platform: 'Bose Official', domain: 'bose.com', price: 299.00, originalPrice: 379.00, savings: '21%', fairness: 89, badge: 'Good Deal', hiddenFees: 'Free shipping + 90-day returns' },
    { platform: 'B&H Photo', domain: 'bhphotovideo.com', price: 289.95, originalPrice: 349.99, savings: '17%', fairness: 82, badge: 'Good Deal', hiddenFees: 'Free expedited shipping' },
    { platform: 'Amazon', domain: 'amazon.com', price: 319.99, originalPrice: 349.99, savings: '9%', fairness: 58, badge: null, hiddenFees: '⚠️ 8% commission embedded' },
    { platform: 'Walmart', domain: 'walmart.com', price: 309.00, originalPrice: 349.99, savings: '12%', fairness: 67, badge: null, hiddenFees: 'Free shipping — straightforward pricing' },
  ],
  'mystery books': [
    { platform: 'Bookshop.org', domain: 'bookshop.org', price: 14.99, originalPrice: 18.99, savings: '21%', fairness: 94, badge: 'Best Value', hiddenFees: 'Supports local bookstores' },
    { platform: 'ThriftBooks', domain: 'thriftbooks.com', price: 8.99, originalPrice: 18.99, savings: '53%', fairness: 88, badge: 'Good Deal', hiddenFees: 'Free shipping on orders over $15' },
    { platform: 'Barnes & Noble', domain: 'barnesandnoble.com', price: 15.99, originalPrice: 18.99, savings: '16%', fairness: 76, badge: 'Fair Price', hiddenFees: 'Free shipping on orders over $35' },
    { platform: 'Amazon', domain: 'amazon.com', price: 13.99, originalPrice: 18.99, savings: '26%', fairness: 58, badge: null, hiddenFees: '⚠️ Prime required for free shipping' },
    { platform: 'AbeBooks', domain: 'abebooks.com', price: 7.50, originalPrice: 18.99, savings: '61%', fairness: 71, badge: null, hiddenFees: '$3.99 shipping — used copies available' },
  ],
  'running shoes': [
    { platform: 'Nike Official', domain: 'nike.com', price: 89.99, originalPrice: 110.00, savings: '18%', fairness: 85, badge: 'Best Value', hiddenFees: 'Free shipping + free returns' },
    { platform: 'Adidas Direct', domain: 'adidas.com', price: 84.99, originalPrice: 100.00, savings: '15%', fairness: 83, badge: 'Good Deal', hiddenFees: 'Free shipping on orders over $50' },
    { platform: 'Running Warehouse', domain: 'runningwarehouse.com', price: 94.95, originalPrice: 110.00, savings: '14%', fairness: 88, badge: 'Good Deal', hiddenFees: 'Free 2-day shipping' },
    { platform: 'Zappos', domain: 'zappos.com', price: 99.99, originalPrice: 110.00, savings: '9%', fairness: 79, badge: null, hiddenFees: 'Free shipping + free returns' },
    { platform: 'Amazon', domain: 'amazon.com', price: 97.00, originalPrice: 110.00, savings: '12%', fairness: 58, badge: null, hiddenFees: '⚠️ Multiple sellers — verify authenticity' },
  ],
};

function generateDealsForQuery(query) {
  const basePrice = 20 + Math.floor(Math.random() * 200);
  return [
    { platform: 'Direct Manufacturer', domain: `${query.replace(/\s+/g, '')}.com`, price: +(basePrice * 0.85).toFixed(2), originalPrice: basePrice, savings: '15%', fairness: 88, badge: 'Best Value', hiddenFees: 'No hidden fees — direct purchase' },
    { platform: 'Specialty Retailer', domain: 'specialty-store.com', price: +(basePrice * 0.90).toFixed(2), originalPrice: basePrice, savings: '10%', fairness: 79, badge: 'Good Deal', hiddenFees: 'Free shipping over $50' },
    { platform: 'Amazon', domain: 'amazon.com', price: +(basePrice * 0.95).toFixed(2), originalPrice: basePrice, savings: '5%', fairness: 58, badge: null, hiddenFees: '⚠️ Commission embedded in price' },
    { platform: 'eBay', domain: 'ebay.com', price: +(basePrice * 0.88).toFixed(2), originalPrice: basePrice, savings: '12%', fairness: 64, badge: null, hiddenFees: 'Shipping costs vary by seller' },
  ];
}

router.post('/deals', async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ error: 'query is required' });
  await sleep(1500 + Math.random() * 1000);
  const key = query.toLowerCase().trim();
  const deals = dealsDatabase[key] || generateDealsForQuery(key);
  deals.sort((a, b) => a.price - b.price);
  const cheapest = deals[0].price, mostExpensive = deals[deals.length - 1].price;
  const savingsPct = Math.round(((mostExpensive - cheapest) / mostExpensive) * 100);
  demoStats.requestsServed++;
  res.json({ query, totalResults: deals.length, deals, savings: { amount: (mostExpensive - cheapest).toFixed(2), percentage: `${savingsPct}%` }, scanTime: `${1500 + Math.floor(Math.random() * 500)}ms`, sitesScanned: 50000 });
});

// ─── Architecture Info ────────────────────────────────────────────────────────
router.get('/architecture', (req, res) => {
  res.json({
    layers: [
      { name: 'AI Agent Layer', components: ['OpenAI GPT-4', 'Anthropic Claude', 'Google Gemini', 'LangChain', 'Custom Agents'] },
      { name: 'WAB Middleware', components: ['Permission Engine', 'Fairness Engine', 'Scam Shield', 'Audit Logger', 'Rate Limiter', 'DOM Intelligence'] },
      { name: 'Website Layer', components: ['E-Commerce', 'Travel & Booking', 'Marketplaces', 'SaaS Platforms', 'Any Website'] },
    ],
    supportedActions: ['navigate', 'click', 'fill', 'submit', 'extract', 'screenshot', 'scroll', 'wait'],
    fairnessSignals: 15, securityDatabases: 47, supportedSites: 50000, dailyActions: 2400000, uptime: '99.97%', avgLatency: '142ms',
  });
});

module.exports = router;
