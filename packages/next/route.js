/**
 * App Router route factory: import GET from '@webagentbridge/next/route'.
 */
'use strict';

const { buildWabDoc } = require('./index');

function readEnvCfg(override) {
  return {
    siteName: (override && override.siteName) || process.env.__WAB_NEXT_SITE_NAME || process.env.WAB_SITE_NAME,
    siteUrl: (override && override.siteUrl) || process.env.__WAB_NEXT_SITE_URL || process.env.WAB_SITE_URL,
    actions: (override && override.actions) || safeParse(process.env.__WAB_NEXT_ACTIONS) || [],
    trust: (override && override.trust) || safeParse(process.env.__WAB_NEXT_TRUST) || {},
    extra: override && override.extra
  };
}

function safeParse(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

function createDiscoveryRoute(cfgOverride) {
  return async function GET() {
    const cfg = readEnvCfg(cfgOverride);
    const doc = buildWabDoc(cfg);
    return new Response(JSON.stringify(doc, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'public, max-age=300',
        'access-control-allow-origin': '*'
      }
    });
  };
}

module.exports = { createDiscoveryRoute };
