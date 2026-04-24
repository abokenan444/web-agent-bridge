/**
 * Web Agent Bridge — Cloudflare Worker
 *
 * Deploys WAB as a Cloudflare Edge Worker that proxies requests to your
 * WAB server and adds WAB discovery headers to all responses.
 *
 * LICENSE: MIT (Open Source)
 * Deploy: https://deploy.workers.cloudflare.com/?url=https://github.com/abokenan444/web-agent-bridge
 *
 * Environment Variables (set in Cloudflare Dashboard → Workers → Settings → Variables):
 *   WAB_SERVER_URL   — Your WAB server URL (e.g. https://wab.yourdomain.com)
 *   WAB_API_KEY      — Your WAB site API key (from WAB dashboard)
 *   WAB_SITE_ID      — Your WAB site ID (from WAB dashboard)
 *   ORIGIN_URL       — Your origin website URL (e.g. https://yourdomain.com)
 *   ALLOWED_AGENTS   — Comma-separated allowed AI agent user-agents (optional, default: all)
 *   RATE_LIMIT_RPM   — Requests per minute per IP (optional, default: 60)
 */

// ── Constants ─────────────────────────────────────────────────────────────────
const WAB_PROTOCOL_VERSION = '1.0';
const WAB_VERSION = '3.2.0';
const CACHE_TTL = 300; // 5 minutes for discovery document

// ── Rate limiting using Cloudflare KV (if available) ─────────────────────────
async function checkRateLimit(env, ip, limitRpm) {
  if (!env.WAB_RATE_LIMIT_KV) return true; // KV not configured, allow all
  const key = `rl:${ip}`;
  const now = Math.floor(Date.now() / 1000);
  const windowKey = `${key}:${Math.floor(now / 60)}`;
  const current = parseInt(await env.WAB_RATE_LIMIT_KV.get(windowKey) || '0');
  if (current >= limitRpm) return false;
  await env.WAB_RATE_LIMIT_KV.put(windowKey, String(current + 1), { expirationTtl: 120 });
  return true;
}

// ── Build WAB discovery document ──────────────────────────────────────────────
function buildDiscoveryDocument(env, request) {
  const originUrl = env.ORIGIN_URL || `https://${new URL(request.url).hostname}`;
  const wabServerUrl = env.WAB_SERVER_URL || '';
  const siteId = env.WAB_SITE_ID || '';

  return {
    wab_version: WAB_VERSION,
    protocol_version: WAB_PROTOCOL_VERSION,
    site_id: siteId,
    site_url: originUrl,
    endpoint: wabServerUrl ? `${wabServerUrl}/api/wab` : `${originUrl}/api/wab`,
    transport: ['http', 'websocket'],
    commands: {
      authenticate: { method: 'POST', path: '/authenticate', auth_required: false },
      search: { method: 'POST', path: '/execute', auth_required: true },
      navigate: { method: 'POST', path: '/execute', auth_required: true },
      read_page: { method: 'POST', path: '/execute', auth_required: true },
      fill_form: { method: 'POST', path: '/execute', auth_required: true },
      click: { method: 'POST', path: '/execute', auth_required: true },
      extract: { method: 'POST', path: '/execute', auth_required: true },
      login: { method: 'POST', path: '/execute', auth_required: true },
      checkout: { method: 'POST', path: '/execute', auth_required: true }
    },
    agent_permissions: {
      read: true,
      search: true,
      navigate: true,
      fill_form: false,
      checkout: false,
      login: false
    },
    rate_limits: {
      requests_per_minute: 60,
      requests_per_day: 5000
    },
    generated_at: new Date().toISOString(),
    powered_by: 'web-agent-bridge',
    edge_worker: true
  };
}

// ── Handle WAB API proxy ───────────────────────────────────────────────────────
async function handleWabApiProxy(request, env) {
  const wabServerUrl = env.WAB_SERVER_URL;
  if (!wabServerUrl) {
    return new Response(JSON.stringify({
      type: 'error',
      error: { code: 'not_configured', message: 'WAB_SERVER_URL environment variable not set' }
    }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(request.url);
  const targetUrl = `${wabServerUrl}${url.pathname}${url.search}`;

  // Clone request with modified headers
  const proxyRequest = new Request(targetUrl, {
    method: request.method,
    headers: new Headers(request.headers),
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    redirect: 'follow'
  });

  // Add forwarding headers
  proxyRequest.headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') || '');
  proxyRequest.headers.set('X-Forwarded-Proto', 'https');
  proxyRequest.headers.set('X-WAB-Edge-Worker', 'true');
  proxyRequest.headers.set('X-WAB-Worker-Version', WAB_VERSION);

  try {
    const response = await fetch(proxyRequest);
    const newResponse = new Response(response.body, response);
    newResponse.headers.set('X-WAB-Edge', 'cloudflare');
    return newResponse;
  } catch (err) {
    return new Response(JSON.stringify({
      type: 'error',
      error: { code: 'upstream_error', message: 'Failed to reach WAB server', detail: err.message }
    }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// ── Add WAB headers to origin response ────────────────────────────────────────
function addWabHeaders(response, env, request) {
  const newResponse = new Response(response.body, response);
  const originUrl = env.ORIGIN_URL || `https://${new URL(request.url).hostname}`;
  const wabServerUrl = env.WAB_SERVER_URL || originUrl;

  newResponse.headers.set('X-WAB-Enabled', 'true');
  newResponse.headers.set('X-WAB-Version', WAB_VERSION);
  newResponse.headers.set('X-WAB-Discovery', `${originUrl}/.well-known/wab.json`);
  newResponse.headers.set('X-WAB-Endpoint', `${wabServerUrl}/api/wab`);

  return newResponse;
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || '0.0.0.0';
    const rateLimitRpm = parseInt(env.RATE_LIMIT_RPM || '60');

    // ── CORS preflight ────────────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-WAB-Site-ID',
          'Access-Control-Max-Age': '86400'
        }
      });
    }

    // ── WAB Discovery endpoint ────────────────────────────────────────────────
    if (url.pathname === '/.well-known/wab.json') {
      // Try cache first
      const cacheKey = new Request(`${url.origin}/.well-known/wab.json`);
      const cache = caches.default;
      let cachedResponse = await cache.match(cacheKey);
      if (cachedResponse) return cachedResponse;

      const discovery = buildDiscoveryDocument(env, request);
      const response = new Response(JSON.stringify(discovery, null, 2), {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': `public, max-age=${CACHE_TTL}`,
          'X-WAB-Edge': 'cloudflare'
        }
      });

      // Cache for 5 minutes
      ctx.waitUntil(cache.put(cacheKey, response.clone()));
      return response;
    }

    // ── WAB API proxy ─────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/wab')) {
      // Rate limiting
      const allowed = await checkRateLimit(env, ip, rateLimitRpm);
      if (!allowed) {
        return new Response(JSON.stringify({
          type: 'error',
          error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' }
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'Retry-After': '60'
          }
        });
      }

      return handleWabApiProxy(request, env);
    }

    // ── WAB ping ──────────────────────────────────────────────────────────────
    if (url.pathname === '/wab/ping') {
      return new Response(JSON.stringify({
        status: 'ok',
        version: WAB_VERSION,
        edge: 'cloudflare',
        timestamp: new Date().toISOString()
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── Pass through to origin with WAB headers ───────────────────────────────
    const originUrl = env.ORIGIN_URL;
    if (!originUrl) {
      // No origin configured — return 404 for unknown paths
      return new Response('WAB Worker: Set ORIGIN_URL to proxy to your website.', { status: 404 });
    }

    const targetUrl = `${originUrl}${url.pathname}${url.search}`;
    try {
      const originResponse = await fetch(new Request(targetUrl, request));
      return addWabHeaders(originResponse, env, request);
    } catch (err) {
      return new Response(`Origin unreachable: ${err.message}`, { status: 502 });
    }
  }
};
