/**
 * Visitor tracking — records every public HTML page hit into `page_visits`.
 * Anonymous-friendly: IPs are hashed (sha256 + IP_HASH_SALT) so we never store raw IPs.
 *
 * Exposes:
 *   - middleware()                — Express middleware to mount before express.static
 *   - getVisitorAnalytics(days)   — totals + timeline + breakdowns for /api/admin/analytics/visits
 *   - getRecentVisits(limit)      — latest individual page hits for the admin live feed
 *   - getQuickCounts()            — visits_24h / visitors_24h / visits_30d for /api/admin/stats
 */

const crypto = require('crypto');
const { db } = require('../models/db');

const IP_SALT = process.env.IP_HASH_SALT || process.env.JWT_SECRET || 'wab-visitor-salt-v1';

// ── Bot detection ────────────────────────────────────────────────────
const BOT_RE = /(bot|crawler|spider|crawl|slurp|bingpreview|facebookexternalhit|preview|monitor|uptime|curl|wget|axios|node-fetch|python-requests|java\/|ahrefs|semrush|petalbot|yandex|baiduspider|duckduckbot|googlebot|applebot|gpt|claude|anthropic|openai|perplexity)/i;

// ── Path filter ──────────────────────────────────────────────────────
// We track real page requests, not asset/API noise.
const SKIP_PREFIX = ['/api/', '/css/', '/js/', '/assets/', '/script/', '/v3/', '/v2/', '/v1/', '/latest/', '/.well-known/', '/admin/', '/socket.io', '/favicon', '/sitemap', '/robots.txt', '/feed.xml', '/downloads/'];
const SKIP_EXT = /\.(?:js|mjs|css|map|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|eot|mp4|webm|mp3|pdf|xml|txt|wasm)$/i;

function shouldTrack(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = req.path || '/';
  if (SKIP_EXT.test(p)) return false;
  for (const pre of SKIP_PREFIX) if (p.startsWith(pre)) return false;
  return true;
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(IP_SALT + ':' + ip).digest('hex').slice(0, 32);
}

function detectDevice(ua) {
  if (!ua) return 'unknown';
  if (BOT_RE.test(ua)) return 'bot';
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet';
  if (/Mobi|Android|iPhone|iPod|Opera Mini|IEMobile/i.test(ua)) return 'mobile';
  return 'desktop';
}

function extractUserId(req) {
  // Best-effort: req.user (set by upstream auth middleware) wins; otherwise null.
  if (req.user && req.user.id) return String(req.user.id);
  if (req.session && req.session.userId) return String(req.session.userId);
  return null;
}

// Lazily prepared so the require() of this module can run before migrations
// have created the page_visits table (e.g. in tests or during cold boot).
let _insertVisit = null;
function getInsertStmt() {
  if (_insertVisit) return _insertVisit;
  _insertVisit = db.prepare(`
    INSERT INTO page_visits
      (path, query_string, referrer, host, user_agent, ip_hash, country, device, is_bot, session_id, user_id, status_code, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  return _insertVisit;
}

function middleware() {
  return function visitTracker(req, res, next) {
    if (!shouldTrack(req)) return next();
    const start = Date.now();
    res.on('finish', () => {
      try {
        const ua      = req.get('user-agent') || null;
        const ref     = req.get('referer') || req.get('referrer') || null;
        const ipHash  = hashIp(req.ip);
        const device  = detectDevice(ua);
        const isBot   = device === 'bot' ? 1 : 0;
        const country = req.get('cf-ipcountry') || req.get('x-vercel-ip-country') || null;
        const session = ipHash && ua
          ? crypto.createHash('sha256').update(ipHash + ':' + ua).digest('hex').slice(0, 24)
          : null;
        const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1, req.url.indexOf('?') + 257) : null;
        getInsertStmt().run(
          req.path.slice(0, 512),
          qs,
          ref ? ref.slice(0, 512) : null,
          (req.get('host') || '').slice(0, 255),
          ua ? ua.slice(0, 512) : null,
          ipHash,
          country ? country.slice(0, 4) : null,
          device,
          isBot,
          session,
          extractUserId(req),
          res.statusCode,
          Date.now() - start
        );
      } catch (e) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[visit-tracker] insert failed:', e.message);
        }
      }
    });
    next();
  };
}

// ── Read queries ────────────────────────────────────────────────────
function getVisitorAnalytics(days) {
  const n = Math.max(1, Math.min(365, parseInt(days, 10) || 30));
  const since = new Date(Date.now() - n * 86400000).toISOString();

  const totalsRow = db.prepare(`
    SELECT
      COUNT(*) AS pageviews,
      COUNT(DISTINCT session_id) AS visitors,
      COALESCE(SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END), 0) AS bot_hits,
      COALESCE(SUM(CASE WHEN user_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS authenticated_hits,
      COUNT(DISTINCT user_id) AS authenticated_users
    FROM page_visits WHERE created_at >= ?
  `).get(since);

  const last24Row = db.prepare(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS visitors
    FROM page_visits WHERE created_at >= datetime('now','-1 day')
  `).get();

  const todayRow = db.prepare(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS visitors
    FROM page_visits WHERE date(created_at) = date('now')
  `).get();

  const timeline = db.prepare(`
    SELECT date(created_at) AS day,
           COUNT(*) AS pageviews,
           COUNT(DISTINCT session_id) AS visitors,
           SUM(CASE WHEN is_bot=1 THEN 1 ELSE 0 END) AS bots
    FROM page_visits WHERE created_at >= ?
    GROUP BY day ORDER BY day
  `).all(since);

  const topPaths = db.prepare(`
    SELECT path, COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS visitors
    FROM page_visits WHERE created_at >= ? AND is_bot = 0
    GROUP BY path ORDER BY pageviews DESC LIMIT 25
  `).all(since);

  const topReferrers = db.prepare(`
    SELECT
      COALESCE(NULLIF(substr(referrer, 1, instr(substr(referrer, 9), '/') + 7), ''), 'Direct') AS source,
      COUNT(*) AS hits
    FROM page_visits WHERE created_at >= ? AND is_bot = 0
    GROUP BY source ORDER BY hits DESC LIMIT 15
  `).all(since);

  const devices = db.prepare(`
    SELECT device, COUNT(*) AS hits
    FROM page_visits WHERE created_at >= ?
    GROUP BY device ORDER BY hits DESC
  `).all(since);

  const countries = db.prepare(`
    SELECT COALESCE(country, 'Unknown') AS country, COUNT(*) AS hits
    FROM page_visits WHERE created_at >= ? AND is_bot = 0
    GROUP BY country ORDER BY hits DESC LIMIT 20
  `).all(since);

  const topBots = db.prepare(`
    SELECT
      CASE
        WHEN user_agent LIKE '%Googlebot%' THEN 'Googlebot'
        WHEN user_agent LIKE '%bingbot%' OR user_agent LIKE '%Bingbot%' THEN 'Bingbot'
        WHEN user_agent LIKE '%DuckDuckBot%' THEN 'DuckDuckBot'
        WHEN user_agent LIKE '%AhrefsBot%' THEN 'AhrefsBot'
        WHEN user_agent LIKE '%SemrushBot%' THEN 'SemrushBot'
        WHEN user_agent LIKE '%YandexBot%' THEN 'YandexBot'
        WHEN user_agent LIKE '%Baiduspider%' THEN 'Baiduspider'
        WHEN user_agent LIKE '%facebookexternalhit%' THEN 'Facebook'
        WHEN user_agent LIKE '%GPTBot%' OR user_agent LIKE '%ChatGPT%' THEN 'GPTBot'
        WHEN user_agent LIKE '%anthropic%' OR user_agent LIKE '%Claude%' THEN 'Claude / Anthropic'
        WHEN user_agent LIKE '%PerplexityBot%' THEN 'Perplexity'
        WHEN user_agent LIKE '%Applebot%' THEN 'Applebot'
        ELSE 'Other bot'
      END AS bot,
      COUNT(*) AS hits
    FROM page_visits WHERE created_at >= ? AND is_bot = 1
    GROUP BY bot ORDER BY hits DESC LIMIT 15
  `).all(since);

  const signups = db.prepare(`
    SELECT date(created_at) AS day, COUNT(*) AS count
    FROM users WHERE created_at >= ? GROUP BY day ORDER BY day
  `).all(since);

  return {
    period_days: n,
    totals: {
      pageviews: totalsRow.pageviews || 0,
      visitors:  totalsRow.visitors  || 0,
      bot_hits:  totalsRow.bot_hits  || 0,
      human_hits: (totalsRow.pageviews || 0) - (totalsRow.bot_hits || 0),
      authenticated_hits: totalsRow.authenticated_hits || 0,
      authenticated_users: totalsRow.authenticated_users || 0,
      pageviews_24h: last24Row.pageviews || 0,
      visitors_24h:  last24Row.visitors  || 0,
      pageviews_today: todayRow.pageviews || 0,
      visitors_today:  todayRow.visitors  || 0,
    },
    timeline,
    topPaths,
    topReferrers,
    devices,
    countries,
    topBots,
    signups,
  };
}

function getRecentVisits(limit) {
  const n = Math.max(1, Math.min(500, parseInt(limit, 10) || 50));
  return db.prepare(`
    SELECT id, path, referrer, host, user_agent, country, device, is_bot, session_id, user_id, status_code, duration_ms, created_at
    FROM page_visits ORDER BY id DESC LIMIT ?
  `).all(n);
}

function getQuickCounts() {
  const row24 = db.prepare(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS visitors
    FROM page_visits WHERE created_at >= datetime('now','-1 day')
  `).get();
  const row30 = db.prepare(`
    SELECT COUNT(*) AS pageviews, COUNT(DISTINCT session_id) AS visitors
    FROM page_visits WHERE created_at >= datetime('now','-30 days')
  `).get();
  const total = db.prepare(`SELECT COUNT(*) AS c FROM page_visits`).get();
  return {
    pageviews_24h: row24.pageviews || 0,
    visitors_24h:  row24.visitors  || 0,
    pageviews_30d: row30.pageviews || 0,
    visitors_30d:  row30.visitors  || 0,
    pageviews_total: total.c || 0,
  };
}

module.exports = {
  middleware,
  getVisitorAnalytics,
  getRecentVisits,
  getQuickCounts,
};
