/**
 * @wab/edge — Shared core for Vercel & Netlify Edge Functions.
 *
 * Builds a Response object containing /.well-known/wab.json from a config.
 * Re-export this from Vercel `middleware.ts` or Netlify `netlify/edge-functions/wab.js`.
 */

/**
 * @typedef {Object} WabConfig
 * @property {string}  siteName
 * @property {string}  siteUrl
 * @property {Array<{name:string, description?:string, url?:string, urlTemplate?:string}>} [actions]
 * @property {object}  [trust]
 * @property {object}  [extra]
 */

/**
 * Build the wab.json response.
 * @param {WabConfig} cfg
 * @returns {Response}
 */
export function buildWabResponse(cfg) {
  const doc = buildWabDoc(cfg);
  return new Response(JSON.stringify(doc, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*'
    }
  });
}

/**
 * @param {WabConfig} cfg
 * @returns {object}
 */
export function buildWabDoc(cfg) {
  const actions = Array.isArray(cfg.actions) && cfg.actions.length
    ? cfg.actions
    : [{ name: 'home', description: 'Open homepage', url: cfg.siteUrl }];
  return {
    version: '1.0',
    site: cfg.siteName,
    url: cfg.siteUrl,
    generated_at: new Date().toISOString(),
    generator: '@wab/edge',
    actions,
    trust: Object.assign({ signed: false, auto: true, source: 'edge-function' }, cfg.trust || {}),
    ...(cfg.extra || {})
  };
}

/**
 * Standard handler that matches /.well-known/wab.json and 404s everything else.
 * Intended for use in Vercel middleware or Netlify edge handler:
 *
 *   import { handleRequest } from '@wab/edge';
 *   export default (req) => handleRequest(req, { siteName: 'Acme', siteUrl: 'https://acme.com' });
 */
export function handleRequest(request, cfg) {
  const url = new URL(request.url);
  if (url.pathname === '/.well-known/wab.json') return buildWabResponse(cfg);
  if (url.pathname === '/.well-known/wab-discovery') {
    return new Response(JSON.stringify({
      ok: true,
      host: url.hostname,
      well_known: `${url.protocol}//${url.hostname}/.well-known/wab.json`,
      dns_txt: `_wab.${url.hostname}`,
      generator: '@wab/edge'
    }, null, 2), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  return null; // caller decides fallthrough
}
