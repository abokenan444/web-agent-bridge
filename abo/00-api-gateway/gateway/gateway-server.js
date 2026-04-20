/**
 * WAB API Gateway Server
 * The single public entry point for ALL WAB modules.
 * Hides all internal microservices behind one authenticated API.
 *
 * External URL: https://api.webagentbridge.com
 * All 10 modules are only accessible through this gateway.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const https = require('https');
const { WABKeyEngine } = require('../core/key-engine');

const engine = new WABKeyEngine();
const PORT = process.env.GATEWAY_PORT || 4500;

// ─── Internal Module Routing Table ───────────────────────────────────────────
// These addresses are NEVER exposed to the public — only the gateway knows them
const MODULE_ROUTES = {
  'firewall':     { host: process.env.FIREWALL_HOST   || 'localhost', port: 3001, plan: 'PRO',      name: 'Agent Firewall' },
  'notary':       { host: process.env.NOTARY_HOST     || 'localhost', port: 3002, plan: 'BUSINESS', name: 'Cryptographic Notary' },
  'dark-pattern': { host: process.env.DARKPAT_HOST    || 'localhost', port: 3003, plan: 'FREE',     name: 'Dark Pattern Detector' },
  'bargaining':   { host: process.env.BARGAIN_HOST    || 'localhost', port: 3004, plan: 'PRO',      name: 'Collective Bargaining' },
  'gov':          { host: process.env.GOV_HOST        || 'localhost', port: 3005, plan: 'BUSINESS', name: 'Gov Intelligence' },
  'price':        { host: process.env.PRICE_HOST      || 'localhost', port: 3006, plan: 'FREE',     name: 'Price Time Machine' },
  'neural':       { host: process.env.NEURAL_HOST     || 'localhost', port: 3007, plan: 'PRO',      name: 'Neural Engine' },
  'protocol':     { host: process.env.PROTOCOL_HOST   || 'localhost', port: 3008, plan: 'FREE',     name: 'WAB Protocol' },
  'bounty':       { host: process.env.BOUNTY_HOST     || 'localhost', port: 3009, plan: 'FREE',     name: 'Bounty Network' },
  'affiliate':    { host: process.env.AFFILIATE_HOST  || 'localhost', port: 3010, plan: 'PRO',      name: 'Affiliate Intelligence' },
};

// ─── Request Parser ───────────────────────────────────────────────────────────
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// ─── Response Helpers ─────────────────────────────────────────────────────────
function send(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'X-Powered-By': 'WAB API Gateway',
    'X-WAB-Version': '1.0.0',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WAB-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  res.end(body);
}

// ─── Extract API Key from request ────────────────────────────────────────────
function extractKey(req) {
  // Support: Authorization: Bearer wab_live_xxx OR X-WAB-Key: wab_live_xxx OR ?api_key=wab_live_xxx
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  if (req.headers['x-wab-key']) return req.headers['x-wab-key'].trim();
  const url = new URL(req.url, `http://localhost`);
  return url.searchParams.get('api_key') || null;
}

// ─── Proxy request to internal module ────────────────────────────────────────
function proxyToModule(moduleConfig, req, res, body, validationResult) {
  const { host, port } = moduleConfig;
  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname.replace(/^\/v1\/[^/]+/, '') || '/';
  const query = url.search || '';

  const options = {
    hostname: host,
    port,
    path: path + query,
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      'X-WAB-Key-Id': validationResult.key_id,
      'X-WAB-Plan': validationResult.plan,
      'X-WAB-Owner': validationResult.owner,
      'X-WAB-Environment': validationResult.environment,
      'X-Forwarded-For': req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      'X-WAB-Gateway': '1',
    },
  };

  const bodyStr = JSON.stringify(body);
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    options.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }

  const proxyReq = http.request(options, (proxyRes) => {
    let responseBody = '';
    proxyRes.on('data', chunk => { responseBody += chunk; });
    proxyRes.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(responseBody); } catch { parsed = { raw: responseBody }; }

      // Inject WAB metadata into every response
      const enriched = {
        ...parsed,
        _wab: {
          gateway: 'api.webagentbridge.com',
          module: moduleConfig.name,
          plan: validationResult.plan_name,
          usage: validationResult.usage,
          timestamp: new Date().toISOString(),
          powered_by: 'WAB — Web Agent Bridge',
        },
      };

      res.writeHead(proxyRes.statusCode, {
        'Content-Type': 'application/json',
        'X-Powered-By': 'WAB API Gateway',
        'X-WAB-Module': moduleConfig.name,
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(enriched, null, 2));
    });
  });

  proxyReq.on('error', (err) => {
    send(res, 503, {
      error: 'Module temporarily unavailable',
      code: 'MODULE_UNAVAILABLE',
      module: moduleConfig.name,
      message: 'The requested WAB module is currently offline. Please try again shortly.',
      support: 'https://www.webagentbridge.com/support',
    });
  });

  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    proxyReq.write(bodyStr);
  }
  proxyReq.end();
}

// ─── Main Request Handler ─────────────────────────────────────────────────────
async function handleRequest(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WAB-Key',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    });
    return res.end();
  }

  const url = new URL(req.url, `http://localhost`);
  const path = url.pathname;

  // ── Public routes (no auth required) ──────────────────────────────────────
  if (path === '/health' || path === '/') {
    return send(res, 200, {
      status: 'operational',
      service: 'WAB API Gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      modules: Object.keys(MODULE_ROUTES).length,
      docs: 'https://www.webagentbridge.com/docs',
      signup: 'https://www.webagentbridge.com/workspace',
    });
  }

  if (path === '/v1/plans') {
    return send(res, 200, { plans: engine.getPlans() });
  }

  // ── Key Management routes ──────────────────────────────────────────────────
  if (path === '/v1/keys/generate' && req.method === 'POST') {
    const body = await parseBody(req);
    try {
      const result = engine.generateKey(body);
      return send(res, 201, result);
    } catch (err) {
      return send(res, 400, { error: err.message, code: 'KEY_GENERATION_FAILED' });
    }
  }

  if (path === '/v1/keys/validate' && req.method === 'POST') {
    const apiKey = extractKey(req);
    const body = await parseBody(req);
    const result = engine.validate(apiKey, body.module);
    return send(res, result.valid ? 200 : 401, result);
  }

  if (path === '/v1/keys/usage' && req.method === 'GET') {
    const apiKey = extractKey(req);
    if (!apiKey) return send(res, 401, { error: 'API key required', code: 'MISSING_KEY' });
    return send(res, 200, engine.getUsage(apiKey));
  }

  if (path === '/v1/keys/revoke' && req.method === 'POST') {
    const apiKey = extractKey(req);
    const body = await parseBody(req);
    if (!apiKey) return send(res, 401, { error: 'API key required' });
    return send(res, 200, engine.revoke(apiKey, body.reason));
  }

  if (path === '/v1/keys/rotate' && req.method === 'POST') {
    const apiKey = extractKey(req);
    if (!apiKey) return send(res, 401, { error: 'API key required' });
    return send(res, 200, engine.rotate(apiKey));
  }

  if (path === '/v1/admin/keys' && req.method === 'GET') {
    const apiKey = extractKey(req);
    return send(res, 200, engine.listKeys(apiKey));
  }

  // ── Module proxy routes: /v1/{module}/... ─────────────────────────────────
  const moduleMatch = path.match(/^\/v1\/([^/]+)(\/.*)?$/);
  if (moduleMatch) {
    const moduleName = moduleMatch[1];
    const moduleConfig = MODULE_ROUTES[moduleName];

    if (!moduleConfig) {
      return send(res, 404, {
        error: `Unknown module: '${moduleName}'`,
        code: 'MODULE_NOT_FOUND',
        available_modules: Object.keys(MODULE_ROUTES),
        docs: 'https://www.webagentbridge.com/docs',
      });
    }

    // Authenticate
    const apiKey = extractKey(req);
    if (!apiKey) {
      return send(res, 401, {
        error: 'Authentication required',
        code: 'MISSING_KEY',
        message: 'Include your API key in the Authorization header: Bearer wab_live_xxx',
        get_key: 'https://www.webagentbridge.com/workspace',
      });
    }

    const validation = engine.validate(apiKey, moduleName);
    if (!validation.valid) {
      return send(res, validation.code === 'INSUFFICIENT_PLAN' ? 403 : 401, validation);
    }

    // Parse body and proxy
    const body = await parseBody(req);
    return proxyToModule(moduleConfig, req, res, body, validation);
  }

  // 404
  return send(res, 404, {
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    docs: 'https://www.webagentbridge.com/docs',
    available_endpoints: [
      'GET  /health',
      'GET  /v1/plans',
      'POST /v1/keys/generate',
      'POST /v1/keys/validate',
      'GET  /v1/keys/usage',
      'POST /v1/keys/revoke',
      'POST /v1/keys/rotate',
      'ANY  /v1/{module}/...',
    ],
  });
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════╗
║           WAB API Gateway — v1.0.0                       ║
║  Powered by Web Agent Bridge | webagentbridge.com        ║
╠══════════════════════════════════════════════════════════╣
║  Gateway URL : http://localhost:${PORT}                     ║
║  Modules     : ${Object.keys(MODULE_ROUTES).length} internal services (HIDDEN)              ║
║  Auth        : API Key (Bearer / X-WAB-Key / ?api_key)   ║
║  Plans       : FREE / PRO / BUSINESS / ENTERPRISE        ║
╚══════════════════════════════════════════════════════════╝
`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[WAB Gateway] Port ${PORT} is already in use.`);
    process.exit(1);
  }
  throw err;
});

module.exports = { server, engine };
