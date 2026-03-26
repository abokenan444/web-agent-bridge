/**
 * Fairness Engine — Neutrality layer ensuring AI agents give equal opportunity
 * to all WAB-enabled sites regardless of brand size or SEO ranking.
 */

const { db } = require('../models/db');

const WAB_VERSION = '1.2.0';

// ─── Directory Table (created lazily) ────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS wab_directory (
    site_id TEXT PRIMARY KEY,
    category TEXT DEFAULT 'general',
    tags TEXT DEFAULT '[]',
    is_independent INTEGER DEFAULT 0,
    commission_rate REAL DEFAULT 0,
    direct_benefit TEXT DEFAULT '',
    trust_signature TEXT,
    listed INTEGER DEFAULT 1,
    neutrality_score REAL DEFAULT 50,
    registered_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_wab_directory_category ON wab_directory(category);
  CREATE INDEX IF NOT EXISTS idx_wab_directory_score ON wab_directory(neutrality_score);
`);

// ─── Neutrality Score Calculation ────────────────────────────────────

/**
 * Score 0-100 based on: config completeness, trust signatures,
 * commission transparency, and responsiveness.
 */
function calculateNeutralityScore(site) {
  let score = 0;
  const weights = { configCompleteness: 30, trustSignature: 20, commissionTransparency: 25, responsiveness: 25 };

  let config = {};
  try { config = JSON.parse(site.config || '{}'); } catch (_) {}

  // Config completeness (0-30): how well the site has configured WAB
  const configFields = [
    config.agentPermissions,
    config.restrictions,
    config.logging,
    config.features
  ];
  const filledFields = configFields.filter(f => f && Object.keys(f).length > 0).length;
  score += (filledFields / configFields.length) * weights.configCompleteness;

  // Permission granularity bonus
  if (config.agentPermissions) {
    const permCount = Object.keys(config.agentPermissions).length;
    score += Math.min(permCount / 8, 1) * 5;
  }

  // Trust signature (0-20)
  const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(site.id);
  if (dirEntry && dirEntry.trust_signature) {
    const isValid = validateTrustSignature(dirEntry.trust_signature);
    score += isValid ? weights.trustSignature : weights.trustSignature * 0.3;
  }

  // Commission transparency (0-25)
  if (dirEntry) {
    if (dirEntry.commission_rate >= 0) score += 10;
    if (dirEntry.direct_benefit && dirEntry.direct_benefit.length > 0) score += 10;
    if (dirEntry.commission_rate === 0) score += 5;
  }

  // Responsiveness (0-25): based on recent analytics activity
  try {
    const recentActivity = db.prepare(
      'SELECT COUNT(*) as c FROM analytics WHERE site_id = ? AND created_at >= datetime("now", "-7 days")'
    ).get(site.id);
    if (recentActivity) {
      const activityScore = Math.min(recentActivity.c / 100, 1) * weights.responsiveness;
      score += activityScore;
    }
  } catch (_) {
    // analytics table may not exist yet
  }

  return Math.round(Math.min(Math.max(score, 0), 100) * 100) / 100;
}

// ─── Fairness-Weighted Search ────────────────────────────────────────

/**
 * Search sites with fairness-weighted ranking rather than pure relevance.
 */
function fairnessWeightedSearch(query, sites) {
  if (!sites || sites.length === 0) return [];

  const queryLower = (query || '').toLowerCase();
  const terms = queryLower.split(/\s+/).filter(Boolean);

  const scored = sites.map(site => {
    let config = {};
    try { config = JSON.parse(site.config || '{}'); } catch (_) {}

    // Base relevance: match query against name, domain, description, category
    let relevance = 0;
    const searchable = [
      site.name,
      site.domain,
      site.description,
      config.category
    ].filter(Boolean).join(' ').toLowerCase();

    for (const term of terms) {
      if (searchable.includes(term)) relevance += 20;
    }
    if (site.name && site.name.toLowerCase().includes(queryLower)) relevance += 30;
    if (site.domain && site.domain.toLowerCase().includes(queryLower)) relevance += 25;

    if (!queryLower) relevance = 50;

    // Fairness adjustments
    const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(site.id);
    let fairnessBoost = 0;

    // Independent businesses get +15%
    if (dirEntry && dirEntry.is_independent) {
      fairnessBoost += relevance * 0.15;
    }

    // Transparent commission gets +10%
    if (dirEntry && dirEntry.commission_rate >= 0 && dirEntry.direct_benefit) {
      fairnessBoost += relevance * 0.10;
    }

    // Neutrality score influence (up to +20%)
    const neutralityScore = dirEntry ? dirEntry.neutrality_score : 50;
    fairnessBoost += (neutralityScore / 100) * relevance * 0.20;

    // Randomization factor to prevent position lock-in (±5%)
    const jitter = (Math.random() - 0.5) * relevance * 0.10;

    const finalScore = relevance + fairnessBoost + jitter;

    return {
      ...site,
      config,
      _relevance: Math.round(relevance * 100) / 100,
      _fairnessBoost: Math.round(fairnessBoost * 100) / 100,
      _finalScore: Math.round(finalScore * 100) / 100,
      _neutralityScore: neutralityScore,
      _isIndependent: dirEntry ? !!dirEntry.is_independent : false
    };
  });

  scored.sort((a, b) => b._finalScore - a._finalScore);

  return ensureNeutralDistribution(scored);
}

// ─── Directory Registration ──────────────────────────────────────────

function registerInDirectory(siteId, metadata = {}) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ? AND active = 1').get(siteId);
  if (!site) return { success: false, error: 'Site not found or inactive' };

  const neutralityScore = calculateNeutralityScore(site);

  const existing = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(siteId);
  if (existing) {
    db.prepare(`
      UPDATE wab_directory SET
        category = ?, tags = ?, is_independent = ?, commission_rate = ?,
        direct_benefit = ?, trust_signature = ?, neutrality_score = ?,
        updated_at = datetime('now')
      WHERE site_id = ?
    `).run(
      metadata.category || existing.category || 'general',
      JSON.stringify(metadata.tags || JSON.parse(existing.tags || '[]')),
      metadata.is_independent !== undefined ? (metadata.is_independent ? 1 : 0) : existing.is_independent,
      metadata.commission_rate !== undefined ? metadata.commission_rate : existing.commission_rate,
      metadata.direct_benefit || existing.direct_benefit || '',
      metadata.trust_signature || existing.trust_signature || null,
      neutralityScore,
      siteId
    );
  } else {
    db.prepare(`
      INSERT INTO wab_directory (site_id, category, tags, is_independent, commission_rate, direct_benefit, trust_signature, neutrality_score)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      siteId,
      metadata.category || 'general',
      JSON.stringify(metadata.tags || []),
      metadata.is_independent ? 1 : 0,
      metadata.commission_rate || 0,
      metadata.direct_benefit || '',
      metadata.trust_signature || null,
      neutralityScore
    );
  }

  return {
    success: true,
    siteId,
    neutralityScore,
    category: metadata.category || 'general'
  };
}

// ─── Directory Listings ──────────────────────────────────────────────

function getDirectoryListings(category, options = {}) {
  const { limit = 50, offset = 0, includeUnlisted = false } = options;

  let query = `
    SELECT s.*, d.category, d.tags, d.is_independent, d.commission_rate,
           d.direct_benefit, d.neutrality_score, d.trust_signature, d.registered_at as directory_registered_at
    FROM wab_directory d
    JOIN sites s ON d.site_id = s.id AND s.active = 1
  `;
  const params = [];

  const conditions = [];
  if (!includeUnlisted) conditions.push('d.listed = 1');
  if (category && category !== 'all') {
    conditions.push('d.category = ?');
    params.push(category);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ' ORDER BY d.neutrality_score DESC, s.name ASC';
  query += ' LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const listings = db.prepare(query).all(...params);

  // Apply fairness shuffling to the top results
  return shuffleTopResults(listings);
}

// ─── Trust Signature Validation ──────────────────────────────────────

/**
 * Validate a trust signature. Signatures are opaque tokens that
 * indicate the site owner has verified their identity through
 * an external trust provider.
 *
 * Format: "wab-trust-v1:<hex-payload>" (min 32 char payload)
 */
function validateTrustSignature(signature) {
  if (!signature || typeof signature !== 'string') return false;

  if (!signature.startsWith('wab-trust-v1:')) return false;

  const payload = signature.slice('wab-trust-v1:'.length);
  if (payload.length < 32) return false;
  if (!/^[a-f0-9]+$/i.test(payload)) return false;

  return true;
}

// ─── Fairness Report ─────────────────────────────────────────────────

function generateFairnessReport(siteId) {
  const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId);
  if (!site) return null;

  const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(siteId);
  const neutralityScore = calculateNeutralityScore(site);

  let config = {};
  try { config = JSON.parse(site.config || '{}'); } catch (_) {}

  const configFields = [config.agentPermissions, config.restrictions, config.logging, config.features];
  const filledFields = configFields.filter(f => f && Object.keys(f).length > 0).length;

  let recentActivity = { c: 0 };
  try {
    recentActivity = db.prepare(
      'SELECT COUNT(*) as c FROM analytics WHERE site_id = ? AND created_at >= datetime("now", "-7 days")'
    ).get(siteId) || { c: 0 };
  } catch (_) {}

  const factors = {
    config_completeness: {
      score: Math.round((filledFields / configFields.length) * 30),
      max: 30,
      details: `${filledFields}/${configFields.length} config sections populated`
    },
    trust_verification: {
      score: dirEntry && dirEntry.trust_signature && validateTrustSignature(dirEntry.trust_signature) ? 20 : 0,
      max: 20,
      details: dirEntry && dirEntry.trust_signature ? 'Trust signature present' : 'No trust signature'
    },
    commission_transparency: {
      score: dirEntry ? ((dirEntry.commission_rate >= 0 ? 10 : 0) + (dirEntry.direct_benefit ? 10 : 0) + (dirEntry.commission_rate === 0 ? 5 : 0)) : 0,
      max: 25,
      details: dirEntry ? `Commission: ${dirEntry.commission_rate}%, Benefit: ${dirEntry.direct_benefit || 'not specified'}` : 'Not registered in directory'
    },
    responsiveness: {
      score: recentActivity ? Math.round(Math.min(recentActivity.c / 100, 1) * 25) : 0,
      max: 25,
      details: `${recentActivity ? recentActivity.c : 0} events in last 7 days`
    }
  };

  return {
    siteId,
    domain: site.domain,
    name: site.name,
    tier: site.tier,
    neutrality_score: neutralityScore,
    is_independent: dirEntry ? !!dirEntry.is_independent : false,
    registered_in_directory: !!dirEntry,
    factors,
    recommendations: generateRecommendations(factors, dirEntry),
    generated_at: new Date().toISOString()
  };
}

function generateRecommendations(factors, dirEntry) {
  const recs = [];

  if (factors.config_completeness.score < factors.config_completeness.max * 0.7) {
    recs.push('Complete all configuration sections (agentPermissions, restrictions, logging, features) for a higher score.');
  }
  if (factors.trust_verification.score === 0) {
    recs.push('Add a trust signature to verify your site identity and boost your neutrality score.');
  }
  if (!dirEntry) {
    recs.push('Register in the WAB directory to appear in discovery searches.');
  }
  if (factors.commission_transparency.score < factors.commission_transparency.max * 0.5) {
    recs.push('Specify your commission rate and direct benefit to increase transparency scoring.');
  }
  if (factors.responsiveness.score < factors.responsiveness.max * 0.3) {
    recs.push('Increase site activity (agent interactions) to improve responsiveness score.');
  }

  return recs;
}

// ─── Neutral Distribution ────────────────────────────────────────────

/**
 * Re-rank results so no single provider dominates more than 30%
 * of the top results. Applies fairness rotation.
 */
function ensureNeutralDistribution(results) {
  if (results.length <= 3) return results;

  const topCount = Math.max(Math.ceil(results.length * 0.3), 3);
  const topSlice = results.slice(0, topCount);
  const rest = results.slice(topCount);

  // Count how many results come from each domain owner (user_id)
  const ownerCounts = {};
  for (const r of topSlice) {
    const owner = r.user_id || r.domain || 'unknown';
    ownerCounts[owner] = (ownerCounts[owner] || 0) + 1;
  }

  const maxAllowed = Math.max(Math.ceil(topCount * 0.3), 1);
  const redistributed = [];
  const demoted = [];

  for (const r of topSlice) {
    const owner = r.user_id || r.domain || 'unknown';
    const currentCount = redistributed.filter(x => (x.user_id || x.domain) === owner).length;
    if (currentCount < maxAllowed) {
      redistributed.push(r);
    } else {
      demoted.push(r);
    }
  }

  // Shuffle the top results slightly to prevent position lock-in
  for (let i = redistributed.length - 1; i > 0; i--) {
    const swapRange = Math.min(3, i);
    const j = i - Math.floor(Math.random() * swapRange);
    if (j !== i) {
      [redistributed[i], redistributed[j]] = [redistributed[j], redistributed[i]];
    }
  }

  return [...redistributed, ...demoted, ...rest];
}

// ─── Helper: Shuffle Top Results ─────────────────────────────────────

function shuffleTopResults(listings) {
  if (listings.length <= 2) return listings;

  const rotateCount = Math.min(5, Math.ceil(listings.length * 0.2));
  const top = listings.slice(0, rotateCount);
  const rest = listings.slice(rotateCount);

  // Fisher-Yates on the top segment only
  for (let i = top.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [top[i], top[j]] = [top[j], top[i]];
  }

  return [...top, ...rest];
}

module.exports = {
  calculateNeutralityScore,
  fairnessWeightedSearch,
  registerInDirectory,
  getDirectoryListings,
  validateTrustSignature,
  generateFairnessReport,
  ensureNeutralDistribution
};
