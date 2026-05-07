/**
 * WAB SDK — Auto-Discovery Fallback
 *
 * For sites that haven't installed WAB yet (no /.well-known/wab.json,
 * no _wab DNS TXT), this module produces a normalized capabilities envelope
 * by parsing publicly available metadata:
 *   1. /.well-known/wab.json   (canonical)
 *   2. <script type="application/ld+json">   (JSON-LD / Schema.org)
 *   3. <meta property="og:*">  (OpenGraph)
 *   4. <meta name="description"> / <title>
 *   5. /sitemap.xml            (URL inventory)
 *   6. /robots.txt             (allow/disallow + Sitemap directives)
 *
 * The resulting envelope shape mirrors a minimal wab.json so downstream
 * code can treat unsigned sites uniformly:
 *
 *   {
 *     ok: boolean,
 *     source: 'wab.json' | 'auto-discovery',
 *     site: { name, description, url },
 *     trust: { signed: false, ssl: { ... } },
 *     actions: [ { name, description, source } ],
 *     products: [ { name, sku, offers } ],
 *     sitemap: [ url, ... ],
 *     robots: { allow: [], disallow: [], sitemaps: [] }
 *   }
 *
 * Pure JS, no external deps. Works in Node (with global fetch).
 */

const { extractJsonLdBlocks, extractProductsFromHtml, suggestWabActionsFromProducts } =
  require('./schema-discovery');

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

function _abs(base, path) {
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

async function _fetchText(url, { timeoutMs = 8000 } = {}) {
  if (typeof fetch !== 'function') {
    throw new Error('global fetch() is required (Node 18+) for auto-discovery');
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'user-agent': 'wab-auto-discovery/1.0 (+https://webagentbridge.com)' }
    });
    if (!r.ok) return { ok: false, status: r.status, text: '' };
    return { ok: true, status: r.status, text: await r.text() };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: e.message };
  } finally {
    clearTimeout(t);
  }
}

/* ------------------------------------------------------------------ */
/* HTML metadata extractors                                            */
/* ------------------------------------------------------------------ */

function extractMetaTags(html) {
  const out = { og: {}, twitter: {}, description: null, title: null };
  if (!html) return out;

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleM) out.title = titleM[1].trim();

  const metaRe = /<meta\b[^>]*>/gi;
  let m;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const nameM = tag.match(/\bname\s*=\s*["']([^"']+)["']/i);
    const propM = tag.match(/\bproperty\s*=\s*["']([^"']+)["']/i);
    const contentM = tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i);
    if (!contentM) continue;
    const content = contentM[1];
    const key = (propM && propM[1]) || (nameM && nameM[1]) || '';
    if (!key) continue;
    const lk = key.toLowerCase();
    if (lk === 'description') out.description = content;
    else if (lk.startsWith('og:')) out.og[lk.slice(3)] = content;
    else if (lk.startsWith('twitter:')) out.twitter[lk.slice(8)] = content;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sitemap / robots                                                   */
/* ------------------------------------------------------------------ */

function parseSitemap(xml, { limit = 200 } = {}) {
  if (!xml) return [];
  const urls = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && urls.length < limit) {
    urls.push(m[1]);
  }
  return urls;
}

function parseRobots(text) {
  const out = { allow: [], disallow: [], sitemaps: [], userAgents: [] };
  if (!text) return out;
  let currentUA = '*';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      currentUA = val;
      if (!out.userAgents.includes(val)) out.userAgents.push(val);
    } else if (key === 'allow') out.allow.push({ ua: currentUA, path: val });
    else if (key === 'disallow') out.disallow.push({ ua: currentUA, path: val });
    else if (key === 'sitemap') out.sitemaps.push(val);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* JSON-LD extras: WebSite + Organization + SearchAction               */
/* ------------------------------------------------------------------ */

function extractSiteIdentity(html) {
  const blocks = extractJsonLdBlocks(html);
  const out = { name: null, description: null, url: null, search: null, organization: null };
  for (const text of blocks) {
    let data;
    try { data = JSON.parse(text); } catch { continue; }
    const items = Array.isArray(data) ? data : Array.isArray(data['@graph']) ? data['@graph'] : [data];
    for (const node of items) {
      if (!node || typeof node !== 'object') continue;
      let types = node['@type'];
      if (typeof types === 'string') types = [types];
      if (!Array.isArray(types)) types = [];
      if (types.includes('WebSite')) {
        out.name = out.name || node.name;
        out.url = out.url || node.url;
        out.description = out.description || node.description;
        const action = node.potentialAction;
        if (action && (Array.isArray(action) ? action[0] : action)) {
          const a = Array.isArray(action) ? action[0] : action;
          if (a && (a['@type'] === 'SearchAction' || /SearchAction/.test(String(a['@type'])))) {
            out.search = {
              target: typeof a.target === 'string' ? a.target : (a.target && a.target.urlTemplate),
              queryParam: a['query-input'] || a.queryInput || null
            };
          }
        }
      } else if (types.includes('Organization')) {
        out.organization = out.organization || { name: node.name, url: node.url, logo: node.logo };
      }
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Main entry                                                         */
/* ------------------------------------------------------------------ */

/**
 * Discover capabilities for a site. Tries /.well-known/wab.json first;
 * falls back to HTML/sitemap/robots scraping.
 *
 * @param {string} siteUrl  e.g. "https://example.com"
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=8000]
 * @param {number} [opts.sitemapLimit=200]
 * @param {boolean} [opts.skipWabJson=false]
 * @returns {Promise<object>} normalized envelope
 */
async function discover(siteUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const sitemapLimit = opts.sitemapLimit || 200;

  let baseUrl;
  try { baseUrl = new URL(siteUrl).origin; }
  catch { return { ok: false, error: 'invalid_url', source: 'auto-discovery' }; }

  // 1) Canonical wab.json — if present, use as authoritative source.
  if (!opts.skipWabJson) {
    const wabUrl = _abs(baseUrl, '/.well-known/wab.json');
    const wabRes = await _fetchText(wabUrl, { timeoutMs });
    if (wabRes.ok && wabRes.text) {
      try {
        const parsed = JSON.parse(wabRes.text);
        return {
          ok: true,
          source: 'wab.json',
          site: { name: parsed.site || parsed.name, description: parsed.description, url: baseUrl },
          trust: { signed: !!parsed.sig, ...(parsed.trust || {}) },
          actions: Array.isArray(parsed.actions) ? parsed.actions : [],
          products: [],
          sitemap: [],
          robots: null,
          raw: parsed
        };
      } catch { /* fall through to auto-discovery */ }
    }
  }

  // 2) Fetch homepage HTML in parallel with sitemap + robots.
  const [homeRes, sitemapRes, robotsRes] = await Promise.all([
    _fetchText(baseUrl, { timeoutMs }),
    _fetchText(_abs(baseUrl, '/sitemap.xml'), { timeoutMs }),
    _fetchText(_abs(baseUrl, '/robots.txt'), { timeoutMs })
  ]);

  const html = homeRes.text || '';
  const meta = extractMetaTags(html);
  const ident = extractSiteIdentity(html);
  const products = extractProductsFromHtml(html);
  const robots = parseRobots(robotsRes.text || '');
  let sitemap = parseSitemap(sitemapRes.text || '', { limit: sitemapLimit });

  // Discover additional sitemaps from robots.
  if (sitemap.length === 0 && robots.sitemaps.length) {
    for (const sm of robots.sitemaps.slice(0, 3)) {
      const r = await _fetchText(sm, { timeoutMs });
      if (r.ok) sitemap = sitemap.concat(parseSitemap(r.text, { limit: sitemapLimit }));
      if (sitemap.length >= sitemapLimit) break;
    }
  }

  // Build action hints.
  const actions = suggestWabActionsFromProducts(products);
  if (ident.search && ident.search.target) {
    actions.push({
      name: 'searchSite',
      description: 'Schema.org SearchAction: ' + ident.search.target,
      source: 'schema.org/SearchAction',
      template: ident.search.target
    });
  }
  if (sitemap.length) {
    actions.push({
      name: 'browseSitemap',
      description: `${sitemap.length} URLs discovered from sitemap.xml`,
      source: 'sitemap.xml'
    });
  }
  if (meta.og && meta.og.url) {
    actions.push({
      name: 'getOpenGraph',
      description: 'OpenGraph metadata available',
      source: 'opengraph'
    });
  }

  return {
    ok: true,
    source: 'auto-discovery',
    site: {
      name: ident.name || meta.og.site_name || meta.title || baseUrl,
      description: ident.description || meta.description || meta.og.description || null,
      url: ident.url || meta.og.url || baseUrl
    },
    trust: { signed: false, auto: true },
    actions,
    products,
    sitemap,
    robots,
    meta: { og: meta.og, twitter: meta.twitter, title: meta.title, description: meta.description },
    organization: ident.organization || null
  };
}

module.exports = {
  discover,
  extractMetaTags,
  parseSitemap,
  parseRobots,
  extractSiteIdentity
};
