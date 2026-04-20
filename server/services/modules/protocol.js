/**
 * WAB Protocol Validator (08-protocol) — OPEN SOURCE
 * Validates wab.json trust protocol files.
 * This module is fully open to become a web standard.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const https = require('https');
const http = require('http');

const WAB_PROTOCOL_SCHEMA = {
  required: ['wab_version', 'site', 'permissions'],
  optional: ['pricing', 'returns', 'trust', 'accessibility', 'dark_patterns_policy'],
  permissions_fields: ['ai_agents', 'price_comparison', 'automated_checkout', 'data_export'],
};

function validateWabJson(wabJson) {
  const errors = [];
  const warnings = [];
  let score = 100;

  if (!wabJson || typeof wabJson !== 'object') return { valid: false, score: 0, errors: ['Invalid JSON structure'] };

  for (const field of WAB_PROTOCOL_SCHEMA.required) {
    if (!wabJson[field]) { errors.push(`Missing required field: ${field}`); score -= 20; }
  }

  if (wabJson.wab_version && !/^\d+\.\d+(\.\d+)?$/.test(wabJson.wab_version)) {
    errors.push('Invalid wab_version format. Expected semver (e.g., "1.0.0")'); score -= 10;
  }

  if (wabJson.permissions) {
    const p = wabJson.permissions;
    if (typeof p.ai_agents !== 'undefined' && typeof p.ai_agents !== 'boolean' && typeof p.ai_agents !== 'string') {
      warnings.push('permissions.ai_agents should be boolean or policy string');
    }
  }

  for (const field of WAB_PROTOCOL_SCHEMA.optional) {
    if (wabJson[field]) score = Math.min(100, score + 3);
  }

  return {
    valid: errors.length === 0, score: Math.max(0, score), errors, warnings,
    fields_present: Object.keys(wabJson),
    completeness: `${Object.keys(wabJson).length} fields`,
    protocol_version: wabJson.wab_version || 'unknown',
  };
}

async function fetchAndValidate(domain) {
  const wabUrl = `https://${domain}/wab.json`;
  return new Promise((resolve) => {
    const protocol = wabUrl.startsWith('https') ? https : http;
    const req = protocol.get(wabUrl, { timeout: 8000, headers: { 'User-Agent': 'WAB-Protocol-Validator/1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        return resolve({ found: false, domain, url: wabUrl, error: `HTTP ${res.statusCode}`, recommendation: 'Add a wab.json file to your site root' });
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const result = validateWabJson(json);
          resolve({ found: true, domain, url: wabUrl, ...result, raw: json });
        } catch { resolve({ found: false, domain, url: wabUrl, error: 'Invalid JSON in wab.json' }); }
      });
    });
    req.on('error', () => resolve({ found: false, domain, url: wabUrl, error: 'Could not reach domain' }));
    req.on('timeout', () => { req.destroy(); resolve({ found: false, domain, url: wabUrl, error: 'Request timed out' }); });
  });
}

function createRouter(express) {
  const router = express.Router();

  router.post('/validate', (req, res) => {
    const { wab_json } = req.body;
    if (!wab_json) return res.status(400).json({ error: 'wab_json object is required' });
    res.json(validateWabJson(wab_json));
  });

  router.get('/check/:domain', async (req, res) => {
    const result = await fetchAndValidate(req.params.domain);
    res.json(result);
  });

  router.get('/schema', (req, res) => {
    res.json({ version: '1.0', schema: WAB_PROTOCOL_SCHEMA, example: {
      wab_version: '1.0.0', site: { name: 'Example Store', domain: 'example.com', type: 'e-commerce' },
      permissions: { ai_agents: true, price_comparison: true, automated_checkout: false, data_export: true },
      pricing: { transparency: 'full', currency: 'USD', includes_tax: false },
      dark_patterns_policy: { commitment: 'none', last_audit: '2026-01-01' },
    }});
  });

  return router;
}

module.exports = { createRouter, validateWabJson, fetchAndValidate };
