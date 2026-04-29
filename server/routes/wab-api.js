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
const crypto = require('crypto');
const { findSiteById, findSiteByLicense, recordAnalytic, db } = require('../models/db');
const { broadcastAnalytic } = require('../ws');
const { wabAuthenticateLimiter, wabActionLimiter, searchLimiter } = require('../middleware/rateLimits');
const { auditLog } = require('../services/security');
const tokenScope = require('../security/token-scope');
const dryRun = require('../security/dry-run');
const humanGate = require('../security/human-gate');
const humanGateTransports = require('../security/human-gate-transports');
const humanGateRateLimit = require('../security/human-gate-rate-limit');
const intentEngine = require('../security/intent-engine');
const rollback = require('../security/rollback-store');

// Register built-in transports (webhook/email/console). Sites pick one
// via siteConfig.humanGate.transport ∈ {null, webhook, email, console}.
humanGateTransports.registerAll(humanGate);

// Fairness module is proprietary — provide stubs when not available
let calculateNeutralityScore, fairnessWeightedSearch, getDirectoryListings, generateFairnessReport;
try {
  ({
    calculateNeutralityScore,
    fairnessWeightedSearch,
    getDirectoryListings,
    generateFairnessReport
  } = require('../services/fairness'));
} catch {
  calculateNeutralityScore = () => ({ score: 0, label: 'unrated' });
  fairnessWeightedSearch = (_q, candidates) => candidates;
  getDirectoryListings = () => [];
  generateFairnessReport = () => ({ status: 'unavailable' });
}

const WAB_VERSION = '1.2.0';
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

function buildErrorResponse(id, code, message, extra) {
  const error = { code, message };
  if (extra && typeof extra === 'object') Object.assign(error, extra);
  return { id: id || null, type: 'error', protocol: PROTOCOL_VERSION, error };
}

// ═════════════════════════════════════════════════════════════════════
// POST /api/wab/authenticate — session token exchange
// ═════════════════════════════════════════════════════════════════════

router.post('/authenticate', wabAuthenticateLimiter, (req, res) => {
  try {
    const { siteId, apiKey, meta, scope: requestedScope } = req.body;
    if (!siteId && !apiKey) {
      return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'siteId or apiKey required'));
    }

    // SPEC §8.7 — parse caller-requested scope. Absent = legacy unscoped (admin/*).
    let scope;
    try {
      scope = tokenScope.parseScope(requestedScope);
    } catch (e) {
      return res.status(400).json(buildErrorResponse(null, 'invalid_scope', e.message));
    }

    let site;
    if (apiKey) {
      // Timing-safe API key lookup: hash the provided key and compare against stored hashes
      // to prevent timing attacks on the raw key comparison
      const allActive = db.prepare('SELECT * FROM sites WHERE active = 1 AND api_key IS NOT NULL').all();
      site = allActive.find(s => {
        if (!s.api_key) return false;
        const a = Buffer.from(s.api_key);
        const b = Buffer.from(apiKey);
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
      }) || null;
    } else {
      site = findSiteById.get(siteId);
    }

    if (!site) {
      auditLog({ actorType: 'agent', action: 'wab_auth_failed', details: { siteId }, ip: req.ip, outcome: 'denied', severity: 'warning' });
      return res.status(404).json(buildErrorResponse(null, 'not_found', 'Site not found or invalid credentials'));
    }

    const origin = req.get('origin') || '';
    if (origin) {
      try {
        const reqDomain = new URL(origin).hostname.replace(/^www\./, '');
        const siteDomain = site.domain.replace(/^www\./, '');
        const isProduction = process.env.NODE_ENV === 'production';
        const isLocalhost = reqDomain === 'localhost' || reqDomain === '127.0.0.1';
        if (reqDomain !== siteDomain && !(isLocalhost && !isProduction)) {
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
      scope,
      createdAt: Date.now(),
      expiresAt: Date.now() + SESSION_TTL
    });

    res.json(buildCommandResponse(null, {
      authenticated: true,
      token,
      siteId: site.id,
      tier: site.tier,
      expiresIn: SESSION_TTL / 1000,
      permissions: parseSiteConfig(site).agentPermissions || {},
      scope: tokenScope.formatScope(scope)
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

router.post('/actions/:name', requireSession, wabActionLimiter, async (req, res) => {
  try {
    const actionName = req.params.name;
    const site = findSiteById.get(req.wabSession.siteId);
    if (!site) return res.status(404).json(buildErrorResponse(req.body?.id, 'not_found', 'Site not found'));

    const config = parseSiteConfig(site);
    const perms = config.agentPermissions || {};

    // SPEC §8.7 — token scope gate. Site config may declare
    // `environment` ("production" by default), `destructiveActions[]`,
    // and `nonDestructiveActions[]` to extend the default policy.
    const sessionScope = req.wabSession.scope;
    if (sessionScope) {
      const decision = tokenScope.authorize(sessionScope, {
        name: actionName,
        env: config.environment || 'production',
        resource: req.body?.resource,
        action_kind: req.body?.action_kind,
      }, config);
      if (!decision.allowed) {
        auditLog({
          actorType: 'agent',
          action: 'scope_denied',
          details: { actionName, code: decision.code, reason: decision.reason, siteId: site.id },
          ip: req.ip,
          outcome: 'denied',
          severity: 'warning',
        });
        return res.status(403).json(buildErrorResponse(
          req.body?.id,
          decision.code,
          decision.reason
        ));
      }
    }

    const permMap = {
      click: 'click', fill_and_submit: 'fillForms', scroll: 'scroll',
      navigate: 'navigate', api: 'apiAccess', read: 'readContent', extract: 'extractData'
    };
    const requiredPerm = permMap[actionName] || actionName;

    if (!perms[requiredPerm] && !perms[actionName]) {
      return res.status(403).json(buildErrorResponse(req.body?.id, 'permission_denied',
        `Action "${actionName}" is not permitted by site configuration`));
    }

    // SPEC §8.12 — Intent Analysis Engine (Premium+ or opt-in).
    const intentCfg = config.intentEngine || {};
    const intentEnabled = intentCfg.enabled === false
      ? false
      : (intentCfg.enabled === true || ['premium', 'enterprise'].includes(String(site.tier || '').toLowerCase()));
    let intentVerdict = null;
    if (intentEnabled) {
      intentVerdict = intentEngine.score({
        actorId: req.wabSession?.agentMeta?.name || null,
        sessionToken: req.get('Authorization')?.slice(7),
        siteId: site.id,
        actionName,
        params: req.body?.params || {},
        env: config.environment || 'production',
        tier: site.tier,
      }, config);
      if (intentVerdict.required_gate === 'block') {
        auditLog({
          actorType: 'agent', action: 'intent_blocked',
          details: { actionName, score: intentVerdict.score, reasons: intentVerdict.reasons, siteId: site.id },
          ip: req.ip, outcome: 'blocked', severity: 'critical',
        });
        return res.status(403).json(buildErrorResponse(req.body?.id, 'INTENT_BLOCKED',
          `Request blocked by intent analysis (score=${intentVerdict.score}, level=${intentVerdict.level}). Reasons: ${intentVerdict.reasons.join('; ')}`,
          { intent: intentVerdict }));
      }
    }

    // SPEC §8.10 — Mandatory Dry-Run for destructive actions.
    const intentForcesDryRun = intentVerdict && intentVerdict.required_gate === 'dry_run';
    if (dryRun.requiresDryRun(actionName, config) || intentForcesDryRun) {
      const dryFlag = req.body?.dry_run;
      const planId = req.body?.plan_id;
      const ctx = {
        sessionToken: req.get('Authorization')?.slice(7),
        siteId: site.id,
        actionName,
        params: req.body?.params || {},
      };

      if (dryFlag === true) {
        // Generate a plan. The default simulator is conservative — it
        // surfaces what we know (action, params, target site) and marks
        // reversible=false. Sites integrating with their own backend MAY
        // override this via a server-side adapter.
        const sim = {
          would_affect: [`site:${site.id}`, `action:${actionName}`],
          side_effects: [actionName],
          reversible: false,
          summary: `Would execute "${actionName}" on site ${site.domain} with the given params. ` +
                   'No actual changes have been made. Confirm with dry_run:false + plan_id to proceed.',
        };
        const envelope = dryRun.createPlan(ctx, sim);
        auditLog({
          actorType: 'agent', action: 'dry_run_plan_created',
          details: { actionName, planId: envelope.plan_id, siteId: site.id },
          ip: req.ip, outcome: 'success', severity: 'info',
        });
        return res.json(buildCommandResponse(req.body?.id, envelope));
      }

      // dryFlag === false (or undefined) — must consume a valid plan.
      const consume = dryRun.consumePlan(planId, ctx);
      if (!consume.ok) {
        auditLog({
          actorType: 'agent', action: 'dry_run_violation',
          details: { actionName, code: consume.code, siteId: site.id },
          ip: req.ip, outcome: 'denied', severity: 'warning',
        });
        return res.status(412).json(buildErrorResponse(req.body?.id, consume.code, consume.message));
      }
    }

    // SPEC §8.11 — Out-of-Band Human Gate (Pro+).
    const intentForcesHumanGate = intentVerdict && intentVerdict.required_gate === 'human_gate';
    if (humanGate.requiresHumanGate(actionName, config, site.tier) || intentForcesHumanGate) {
      const hgCtx = {
        sessionToken: req.get('Authorization')?.slice(7),
        siteId: site.id,
        actorId: req.wabSession?.agentMeta?.name || null,
        actionName,
        params: req.body?.params || {},
      };
      const confirmationId = req.body?.confirmation_id;
      if (!confirmationId) {
        const challenge = await humanGate.issueChallenge(hgCtx, { siteConfig: config });
        auditLog({
          actorType: 'agent', action: 'human_gate_issued',
          details: { actionName, challenge_id: challenge.challenge_id, siteId: site.id, dispatched_to: challenge.dispatched_to },
          ip: req.ip, outcome: 'success', severity: 'info',
        });
        return res.status(202).json(buildErrorResponse(req.body?.id, 'HUMAN_GATE_REQUIRED',
          'Out-of-band human approval required. Retry with confirmation_id once approved.', {
            challenge_id: challenge.challenge_id,
            expires_at: challenge.expires_at,
            dispatched_to: challenge.dispatched_to,
          }));
      }
      const hg = humanGate.consumeApproved(confirmationId, hgCtx);
      if (!hg.ok) {
        auditLog({
          actorType: 'agent', action: 'human_gate_violation',
          details: { actionName, code: hg.code, challenge_id: confirmationId, siteId: site.id },
          ip: req.ip, outcome: 'denied', severity: 'warning',
        });
        const status = hg.code === 'HUMAN_GATE_PENDING' ? 425 : 403;
        return res.status(status).json(buildErrorResponse(req.body?.id, hg.code, hg.message || hg.code));
      }
    }

    // SPEC §8.13 — Snapshot before execution (Enterprise or opt-in).
    let snapshotId = null;
    const snapshotsEnabled = (config.snapshots && config.snapshots.enabled === true) ||
      String(site.tier || '').toLowerCase() === 'enterprise';
    const isDestructiveExec = tokenScope.isDestructiveAction(actionName, config) ||
      (intentVerdict && intentVerdict.verb_class === 'destructive');
    if (snapshotsEnabled && isDestructiveExec) {
      try {
        const snap = rollback.recordSnapshot({
          siteId: site.id,
          actionName,
          actorId: req.wabSession?.agentMeta?.name || null,
          sessionToken: req.get('Authorization')?.slice(7),
          params: req.body?.params || {},
        }, {
          // The default snapshot payload is metadata-only; site adapters
          // override via their own pre-execution hook.
          snapshot: { actionName, params: req.body?.params || {}, captured_at: new Date().toISOString() },
          meta: { intent_score: intentVerdict?.score || null },
          reversible: true,
        });
        snapshotId = snap.snapshot_id;
        auditLog({
          actorType: 'agent', action: 'snapshot_recorded',
          details: { actionName, snapshot_id: snapshotId, siteId: site.id },
          ip: req.ip, outcome: 'success', severity: 'info',
        });
      } catch (e) {
        // Snapshot failure must NOT silently allow destructive actions.
        auditLog({
          actorType: 'agent', action: 'snapshot_failed',
          details: { actionName, error: e.message, siteId: site.id },
          ip: req.ip, outcome: 'error', severity: 'critical',
        });
        return res.status(500).json(buildErrorResponse(req.body?.id, 'SNAPSHOT_FAILED',
          'Could not record pre-action snapshot — destructive action aborted for safety.'));
      }
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
      snapshot_id: snapshotId,
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

router.get('/search', searchLimiter, (req, res) => {
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

// ═════════════════════════════════════════════════════════════════════
// SPEC §8.11 — Out-of-Band Human Gate endpoints
// ═════════════════════════════════════════════════════════════════════

// Public-ish: anyone holding a valid challenge_id + 6-digit code can
// approve/reject. Rate-limit applies to brute-force the code (5 attempts
// per challenge enforced by the module).
router.post('/human-gate/approve', wabActionLimiter, (req, res) => {
  try {
    const { challenge_id, code } = req.body || {};
    if (!challenge_id || !code) {
      return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'challenge_id and code required'));
    }
    // SPEC §8.11 — IP-level brute-force limiter (sliding window).
    // Per-challenge 5-attempt lockout still applies inside humanGate.
    const ipCheck = humanGateRateLimit.checkBeforeAttempt(req.ip);
    if (!ipCheck.allowed) {
      try {
        auditLog({
          actorType: 'user', action: 'human_gate_rate_limited',
          details: { challenge_id, code: ipCheck.code, retry_after_ms: ipCheck.retry_after_ms },
          ip: req.ip, outcome: 'denied', severity: 'warning',
        });
      } catch { /* audit failures must not block */ }
      res.set('Retry-After', String(Math.ceil((ipCheck.retry_after_ms || 0) / 1000)));
      return res.status(429).json(buildErrorResponse(null, ipCheck.code,
        'too many approval attempts from this IP; slow down', { retry_after_ms: ipCheck.retry_after_ms }));
    }
    const result = humanGate.approveChallenge(challenge_id, code);
    humanGateRateLimit.recordAttempt(req.ip, !!result.ok);
    try {
      auditLog({
        actorType: 'user', action: 'human_gate_approve_attempt',
        details: { challenge_id, ok: result.ok, code: result.code },
        ip: req.ip, outcome: result.ok ? 'success' : 'denied',
        severity: result.ok ? 'info' : 'warning',
      });
    } catch (e) { /* audit failures must not block the security gate */ }
    if (!result.ok) {
      const status = result.code === 'HUMAN_GATE_NOT_FOUND' ? 404
                   : result.code === 'HUMAN_GATE_LOCKED' ? 429
                   : result.code === 'HUMAN_GATE_BAD_CODE' ? 401
                   : 400;
      return res.status(status).json(buildErrorResponse(null, result.code, result.message || result.code));
    }
    return res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: { status: result.status } });
  } catch (err) {
    return res.status(500).json(buildErrorResponse(null, 'internal', err.message));
  }
});

router.post('/human-gate/reject', wabActionLimiter, (req, res) => {
  const { challenge_id, reason } = req.body || {};
  if (!challenge_id) {
    return res.status(400).json(buildErrorResponse(null, 'invalid_argument', 'challenge_id required'));
  }
  const result = humanGate.rejectChallenge(challenge_id, reason);
  auditLog({
    actorType: 'user', action: 'human_gate_reject',
    details: { challenge_id, ok: result.ok, code: result.code },
    ip: req.ip, outcome: result.ok ? 'success' : 'denied', severity: 'info',
  });
  if (!result.ok) {
    return res.status(result.code === 'HUMAN_GATE_NOT_FOUND' ? 404 : 400)
      .json(buildErrorResponse(null, result.code, result.code));
  }
  return res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: { status: result.status } });
});

router.get('/human-gate/:id/status', (req, res) => {
  const status = humanGate.getStatus(req.params.id);
  if (!status) {
    return res.status(404).json(buildErrorResponse(null, 'HUMAN_GATE_NOT_FOUND', 'challenge not found'));
  }
  return res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: status });
});

// ═════════════════════════════════════════════════════════════════════
// SPEC §8.13 — Snapshot & Rollback admin endpoints
// ═════════════════════════════════════════════════════════════════════
//
// Auth: site owner authenticates with the site's apiKey via
//   X-WAB-Site-Id + X-WAB-Api-Key headers (same secret used to issue
//   bridge tokens). This is the operator's break-glass.
function _adminAuth(req, res) {
  const siteId = req.get('X-WAB-Site-Id');
  const apiKey = req.get('X-WAB-Api-Key');
  if (!siteId || !apiKey) {
    res.status(401).json(buildErrorResponse(null, 'auth_required', 'X-WAB-Site-Id and X-WAB-Api-Key required'));
    return null;
  }
  const site = findSiteById.get(siteId);
  if (!site || site.api_key !== apiKey) {
    res.status(403).json(buildErrorResponse(null, 'forbidden', 'invalid site or api key'));
    return null;
  }
  return site;
}

router.get('/admin/snapshots', (req, res) => {
  const site = _adminAuth(req, res); if (!site) return;
  try {
    const list = rollback.listSnapshots(site.id, {
      limit: parseInt(req.query.limit, 10) || 50,
      status: req.query.status || undefined,
    });
    res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: { snapshots: list } });
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', err.message));
  }
});

router.get('/admin/snapshots/:id', (req, res) => {
  const site = _adminAuth(req, res); if (!site) return;
  const snap = rollback.getSnapshot(req.params.id);
  if (!snap || snap.site_id !== site.id) {
    return res.status(404).json(buildErrorResponse(null, 'SNAPSHOT_NOT_FOUND', 'snapshot not found'));
  }
  res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: snap });
});

router.post('/admin/rollback/:id', async (req, res) => {
  const site = _adminAuth(req, res); if (!site) return;
  const snap = rollback.getSnapshot(req.params.id);
  if (!snap || snap.site_id !== site.id) {
    return res.status(404).json(buildErrorResponse(null, 'SNAPSHOT_NOT_FOUND', 'snapshot not found'));
  }
  try {
    const result = await rollback.restoreSnapshot(req.params.id);
    auditLog({
      actorType: 'admin', action: 'snapshot_rollback_attempt',
      details: { snapshot_id: req.params.id, site_id: site.id, ok: result.ok, code: result.code },
      ip: req.ip, outcome: result.ok ? 'success' : 'denied',
      severity: result.ok ? 'warning' : 'critical',
    });
    if (!result.ok) {
      const status = result.code === 'SNAPSHOT_NOT_FOUND' ? 404
                   : result.code === 'NO_RESTORER' ? 503
                   : 409;
      return res.status(status).json(buildErrorResponse(null, result.code, result.message || result.code));
    }
    res.json({ type: 'success', protocol: PROTOCOL_VERSION, result: { restored: true, snapshot_id: req.params.id } });
  } catch (err) {
    res.status(500).json(buildErrorResponse(null, 'internal', err.message));
  }
});

module.exports = router;
