/**
 * WAB Fairness Engine
 * ═══════════════════════════════════════════════════════════════════
 * نظام العدالة — Prevents AI bias toward large platforms.
 *
 * Core principle: Small trustworthy businesses deserve equal visibility.
 * Big platforms have marketing budgets; small businesses have better deals.
 *
 * Scoring dimensions:
 *   1. Size Penalty — big-tech platforms get penalized
 *   2. Direct Booking Bonus — booking directly = no commissions = better price
 *   3. Trust Attestations — verified by other WAB agents
 *   4. Price Honesty — sites that don't use dark patterns score higher
 *   5. Local/Independent Bonus — community businesses
 *   6. Transparency Score — clear pricing, no hidden fees
 */

const crypto = require('crypto');
const { db, findSiteByDomain } = require('../models/db');

// ─── WAB Bridge Detection ────────────────────────────────────────────
// Check if a domain has installed the WAB bridge script (cooperative site)

const _stmtNegotiationRules = db.prepare(
  `SELECT COUNT(*) AS cnt FROM negotiation_rules WHERE site_id = ?`
);
const _stmtDirectoryEntry = db.prepare(
  `SELECT * FROM wab_directory WHERE site_id = ?`
);

/**
 * Returns bridge details for a domain, or null if not a WAB-enabled site.
 *  { siteId, tier, hasNegotiation, directoryEntry }
 */
function getWabBridgeInfo(domain) {
  const d = domain.replace(/^www\./, '').toLowerCase();
  const site = findSiteByDomain.get(d);
  if (!site) return null;

  let hasNegotiation = false;
  try {
    const nr = _stmtNegotiationRules.get(site.id);
    hasNegotiation = nr && nr.cnt > 0;
  } catch (_) {}

  let directoryEntry = null;
  try {
    directoryEntry = _stmtDirectoryEntry.get(site.id);
  } catch (_) {}

  return {
    siteId: site.id,
    tier: site.tier || 'free',
    hasNegotiation,
    directoryEntry,
    isListed: directoryEntry ? directoryEntry.listed === 1 : false,
    neutralityScore: directoryEntry ? directoryEntry.neutrality_score : null,
  };
}

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS fairness_scores (
    domain TEXT PRIMARY KEY,
    category TEXT DEFAULT 'neutral',
    size_score INTEGER DEFAULT 50,
    trust_score INTEGER DEFAULT 50,
    price_honesty INTEGER DEFAULT 50,
    transparency INTEGER DEFAULT 50,
    direct_booking INTEGER DEFAULT 0,
    total_score INTEGER DEFAULT 50,
    attestation_count INTEGER DEFAULT 0,
    fraud_count INTEGER DEFAULT 0,
    last_checked TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS fairness_overrides (
    domain TEXT PRIMARY KEY,
    boost INTEGER DEFAULT 0,
    reason TEXT,
    created_by TEXT DEFAULT 'system',
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

const stmts = {
  upsertScore: db.prepare(`INSERT OR REPLACE INTO fairness_scores
    (domain, category, size_score, trust_score, price_honesty, transparency,
     direct_booking, total_score, attestation_count, fraud_count, last_checked, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`),
  getScore: db.prepare('SELECT * FROM fairness_scores WHERE domain = ?'),
  getTopFair: db.prepare('SELECT * FROM fairness_scores ORDER BY total_score DESC LIMIT ?'),
  upsertOverride: db.prepare(`INSERT OR REPLACE INTO fairness_overrides
    (domain, boost, reason, created_by) VALUES (?, ?, ?, ?)`),
  getOverride: db.prepare('SELECT * FROM fairness_overrides WHERE domain = ?'),
};

// ─── Big Tech / Platform Registry ────────────────────────────────────

const PLATFORM_REGISTRY = {
  // Mega platforms — high commission, opaque pricing, aggressive marketing
  'amazon.com': { size: 'mega', commission: 15, darkPatterns: true, category: 'marketplace' },
  'ebay.com': { size: 'mega', commission: 13, darkPatterns: false, category: 'marketplace' },
  'alibaba.com': { size: 'mega', commission: 8, darkPatterns: true, category: 'marketplace' },
  'aliexpress.com': { size: 'mega', commission: 8, darkPatterns: true, category: 'marketplace' },
  'walmart.com': { size: 'mega', commission: 15, darkPatterns: true, category: 'marketplace' },

  // Large travel platforms — high commission to hotels/airlines
  'booking.com': { size: 'large', commission: 18, darkPatterns: true, category: 'travel' },
  'expedia.com': { size: 'large', commission: 20, darkPatterns: true, category: 'travel' },
  'hotels.com': { size: 'large', commission: 20, darkPatterns: true, category: 'travel' },
  'agoda.com': { size: 'large', commission: 18, darkPatterns: true, category: 'travel' },
  'tripadvisor.com': { size: 'large', commission: 15, darkPatterns: false, category: 'travel' },

  // Medium aggregators — useful but still take commission
  'kayak.com': { size: 'medium', commission: 5, darkPatterns: false, category: 'aggregator' },
  'skyscanner.com': { size: 'medium', commission: 5, darkPatterns: false, category: 'aggregator' },
  'trivago.com': { size: 'medium', commission: 5, darkPatterns: false, category: 'aggregator' },
  'momondo.com': { size: 'medium', commission: 5, darkPatterns: false, category: 'aggregator' },
  'google.com': { size: 'mega', commission: 0, darkPatterns: false, category: 'search' },

  // Small/Independent — zero or low commission, direct relationships
  'hostelworld.com': { size: 'small', commission: 12, darkPatterns: false, category: 'travel' },
  'kiwi.com': { size: 'small', commission: 5, darkPatterns: false, category: 'travel' },
  'almosafer.com': { size: 'small', commission: 8, darkPatterns: false, category: 'travel' },
  'wego.com': { size: 'small', commission: 3, darkPatterns: false, category: 'aggregator' },
  'flyin.com': { size: 'small', commission: 5, darkPatterns: false, category: 'travel' },
  'etsy.com': { size: 'medium', commission: 6.5, darkPatterns: false, category: 'marketplace' },
};

// Known dark patterns used by big platforms
const DARK_PATTERNS = {
  urgencyScarcity: {
    name: 'Urgency/Scarcity',
    name_ar: 'استعجال/ندرة وهمية',
    indicators: ['only X left', 'book now', 'limited time', 'selling fast', 'hurry',
      'عرض محدود', 'آخر فرصة', 'تبقى فقط', 'احجز الآن'],
  },
  confirmShaming: {
    name: 'Confirm Shaming',
    name_ar: 'إذلال للرفض',
    indicators: ['no thanks, i don\'t want to save', 'i\'ll pay full price',
      'لا أريد التوفير', 'سأدفع السعر الكامل'],
  },
  hiddenCosts: {
    name: 'Hidden Costs',
    name_ar: 'تكاليف مخفية',
    indicators: ['resort fee', 'cleaning fee', 'service charge', 'processing fee',
      'رسوم خدمة', 'رسوم تنظيف', 'رسوم منتجع'],
  },
  misdirection: {
    name: 'Misdirection',
    name_ar: 'تضليل',
    indicators: ['recommended', 'most popular', 'best value', 'top pick',
      'موصى به', 'الأكثر شعبية', 'أفضل قيمة'],
  },
};

// ─── Score Calculator ────────────────────────────────────────────────

function calculateFairnessScore(domain, context = {}) {
  const d = domain.replace(/^www\./, '').toLowerCase();
  const platform = PLATFORM_REGISTRY[d];
  const override = stmts.getOverride.get(d);

  let sizeScore = 50;
  let trustScore = 50;
  let priceHonesty = 50;
  let transparency = 50;
  let directBooking = 0;

  if (platform) {
    // Size scoring — smaller = higher
    switch (platform.size) {
      case 'mega': sizeScore = 15; break;
      case 'large': sizeScore = 30; break;
      case 'medium': sizeScore = 60; break;
      case 'small': sizeScore = 85; break;
    }

    // Commission impacts price honesty
    priceHonesty = Math.max(10, 100 - platform.commission * 3);

    // Dark patterns reduce transparency
    transparency = platform.darkPatterns ? 30 : 75;

    // Direct booking capability
    if (platform.category === 'travel' && platform.size === 'small') directBooking = 1;
  } else {
    // Unknown domain — likely independent/small
    sizeScore = 75;
    priceHonesty = 60;
    transparency = 60;

    // Check TLD indicators
    const tld = '.' + d.split('.').pop();
    const smallTlds = ['.shop', '.store', '.boutique', '.local', '.direct'];
    if (smallTlds.some(t => d.endsWith(t))) sizeScore += 10;

    // Long domain = likely niche/specific
    if (d.length > 15) sizeScore += 5;

    directBooking = 1; // Unknown = assume direct
  }

  // Apply context-based adjustments
  if (context.fraudAlerts && context.fraudAlerts > 0) {
    priceHonesty -= context.fraudAlerts * 15;
    trustScore -= context.fraudAlerts * 10;
  }
  if (context.attestations && context.attestations > 0) {
    trustScore += Math.min(30, context.attestations * 5);
  }
  if (context.priceIncreased) {
    priceHonesty -= 20;
  }

  // ── WAB Bridge Priority ───────────────────────────────────────────
  // Sites that installed the WAB script get significant bonuses:
  //   +15 trust  (cooperative = trustworthy)
  //   +10 transparency (open to agent interaction)
  //   +10 bonus if negotiation rules exist (willing to negotiate)
  //   +5 bonus if listed in WAB directory
  let wabBridgeBonus = 0;
  let wabBridge = null;
  try {
    wabBridge = context.wabBridge || getWabBridgeInfo(d);
  } catch (_) {}

  if (wabBridge) {
    trustScore += 15;
    transparency += 10;
    wabBridgeBonus += 5; // Base bonus for installing bridge

    if (wabBridge.hasNegotiation) {
      wabBridgeBonus += 10; // Negotiation-ready sites get extra priority
    }
    if (wabBridge.isListed) {
      wabBridgeBonus += 5; // Listed in directory = transparent
    }
    // Higher tiers show greater commitment
    if (wabBridge.tier === 'pro' || wabBridge.tier === 'enterprise') {
      wabBridgeBonus += 5;
    }
  }

  // Apply admin override
  const boost = (override ? override.boost : 0) + wabBridgeBonus;

  // Calculate total
  const total = Math.max(0, Math.min(100,
    Math.round(sizeScore * 0.25 + trustScore * 0.25 + priceHonesty * 0.25 + transparency * 0.25) + boost
  ));

  const category = total >= 70 ? 'recommended' : total >= 45 ? 'neutral' : 'caution';

  // Upsert to DB
  try {
    stmts.upsertScore.run(d, category, sizeScore, trustScore, priceHonesty, transparency,
      directBooking, total, context.attestations || 0, context.fraudAlerts || 0);
  } catch (_) {}

  return {
    domain: d,
    category,
    total,
    breakdown: { sizeScore, trustScore, priceHonesty, transparency, directBooking },
    wabBridge: wabBridge ? {
      installed: true,
      hasNegotiation: wabBridge.hasNegotiation,
      isListed: wabBridge.isListed,
      tier: wabBridge.tier,
      bonus: wabBridgeBonus,
    } : { installed: false },
    platform: platform ? { size: platform.size, commission: platform.commission } : null,
    override: boost !== wabBridgeBonus ? { boost: boost - wabBridgeBonus, reason: override?.reason } : null,
  };
}

// ─── Rank results with fairness ──────────────────────────────────────

function rankWithFairness(results, options = {}) {
  if (!results || results.length === 0) return [];

  // Calculate fairness for each result
  const scored = results.map(r => {
    const domain = r.domain || _extractDomain(r.url || '');
    const fairness = calculateFairnessScore(domain, {
      fraudAlerts: r.fraudAlerts?.length || 0,
      attestations: r.attestations || 0,
    });

    // Composite score: price (45%) + fairness (25%) + quality (15%) + WAB bridge (15%)
    const priceWeight = options.priceWeight || 0.45;
    const fairnessWeight = options.fairnessWeight || 0.25;
    const qualityWeight = options.qualityWeight || 0.15;
    const bridgeWeight = options.bridgeWeight || 0.15;

    // Normalize price score (lower price = higher score, 0-100)
    let priceScore = 50;
    if (r.priceUsd && options.avgPrice) {
      priceScore = Math.max(0, Math.min(100, 100 - ((r.priceUsd / options.avgPrice) * 50)));
    }

    // Quality score from rating
    const qualityScore = r.rating ? Math.min(100, r.rating * 20) : 50;

    // WAB Bridge score — sites with the bridge installed get priority
    // 100 = bridge + negotiation + listed, 60 = bridge only, 0 = no bridge
    let bridgeScore = 0;
    if (fairness.wabBridge && fairness.wabBridge.installed) {
      bridgeScore = 60; // Base: bridge installed
      if (fairness.wabBridge.hasNegotiation) bridgeScore += 25; // Can negotiate prices
      if (fairness.wabBridge.isListed) bridgeScore += 15; // Listed in directory
    }

    const compositeScore = Math.round(
      priceScore * priceWeight +
      fairness.total * fairnessWeight +
      qualityScore * qualityWeight +
      bridgeScore * bridgeWeight
    );

    return {
      ...r,
      fairness,
      priceScore,
      qualityScore,
      bridgeScore,
      compositeScore,
    };
  });

  // Sort by composite score
  scored.sort((a, b) => b.compositeScore - a.compositeScore);

  // Add rank labels
  scored.forEach((r, i) => {
    r.rank = i + 1;
    if (i === 0) r.badge = '🥇';
    else if (i === 1) r.badge = '🥈';
    else if (i === 2) r.badge = '🥉';

    // Add fairness badges
    if (r.fairness.category === 'recommended') r.fairnessBadge = '✅';
    else if (r.fairness.category === 'caution') r.fairnessBadge = '⚠️';

    if (r.fairness.breakdown.directBooking) r.directBadge = '🔗 Direct';
    if (r.fairness.platform?.size === 'small') r.sizeBadge = '🏪 Independent';

    // WAB Bridge badges
    if (r.fairness.wabBridge?.installed) {
      r.wabBridgeBadge = '🌉 WAB';
      if (r.fairness.wabBridge.hasNegotiation) r.negotiationBadge = '🤝 Negotiable';
    }
  });

  return scored;
}

// ─── Dark Pattern Detector ───────────────────────────────────────────

function detectDarkPatterns(text, lang = 'en') {
  const detected = [];
  const lowerText = (text || '').toLowerCase();

  for (const [key, pattern] of Object.entries(DARK_PATTERNS)) {
    const found = pattern.indicators.filter(ind => lowerText.includes(ind.toLowerCase()));
    if (found.length > 0) {
      detected.push({
        type: key,
        name: lang === 'ar' ? pattern.name_ar : pattern.name,
        matches: found,
        severity: found.length >= 3 ? 'high' : found.length >= 2 ? 'medium' : 'low',
      });
    }
  }

  return detected;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch (_) { return ''; }
}

function getTopFairSites(limit = 20) {
  return stmts.getTopFair.all(limit);
}

function setOverride(domain, boost, reason, createdBy = 'admin') {
  stmts.upsertOverride.run(domain.replace(/^www\./, ''), boost, reason, createdBy);
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  calculateFairnessScore,
  rankWithFairness,
  detectDarkPatterns,
  getTopFairSites,
  setOverride,
  getWabBridgeInfo,
  PLATFORM_REGISTRY,
  DARK_PATTERNS,
};
