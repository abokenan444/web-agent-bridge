/**
 * Pages Router handler factory: pages/api/wab/discovery.js
 *   const { createPagesHandler } = require('@webagentbridge/next/pages');
 *   module.exports = createPagesHandler();
 */
'use strict';

const { buildWabDoc } = require('./index');

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function createPagesHandler(cfgOverride) {
  return function handler(req, res) {
    const cfg = {
      siteName: (cfgOverride && cfgOverride.siteName) || process.env.__WAB_NEXT_SITE_NAME || process.env.WAB_SITE_NAME,
      siteUrl: (cfgOverride && cfgOverride.siteUrl) || process.env.__WAB_NEXT_SITE_URL || process.env.WAB_SITE_URL,
      actions: (cfgOverride && cfgOverride.actions) || safeParse(process.env.__WAB_NEXT_ACTIONS) || [],
      trust: (cfgOverride && cfgOverride.trust) || safeParse(process.env.__WAB_NEXT_TRUST) || {}
    };
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'public, max-age=300');
    res.setHeader('access-control-allow-origin', '*');
    res.status(200).end(JSON.stringify(buildWabDoc(cfg), null, 2));
  };
}

module.exports = { createPagesHandler };
