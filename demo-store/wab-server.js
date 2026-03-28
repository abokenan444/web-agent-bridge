/**
 * WAB Server Middleware for Express
 *
 * Usage:
 *   const wab = require('./wab-server');
 *   app.use(wab({
 *     name: 'My Store',
 *     actions: {
 *       getPrice: { description: 'Get price', handler: async () => ({ price: '$49' }) }
 *     }
 *   }));
 *
 * That's it. This creates:
 *   GET  /.well-known/wab.json   — Discovery document
 *   GET  /agent-bridge.json      — Discovery document (alias)
 *   GET  /wab/ping               — Health check
 *   GET  /wab/discover           — Discovery
 *   GET  /wab/actions            — List available actions
 *   POST /wab/execute            — Execute an action
 *   GET  /wab/audit              — View action audit log
 */

const crypto = require('crypto');
const WAB_VERSION = '1.2.0';

module.exports = function createWABMiddleware(config) {
  const {
    name = 'WAB Site',
    description = '',
    category = 'general',
    version = WAB_VERSION,
    actions = {},
    security = {},
    fairness = {}
  } = config;

  const auditLog = [];
  function audit(action, params, result, duration) {
    auditLog.push({ action, params, success: !result.error, duration_ms: duration, timestamp: new Date().toISOString() });
    if (auditLog.length > 500) auditLog.shift();
  }

  const actionDefs = Object.entries(actions).map(([actionName, def]) => ({
    name: actionName,
    description: def.description || actionName,
    category: def.category || 'general',
    params: def.params || []
  }));

  function buildDiscovery(req) {
    const host = req.get('host') || 'localhost';
    return {
      wab_version: version,
      protocol: '1.0',
      generated_at: new Date().toISOString(),
      site: { name, domain: host, description, category, platform: 'express' },
      capabilities: {
        commands: ['read', 'navigate', 'click', 'fill', 'submit', 'search'],
        permissions: { readContent: true, click: true, fillForms: true, scroll: true, navigate: true, apiAccess: true },
        transport: ['http'],
        features: Object.keys(actions)
      },
      actions: actionDefs,
      fairness: {
        is_independent: fairness.is_independent !== false,
        commission_rate: fairness.commission_rate || 0,
        direct_benefit: fairness.direct_benefit || 'Direct to site owner',
        neutrality_score: fairness.neutrality_score || 95
      },
      security: {
        session_required: security.session_required || false,
        rate_limit: security.rate_limit || 60,
        sandbox: security.sandbox !== false
      },
      endpoints: { discover: '/wab/discover', execute: '/wab/execute', actions: '/wab/actions', ping: '/wab/ping' },
      lifecycle: ['discover', 'authenticate', 'plan', 'execute', 'confirm']
    };
  }

  const router = require('express').Router();

  const wabHeaders = { 'X-WAB-Version': version, 'Cache-Control': 'public, max-age=60' };

  router.get('/.well-known/wab.json', (req, res) => { res.set(wabHeaders).json(buildDiscovery(req)); });
  router.get('/agent-bridge.json',    (req, res) => { res.set(wabHeaders).json(buildDiscovery(req)); });

  router.get('/wab/ping', (req, res) => {
    res.json({ status: 'ok', wab_version: version, protocol: '1.0', timestamp: new Date().toISOString(), uptime: process.uptime() });
  });

  router.get('/wab/discover', (req, res) => { res.set(wabHeaders).json(buildDiscovery(req)); });
  router.get('/wab/actions',  (req, res) => { res.json({ wab_version: version, actions: actionDefs }); });

  router.post('/wab/execute', async (req, res) => {
    const { action: actionName, params } = req.body || {};
    const start = Date.now();

    if (!actionName) {
      return res.status(400).json({ success: false, error: 'Missing "action" field', wab_version: version });
    }

    const actionDef = actions[actionName];
    if (!actionDef || !actionDef.handler) {
      return res.status(400).json({
        success: false,
        error: `Unknown action: ${actionName}`,
        available: Object.keys(actions),
        wab_version: version
      });
    }

    try {
      const result = await actionDef.handler(params || {}, req);
      const duration = Date.now() - start;
      audit(actionName, params, result, duration);
      res.json({ success: !result.error, action: actionName, result, wab_version: version, duration_ms: duration });
    } catch (err) {
      const duration = Date.now() - start;
      const result = { error: err.message };
      audit(actionName, params, result, duration);
      res.json({ success: false, action: actionName, result, wab_version: version, duration_ms: duration });
    }
  });

  router.get('/wab/audit', (req, res) => {
    res.json({ entries: auditLog.slice(-50), total: auditLog.length });
  });

  return router;
};
