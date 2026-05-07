/**
 * Adoption Agent — turns a bare URL into a ready-to-publish wab.json + DNS TXT.
 *
 * Heuristic-driven (no LLM required). Steps:
 *   1) Run sdk/auto-discovery.discover() to extract metadata.
 *   2) Inspect TLS fingerprint (best effort).
 *   3) Build a draft wab.json (unsigned) from observed signals.
 *   4) Build a draft DNS TXT record.
 *   5) Provide deploy snippets for Cloudflare Worker, Vercel, Netlify, Next.js.
 *
 * Pure server-side, used by /api/adopt and bin/wab-init.js (--auto-from).
 */

'use strict';

const { discover } = require('../../sdk/auto-discovery');
const tls = require('node:tls');

function _tlsFingerprint(host, timeoutMs = 6000) {
  return new Promise((resolve) => {
    const sock = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate(false);
      sock.end();
      const fp = (cert && cert.fingerprint256 || '').replace(/:/g, '').toLowerCase();
      resolve({ fp: fp || null, valid_to: cert && cert.valid_to });
    });
    sock.on('error', () => resolve({ fp: null }));
    sock.setTimeout(timeoutMs, () => { sock.destroy(); resolve({ fp: null }); });
  });
}

function _detectStackFromEnv(env) {
  const out = { type: 'static', signals: [] };
  if (env.meta && env.meta.og && env.meta.og.site_name) out.signals.push('opengraph');
  if (env.products && env.products.length) out.signals.push('schema.org/Product');
  if (env.sitemap && env.sitemap.length) out.signals.push('sitemap.xml');

  // Server header probing is too slow; rely on URL/sitemap heuristics.
  const allUrls = (env.sitemap || []).join(' ');
  if (/\?p=\d+|wp-content|wp-json/i.test(allUrls)) out.type = 'wordpress';
  else if (/\/_next\/|\/__next/.test(allUrls)) out.type = 'nextjs';
  else if (env.products && env.products.length > 5) out.type = 'ecommerce';
  return out;
}

function _suggestActions(env, baseUrl) {
  const out = [
    { name: 'home', description: 'Open homepage', url: baseUrl }
  ];
  if (env.actions && Array.isArray(env.actions)) {
    for (const a of env.actions) {
      if (out.find((x) => x.name === a.name)) continue;
      out.push(a);
    }
  }
  if (env.products && env.products.length) {
    out.push({ name: 'browseProducts', description: `${env.products.length} schema.org products discovered`, source: 'schema.org' });
  }
  if (env.sitemap && env.sitemap.length) {
    out.push({ name: 'browseSitemap', description: `${env.sitemap.length} URLs from sitemap.xml`, url: `${baseUrl}/sitemap.xml` });
  }
  if (env.meta && env.meta.og && env.meta.og.url) {
    out.push({ name: 'getOpenGraph', description: 'OpenGraph metadata available', source: 'opengraph' });
  }
  return out.slice(0, 12);
}

function _dnsTxt(host, baseUrl, fingerprint) {
  let v = `v=wab1; endpoint=${baseUrl}/.well-known/wab.json`;
  if (fingerprint) v += `; ssl_thumbprint=${fingerprint}`;
  return { name: `_wab.${host}`, type: 'TXT', value: v };
}

function _deploySnippets(host, baseUrl, doc) {
  const docInline = JSON.stringify(doc, null, 2);
  return {
    static: {
      title: 'Static / Apache / nginx',
      instructions: `Save the wab.json below to:\n  <docroot>/.well-known/wab.json\n\nMake sure it is publicly reachable at:\n  ${baseUrl}/.well-known/wab.json`
    },
    cloudflare_worker: {
      title: '@webagentbridge/cloudflare-worker',
      install: 'npm i -g wrangler && npm i @webagentbridge/cloudflare-worker',
      env: {
        WAB_SITE_NAME: doc.site,
        WAB_SITE_URL: baseUrl,
        WAB_ACTIONS_JSON: JSON.stringify(doc.actions || [])
      },
      command: 'wrangler deploy'
    },
    vercel: {
      title: '@webagentbridge/edge (Vercel Middleware)',
      install: 'npm i @webagentbridge/edge',
      file: 'middleware.ts',
      content: `import { handleRequest } from '@webagentbridge/edge';
export const config = { matcher: ['/.well-known/wab.json', '/.well-known/wab-discovery'] };
export default (req) => handleRequest(req, ${JSON.stringify({ siteName: doc.site, siteUrl: baseUrl, actions: doc.actions || [] }, null, 2)});`
    },
    netlify: {
      title: '@webagentbridge/edge (Netlify Edge Function)',
      install: 'npm i @webagentbridge/edge',
      file: 'netlify/edge-functions/wab.js',
      toml: `[[edge_functions]]\nfunction = "wab"\npath = "/.well-known/wab.json"\n\n[[edge_functions]]\nfunction = "wab"\npath = "/.well-known/wab-discovery"`,
      content: `import { handleRequest } from '@webagentbridge/edge';
export default (request, ctx) => handleRequest(request, {
  siteName: ${JSON.stringify(doc.site)},
  siteUrl: ${JSON.stringify(baseUrl)},
  actions: ${JSON.stringify(doc.actions || [])}
});`
    },
    nextjs: {
      title: '@webagentbridge/next',
      install: 'npm i @webagentbridge/next',
      file: 'next.config.js',
      content: `const { withWAB } = require('@webagentbridge/next');
module.exports = withWAB({}, {
  siteName: ${JSON.stringify(doc.site)},
  siteUrl: ${JSON.stringify(baseUrl)},
  actions: ${JSON.stringify(doc.actions || [], null, 2)},
});`
    },
    inline_wab_json: docInline
  };
}

/**
 * Suggest a complete adoption package for a URL.
 *
 * @param {string} siteUrl
 * @param {object} [opts]
 * @param {boolean} [opts.includeTls=true]
 * @returns {Promise<{ok:boolean, host:string, base_url:string, stack:object, wab_json:object, dns_txt:object, ssl?:object, deploy:object, env:object}>}
 */
async function suggest(siteUrl, opts = {}) {
  if (!siteUrl) return { ok: false, error: 'missing url' };
  if (!/^https?:\/\//i.test(siteUrl)) siteUrl = `https://${siteUrl}`;
  let host, baseUrl;
  try {
    const u = new URL(siteUrl);
    host = u.hostname;
    baseUrl = `${u.protocol}//${u.hostname}`;
  } catch {
    return { ok: false, error: 'invalid url' };
  }

  const env = await discover(baseUrl, { timeoutMs: opts.timeoutMs || 8000 });
  const stack = _detectStackFromEnv(env);
  const ssl = opts.includeTls === false ? null : await _tlsFingerprint(host);

  const doc = {
    version: '1.0',
    site: (env.site && env.site.name) || host,
    description: (env.site && env.site.description) || `${host} — generated by Adoption Agent`,
    url: baseUrl,
    project_type: stack.type,
    detected_signals: stack.signals,
    generated_at: new Date().toISOString(),
    generator: 'wab-adoption-agent',
    actions: _suggestActions(env, baseUrl),
    trust: { signed: false, note: 'Run scripts/sign-wab-domain.js to add an Ed25519 signature.' }
  };

  return {
    ok: true,
    host,
    base_url: baseUrl,
    stack,
    ssl: ssl && ssl.fp ? { fingerprint_sha256: ssl.fp, valid_to: ssl.valid_to } : null,
    wab_json: doc,
    dns_txt: _dnsTxt(host, baseUrl, ssl && ssl.fp),
    deploy: _deploySnippets(host, baseUrl, doc),
    env_summary: {
      source: env.source,
      action_count: doc.actions.length,
      sitemap_count: env.sitemap ? env.sitemap.length : 0,
      product_count: env.products ? env.products.length : 0,
      has_signed_wab: env.source === 'wab.json'
    }
  };
}

module.exports = { suggest };
