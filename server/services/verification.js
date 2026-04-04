/**
 * Anti-Hallucination Shield (Cross-Verification Engine)
 * ════════════════════════════════════════════════════════════════════════
 * Prevents AI agent "hallucinations" by cross-verifying data read from
 * the DOM against visual analysis (screenshots). If the agent reads a
 * price as "$10" but the screenshot shows "$100", the shield catches the
 * discrepancy and halts execution, requesting human confirmation.
 *
 * Verification layers:
 *  1. DOM vs Vision: Compare text extracted from DOM with OCR/vision output
 *  2. Price Sanity: Flag unrealistically low prices vs market averages
 *  3. Temporal Consistency: Compare with previously cached values
 *  4. Multi-Source: Cross-check across multiple page elements
 */

const { db } = require('../models/db');
const crypto = require('crypto');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS verification_results (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_id TEXT,
    url TEXT,
    verification_type TEXT NOT NULL CHECK(verification_type IN (
      'price','text','element_presence','form_data','navigation','action_result'
    )),
    dom_value TEXT,
    vision_value TEXT,
    cached_value TEXT,
    match_score REAL DEFAULT 0,
    discrepancy_type TEXT CHECK(discrepancy_type IN (
      'none','minor','major','critical','fraud_suspected'
    )),
    discrepancy_details TEXT DEFAULT '{}',
    action_taken TEXT DEFAULT 'none' CHECK(action_taken IN (
      'none','warn','halt','confirm_human','auto_correct','block'
    )),
    human_confirmed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS price_benchmarks (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL,
    item_pattern TEXT NOT NULL,
    avg_price REAL NOT NULL,
    min_price REAL NOT NULL,
    max_price REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    sample_count INTEGER DEFAULT 1,
    last_updated TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS verification_cache (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    url TEXT NOT NULL,
    field_name TEXT NOT NULL,
    field_value TEXT NOT NULL,
    value_hash TEXT NOT NULL,
    source TEXT DEFAULT 'dom' CHECK(source IN ('dom','vision','agent')),
    captured_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_verif_results_site ON verification_results(site_id);
  CREATE INDEX IF NOT EXISTS idx_verif_results_type ON verification_results(discrepancy_type);
  CREATE INDEX IF NOT EXISTS idx_verif_cache_site ON verification_cache(site_id);
  CREATE INDEX IF NOT EXISTS idx_verif_cache_url ON verification_cache(url);
  CREATE INDEX IF NOT EXISTS idx_price_bench_cat ON price_benchmarks(category);
`);

// ─── Constants ───────────────────────────────────────────────────────

const THRESHOLDS = {
  priceMismatchMinor: 0.05,    // 5% difference
  priceMismatchMajor: 0.15,    // 15%
  priceMismatchCritical: 0.50, // 50%
  priceAnomalyLow: 0.3,       // 70% below market average
  priceAnomalyHigh: 3.0,      // 300% above market average
  textSimilarityOk: 0.85,     // 85% text match is acceptable
  textSimilarityWarn: 0.60,   // Below 60% is a warning
};

// ─── Text Similarity (Levenshtein-based) ─────────────────────────────

function levenshteinDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function textSimilarity(a, b) {
  if (!a || !b) return 0;
  const cleanA = a.toString().trim().toLowerCase();
  const cleanB = b.toString().trim().toLowerCase();
  if (cleanA === cleanB) return 1.0;
  const maxLen = Math.max(cleanA.length, cleanB.length);
  if (maxLen === 0) return 1.0;
  return 1 - levenshteinDistance(cleanA, cleanB) / maxLen;
}

// ─── Price Extraction ────────────────────────────────────────────────

function extractPrice(text) {
  if (typeof text !== 'string') return null;
  // Match common price formats: $100, $1,000.00, 100.00$, EUR 50, etc.
  const patterns = [
    /[\$€£¥]\s*([\d,]+\.?\d*)/,
    /([\d,]+\.?\d*)\s*[\$€£¥]/,
    /(?:USD|EUR|GBP|SAR|AED)\s*([\d,]+\.?\d*)/i,
    /([\d,]+\.?\d*)\s*(?:USD|EUR|GBP|SAR|AED)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return parseFloat(match[1].replace(/,/g, ''));
    }
  }
  return null;
}

// ─── Core Verification ───────────────────────────────────────────────

function verifyPrice({ siteId, agentId, url, domValue, visionValue, category, itemName }) {
  const id = crypto.randomBytes(12).toString('hex');

  const domPrice = extractPrice(domValue);
  const visionPrice = extractPrice(visionValue);

  const result = {
    id,
    siteId,
    verificationType: 'price',
    domValue,
    visionValue,
    domPrice,
    visionPrice,
    matchScore: 1.0,
    discrepancyType: 'none',
    discrepancyDetails: {},
    actionTaken: 'none',
    checks: []
  };

  // Check 1: DOM vs Vision price match
  if (domPrice !== null && visionPrice !== null) {
    const priceDiff = Math.abs(domPrice - visionPrice);
    const relativeDiff = domPrice > 0 ? priceDiff / domPrice : 0;

    result.matchScore = 1 - relativeDiff;

    if (relativeDiff > THRESHOLDS.priceMismatchCritical) {
      result.discrepancyType = 'critical';
      result.actionTaken = 'halt';
      result.discrepancyDetails.domVsVision = {
        difference: priceDiff,
        relativeDifference: Math.round(relativeDiff * 100) + '%',
        message: `CRITICAL: DOM shows $${domPrice} but visual shows $${visionPrice}. ` +
          `Possible deceptive pricing or site error. Operation halted.`
      };
      result.checks.push({ check: 'dom_vs_vision', status: 'FAIL', severity: 'critical' });
    } else if (relativeDiff > THRESHOLDS.priceMismatchMajor) {
      result.discrepancyType = 'major';
      result.actionTaken = 'confirm_human';
      result.discrepancyDetails.domVsVision = {
        difference: priceDiff,
        relativeDifference: Math.round(relativeDiff * 100) + '%',
        message: `WARNING: Price mismatch detected. DOM: $${domPrice}, Visual: $${visionPrice}. ` +
          `Requesting human confirmation before proceeding.`
      };
      result.checks.push({ check: 'dom_vs_vision', status: 'WARN', severity: 'major' });
    } else if (relativeDiff > THRESHOLDS.priceMismatchMinor) {
      result.discrepancyType = 'minor';
      result.actionTaken = 'warn';
      result.discrepancyDetails.domVsVision = {
        difference: priceDiff,
        message: `Minor price variance: DOM $${domPrice} vs Visual $${visionPrice}. May be rounding.`
      };
      result.checks.push({ check: 'dom_vs_vision', status: 'OK', severity: 'minor' });
    } else {
      result.checks.push({ check: 'dom_vs_vision', status: 'PASS', severity: 'none' });
    }
  }

  // Check 2: Price sanity vs market benchmarks
  const effectivePrice = domPrice || visionPrice;
  if (effectivePrice !== null && category) {
    const benchmark = db.prepare(`
      SELECT * FROM price_benchmarks
      WHERE category = ? AND item_pattern LIKE ?
      ORDER BY sample_count DESC LIMIT 1
    `).get(category, `%${(itemName || '').slice(0, 20)}%`);

    if (benchmark) {
      const ratio = effectivePrice / benchmark.avg_price;

      if (ratio < THRESHOLDS.priceAnomalyLow) {
        result.discrepancyType = result.discrepancyType === 'none' ? 'major' : result.discrepancyType;
        result.actionTaken = result.actionTaken === 'none' ? 'confirm_human' : result.actionTaken;
        result.discrepancyDetails.marketAnomaly = {
          price: effectivePrice,
          marketAvg: benchmark.avg_price,
          ratio: Math.round(ratio * 100) / 100,
          message: `Suspiciously low price ($${effectivePrice}) vs market average ($${benchmark.avg_price}). ` +
            `Could be a scam, error, or genuine deal. Verify manually.`
        };
        result.checks.push({ check: 'market_benchmark', status: 'WARN', severity: 'major' });
      } else if (ratio > THRESHOLDS.priceAnomalyHigh) {
        result.discrepancyDetails.marketAnomaly = {
          price: effectivePrice,
          marketAvg: benchmark.avg_price,
          ratio: Math.round(ratio * 100) / 100,
          message: `Price ($${effectivePrice}) is ${Math.round(ratio)}x market average ($${benchmark.avg_price}).`
        };
        result.checks.push({ check: 'market_benchmark', status: 'WARN', severity: 'minor' });
      } else {
        result.checks.push({ check: 'market_benchmark', status: 'PASS', severity: 'none' });
      }
    }
  }

  // Check 3: Temporal consistency (compare with cached values)
  if (effectivePrice !== null && url) {
    const cached = db.prepare(`
      SELECT * FROM verification_cache
      WHERE site_id = ? AND url = ? AND field_name = 'price'
      ORDER BY captured_at DESC LIMIT 1
    `).get(siteId, url);

    if (cached) {
      const cachedPrice = extractPrice(cached.field_value);
      if (cachedPrice !== null) {
        const temporalDiff = Math.abs(effectivePrice - cachedPrice) / cachedPrice;
        if (temporalDiff > 0.5) {
          result.discrepancyDetails.temporalChange = {
            currentPrice: effectivePrice,
            previousPrice: cachedPrice,
            previousDate: cached.captured_at,
            changePct: Math.round(temporalDiff * 100) + '%',
            message: `Price changed ${Math.round(temporalDiff * 100)}% since last check. ` +
              `Was $${cachedPrice}, now $${effectivePrice}.`
          };
          result.checks.push({ check: 'temporal_consistency', status: 'WARN', severity: 'minor' });
        } else {
          result.checks.push({ check: 'temporal_consistency', status: 'PASS', severity: 'none' });
        }
      }
    }

    // Cache current value
    const cacheId = crypto.randomBytes(12).toString('hex');
    const cacheExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const valueHash = crypto.createHash('sha256').update(String(effectivePrice)).digest('hex');
    db.prepare(`
      INSERT OR REPLACE INTO verification_cache
      (id, site_id, url, field_name, field_value, value_hash, source, expires_at)
      VALUES (?, ?, ?, 'price', ?, ?, 'dom', ?)
    `).run(cacheId, siteId, url, String(effectivePrice), valueHash, cacheExpiry);
  }

  // Persist result
  db.prepare(`
    INSERT INTO verification_results
    (id, site_id, agent_id, url, verification_type, dom_value, vision_value,
     match_score, discrepancy_type, discrepancy_details, action_taken)
    VALUES (?, ?, ?, ?, 'price', ?, ?, ?, ?, ?, ?)
  `).run(
    id, siteId, agentId || null, url || null,
    domValue, visionValue,
    Math.round(result.matchScore * 1000) / 1000,
    result.discrepancyType,
    JSON.stringify(result.discrepancyDetails),
    result.actionTaken
  );

  return result;
}

// ─── Text Verification ───────────────────────────────────────────────

function verifyText({ siteId, agentId, url, domValue, visionValue, fieldName }) {
  const id = crypto.randomBytes(12).toString('hex');

  const similarity = textSimilarity(domValue, visionValue);

  let discrepancyType = 'none';
  let actionTaken = 'none';
  let message = '';

  if (similarity < THRESHOLDS.textSimilarityWarn) {
    discrepancyType = 'major';
    actionTaken = 'confirm_human';
    message = `Text mismatch: DOM reads "${domValue}" but visual shows "${visionValue}" ` +
      `(${Math.round(similarity * 100)}% match). Human confirmation required.`;
  } else if (similarity < THRESHOLDS.textSimilarityOk) {
    discrepancyType = 'minor';
    actionTaken = 'warn';
    message = `Slight text variance: "${domValue}" vs "${visionValue}" ` +
      `(${Math.round(similarity * 100)}% match).`;
  }

  db.prepare(`
    INSERT INTO verification_results
    (id, site_id, agent_id, url, verification_type, dom_value, vision_value,
     match_score, discrepancy_type, discrepancy_details, action_taken)
    VALUES (?, ?, ?, ?, 'text', ?, ?, ?, ?, ?, ?)
  `).run(
    id, siteId, agentId || null, url || null,
    domValue, visionValue,
    Math.round(similarity * 1000) / 1000,
    discrepancyType,
    JSON.stringify({ message, similarity }),
    actionTaken
  );

  return {
    id,
    matchScore: Math.round(similarity * 100),
    discrepancyType,
    actionTaken,
    message: message || 'Text verified successfully.',
    verified: discrepancyType === 'none'
  };
}

// ─── Full Page Verification ──────────────────────────────────────────

function verifyPage({ siteId, agentId, url, domData, visionData }) {
  const results = { checks: [], overallScore: 100, actionRequired: 'none', details: [] };

  // Verify prices
  if (domData.prices && visionData.prices) {
    for (let i = 0; i < Math.min(domData.prices.length, visionData.prices.length); i++) {
      const priceCheck = verifyPrice({
        siteId, agentId, url,
        domValue: domData.prices[i],
        visionValue: visionData.prices[i],
        category: domData.category,
        itemName: domData.itemNames?.[i]
      });
      results.checks.push(priceCheck);
      if (priceCheck.discrepancyType !== 'none') {
        results.overallScore -= priceCheck.discrepancyType === 'critical' ? 40 : priceCheck.discrepancyType === 'major' ? 20 : 5;
      }
    }
  }

  // Verify key text elements
  if (domData.texts && visionData.texts) {
    for (let i = 0; i < Math.min(domData.texts.length, visionData.texts.length); i++) {
      const textCheck = verifyText({
        siteId, agentId, url,
        domValue: domData.texts[i],
        visionValue: visionData.texts[i],
        fieldName: `text_${i}`
      });
      results.checks.push(textCheck);
      if (!textCheck.verified) results.overallScore -= 10;
    }
  }

  results.overallScore = Math.max(0, results.overallScore);

  if (results.overallScore < 30) results.actionRequired = 'block';
  else if (results.overallScore < 60) results.actionRequired = 'confirm_human';
  else if (results.overallScore < 80) results.actionRequired = 'warn';

  return results;
}

// ─── Market Benchmark Management ─────────────────────────────────────

function updateBenchmark(category, itemPattern, price) {
  const existing = db.prepare(`
    SELECT * FROM price_benchmarks WHERE category = ? AND item_pattern = ?
  `).get(category, itemPattern);

  if (existing) {
    const newCount = existing.sample_count + 1;
    const newAvg = (existing.avg_price * existing.sample_count + price) / newCount;
    const newMin = Math.min(existing.min_price, price);
    const newMax = Math.max(existing.max_price, price);

    db.prepare(`
      UPDATE price_benchmarks
      SET avg_price = ?, min_price = ?, max_price = ?,
          sample_count = ?, last_updated = datetime('now')
      WHERE id = ?
    `).run(newAvg, newMin, newMax, newCount, existing.id);
  } else {
    const id = crypto.randomBytes(12).toString('hex');
    db.prepare(`
      INSERT INTO price_benchmarks (id, category, item_pattern, avg_price, min_price, max_price, sample_count)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `).run(id, category, itemPattern, price, price, price);
  }
}

// ─── Human Confirmation ──────────────────────────────────────────────

function confirmVerification(verificationId, humanApproved) {
  db.prepare(`
    UPDATE verification_results
    SET human_confirmed = ?, action_taken = CASE WHEN ? = 1 THEN 'none' ELSE 'block' END
    WHERE id = ?
  `).run(humanApproved ? 1 : 0, humanApproved ? 1 : 0, verificationId);

  return { confirmed: true, approved: humanApproved };
}

// ─── Shield Stats ────────────────────────────────────────────────────

function getShieldStats(siteId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_checks,
      SUM(CASE WHEN discrepancy_type = 'none' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN discrepancy_type = 'minor' THEN 1 ELSE 0 END) as minor_issues,
      SUM(CASE WHEN discrepancy_type = 'major' THEN 1 ELSE 0 END) as major_issues,
      SUM(CASE WHEN discrepancy_type = 'critical' THEN 1 ELSE 0 END) as critical_issues,
      SUM(CASE WHEN discrepancy_type = 'fraud_suspected' THEN 1 ELSE 0 END) as fraud_suspected,
      SUM(CASE WHEN action_taken = 'halt' THEN 1 ELSE 0 END) as halted_operations,
      SUM(CASE WHEN action_taken = 'block' THEN 1 ELSE 0 END) as blocked_operations,
      AVG(match_score) as avg_match_score
    FROM verification_results
    WHERE site_id = ?
  `).get(siteId);

  return {
    ...stats,
    avg_match_score: stats.avg_match_score ? Math.round(stats.avg_match_score * 100) : 100,
    integrity_rating: stats.total_checks > 0
      ? Math.round((stats.passed / stats.total_checks) * 100)
      : 100
  };
}

function getGlobalShieldStats() {
  return db.prepare(`
    SELECT
      COUNT(*) as total_checks,
      SUM(CASE WHEN discrepancy_type = 'none' THEN 1 ELSE 0 END) as passed,
      SUM(CASE WHEN action_taken = 'halt' THEN 1 ELSE 0 END) as threats_blocked,
      SUM(CASE WHEN action_taken = 'confirm_human' THEN 1 ELSE 0 END) as human_reviews,
      COUNT(DISTINCT site_id) as sites_verified
    FROM verification_results
  `).get();
}

// ─── Cleanup ─────────────────────────────────────────────────────────

function cleanupExpiredCache() {
  return db.prepare("DELETE FROM verification_cache WHERE expires_at < datetime('now')").run();
}

module.exports = {
  verifyPrice,
  verifyText,
  verifyPage,
  updateBenchmark,
  confirmVerification,
  getShieldStats,
  getGlobalShieldStats,
  cleanupExpiredCache,
  extractPrice,
  textSimilarity
};
