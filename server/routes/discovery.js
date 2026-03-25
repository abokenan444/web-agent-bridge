/**
 * WAB Discovery Protocol — Auto-generated discovery documents and
 * public registry of WAB-enabled sites with fairness scoring.
 */

const express = require('express');
const router = express.Router();
const { findSiteById, db } = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const {
  calculateNeutralityScore,
  fairnessWeightedSearch,
  registerInDirectory,
  getDirectoryListings,
  generateFairnessReport
} = require('../services/fairness');

const WAB_VERSION = '1.1.0';

// ─── Helpers ─────────────────────────────────────────────────────────

function findSiteByDomain(domain) {
  if (!domain) return null;
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return db.prepare(
    'SELECT * FROM sites WHERE LOWER(REPLACE(domain, "www.", "")) = ? AND active = 1 LIMIT 1'
  ).get(normalized);
}

function getRequestDomain(req) {
  const origin = req.get('origin');
  if (origin) {
    try { return new URL(origin).hostname; } catch (_) {}
  }
  const host = req.get('host');
  if (host) return host.split(':')[0];
  return req.hostname;
}

function parseSiteConfig(site) {
  try { return JSON.parse(site.config || '{}'); } catch (_) { return {}; }
}

function buildDiscoveryDocument(site) {
  const config = parseSiteConfig(site);
  const perms = config.agentPermissions || {};
  const restrictions = config.restrictions || {};
  const features = config.features || {};

  const enabledActions = Object.entries(perms)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const featureList = ['auto_discovery', 'noscript_fallback'];
  if (features.advancedAnalytics) featureList.push('advanced_analytics');
  if (features.realTimeUpdates) featureList.push('real_time_updates');
  if (perms.apiAccess) featureList.push('api_access');

  const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(site.id);
  const neutralityScore = calculateNeutralityScore(site);

  return {
    wab_version: WAB_VERSION,
    generated_at: new Date().toISOString(),
    provider: {
      name: site.name,
      domain: site.domain,
      category: (dirEntry && dirEntry.category) || config.category || 'general',
      description: site.description || ''
    },
    capabilities: {
      commands: enabledActions,
      permissions: perms,
      tier: site.tier,
      transport: ['js_global', 'http', 'websocket'],
      features: featureList
    },
    agent_access: {
      bridge_script: '/script/ai-agent-bridge.js',
      api_base: '/api/license',
      websocket: '/ws/analytics',
      noscript: '/api/noscript',
      discovery: '/api/discovery'
    },
    fairness: {
      is_independent: dirEntry ? !!dirEntry.is_independent : false,
      commission_rate: dirEntry ? dirEntry.commission_rate : 0,
      direct_benefit: dirEntry ? (dirEntry.direct_benefit || '') : '',
      neutrality_score: neutralityScore
    },
    security: {
      session_required: true,
      origin_validation: true,
      rate_limit: (restrictions.rateLimit && restrictions.rateLimit.maxCallsPerMinute) || 60,
      sandbox: true
    },
    endpoints: {
      token_exchange: '/api/license/token',
      verify: '/api/license/verify',
      track: '/api/license/track',
      actions: `/api/discovery/${site.id}`,
      bridge_page: `/api/noscript/bridge/${site.id}`
    }
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1. GET /.well-known/wab.json — Standard discovery location
// ═════════════════════════════════════════════════════════════════════

router.get('/.well-known/wab.json', (req, res) => {
  try {
    const domain = getRequestDomain(req);
    const site = findSiteByDomain(domain);

    if (!site) {
      return res.status(404).json({
        error: 'No WAB-enabled site found for this domain',
        domain,
        hint: 'Register your site at /dashboard to enable WAB discovery'
      });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 2. GET /agent-bridge.json — Alternative discovery location
// ═════════════════════════════════════════════════════════════════════

router.get('/agent-bridge.json', (req, res) => {
  try {
    const domain = getRequestDomain(req);
    const site = findSiteByDomain(domain);

    if (!site) {
      return res.status(404).json({
        error: 'No WAB-enabled site found for this domain',
        domain,
        hint: 'Register your site at /dashboard to enable WAB discovery'
      });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3. GET /api/discovery/registry — Public registry with fairness scoring
//    (defined BEFORE :siteId to avoid route shadowing)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/registry', (req, res) => {
  try {
    const category = req.query.category || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const listings = getDirectoryListings(category, { limit, offset });

    const registry = listings.map(entry => ({
      siteId: entry.id,
      name: entry.name,
      domain: entry.domain,
      description: entry.description || '',
      category: entry.category || 'general',
      tier: entry.tier,
      neutrality_score: entry.neutrality_score || 0,
      is_independent: !!entry.is_independent,
      tags: safeParseTags(entry.tags),
      discovery_url: `/api/discovery/${entry.id}`
    }));

    res.json({
      wab_version: WAB_VERSION,
      total: registry.length,
      category,
      listings: registry
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch registry' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 4. POST /api/discovery/register — Register site in WAB directory
// ═════════════════════════════════════════════════════════════════════

router.post('/api/discovery/register', authenticateToken, (req, res) => {
  try {
    const { siteId, category, tags, is_independent, commission_rate, direct_benefit, trust_signature } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'siteId is required' });
    }

    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }
    if (site.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this site' });
    }

    const result = registerInDirectory(siteId, {
      category,
      tags,
      is_independent,
      commission_rate,
      direct_benefit,
      trust_signature
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const report = generateFairnessReport(siteId);

    res.status(201).json({
      success: true,
      registration: result,
      fairness_report: report
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register site' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 5. GET /api/discovery/search — Search WAB sites (fairness-weighted)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = `
      SELECT s.*, d.category, d.tags, d.is_independent, d.commission_rate,
             d.direct_benefit, d.neutrality_score, d.trust_signature
      FROM wab_directory d
      JOIN sites s ON d.site_id = s.id AND s.active = 1
      WHERE d.listed = 1
    `;
    const params = [];

    if (category) {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY d.neutrality_score DESC LIMIT ?';
    params.push(limit * 3);

    const candidates = db.prepare(sql).all(...params);
    const results = fairnessWeightedSearch(query, candidates).slice(0, limit);

    res.json({
      wab_version: WAB_VERSION,
      query,
      total: results.length,
      results: results.map(r => ({
        siteId: r.id,
        name: r.name,
        domain: r.domain,
        description: r.description || '',
        category: r.category || 'general',
        tier: r.tier,
        neutrality_score: r._neutralityScore,
        is_independent: r._isIndependent,
        relevance_score: r._relevance,
        fairness_boost: r._fairnessBoost,
        final_score: r._finalScore,
        tags: safeParseTags(r.tags),
        discovery_url: `/api/discovery/${r.id}`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6. GET /api/discovery/:siteId — Discovery doc for a specific site
//    (defined AFTER named routes to prevent shadowing)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/:siteId', (req, res) => {
  try {
    const site = findSiteById.get(req.params.siteId);
    if (!site || !site.active) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ─── Utility ─────────────────────────────────────────────────────────

function safeParseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags || '[]'); } catch (_) { return []; }
}

module.exports = router;
