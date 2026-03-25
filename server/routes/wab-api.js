/**
 * WAB Protocol HTTP Transport — RESTful endpoints that implement the
 * WAB command protocol over HTTP for remote agents and the MCP adapter.
 *
 * Every command from the WAB spec (docs/SPEC.md §5) is accessible here
 * so agents that cannot run JavaScript in a browser can still interact
 * with WAB-enabled sites via standard HTTP requests.
 */

const express = require('express');
const router = express.Router();
const { findSiteById, findSiteByLicense, recordAnalytic, db } = require('../models/db');
const { broadcastAnalytic } = require('../ws');
const {
  calculateNeutralityScore,
  fairnessWeightedSearch,
  getDirectoryListings,
  generateFairnessReport
} = require('../services/fairness');

const WAB_VERSION = '1.1.2';
const PROTOCOL_VERSION = '1.0';

// ─── Session management ──────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = 3600_000;

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessions) {
    if (now > data.expiresAt) sessions.delete(token);
  }
}, 300_000);

function generateSessionToken() {
  const bytes = require('crypto').randomBytes(32);
  return bytes.toString('hex');
}

function requireSession(req, res, next) {
  const auth = req.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({
      type: 'error',
      error: { code: 'auth_required', message: 'Bearer token required in Authorization header' }
    });
  }
  const token = auth.slice(7);
  const session = sessions.get(token);
  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({
      type: 'error',
      error: { code: 'session_expired', message: 'Session expired or invalid' }
    });
  }
  req.wabSession = session;
  next();
}

// ─── Helper: resolve site from request ───────────────────────────────
function resolveSite(req) {
  if (req.wabSession) return findSiteById.get(req.wabSession.siteId);
  const siteId = req.query.siteId || req.body?.siteId;
  if (siteId) return findSiteById.get(siteId);
  return null;
}

function parseSiteConfig(site) {
  try { return JSON.parse(site.config || '{}'); } catch (_) { return {}; }
}

function buildCommandResponse(id, result) {
  return { id: id || null, type: 'success', protocol: PROTOCOL_VERSION, result };
}

function buildErrorResponse(id, code, message) {
  return { id: id || null, type: 'error', protocol: PROTOCOL_VERSION, error: { code, message } };
}

// ═════════════════════════════════════════════════════════════════════
// POST /api/wab/authenticate — session token exchange
// ═════════════════════════════════════════════════════════════════════

router.post('/authenticate', (req, res) => {
  try {
    const { siteId, apiKey, meta } = req.body;
    if (!siteId && !apiKey) {
      return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'siteId or apiKey required'));
    }

    let site;
    if (apiKey) {
      site = db.prepare('SELECT * FROM sites WHERE api_key = ? AND active = 1').get(apiKey);
    } else {
      site = findSiteById.get(siteId);
    }

    if (!site) {
      return res.status(404).json(buildErrorResponse(null, 'not_found', 'Site not found or invalid credentials'));
    }

    const origin = req.get('origin') || '';
    if (origin) {
      try {
        const reqDomain = new URL(origin).hostname.replace(/^www\./, '');
        const siteDomain = site.domain.replace(/^www\./, '');
        if (reqDomain !== siteDomain && reqDomain !== 'localhost' && reqDomain !== '127.0.0.1') {
          return res.status(403).json(buildErrorResponse(null, 'origin_mismatch', 'Origin does not match site domain'));
        }
      } catch (_) {}
    }

    const token = generateSessionToken();
    sessions.set(token, {
      siteId: site.id,
      tier: site.tier,
      domain: site.domain,
      agentMeta: meta || {},
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL
    });

    res.json(buildCommandResponse(null, {
      authenticated: true,
      token,
      siteId: site.id,
      tier: site.tier,
      expiresIn: SESSION_TTL / 1000,
      permissions: parseSiteConfig(site).agentPermissions || {}
    }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Authentication failed'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/wab/discover — full discovery document
// ═════════════════════════════════════════════════════════════════════

router.get('/discover', (req, res) => {
  try {
    const site = resolveSite(req);
    if (!site || !site.active) {
      const domain = (req.get('origin') ? new URL(req.get('origin')).hostname : req.get('host')?.split(':')[0]) || '';
      const byDomain = db.prepare(
        'SELECT * FROM sites WHERE LOWER(REPLACE(domain, "www.", "")) = ? AND active = 1 LIMIT 1'
      ).get(domain.toLowerCase().replace(/^www\./, ''));

      if (!byDomain) {
        return res.status(404).json(buildErrorResponse(null, 'not_found', 'No WAB site found'));
      }
      return res.json(buildCommandResponse(null, buildDiscovery(byDomain)));
    }
    res.json(buildCommandResponse(null, buildDiscovery(site)));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Discovery failed'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/wab/actions — list actions
// ═════════════════════════════════════════════════════════════════════

router.get('/actions', (req, res) => {
  try {
    const site = resolveSite(req);
    if (!site) return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'siteId required'));

    const config = parseSiteConfig(site);
    const perms = config.agentPermissions || {};
    const category = req.query.category;

    const actions = Object.entries(perms)
      .filter(([, v]) => v)
      .map(([name]) => ({
        name,
        description: `Permission: ${name}`,
        trigger: name === 'click' ? 'click' : name === 'fillForms' ? 'fill_and_submit' : name === 'scroll' ? 'scroll' : 'api',
        category: name === 'navigate' ? 'navigation' : 'general',
        requiresAuth: ['apiAccess', 'automatedLogin', 'extractData'].includes(name)
      }));

    const filtered = category ? actions.filter(a => a.category === category) : actions;

    res.json(buildCommandResponse(req.query.id || null, { actions: filtered, total: filtered.length }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Failed to list actions'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// POST /api/wab/actions/:name — execute action (with tracking)
// ═════════════════════════════════════════════════════════════════════

router.post('/actions/:name', requireSession, (req, res) => {
  try {
    const actionName = req.params.name;
    const site = findSiteById.get(req.wabSession.siteId);
    if (!site) return res.status(404).json(buildErrorResponse(req.body?.id, 'not_found', 'Site not found'));

    const config = parseSiteConfig(site);
    const perms = config.agentPermissions || {};

    const permMap = {
      click: 'click', fill_and_submit: 'fillForms', scroll: 'scroll',
      navigate: 'navigate', api: 'apiAccess', read: 'readContent', extract: 'extractData'
    };
    const requiredPerm = permMap[actionName] || actionName;

    if (!perms[requiredPerm] && !perms[actionName]) {
      return res.status(403).json(buildErrorResponse(req.body?.id, 'permission_denied',
        `Action "${actionName}" is not permitted by site configuration`));
    }

    recordAnalytic({
      siteId: site.id,
      actionName,
      agentId: req.wabSession.agentMeta?.name || 'mcp-agent',
      triggerType: 'wab_api',
      success: true,
      metadata: { params: req.body?.params || {}, transport: 'http' }
    });

    broadcastAnalytic(site.id, {
      actionName,
      agentId: req.wabSession.agentMeta?.name || 'mcp-agent',
      triggerType: 'wab_api',
      success: true
    });

    res.json(buildCommandResponse(req.body?.id, {
      success: true,
      action: actionName,
      siteId: site.id,
      executed_at: new Date().toISOString(),
      note: 'Server-side action recorded. For DOM interactions, use the bridge script in-browser.'
    }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(req.body?.id, 'internal', 'Action execution failed'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// POST /api/wab/read — read content (selector-based, requires in-browser)
// ═════════════════════════════════════════════════════════════════════

router.post('/read', requireSession, (req, res) => {
  try {
    const { selector, id } = req.body;
    if (!selector) {
      return res.status(400).json(buildErrorResponse(id, 'invalid_argument', 'selector is required'));
    }

    const site = findSiteById.get(req.wabSession.siteId);
    if (!site) return res.status(404).json(buildErrorResponse(id, 'not_found', 'Site not found'));

    const config = parseSiteConfig(site);
    if (!config.agentPermissions?.readContent) {
      return res.status(403).json(buildErrorResponse(id, 'permission_denied', 'readContent not enabled'));
    }

    recordAnalytic({
      siteId: site.id,
      actionName: 'readContent',
      agentId: req.wabSession.agentMeta?.name || 'mcp-agent',
      triggerType: 'wab_api',
      success: true,
      metadata: { selector, transport: 'http' }
    });

    res.json(buildCommandResponse(id, {
      success: true,
      selector,
      note: 'Content reading via HTTP returns metadata only. Use the bridge script in-browser or the noscript bridge for rendered content.',
      bridge_page: `/api/noscript/bridge/${site.id}`,
      noscript_endpoints: {
        pixel: `/api/noscript/pixel/${site.id}`,
        css: `/api/noscript/css/${site.id}`,
        bridge: `/api/noscript/bridge/${site.id}`
      }
    }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Read failed'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/wab/page-info — get page/site metadata
// ═════════════════════════════════════════════════════════════════════

router.get('/page-info', (req, res) => {
  try {
    const site = resolveSite(req);
    if (!site) return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'siteId required'));

    const config = parseSiteConfig(site);
    const neutralityScore = calculateNeutralityScore(site);

    res.json(buildCommandResponse(req.query.id || null, {
      title: site.name,
      domain: site.domain,
      url: `https://${site.domain}`,
      tier: site.tier,
      bridgeVersion: WAB_VERSION,
      protocol: PROTOCOL_VERSION,
      permissions: config.agentPermissions || {},
      restrictions: config.restrictions || {},
      security: {
        sandboxActive: true,
        sessionRequired: true,
        originValidation: true,
        rateLimit: config.restrictions?.rateLimit?.maxCallsPerMinute || 60
      },
      fairness: {
        neutralityScore,
        isIndependent: false
      },
      endpoints: {
        discover: `/api/wab/discover?siteId=${site.id}`,
        actions: `/api/wab/actions?siteId=${site.id}`,
        authenticate: '/api/wab/authenticate',
        bridge: `/api/noscript/bridge/${site.id}`,
        discovery: `/api/discovery/${site.id}`
      }
    }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Failed to get page info'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/wab/search — fairness-weighted search (MCP adapter uses this)
// ═════════════════════════════════════════════════════════════════════

router.get('/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 10, 100);

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

    res.json(buildCommandResponse(req.query.id || null, {
      query,
      total: results.length,
      fairness_applied: true,
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
        endpoints: {
          discover: `/api/wab/discover?siteId=${r.id}`,
          actions: `/api/wab/actions?siteId=${r.id}`,
          bridge: `/api/noscript/bridge/${r.id}`
        }
      }))
    }));
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', 'Search failed'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// GET /api/wab/ping — health check
// ═════════════════════════════════════════════════════════════════════

router.get('/ping', (_req, res) => {
  res.json(buildCommandResponse(null, {
    pong: true,
    version: WAB_VERSION,
    protocol: PROTOCOL_VERSION,
    timestamp: Date.now(),
    status: 'healthy'
  }));
});

// ─── Discovery document builder ──────────────────────────────────────

function buildDiscovery(site) {
  const config = parseSiteConfig(site);
  const perms = config.agentPermissions || {};
  const features = config.features || {};

  const commands = Object.entries(perms)
    .filter(([, v]) => v)
    .map(([name]) => ({
      name,
      trigger: name === 'click' ? 'click' : name === 'fillForms' ? 'fill_and_submit' : name === 'scroll' ? 'scroll' : 'api',
      requiresAuth: ['apiAccess', 'automatedLogin', 'extractData'].includes(name)
    }));

  const featureList = ['auto_discovery', 'noscript_fallback', 'wab_protocol_api'];
  if (features.advancedAnalytics) featureList.push('advanced_analytics');
  if (features.realTimeUpdates) featureList.push('real_time_updates');

  const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(site.id);

  return {
    wab_version: WAB_VERSION,
    protocol: PROTOCOL_VERSION,
    generated_at: new Date().toISOString(),
    provider: {
      name: site.name,
      domain: site.domain,
      category: dirEntry?.category || 'general',
      description: site.description || ''
    },
    capabilities: {
      commands,
      permissions: perms,
      tier: site.tier,
      transport: ['js_global', 'http', 'websocket'],
      features: featureList
    },
    agent_access: {
      bridge_script: '/script/ai-agent-bridge.js',
      api_base: '/api/wab',
      websocket: '/ws/analytics',
      noscript: `/api/noscript/bridge/${site.id}`,
      discovery: `/api/discovery/${site.id}`
    },
    fairness: {
      is_independent: dirEntry ? !!dirEntry.is_independent : false,
      commission_rate: dirEntry ? dirEntry.commission_rate : 0,
      direct_benefit: dirEntry ? (dirEntry.direct_benefit || '') : '',
      neutrality_score: calculateNeutralityScore(site)
    },
    security: {
      session_required: true,
      origin_validation: true,
      rate_limit: config.restrictions?.rateLimit?.maxCallsPerMinute || 60,
      sandbox: true
    },
    endpoints: {
      authenticate: '/api/wab/authenticate',
      discover: `/api/wab/discover?siteId=${site.id}`,
      actions: `/api/wab/actions?siteId=${site.id}`,
      execute: '/api/wab/actions/{actionName}',
      read: '/api/wab/read',
      page_info: `/api/wab/page-info?siteId=${site.id}`,
      search: '/api/wab/search',
      ping: '/api/wab/ping',
      token_exchange: '/api/license/token',
      bridge_page: `/api/noscript/bridge/${site.id}`
    }
  };
}

module.exports = router;
