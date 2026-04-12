/**
 * Dynamic Pricing Shield — Price Manipulation Detection Engine
 * ════════════════════════════════════════════════════════════════════════
 * Exposes how websites manipulate prices based on user identity signals:
 *   - Search frequency (repeated visits → higher prices)
 *   - Geolocation (IP-based regional pricing discrimination)
 *   - Device fingerprint (mobile vs desktop, brand premium)
 *   - Login status (logged-in users see different prices)
 *   - Cookies & browsing history (retargeting surcharges)
 *   - Time-of-day / day-of-week patterns
 *   - Referral source (search engine vs direct vs social)
 *
 * Architecture:
 *   Multi-Identity Probing: Agent opens the same page with N distinct
 *   identity "personas" — each with unique User-Agent, Accept-Language,
 *   cookies, referrer, and device hints. Prices collected from each probe
 *   are compared statistically to detect variance → manipulation.
 *
 *   Integration:
 *   - Ghost Mode (wab-browser): provides stealth fingerprints on client
 *   - Verification Engine: cross-checks prices via DOM+vision layer
 *   - Symphony Orchestrator: 'price-shield' template chains probing,
 *     analysis, and negotiation into one automated pipeline
 *   - Learning Engine: records manipulation patterns for future reference
 *   - Reputation: penalises sites caught using dynamic pricing tricks
 *
 * Everything runs locally. No data leaves the WAB instance.
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS price_probes (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    site_id TEXT,
    url TEXT NOT NULL,
    persona_id TEXT NOT NULL,
    persona_label TEXT NOT NULL,
    persona_config TEXT DEFAULT '{}',
    detected_price REAL,
    currency TEXT DEFAULT 'USD',
    raw_price_text TEXT,
    response_headers TEXT DEFAULT '{}',
    cookies_received TEXT DEFAULT '[]',
    probe_duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_scans (
    id TEXT PRIMARY KEY,
    site_id TEXT,
    url TEXT NOT NULL,
    item_name TEXT,
    category TEXT,
    probe_count INTEGER DEFAULT 0,
    lowest_price REAL,
    highest_price REAL,
    median_price REAL,
    price_variance REAL DEFAULT 0,
    manipulation_score REAL DEFAULT 0,
    manipulation_type TEXT DEFAULT 'none',
    manipulation_details TEXT DEFAULT '{}',
    recommended_price REAL,
    recommended_persona TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN (
      'pending','probing','analyzing','completed','failed'
    )),
    created_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS price_manipulation_log (
    id TEXT PRIMARY KEY,
    scan_id TEXT NOT NULL,
    site_id TEXT,
    url TEXT NOT NULL,
    manipulation_type TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
    price_spread REAL DEFAULT 0,
    price_spread_pct REAL DEFAULT 0,
    lowest_price REAL,
    highest_price REAL,
    details TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_history (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    item_name TEXT,
    price REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    source_persona TEXT,
    captured_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_probes_scan ON price_probes(scan_id);
  CREATE INDEX IF NOT EXISTS idx_probes_url ON price_probes(url);
  CREATE INDEX IF NOT EXISTS idx_scans_url ON price_scans(url);
  CREATE INDEX IF NOT EXISTS idx_scans_status ON price_scans(status);
  CREATE INDEX IF NOT EXISTS idx_manip_site ON price_manipulation_log(site_id);
  CREATE INDEX IF NOT EXISTS idx_manip_type ON price_manipulation_log(manipulation_type);
  CREATE INDEX IF NOT EXISTS idx_history_url ON price_history(url);
  CREATE INDEX IF NOT EXISTS idx_history_time ON price_history(captured_at);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertScan: db.prepare(`
    INSERT INTO price_scans (id, site_id, url, item_name, category, status)
    VALUES (?, ?, ?, ?, ?, 'pending')
  `),
  updateScan: db.prepare(`
    UPDATE price_scans
    SET probe_count = ?, lowest_price = ?, highest_price = ?, median_price = ?,
        price_variance = ?, manipulation_score = ?, manipulation_type = ?,
        manipulation_details = ?, recommended_price = ?, recommended_persona = ?,
        status = ?, completed_at = datetime('now')
    WHERE id = ?
  `),
  updateScanStatus: db.prepare(`UPDATE price_scans SET status = ? WHERE id = ?`),
  getScan: db.prepare(`SELECT * FROM price_scans WHERE id = ?`),
  getScansForUrl: db.prepare(`SELECT * FROM price_scans WHERE url = ? ORDER BY created_at DESC LIMIT ?`),
  getRecentScans: db.prepare(`SELECT * FROM price_scans WHERE status = 'completed' ORDER BY created_at DESC LIMIT ?`),

  insertProbe: db.prepare(`
    INSERT INTO price_probes
    (id, scan_id, site_id, url, persona_id, persona_label, persona_config,
     detected_price, currency, raw_price_text, response_headers, cookies_received, probe_duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getProbes: db.prepare(`SELECT * FROM price_probes WHERE scan_id = ? ORDER BY created_at ASC`),

  insertManipulation: db.prepare(`
    INSERT INTO price_manipulation_log
    (id, scan_id, site_id, url, manipulation_type, severity,
     price_spread, price_spread_pct, lowest_price, highest_price, details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  getManipulations: db.prepare(`SELECT * FROM price_manipulation_log WHERE scan_id = ?`),
  getManipulationsBySite: db.prepare(`SELECT * FROM price_manipulation_log WHERE site_id = ? ORDER BY created_at DESC LIMIT ?`),
  getManipulationStats: db.prepare(`
    SELECT manipulation_type, severity,
      COUNT(*) as count,
      AVG(price_spread_pct) as avg_spread_pct,
      MAX(price_spread_pct) as max_spread_pct
    FROM price_manipulation_log
    GROUP BY manipulation_type, severity
    ORDER BY count DESC
  `),

  insertHistory: db.prepare(`
    INSERT INTO price_history (id, url, item_name, price, currency, source_persona)
    VALUES (?, ?, ?, ?, ?, ?)
  `),
  getHistory: db.prepare(`SELECT * FROM price_history WHERE url = ? ORDER BY captured_at DESC LIMIT ?`),
  getHistoryRange: db.prepare(`
    SELECT * FROM price_history
    WHERE url = ? AND captured_at >= ? AND captured_at <= ?
    ORDER BY captured_at ASC
  `),
};

// ─── Identity Personas ───────────────────────────────────────────────
// Each persona simulates a distinct user profile that might trigger
// different dynamic pricing on the target site.

const PERSONAS = [
  {
    id: 'clean-desktop',
    label: 'Clean Desktop Visitor',
    description: 'Fresh Chrome/Windows session, no cookies, no history',
    category: 'baseline',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'clean-mobile',
    label: 'Clean Mobile Visitor',
    description: 'Fresh Safari/iPhone, no cookies — tests mobile pricing',
    category: 'device',
    config: {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'iPhone',
      mobile: true,
      cookies: {},
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"iOS"', 'Sec-CH-UA-Mobile': '?1' }
    }
  },
  {
    id: 'premium-mac',
    label: 'Premium Mac User',
    description: 'Safari on macOS — tests Apple/premium device surcharge',
    category: 'device',
    config: {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'MacIntel',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"macOS"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'geo-eu',
    label: 'European Visitor',
    description: 'German Firefox on Linux — tests EU geolocation pricing',
    category: 'geolocation',
    config: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
      acceptLanguage: 'de-DE,de;q=0.9,en-US;q=0.5,en;q=0.3',
      platform: 'Linux x86_64',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: {
        'Sec-CH-UA-Platform': '"Linux"', 'Sec-CH-UA-Mobile': '?0',
        'X-Forwarded-For': '85.214.132.117'
      }
    }
  },
  {
    id: 'geo-mena',
    label: 'MENA Region Visitor',
    description: 'Arabic Chrome on Windows — tests Middle East pricing',
    category: 'geolocation',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'ar-SA,ar;q=0.9,en-US;q=0.5,en;q=0.3',
      platform: 'Win32',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'geo-sea',
    label: 'Southeast Asia Visitor',
    description: 'Chrome on Android — tests SEA regional pricing',
    category: 'geolocation',
    config: {
      userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
      acceptLanguage: 'th-TH,th;q=0.9,en-US;q=0.5,en;q=0.3',
      platform: 'Linux armv8l',
      mobile: true,
      cookies: {},
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"Android"', 'Sec-CH-UA-Mobile': '?1' }
    }
  },
  {
    id: 'repeat-visitor',
    label: 'Repeat Visitor (3rd visit)',
    description: 'Simulates return visits with existing cookies — tests urgency/frequency markup',
    category: 'behavior',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      mobile: false,
      cookies: {
        '_visit_count': '3',
        '_last_visit': new Date(Date.now() - 3600000).toISOString(),
        '_viewed_items': 'true'
      },
      referrer: '',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'search-referral',
    label: 'Google Search Referral',
    description: 'Arrives from Google search — tests referral-based pricing',
    category: 'referral',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      mobile: false,
      cookies: {},
      referrer: 'https://www.google.com/search?q=best+deals',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'social-referral',
    label: 'Social Media Referral',
    description: 'Arrives from Facebook — tests social referral pricing',
    category: 'referral',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      mobile: false,
      cookies: {},
      referrer: 'https://www.facebook.com/',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'price-compare-referral',
    label: 'Price Comparison Referral',
    description: 'Arrives from a price comparison site — typically forces lowest price',
    category: 'referral',
    config: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptLanguage: 'en-US,en;q=0.9',
      platform: 'Win32',
      mobile: false,
      cookies: {},
      referrer: 'https://www.google.com/shopping',
      headers: { 'Sec-CH-UA-Platform': '"Windows"', 'Sec-CH-UA-Mobile': '?0' }
    }
  },
  {
    id: 'incognito-linux',
    label: 'Privacy-Focused User',
    description: 'Firefox on Linux, DNT + GPC enabled — tests privacy-aware pricing',
    category: 'privacy',
    config: {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
      acceptLanguage: 'en-US,en;q=0.5',
      platform: 'Linux x86_64',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: {
        'Sec-CH-UA-Platform': '"Linux"', 'Sec-CH-UA-Mobile': '?0',
        'DNT': '1', 'Sec-GPC': '1'
      }
    }
  },
  {
    id: 'bot-like',
    label: 'Bot-Like Agent',
    description: 'Minimal headers, no JS hints — tests anti-bot price walls',
    category: 'stealth',
    config: {
      userAgent: 'Mozilla/5.0 (compatible; WABAgent/1.0)',
      acceptLanguage: 'en',
      platform: '',
      mobile: false,
      cookies: {},
      referrer: '',
      headers: {}
    }
  },
];

// ─── Price Extraction Utilities ──────────────────────────────────────

function extractPrice(text) {
  if (typeof text !== 'string') return null;
  const patterns = [
    /[\$€£¥]\s*([\d,]+\.?\d*)/,
    /([\d,]+\.?\d*)\s*[\$€£¥]/,
    /(?:USD|EUR|GBP|SAR|AED|TND)\s*([\d,]+\.?\d*)/i,
    /([\d,]+\.?\d*)\s*(?:USD|EUR|GBP|SAR|AED|TND)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return parseFloat(match[1].replace(/,/g, ''));
  }
  return null;
}

function detectCurrency(text) {
  if (typeof text !== 'string') return 'USD';
  const map = { '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
  for (const [sym, code] of Object.entries(map)) {
    if (text.includes(sym)) return code;
  }
  const codeMatch = text.match(/\b(USD|EUR|GBP|SAR|AED|TND|JPY)\b/i);
  return codeMatch ? codeMatch[1].toUpperCase() : 'USD';
}

// ─── Statistical Helpers ─────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function variance(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
}

function standardDeviation(arr) {
  return Math.sqrt(variance(arr));
}

function coefficientOfVariation(arr) {
  if (!arr.length) return 0;
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  if (mean === 0) return 0;
  return standardDeviation(arr) / mean;
}

function zScores(arr) {
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const sd = standardDeviation(arr);
  if (sd === 0) return arr.map(() => 0);
  return arr.map(v => (v - mean) / sd);
}

// ─── Core: Create Scan ───────────────────────────────────────────────

/**
 * Initiate a new price manipulation scan for a given URL/product.
 * Returns a scan object with an ID the caller uses to add probes.
 */
function createScan({ siteId, url, itemName, category }) {
  const id = crypto.randomBytes(12).toString('hex');
  stmts.insertScan.run(id, siteId || null, url, itemName || null, category || null);
  return {
    scanId: id,
    url,
    itemName,
    personas: PERSONAS.map(p => ({ id: p.id, label: p.label, category: p.category })),
    status: 'pending'
  };
}

// ─── Core: Record Probe Result ───────────────────────────────────────

/**
 * After probing a page with a specific persona, record the result.
 * The agent (or browser extension) calls this once per persona.
 */
function recordProbe(scanId, {
  personaId, priceText, currency, responseHeaders, cookiesReceived, durationMs
}) {
  const persona = PERSONAS.find(p => p.id === personaId);
  if (!persona) return { error: 'unknown_persona', personaId };

  const scan = stmts.getScan.get(scanId);
  if (!scan) return { error: 'scan_not_found' };

  const price = extractPrice(priceText);
  const detectedCurrency = currency || detectCurrency(priceText);

  const probeId = crypto.randomBytes(12).toString('hex');

  stmts.insertProbe.run(
    probeId, scanId, scan.site_id, scan.url,
    persona.id, persona.label, JSON.stringify(persona.config),
    price, detectedCurrency, priceText || null,
    JSON.stringify(responseHeaders || {}),
    JSON.stringify(cookiesReceived || []),
    durationMs || 0
  );

  // Update scan status
  if (scan.status === 'pending') {
    stmts.updateScanStatus.run('probing', scanId);
  }

  // Record price history
  if (price !== null) {
    stmts.insertHistory.run(
      crypto.randomBytes(12).toString('hex'),
      scan.url, scan.item_name, price, detectedCurrency, persona.id
    );
  }

  return {
    probeId,
    personaId: persona.id,
    personaLabel: persona.label,
    detectedPrice: price,
    currency: detectedCurrency,
    status: 'recorded'
  };
}

// ─── Core: Analyze Scan ──────────────────────────────────────────────

/**
 * After all (or enough) probes are recorded, analyze the scan to detect
 * price manipulation. Returns a comprehensive manipulation report.
 */
function analyzeScan(scanId) {
  const scan = stmts.getScan.get(scanId);
  if (!scan) return { error: 'scan_not_found' };

  const probes = stmts.getProbes.all(scanId);
  if (probes.length < 2) {
    return { error: 'insufficient_probes', minimum: 2, current: probes.length };
  }

  stmts.updateScanStatus.run('analyzing', scanId);

  // Collect valid prices
  const validProbes = probes.filter(p => p.detected_price !== null);
  if (validProbes.length < 2) {
    stmts.updateScan.run(
      probes.length, null, null, null, 0, 0, 'none', '{}', null, null, 'completed', scanId
    );
    return { scanId, status: 'completed', manipulation: false, reason: 'insufficient_price_data' };
  }

  const prices = validProbes.map(p => p.detected_price);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const medianPrice = median(prices);
  const priceVariance = variance(prices);
  const cv = coefficientOfVariation(prices);
  const spread = highestPrice - lowestPrice;
  const spreadPct = lowestPrice > 0 ? (spread / lowestPrice) * 100 : 0;

  // ─── Manipulation Detection Algorithms ─────────────────────────

  const manipulations = [];
  let manipulationScore = 0;

  // 1. Overall price variance test
  if (cv > 0.02) { // >2% coefficient of variation
    const severity = cv > 0.15 ? 'critical' : cv > 0.08 ? 'high' : cv > 0.04 ? 'medium' : 'low';
    const severityScore = { low: 10, medium: 25, high: 50, critical: 80 };
    manipulations.push({
      type: 'price_variance',
      severity,
      description: `Price varies by ${spreadPct.toFixed(1)}% across identities ($${lowestPrice} — $${highestPrice})`,
      spread,
      spreadPct: Math.round(spreadPct * 10) / 10,
      cv: Math.round(cv * 1000) / 1000
    });
    manipulationScore += severityScore[severity];
  }

  // 2. Device-based discrimination
  const deviceAnalysis = _analyzeByCategory(validProbes, 'device');
  if (deviceAnalysis.detected) {
    manipulations.push({
      type: 'device_discrimination',
      severity: deviceAnalysis.severity,
      description: deviceAnalysis.description,
      details: deviceAnalysis.details
    });
    manipulationScore += deviceAnalysis.score;
  }

  // 3. Geolocation-based pricing
  const geoAnalysis = _analyzeByCategory(validProbes, 'geolocation');
  if (geoAnalysis.detected) {
    manipulations.push({
      type: 'geo_pricing',
      severity: geoAnalysis.severity,
      description: geoAnalysis.description,
      details: geoAnalysis.details
    });
    manipulationScore += geoAnalysis.score;
  }

  // 4. Referral-source manipulation
  const referralAnalysis = _analyzeByCategory(validProbes, 'referral');
  if (referralAnalysis.detected) {
    manipulations.push({
      type: 'referral_manipulation',
      severity: referralAnalysis.severity,
      description: referralAnalysis.description,
      details: referralAnalysis.details
    });
    manipulationScore += referralAnalysis.score;
  }

  // 5. Repeat-visitor surcharge detection
  const repeatProbe = validProbes.find(p => p.persona_id === 'repeat-visitor');
  const baselineProbe = validProbes.find(p => p.persona_id === 'clean-desktop');
  if (repeatProbe && baselineProbe && repeatProbe.detected_price && baselineProbe.detected_price) {
    const repeatDiff = repeatProbe.detected_price - baselineProbe.detected_price;
    const repeatPct = baselineProbe.detected_price > 0
      ? (repeatDiff / baselineProbe.detected_price) * 100 : 0;
    if (repeatPct > 1) { // >1% surcharge for returning visitors
      const severity = repeatPct > 10 ? 'critical' : repeatPct > 5 ? 'high' : repeatPct > 2 ? 'medium' : 'low';
      manipulations.push({
        type: 'repeat_visitor_surcharge',
        severity,
        description: `Returning visitors pay ${repeatPct.toFixed(1)}% more ($${repeatProbe.detected_price} vs $${baselineProbe.detected_price} for first-time)`,
        details: { repeatPrice: repeatProbe.detected_price, baselinePrice: baselineProbe.detected_price, surcharge: repeatDiff }
      });
      manipulationScore += { low: 15, medium: 30, high: 50, critical: 75 }[severity];
    }
  }

  // 6. Privacy penalty — sites charging more when tracking is blocked
  const privacyProbe = validProbes.find(p => p.persona_id === 'incognito-linux');
  if (privacyProbe && baselineProbe && privacyProbe.detected_price && baselineProbe.detected_price) {
    const privacyDiff = privacyProbe.detected_price - baselineProbe.detected_price;
    const privacyPct = baselineProbe.detected_price > 0
      ? (privacyDiff / baselineProbe.detected_price) * 100 : 0;
    if (privacyPct > 1) {
      const severity = privacyPct > 8 ? 'high' : privacyPct > 3 ? 'medium' : 'low';
      manipulations.push({
        type: 'privacy_penalty',
        severity,
        description: `Privacy-focused browsers see ${privacyPct.toFixed(1)}% higher prices — site penalises tracking blockers`,
        details: { privacyPrice: privacyProbe.detected_price, baselinePrice: baselineProbe.detected_price, penalty: privacyDiff }
      });
      manipulationScore += { low: 10, medium: 25, high: 45 }[severity];
    }
  }

  // 7. Bot-detection price wall
  const botProbe = validProbes.find(p => p.persona_id === 'bot-like');
  if (botProbe && baselineProbe) {
    if (botProbe.detected_price === null && baselineProbe.detected_price) {
      manipulations.push({
        type: 'bot_price_wall',
        severity: 'medium',
        description: 'Site hides prices from bot-like visitors — anti-scraping defence detected',
        details: { botBlocked: true }
      });
      manipulationScore += 20;
    } else if (botProbe.detected_price && baselineProbe.detected_price) {
      const botDiff = Math.abs(botProbe.detected_price - baselineProbe.detected_price);
      const botPct = baselineProbe.detected_price > 0
        ? (botDiff / baselineProbe.detected_price) * 100 : 0;
      if (botPct > 3) {
        manipulations.push({
          type: 'bot_price_wall',
          severity: botPct > 10 ? 'high' : 'medium',
          description: `Bot-like agents see ${botPct.toFixed(1)}% different prices — automated visitor detection active`,
          details: { botPrice: botProbe.detected_price, baselinePrice: baselineProbe.detected_price }
        });
        manipulationScore += botPct > 10 ? 35 : 15;
      }
    }
  }

  // 8. Time-pattern detection (using historical data)
  const historicalManipulation = _analyzeHistoricalPrices(scan.url);
  if (historicalManipulation.detected) {
    manipulations.push({
      type: 'temporal_manipulation',
      severity: historicalManipulation.severity,
      description: historicalManipulation.description,
      details: historicalManipulation.details
    });
    manipulationScore += historicalManipulation.score;
  }

  // ─── Clamp & Classify ──────────────────────────────────────────

  manipulationScore = Math.min(100, manipulationScore);

  const manipulationType =
    manipulationScore === 0 ? 'none' :
    manipulationScore < 20 ? 'minor' :
    manipulationScore < 45 ? 'moderate' :
    manipulationScore < 70 ? 'significant' :
    'severe';

  // Find recommended (lowest) price persona
  let recommendedPrice = lowestPrice;
  let recommendedPersona = null;
  for (const probe of validProbes) {
    if (probe.detected_price === lowestPrice) {
      recommendedPersona = probe.persona_id;
      break;
    }
  }

  // ─── Z-Score Outlier Detection ─────────────────────────────────

  const zs = zScores(prices);
  const outliers = [];
  validProbes.forEach((p, i) => {
    if (Math.abs(zs[i]) > 1.5) {
      outliers.push({
        persona: p.persona_id,
        label: p.persona_label,
        price: p.detected_price,
        zScore: Math.round(zs[i] * 100) / 100,
        direction: zs[i] > 0 ? 'above_average' : 'below_average'
      });
    }
  });

  // ─── Persist ───────────────────────────────────────────────────

  const manipulationDetails = {
    manipulations,
    outliers,
    statistics: {
      mean: Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100,
      median: medianPrice,
      standardDeviation: Math.round(standardDeviation(prices) * 100) / 100,
      coefficientOfVariation: Math.round(cv * 1000) / 1000,
      probeCount: validProbes.length,
      totalProbes: probes.length
    }
  };

  stmts.updateScan.run(
    probes.length, lowestPrice, highestPrice, medianPrice,
    Math.round(priceVariance * 100) / 100, manipulationScore,
    manipulationType, JSON.stringify(manipulationDetails),
    recommendedPrice, recommendedPersona,
    'completed', scanId
  );

  // Log individual manipulations
  for (const m of manipulations) {
    stmts.insertManipulation.run(
      crypto.randomBytes(12).toString('hex'),
      scanId, scan.site_id, scan.url,
      m.type, m.severity,
      spread, Math.round(spreadPct * 10) / 10,
      lowestPrice, highestPrice,
      JSON.stringify(m.details || {})
    );
  }

  return {
    scanId,
    url: scan.url,
    itemName: scan.item_name,
    status: 'completed',
    manipulation: {
      detected: manipulationScore > 0,
      score: manipulationScore,
      level: manipulationType,
      types: manipulations.map(m => m.type),
      count: manipulations.length
    },
    prices: {
      lowest: lowestPrice,
      highest: highestPrice,
      median: medianPrice,
      spread,
      spreadPct: Math.round(spreadPct * 10) / 10
    },
    recommendation: {
      bestPrice: recommendedPrice,
      bestPersona: recommendedPersona,
      bestPersonaLabel: PERSONAS.find(p => p.id === recommendedPersona)?.label || 'Unknown',
      savings: highestPrice - recommendedPrice,
      savingsPct: highestPrice > 0
        ? Math.round(((highestPrice - recommendedPrice) / highestPrice) * 1000) / 10
        : 0,
      strategy: _buildStrategy(manipulations, recommendedPersona)
    },
    manipulations,
    outliers,
    statistics: manipulationDetails.statistics,
    probes: validProbes.map(p => ({
      persona: p.persona_id,
      label: p.persona_label,
      price: p.detected_price,
      currency: p.currency
    }))
  };
}

// ─── Category Analysis Helper ────────────────────────────────────────

function _analyzeByCategory(probes, category) {
  const persona = PERSONAS.filter(p => p.category === category);
  const categoryProbes = probes.filter(p => persona.some(ps => ps.id === p.persona_id));
  const baselineProbe = probes.find(p => p.persona_id === 'clean-desktop');

  if (categoryProbes.length === 0 || !baselineProbe || !baselineProbe.detected_price) {
    return { detected: false };
  }

  const categoryPrices = categoryProbes.filter(p => p.detected_price !== null);
  if (categoryPrices.length === 0) return { detected: false };

  const baseline = baselineProbe.detected_price;
  const diffs = categoryPrices.map(p => ({
    persona: p.persona_id,
    label: p.persona_label,
    price: p.detected_price,
    diff: p.detected_price - baseline,
    diffPct: baseline > 0 ? ((p.detected_price - baseline) / baseline) * 100 : 0
  }));

  const maxAbsDiffPct = Math.max(...diffs.map(d => Math.abs(d.diffPct)));

  if (maxAbsDiffPct < 1) return { detected: false };

  const categoryLabels = {
    device: 'Device-based pricing',
    geolocation: 'Geolocation-based pricing',
    referral: 'Referral-source pricing',
    behavior: 'Behavioral pricing',
    privacy: 'Privacy-based pricing',
    stealth: 'Bot-detection pricing'
  };

  const severity = maxAbsDiffPct > 15 ? 'critical' : maxAbsDiffPct > 8 ? 'high' : maxAbsDiffPct > 3 ? 'medium' : 'low';
  const score = { low: 10, medium: 25, high: 45, critical: 70 }[severity];

  const description = `${categoryLabels[category] || category} detected: up to ${maxAbsDiffPct.toFixed(1)}% difference vs baseline`;

  return {
    detected: true,
    severity,
    score,
    description,
    details: {
      category,
      baseline: { persona: 'clean-desktop', price: baseline },
      comparisons: diffs
    }
  };
}

// ─── Historical Price Analysis ───────────────────────────────────────

function _analyzeHistoricalPrices(url) {
  const history = stmts.getHistory.all(url, 50);

  if (history.length < 5) {
    return { detected: false };
  }

  const prices = history.map(h => h.price);
  const cv = coefficientOfVariation(prices);

  if (cv < 0.05) return { detected: false };

  // Check for upward trend (price creep)
  const recentAvg = prices.slice(0, Math.min(5, prices.length)).reduce((s, v) => s + v, 0) /
    Math.min(5, prices.length);
  const olderAvg = prices.slice(-Math.min(5, prices.length)).reduce((s, v) => s + v, 0) /
    Math.min(5, prices.length);

  const trend = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  if (Math.abs(trend) < 2) return { detected: false };

  const direction = trend > 0 ? 'increasing' : 'decreasing';
  const severity = Math.abs(trend) > 15 ? 'high' : Math.abs(trend) > 5 ? 'medium' : 'low';

  return {
    detected: true,
    severity,
    score: { low: 10, medium: 20, high: 35 }[severity],
    description: `Price ${direction} over time: ${Math.abs(trend).toFixed(1)}% change detected across ${history.length} observations`,
    details: {
      recentAvg: Math.round(recentAvg * 100) / 100,
      olderAvg: Math.round(olderAvg * 100) / 100,
      trend: Math.round(trend * 10) / 10,
      direction,
      dataPoints: history.length
    }
  };
}

// ─── Strategy Builder ────────────────────────────────────────────────

function _buildStrategy(manipulations, bestPersona) {
  const tips = [];

  if (manipulations.length === 0) {
    tips.push('No dynamic pricing detected — this site shows consistent prices across identities.');
    return { tips, approach: 'direct' };
  }

  const types = new Set(manipulations.map(m => m.type));

  if (types.has('device_discrimination')) {
    tips.push('Switch to a different device or browser to trigger lower pricing.');
  }
  if (types.has('geo_pricing')) {
    tips.push('Use a VPN to appear from a region with cheaper pricing.');
  }
  if (types.has('repeat_visitor_surcharge')) {
    tips.push('Clear cookies and browsing data before purchasing, or use incognito mode.');
  }
  if (types.has('referral_manipulation')) {
    tips.push('Try arriving via a price-comparison site or Google Shopping for lower referral-triggered prices.');
  }
  if (types.has('privacy_penalty')) {
    tips.push('Temporarily allow tracking — some sites charge more when tracking is blocked.');
  }
  if (types.has('bot_price_wall')) {
    tips.push('Ensure your browser appears as a regular human visitor.');
  }
  if (types.has('temporal_manipulation')) {
    tips.push('Check prices at different times of day — this site changes prices over time.');
  }
  if (types.has('price_variance')) {
    tips.push('Significant price variance detected. Use the recommended persona/identity to access the lowest price.');
  }

  const persona = PERSONAS.find(p => p.id === bestPersona);
  if (persona) {
    tips.push(`Best identity for lowest price: "${persona.label}" — ${persona.description}`);
  }

  return {
    tips,
    approach: manipulations.some(m => m.severity === 'critical' || m.severity === 'high')
      ? 'stealth' : 'optimized',
    recommendedPersona: bestPersona
  };
}

// ─── Quick Scan (All-in-One) ─────────────────────────────────────────

/**
 * Perform a quick scan by providing pre-collected probe data.
 * Useful when the client collects all prices first, then sends them.
 *
 * @param {Object} options
 * @param {string} options.url - Product page URL
 * @param {string} options.itemName - Product name
 * @param {string} options.siteId - Optional site ID
 * @param {string} options.category - Optional product category
 * @param {Array} options.probes - Array of { personaId, priceText, currency? }
 */
function quickScan({ url, itemName, siteId, category, probes }) {
  if (!url || !probes || !Array.isArray(probes) || probes.length < 2) {
    return { error: 'url and at least 2 probes are required' };
  }

  const scan = createScan({ siteId, url, itemName, category });

  for (const probe of probes) {
    if (!probe.personaId || !probe.priceText) continue;
    recordProbe(scan.scanId, {
      personaId: probe.personaId,
      priceText: probe.priceText,
      currency: probe.currency,
      responseHeaders: probe.responseHeaders,
      cookiesReceived: probe.cookiesReceived,
      durationMs: probe.durationMs
    });
  }

  return analyzeScan(scan.scanId);
}

// ─── Get Scan Report ─────────────────────────────────────────────────

function getScanReport(scanId) {
  const scan = stmts.getScan.get(scanId);
  if (!scan) return { error: 'scan_not_found' };

  const probes = stmts.getProbes.all(scanId);
  const manipulations = stmts.getManipulations.all(scanId);
  const details = safeParseJSON(scan.manipulation_details);

  return {
    scan: {
      id: scan.id,
      url: scan.url,
      itemName: scan.item_name,
      category: scan.category,
      status: scan.status,
      createdAt: scan.created_at,
      completedAt: scan.completed_at
    },
    prices: {
      lowest: scan.lowest_price,
      highest: scan.highest_price,
      median: scan.median_price,
      variance: scan.price_variance,
      probeCount: scan.probe_count
    },
    manipulation: {
      score: scan.manipulation_score,
      level: scan.manipulation_type,
      details: details.manipulations || [],
      outliers: details.outliers || [],
      statistics: details.statistics || {}
    },
    recommendation: {
      bestPrice: scan.recommended_price,
      bestPersona: scan.recommended_persona,
      bestPersonaLabel: PERSONAS.find(p => p.id === scan.recommended_persona)?.label || null,
      strategy: scan.recommended_persona ? _buildStrategy(
        manipulations.map(m => ({ type: m.manipulation_type, severity: m.severity })),
        scan.recommended_persona
      ) : null
    },
    probes: probes.map(p => ({
      persona: p.persona_id,
      label: p.persona_label,
      price: p.detected_price,
      currency: p.currency,
      rawText: p.raw_price_text,
      duration: p.probe_duration_ms
    })),
    history: manipulations.map(m => ({
      type: m.manipulation_type,
      severity: m.severity,
      spread: m.price_spread,
      spreadPct: m.price_spread_pct,
      detectedAt: m.created_at
    }))
  };
}

// ─── Global Statistics ───────────────────────────────────────────────

function getGlobalStats() {
  const manipStats = stmts.getManipulationStats.all();

  const totalScans = db.prepare('SELECT COUNT(*) as c FROM price_scans').get().c;
  const completedScans = db.prepare("SELECT COUNT(*) as c FROM price_scans WHERE status = 'completed'").get().c;
  const manipulatedScans = db.prepare("SELECT COUNT(*) as c FROM price_scans WHERE manipulation_score > 0").get().c;

  const avgScore = db.prepare('SELECT AVG(manipulation_score) as avg FROM price_scans WHERE status = ?').get('completed');

  const topManipulators = db.prepare(`
    SELECT site_id, COUNT(*) as incidents,
      AVG(price_spread_pct) as avg_spread,
      MAX(price_spread_pct) as max_spread,
      GROUP_CONCAT(DISTINCT manipulation_type) as types
    FROM price_manipulation_log
    WHERE site_id IS NOT NULL
    GROUP BY site_id
    ORDER BY incidents DESC
    LIMIT 10
  `).all();

  const recentScans = stmts.getRecentScans.all(10);

  return {
    overview: {
      totalScans,
      completedScans,
      manipulatedScans,
      manipulationRate: totalScans > 0 ? Math.round((manipulatedScans / totalScans) * 1000) / 10 : 0,
      averageManipulationScore: Math.round((avgScore?.avg || 0) * 10) / 10
    },
    byType: manipStats,
    topManipulators: topManipulators.map(t => ({
      siteId: t.site_id,
      incidents: t.incidents,
      avgSpread: Math.round(t.avg_spread * 10) / 10,
      maxSpread: Math.round(t.max_spread * 10) / 10,
      types: t.types ? t.types.split(',') : []
    })),
    recentScans: recentScans.map(s => ({
      id: s.id,
      url: s.url,
      itemName: s.item_name,
      manipulationScore: s.manipulation_score,
      level: s.manipulation_type,
      lowestPrice: s.lowest_price,
      highestPrice: s.highest_price,
      createdAt: s.created_at
    }))
  };
}

// ─── Price History for URL ───────────────────────────────────────────

function getPriceHistory(url, limit = 30) {
  const history = stmts.getHistory.all(url, limit);
  if (!history.length) return { url, history: [], trend: null };

  const prices = history.map(h => h.price);
  const cv = coefficientOfVariation(prices);

  // Simple trend
  const recentAvg = prices.slice(0, Math.min(5, prices.length)).reduce((s, v) => s + v, 0) /
    Math.min(5, prices.length);
  const olderAvg = prices.slice(-Math.min(5, prices.length)).reduce((s, v) => s + v, 0) /
    Math.min(5, prices.length);
  const trend = olderAvg > 0 ? ((recentAvg - olderAvg) / olderAvg) * 100 : 0;

  return {
    url,
    history: history.map(h => ({
      price: h.price,
      currency: h.currency,
      persona: h.source_persona,
      capturedAt: h.captured_at
    })),
    statistics: {
      current: prices[0],
      lowest: Math.min(...prices),
      highest: Math.max(...prices),
      average: Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100,
      volatility: Math.round(cv * 1000) / 1000,
      trend: Math.round(trend * 10) / 10,
      direction: trend > 2 ? 'rising' : trend < -2 ? 'falling' : 'stable'
    }
  };
}

// ─── List Available Personas ─────────────────────────────────────────

function getPersonas() {
  return PERSONAS.map(p => ({
    id: p.id,
    label: p.label,
    description: p.description,
    category: p.category
  }));
}

// ─── Utility ─────────────────────────────────────────────────────────

function safeParseJSON(str) {
  try { return JSON.parse(str); } catch { return {}; }
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  createScan,
  recordProbe,
  analyzeScan,
  quickScan,
  getScanReport,
  getGlobalStats,
  getPriceHistory,
  getPersonas,
  PERSONAS
};
