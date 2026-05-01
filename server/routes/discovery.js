/**
 * WAB Discovery Protocol — Auto-generated discovery documents and
 * public registry of WAB-enabled sites with fairness scoring.
 */

const express = require('express');
const router = express.Router();
const { findSiteById, db } = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const { safeFetch } = require('../utils/safe-fetch');
const { verify } = require('../../packages/dns-verify/src/index');

// Fairness module is proprietary — provide stubs when not available
let calculateNeutralityScore, fairnessWeightedSearch, registerInDirectory, getDirectoryListings, generateFairnessReport;
try {
  ({
    calculateNeutralityScore,
    fairnessWeightedSearch,
    registerInDirectory,
    getDirectoryListings,
    generateFairnessReport
  } = require('../services/fairness'));
} catch {
  calculateNeutralityScore = () => ({ score: 0, label: 'unrated' });
  fairnessWeightedSearch = (_q, candidates) => candidates;
  registerInDirectory = () => ({});
  getDirectoryListings = () => [];
  generateFairnessReport = () => ({ status: 'unavailable' });
}

const WAB_VERSION = '1.2.0';

// ─── Helpers ─────────────────────────────────────────────────────────

function findSiteByDomain(domain) {
  if (!domain) return null;
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return db.prepare(
    "SELECT * FROM sites WHERE LOWER(REPLACE(domain, 'www.', '')) = ? AND active = 1 LIMIT 1"
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

function sanitizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function deriveEndpointFromRecord(rawRecords, parsedRecord) {
  if (parsedRecord && parsedRecord.endpoint) return parsedRecord.endpoint;
  const first = (rawRecords || [])[0] || '';
  const match = /endpoint=([^;\s]+)/i.exec(first);
  return match ? match[1] : null;
}

function summarizeUseCase(wabDoc) {
  const raw = (wabDoc && wabDoc.use_case) ||
    (wabDoc && wabDoc.provider && wabDoc.provider.use_case) ||
    (wabDoc && wabDoc.provider && wabDoc.provider.category) ||
    '';
  if (raw) return String(raw);

  const commands = new Set((wabDoc && wabDoc.capabilities && wabDoc.capabilities.commands) || []);
  if (commands.has('checkout')) return 'checkout';
  if (commands.has('booking')) return 'booking';
  if (commands.has('message') || commands.has('messaging')) return 'messaging';
  if (commands.has('search')) return 'search';
  if (commands.has('read') || commands.has('readContent')) return 'content-reading';
  return 'general-automation';
}

function hostAllowList(domain, endpointHost) {
  const list = [domain, '*.' + domain];
  if (endpointHost && endpointHost !== domain) {
    list.push(endpointHost);
    list.push('*.' + endpointHost);
  }
  return Array.from(new Set(list));
}

function toBooleanState(v) {
  return v ? 'yes' : 'no';
}

async function buildProof(domain, opts = {}) {
  const includeAgentRun = opts.includeAgentRun === true;
  const out = {
    wab_version: WAB_VERSION,
    checked_at: new Date().toISOString(),
    domain,
    three_steps: [
      'Add TXT record at _wab.<domain>',
      'Serve /.well-known/wab.json',
      'Agent discovers and runs a test call',
    ],
    dns: {
      fqdn: `_wab.${domain}`,
      ok: false,
      ad: false,
      records: [],
      parsed: null,
      error: null,
    },
    wab_json: {
      url: null,
      ok: false,
      http_status: null,
      provider: null,
      commands: [],
      use_case: null,
      error: null,
    },
    execution_proof: {
      attempted: includeAgentRun,
      ok: false,
      steps: [
        { key: 'discover_dns', ok: false, detail: null },
        { key: 'fetch_wab_json', ok: false, detail: null },
        { key: 'agent_discover_call', ok: false, detail: null },
        { key: 'agent_ping_call', ok: false, detail: null },
      ],
      result: null,
      error: null,
    },
    statuses: {
      registered: 'no',
      dns_verified: 'no',
      agent_ready: 'no',
      production: 'no',
    },
  };

  // Internal registration is informative only. DNS + wab.json remain sufficient.
  const internalSite = findSiteByDomain(domain);
  if (internalSite) {
    const cfg = parseSiteConfig(internalSite);
    out.statuses.registered = 'yes';
    out.statuses.production = toBooleanState((cfg.environment || 'production') === 'production');
  }

  const proof = await verify(domain, { timeoutMs: 6000 }).catch((err) => ({
    ok: false,
    records: [{
      type: '_wab',
      ad: false,
      raw: [],
      parsed: null,
      error: err && err.message ? err.message : 'verify_failed',
      code: err && err.code,
    }],
  }));

  const wabRecord = (proof.records || []).find((r) => r.type === '_wab') || {};
  out.dns.ok = !!wabRecord.ok;
  out.dns.ad = !!wabRecord.ad;
  out.dns.records = wabRecord.raw || [];
  out.dns.parsed = wabRecord.parsed || null;
  out.dns.error = wabRecord.error || null;
  out.execution_proof.steps[0].ok = out.dns.ok;
  out.execution_proof.steps[0].detail = out.dns.ok ? 'valid _wab TXT record' : (out.dns.error || 'missing _wab record');
  out.statuses.dns_verified = toBooleanState(out.dns.ok);

  const endpoint = deriveEndpointFromRecord(out.dns.records, out.dns.parsed);
  out.wab_json.url = endpoint;

  if (!endpoint) {
    out.wab_json.error = 'endpoint missing in _wab record';
    out.execution_proof.error = out.wab_json.error;
    return out;
  }

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    out.wab_json.error = 'invalid endpoint URL';
    out.execution_proof.error = out.wab_json.error;
    return out;
  }

  try {
    const wabRes = await safeFetch(endpointUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    }, {
      requireHttps: true,
      allowList: hostAllowList(domain, endpointUrl.hostname),
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json', 'application/ld+json', 'text/plain'],
    });
    out.wab_json.http_status = wabRes.status;
    const doc = await wabRes.json();
    out.wab_json.ok = wabRes.ok && doc && typeof doc === 'object';
    out.wab_json.provider = doc && doc.provider ? {
      name: doc.provider.name || null,
      domain: doc.provider.domain || null,
      category: doc.provider.category || null,
    } : null;
    out.wab_json.commands = (doc && doc.capabilities && doc.capabilities.commands) || [];
    out.wab_json.use_case = summarizeUseCase(doc);
    out.execution_proof.steps[1].ok = out.wab_json.ok;
    out.execution_proof.steps[1].detail = out.wab_json.ok ? 'wab.json fetched and parsed' : 'wab.json invalid';
    out.statuses.agent_ready = toBooleanState(out.wab_json.ok && out.wab_json.commands.length > 0);

    if (!includeAgentRun) return out;

    const endpointOrigin = endpointUrl.origin;
    const discoverUrl = endpointOrigin + '/api/wab/discover';
    const pingUrl = endpointOrigin + '/api/wab/ping';

    try {
      const discoverRes = await safeFetch(discoverUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, endpointUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 1024 * 1024,
        allowedContentTypes: ['application/json'],
      });
      const discoverBody = await discoverRes.json().catch(() => ({}));
      out.execution_proof.steps[2].ok = !!discoverRes.ok;
      out.execution_proof.steps[2].detail = discoverRes.ok ? 'GET /api/wab/discover succeeded' : ('HTTP ' + discoverRes.status);

      const pingRes = await safeFetch(pingUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, endpointUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 512 * 1024,
        allowedContentTypes: ['application/json'],
      });
      const pingBody = await pingRes.json().catch(() => ({}));
      out.execution_proof.steps[3].ok = !!pingRes.ok;
      out.execution_proof.steps[3].detail = pingRes.ok ? 'GET /api/wab/ping succeeded' : ('HTTP ' + pingRes.status);
      out.execution_proof.ok = out.execution_proof.steps.every((s) => s.ok);
      out.execution_proof.result = {
        discovered: discoverBody && (discoverBody.result || discoverBody),
        ping: pingBody && (pingBody.result || pingBody),
      };
    } catch (err) {
      out.execution_proof.error = err && err.message ? err.message : 'agent_test_failed';
    }
  } catch (err) {
    out.wab_json.error = err && err.message ? err.message : 'wab_fetch_failed';
    out.execution_proof.error = out.wab_json.error;
  }

  return out;
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
      api_base: '/api/wab',
      websocket: '/ws/analytics',
      noscript: `/api/noscript/bridge/${site.id}`,
      discovery: `/api/discovery/${site.id}`
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

// ═════════════════════════════════════════════════════════════════════
// 1. GET /.well-known/wab.json — Standard discovery location
// ═════════════════════════════════════════════════════════════════════

function buildSelfDiscovery() {
  return {
    wab_version: WAB_VERSION,
    protocol: '1.0',
    generated_at: new Date().toISOString(),
    provider: {
      name: 'Web Agent Bridge',
      domain: 'webagentbridge.com',
      category: 'developer-tools',
      description: 'Open protocol and runtime for AI agent ↔ website interaction. The OpenAPI for human-facing web pages.'
    },
    capabilities: {
      commands: ['read', 'navigate', 'search', 'discover'],
      permissions: { readContent: true, navigate: true, apiAccess: true },
      tier: 'platform',
      transport: ['http', 'javascript', 'websocket'],
      features: [
        'discovery_protocol', 'fairness_engine', 'mcp_adapter',
        'noscript_fallback', 'agent_sdk', 'wordpress_plugin',
        'openapi_spec', 'llms_txt', 'atom_feed'
      ]
    },
    agent_access: {
      bridge_script: '/script/ai-agent-bridge.js',
      api_base: '/api/wab',
      websocket: '/ws/analytics',
      discovery: '/agent-bridge.json',
      llms_txt: '/llms.txt',
      llms_full_txt: '/llms-full.txt',
      openapi: '/openapi.json',
      ai_assets: '/.well-known/ai-assets.json',
      atom_feed: '/feed.xml',
      sitemap: '/sitemap.xml'
    },
    fairness: {
      is_independent: true,
      commission_rate: 0,
      direct_benefit: 'Open-source protocol maintainer',
      neutrality_score: 100
    },
    security: {
      session_required: false,
      origin_validation: true,
      rate_limit: 60,
      sandbox: true
    },
    endpoints: {
      discover: '/api/wab/discover',
      actions: '/api/wab/actions',
      execute: '/api/wab/execute',
      ping: '/api/wab/ping',
      search: '/api/wab/search',
      registry: '/api/discovery/registry',
      plans: '/api/plans',
      page_info: '/api/wab/page-info'
    },
    ecosystem: {
      npm: 'https://www.npmjs.com/package/web-agent-bridge',
      github: 'https://github.com/abokenan444/web-agent-bridge',
      security: 'https://socket.dev/npm/package/web-agent-bridge',
      mcp_adapter: 'https://www.npmjs.com/package/wab-mcp-adapter',
      wordpress: 'https://github.com/abokenan444/web-agent-bridge/tree/master/web-agent-bridge-wordpress',
      specification: 'https://github.com/abokenan444/web-agent-bridge/blob/master/docs/SPEC.md'
    }
  };
}

router.get('/.well-known/wab.json', (req, res) => {
  try {
    const domain = getRequestDomain(req);
    const site = findSiteByDomain(domain);

    if (!site) {
      if (domain === 'webagentbridge.com' || domain === 'www.webagentbridge.com' || domain === 'localhost') {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-WAB-Version', WAB_VERSION);
        return res.json(buildSelfDiscovery());
      }
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
      if (domain === 'webagentbridge.com' || domain === 'www.webagentbridge.com' || domain === 'localhost') {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-WAB-Version', WAB_VERSION);
        return res.json(buildSelfDiscovery());
      }
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
// 6. GET /api/discovery/verify-live?domain=example.com
//    Verifiable proof: DNS TXT + wab.json + explicit status model.
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/verify-live', async (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/verify-live?domain=example.com',
    });
  }
  try {
    const proof = await buildProof(domain, { includeAgentRun: false });
    return res.json(proof);
  } catch (err) {
    return res.status(500).json({ error: 'verify_live_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 7. GET /api/discovery/test-agent?domain=example.com
//    Execution proof: discover → ping (official consumer path).
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/test-agent', async (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/test-agent?domain=example.com',
    });
  }
  try {
    const proof = await buildProof(domain, { includeAgentRun: true });
    if (!proof.execution_proof.ok) {
      return res.status(200).json({
        ...proof,
        warning: 'agent flow did not fully pass; inspect execution_proof.steps',
      });
    }
    return res.json(proof);
  } catch (err) {
    return res.status(500).json({ error: 'agent_test_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 8. GET /api/discovery/:siteId — Discovery doc for a specific site
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
module.exports._internals = {
  sanitizeDomain,
  deriveEndpointFromRecord,
  summarizeUseCase,
  hostAllowList,
};
