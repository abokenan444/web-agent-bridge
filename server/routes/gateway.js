/**
 * WAB API Gateway Routes
 * Single entry point: /api/v1/*
 * All 10 advanced modules behind API key authentication.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const express = require('express');
const router = express.Router();
const { WABKeyEngine } = require('../services/api-key-engine');

const engine = new WABKeyEngine();

// ─── Module Registry ───────────────────────────────────────────────────────────
const MODULE_META = {
  'firewall':     { name: 'Agent Firewall',          plan: 'PRO',      file: '../services/modules/agent-firewall' },
  'notary':       { name: 'Cryptographic Notary',    plan: 'BUSINESS', file: '../services/modules/notary' },
  'dark-pattern': { name: 'Dark Pattern Detector',   plan: 'FREE',     file: '../services/modules/dark-pattern' },
  'bargaining':   { name: 'Collective Bargaining',   plan: 'PRO',      file: '../services/modules/collective-bargaining' },
  'gov':          { name: 'Gov Intelligence',         plan: 'BUSINESS', file: '../services/modules/gov-intelligence' },
  'price':        { name: 'Price Time Machine',       plan: 'FREE',     file: '../services/modules/price-time-machine' },
  'neural':       { name: 'Neural Engine',            plan: 'PRO',      file: '../services/modules/neural' },
  'protocol':     { name: 'WAB Protocol',             plan: 'FREE',     file: '../services/modules/protocol' },
  'bounty':       { name: 'Bounty Network',           plan: 'FREE',     file: '../services/modules/bounty' },
  'affiliate':    { name: 'Affiliate Intelligence',   plan: 'PRO',      file: '../services/modules/affiliate-intelligence' },
};

// ─── Extract API Key ──────────────────────────────────────────────────────────
function extractKey(req) {
  const auth = req.headers['authorization'] || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  if (req.headers['x-wab-key']) return req.headers['x-wab-key'].trim();
  return req.query.api_key || null;
}

// ─── Auth Middleware (with HTTP-method → scope mapping) ──────────────────────
function methodToScope(method) {
  const m = (method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
  if (m === 'DELETE') return 'admin';
  return 'write'; // POST/PUT/PATCH
}

function gatewayAuth(moduleName, requiredScope = null) {
  return (req, res, next) => {
    const apiKey = extractKey(req);
    if (!apiKey) {
      return res.status(401).json({
        error: 'Authentication required', code: 'MISSING_KEY',
        message: 'Include your API key: Authorization: Bearer wab_live_xxx',
        get_key: 'https://www.webagentbridge.com/workspace',
      });
    }
    const scope = requiredScope || methodToScope(req.method);
    const validation = engine.validate(apiKey, moduleName, scope);
    if (!validation.valid) {
      const status = validation.code === 'INSUFFICIENT_PLAN' ? 403
                   : validation.code === 'INSUFFICIENT_SCOPE' ? 403
                   : validation.code === 'RATE_LIMIT_EXCEEDED' ? 429
                   : validation.code === 'QUOTA_EXCEEDED' ? 429
                   : 401;
      return res.status(status).json(validation);
    }
    if (validation.rotation && validation.rotation.warning) {
      res.setHeader('X-WAB-Key-Rotation-Due', validation.rotation.rotation_due_at);
      res.setHeader('X-WAB-Key-Rotation-Days', String(validation.rotation.days_until_due));
    }
    req.wabAuth = validation;
    next();
  };
}

// ─── WAB response wrapper ────────────────────────────────────────────────────
function wabWrap(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (data) => {
    const enriched = { ...data, _wab: {
      gateway: 'api.webagentbridge.com', module: req._wabModuleName || 'unknown',
      plan: req.wabAuth ? req.wabAuth.plan_name : 'unknown',
      usage: req.wabAuth ? req.wabAuth.usage : null,
      timestamp: new Date().toISOString(), powered_by: 'WAB — Web Agent Bridge',
    }};
    return originalJson(enriched);
  };
  next();
}

// ─── Public routes (no auth) ──────────────────────────────────────────────────
router.get('/health', (req, res) => {
  res.json({ status: 'operational', service: 'WAB API Gateway', version: '1.0.0',
    timestamp: new Date().toISOString(), modules: Object.keys(MODULE_META).length,
    docs: 'https://www.webagentbridge.com/api' });
});

router.get('/plans', (req, res) => {
  res.json({ plans: engine.getPlans() });
});

router.get('/modules', (req, res) => {
  res.json({ modules: Object.entries(MODULE_META).map(([id, m]) => ({
    id, name: m.name, min_plan: m.plan,
    endpoints: `https://api.webagentbridge.com/v1/${id}/`,
  }))});
});

// ─── Key Management ─────────────────────────────────────────────────────────
router.post('/keys/generate', (req, res) => {
  try {
    const result = engine.generateKey(req.body);
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/keys/validate', (req, res) => {
  const apiKey = extractKey(req);
  const result = engine.validate(apiKey, req.body.module);
  res.status(result.valid ? 200 : 401).json(result);
});

router.get('/keys/usage', (req, res) => {
  const apiKey = extractKey(req);
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  res.json(engine.getUsage(apiKey));
});

router.post('/keys/revoke', (req, res) => {
  const apiKey = extractKey(req);
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  res.json(engine.revoke(apiKey, req.body.reason));
});

router.post('/keys/rotate', (req, res) => {
  const apiKey = extractKey(req);
  if (!apiKey) return res.status(401).json({ error: 'API key required' });
  res.json(engine.rotate(apiKey));
});

router.get('/admin/keys', (req, res) => {
  const apiKey = extractKey(req);
  res.json(engine.listKeys(apiKey));
});

// ─── Mount module routers ───────────────────────────────────────────────────
for (const [moduleId, meta] of Object.entries(MODULE_META)) {
  try {
    const mod = require(meta.file);
    const moduleRouter = mod.createRouter(express);
    router.use(`/${moduleId}`, gatewayAuth(moduleId), (req, res, next) => { req._wabModuleName = meta.name; next(); }, wabWrap, moduleRouter);
  } catch (err) {
    // Module not available — create a stub
    router.use(`/${moduleId}`, gatewayAuth(moduleId), (req, res) => {
      res.status(503).json({ error: `Module '${meta.name}' is temporarily unavailable`, code: 'MODULE_UNAVAILABLE' });
    });
  }
}

// ─── Module listing for admin ── ────────────────────────────────────────────
router.get('/admin/modules', (req, res) => {
  const apiKey = extractKey(req);
  const validation = engine.validate(apiKey);
  if (!validation.valid) return res.status(401).json(validation);

  const modules = Object.entries(MODULE_META).map(([id, m]) => ({
    id, name: m.name, min_plan: m.plan, status: 'active',
  }));
  res.json({ modules });
});

module.exports = router;
