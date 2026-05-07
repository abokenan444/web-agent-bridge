/**
 * @webagentbridge/next — Next.js plugin for Web Agent Bridge.
 *
 * Wraps your Next.js config and:
 *   • Adds a rewrite from `/.well-known/wab.json` → `/api/wab/discovery`
 *   • Exposes a Route Handler factory `createDiscoveryRoute()` for
 *     App Router (or a default export for the Pages Router).
 *
 * Usage (next.config.js):
 *   const { withWAB } = require('@webagentbridge/next');
 *   module.exports = withWAB({
 *     // your existing next config
 *   }, {
 *     siteName: 'Acme',
 *     siteUrl: 'https://acme.com',
 *     actions: [
 *       { name: 'home', description: 'Open homepage', url: 'https://acme.com' }
 *     ]
 *   });
 *
 * Usage — App Router (app/api/wab/discovery/route.js):
 *   import { createDiscoveryRoute } from '@webagentbridge/next/route';
 *   export const GET = createDiscoveryRoute({
 *     siteName: 'Acme',
 *     siteUrl: 'https://acme.com'
 *   });
 *
 * Usage — Pages Router (pages/api/wab/discovery.js):
 *   const { createPagesHandler } = require('@webagentbridge/next/pages');
 *   module.exports = createPagesHandler({
 *     siteName: 'Acme',
 *     siteUrl: 'https://acme.com'
 *   });
 */

'use strict';

function buildWabDoc(cfg) {
  const actions = Array.isArray(cfg.actions) && cfg.actions.length
    ? cfg.actions
    : [{ name: 'home', description: 'Open homepage', url: cfg.siteUrl }];
  return {
    version: '1.0',
    site: cfg.siteName,
    url: cfg.siteUrl,
    generated_at: new Date().toISOString(),
    generator: '@webagentbridge/next',
    actions,
    trust: Object.assign({ signed: false, auto: true, source: 'next-plugin' }, cfg.trust || {}),
    ...(cfg.extra || {})
  };
}

/**
 * Wrap a Next.js config with WAB rewrites + headers.
 * @param {object} nextConfig
 * @param {{siteName:string, siteUrl:string, actions?:Array, trust?:object, extra?:object}} wabCfg
 */
function withWAB(nextConfig = {}, wabCfg = {}) {
  if (!wabCfg.siteName || !wabCfg.siteUrl) {
    console.warn('[@webagentbridge/next] siteName and siteUrl are required for full configuration');
  }

  const userRewrites = nextConfig.rewrites;
  const userHeaders = nextConfig.headers;

  return Object.assign({}, nextConfig, {
    async rewrites() {
      const wabRules = [
        { source: '/.well-known/wab.json', destination: '/api/wab/discovery' }
      ];
      if (typeof userRewrites === 'function') {
        const r = await userRewrites();
        if (Array.isArray(r)) return [...wabRules, ...r];
        return Object.assign(
          { beforeFiles: [], afterFiles: [], fallback: [] },
          r,
          { beforeFiles: [...wabRules, ...((r && r.beforeFiles) || [])] }
        );
      }
      return wabRules;
    },
    async headers() {
      const wabHeaders = [{
        source: '/.well-known/wab.json',
        headers: [
          { key: 'cache-control', value: 'public, max-age=300' },
          { key: 'access-control-allow-origin', value: '*' }
        ]
      }];
      if (typeof userHeaders === 'function') {
        const h = await userHeaders();
        return Array.isArray(h) ? [...wabHeaders, ...h] : wabHeaders;
      }
      return wabHeaders;
    },
    env: Object.assign({}, nextConfig.env, {
      __WAB_NEXT_SITE_NAME: wabCfg.siteName || '',
      __WAB_NEXT_SITE_URL: wabCfg.siteUrl || '',
      __WAB_NEXT_ACTIONS: JSON.stringify(wabCfg.actions || []),
      __WAB_NEXT_TRUST: JSON.stringify(wabCfg.trust || {})
    })
  });
}

module.exports = { withWAB, buildWabDoc };
