/**
 * @webagentbridge/cloudflare-worker
 *
 * Auto-injects /.well-known/wab.json on any site fronted by Cloudflare Workers.
 * Useful when you can't (or don't want to) deploy a static file to your origin.
 *
 * Usage (wrangler.toml):
 *   name = "wab-injector"
 *   main = "src/index.js"
 *   compatibility_date = "2024-09-01"
 *   [vars]
 *   WAB_SITE_NAME = "Acme"
 *   WAB_SITE_URL  = "https://acme.com"
 *   WAB_ACTIONS_JSON = "[]"   # optional JSON array
 *   WAB_FALLBACK_ORIGIN = "https://origin.acme.com"  # optional reverse-proxy origin
 *
 * Deploy with: `npx wrangler deploy`.
 *
 * The worker:
 *   • Serves /.well-known/wab.json from KV/env (stub if missing).
 *   • Optionally proxies all other paths to WAB_FALLBACK_ORIGIN unchanged.
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/.well-known/wab.json') {
      return serveWabJson(env, url);
    }
    if (url.pathname === '/.well-known/wab-discovery') {
      return serveDiscoveryEcho(env, url);
    }

    // Pass-through to origin if configured; otherwise 404.
    const origin = env.WAB_FALLBACK_ORIGIN;
    if (origin) {
      const target = new URL(url.pathname + url.search, origin);
      return fetch(new Request(target.toString(), request));
    }
    return new Response('Not found', { status: 404 });
  }
};

function serveWabJson(env, url) {
  // 1) KV-backed: if env.WAB_KV is bound, prefer the stored doc.
  // (Worker runtime exposes env.WAB_KV.get when bound in wrangler.toml)
  const stored = env.WAB_KV && env.WAB_KV.get
    ? env.WAB_KV.get('wab.json', 'json')
    : Promise.resolve(null);

  return Promise.resolve(stored).then((doc) => {
    if (doc) {
      return jsonResponse(doc, 300);
    }
    // 2) Stub from env vars.
    let actions = [];
    try { if (env.WAB_ACTIONS_JSON) actions = JSON.parse(env.WAB_ACTIONS_JSON); } catch {}
    const stub = {
      version: '1.0',
      site: env.WAB_SITE_NAME || url.hostname,
      url: env.WAB_SITE_URL || `${url.protocol}//${url.hostname}`,
      generated_at: new Date().toISOString(),
      generator: 'wab/cloudflare-worker',
      actions: actions.length ? actions : [
        { name: 'home', description: 'Open homepage', url: env.WAB_SITE_URL || `${url.protocol}//${url.hostname}` }
      ],
      trust: { signed: false, auto: true, source: 'cloudflare-worker' }
    };
    return jsonResponse(stub, 60);
  });
}

function serveDiscoveryEcho(env, url) {
  return jsonResponse({
    ok: true,
    host: url.hostname,
    well_known: `${url.protocol}//${url.hostname}/.well-known/wab.json`,
    dns_txt: `_wab.${url.hostname}`,
    note: 'Served by @webagentbridge/cloudflare-worker'
  }, 60);
}

function jsonResponse(obj, maxAge) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': `public, max-age=${maxAge}`,
      'access-control-allow-origin': '*'
    }
  });
}
