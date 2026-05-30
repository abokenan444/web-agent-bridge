require('dotenv').config();

const { assertSecretsAtStartup } = require('./config/secrets');
assertSecretsAtStartup();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { setupWebSocket } = require('./ws');
const { runMigrations } = require('./utils/migrate');
const { maybeBootstrapAdmin, db } = require('./models/db');
const { initSearchEngine, search, getSuggestions, getTrendingSearches, getSearchStats, purgeOldCache } = require('./services/search-engine');
const { processMessage: agentChat } = require('./services/agent-chat');
const agentTasks = require('./services/agent-tasks');
const { cluster } = require('./services/cluster');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const geniusGateway = require('./routes/genius-gateway');
const sovereignRoutes = require('./routes/sovereign');
const meshRoutes = require('./routes/mesh');
const commanderRoutes = require('./routes/commander');
const adsRoutes = require('./routes/ads');
const wabApiRoutes = require('./routes/wab-api');
const noscriptRoutes = require('./routes/noscript');
const discoveryRoutes = require('./routes/discovery');
const providerRoutes = require('./routes/providers');
const governanceRoutes = require('./routes/governance');
const premiumRoutes = require('./routes/premium');
const adminPremiumRoutes = require('./routes/admin-premium');
const workspaceRoutes = require('./routes/agent-workspace');
const universalRoutes = require('./routes/universal');
const runtimeRoutes = require('./routes/runtime');
const demoShowcaseRoutes = require('./routes/demo-showcase');
const demoStoreRoutes = require('./routes/demo-store');
const gatewayRoutes = require('./routes/gateway');
let growthRoutes;
try { growthRoutes = require('./routes/growth'); } catch { growthRoutes = require('express').Router(); }
const { handleWebhookRequest } = require('./services/stripe');
const { runtime } = require('./runtime');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const corsOrigins = (process.env.ALLOWED_ORIGINS
  || 'http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (corsOrigins.includes(origin)) return callback(null, true);
      if (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true
  })
);

const scriptSrc = process.env.CSP_ALLOW_UNSAFE_INLINE === 'false'
  ? ["'self'", 'https://unpkg.com', 'https://cdn.jsdelivr.net']
  : ["'self'", "'unsafe-inline'", 'https://unpkg.com', 'https://cdn.jsdelivr.net'];
const styleSrc = process.env.CSP_ALLOW_UNSAFE_INLINE === 'false'
  ? ["'self'"]
  : ["'self'", "'unsafe-inline'"];

// Per-request CSP nonce — exposed as res.locals.cspNonce for new pages opting into strict CSP.
app.use((req, res, next) => {
  res.locals.cspNonce = require('crypto').randomBytes(16).toString('base64');
  next();
});

// CSP — tightened: HTTPS-only iframes, upgrade-insecure-requests, report endpoint.
const cspReportUri = '/api/security/csp-report';
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // NOTE: Adding a nonce alongside 'unsafe-inline' makes browsers ignore
        // 'unsafe-inline' (CSP3 spec). All existing public/admin pages still
        // rely on inline <script> blocks, so we keep 'unsafe-inline' enforced
        // here and use the Report-Only policy below to track nonce migration.
        scriptSrc: scriptSrc,
        scriptSrcAttr: [...scriptSrc, "'unsafe-hashes'"],
        styleSrc: [...styleSrc, 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https:', 'ws:', 'wss:'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https:', 'data:'],
        frameSrc: ["'self'", 'https:'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
        reportUri: [cspReportUri]
      }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
);

// Companion strict Report-Only CSP — surfaces every inline-script violation
// without breaking existing pages, so we can migrate page-by-page to nonces.
app.use((req, res, next) => {
  const nonce = res.locals.cspNonce;
  const strict = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "connect-src 'self' https: wss:",
    "font-src 'self' https://fonts.gstatic.com data:",
    "frame-src 'self' https:",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
    `report-uri ${cspReportUri}`
  ].join('; ');
  res.setHeader('Content-Security-Policy-Report-Only', strict);
  next();
});

// CSP violation report sink (capped, in-memory ring buffer + console).
const _cspReports = [];
app.post('/api/security/csp-report', express.json({ type: ['application/csp-report', 'application/json'], limit: '32kb' }), (req, res) => {
  const report = req.body && (req.body['csp-report'] || req.body);
  if (report) {
    _cspReports.push({ at: new Date().toISOString(), ip: req.ip, report });
    if (_cspReports.length > 500) _cspReports.shift();
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[CSP]', report['violated-directive'] || report.violatedDirective, '→', report['blocked-uri'] || report.blockedURI);
    }
  }
  res.status(204).end();
});
app.get('/api/security/csp-report/recent', (req, res) => {
  res.json({ count: _cspReports.length, reports: _cspReports.slice(-50) });
});

// ── Reward-guard + cross-site redactor admin views (token-gated) ──
function _adminAuth(req, res, next) {
  const want = process.env.WAB_ADMIN_TOKEN;
  if (!want) return res.status(503).json({ error: 'WAB_ADMIN_TOKEN not configured' });
  const got = req.headers['x-wab-admin-token'] || req.query.token;
  if (got !== want) return res.status(401).json({ error: 'admin token required' });
  next();
}
app.get('/api/security/reward-audit/recent', _adminAuth, (req, res) => {
  try {
    const guard = require('./security/reward-guard');
    res.json({ stats: guard.getStats(), recent: guard.getRecentAudits(50, req.query.decision || null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/security/cross-site-transfers/recent', _adminAuth, (req, res) => {
  try {
    const r = require('./security/cross-site-redactor');
    res.json({ recent: r.getRecentTransfers(50, req.query.from || null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});
app.get('/api/security/url-policy/recent', _adminAuth, (req, res) => {
  try {
    const p = require('./security/url-policy');
    res.json({ recent: p.getRecentAudits(50, req.query.decision || null) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await handleWebhookRequest(req);
    res.json({ received: true });
  } catch (err) {
    console.error('Webhook error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.use(express.json());

// Global JSON parse error handler (catches malformed JSON from bots/scanners)
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ error: 'Invalid JSON', details: err.message });
  }
  next(err);
});

// Global error handler — catches all unhandled route errors
// global-error-handler
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  if (status >= 500) {
    console.error('[server] Unhandled error:', err.message, err.stack?.split('\n')[1] || '');
  }
  if (!res.headersSent) {
    res.status(status).json({ error: message });
  }
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const licenseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const key = req.body?.licenseKey || req.body?.siteId || req.ip;
    return `${req.ip}:${key}`;
  }
});

// Visitor analytics — record every public page hit (HTML routes only) before
// they're served by express.static. Skips assets, /api, /admin and other noise.
try {
  const visitorTracker = require('./services/visitor-tracker');
  app.use(visitorTracker.middleware());
} catch (e) {
  console.warn('[wab] visitor-tracker disabled:', e.message);
}

// Whitepaper guard — must run BEFORE express.static so we can apply strict headers
// and intercept both /whitepaper and /whitepaper.html with the same protections.
const whitepaperHandler = (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('X-Robots-Tag', 'index, follow, noarchive, nosnippet, noimageindex');
  res.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.set('X-Copyright', 'All Rights Reserved (c) 2026 Web Agent Bridge - Reproduction Prohibited');
  res.sendFile(path.join(__dirname, '..', 'public', 'whitepaper.html'));
};
app.get(['/whitepaper', '/whitepaper.html'], whitepaperHandler);

// WAB Trust artifact (signed Ed25519 wab.json) — served explicitly because
// express.static skips dotfile directories like /.well-known by default.
// We compose: signed trust payload (untouched, from disk) + a top-level
// `actions` map so structural-agent platforms (e.g. The Code Genius) can
// discover and execute the public API surface without DOM scraping.
const WAB_ACTIONS_MANIFEST = {
  v:           '1.0',
  name:        'Web Agent Bridge',
  description: 'Structural API surface for agents — registry discovery, trust verification, reputation queries, and ShieldQR scanning.',
  endpoint:    'https://webagentbridge.com',
  actions: {
    discover_sites: {
      id:          'discover_sites',
      description: 'Search the WAB registry for sites by intent tag, ring, or domain pattern.',
      url:         '/api/registry/discover',
      method:      'GET',
      inputs: {
        intent: { type: 'string', required: false, description: 'Intent tag to filter by (e.g. "shop", "news")' },
        ring:   { type: 'number', required: false, description: 'Minimum trust ring (0–4)' },
        limit:  { type: 'number', required: false, description: 'Max results (default 20)' },
      },
    },
    list_sites: {
      id:          'list_sites',
      description: 'List all active WAB-enabled sites in the public registry.',
      url:         '/api/registry/list',
      method:      'GET',
      inputs: {
        limit:  { type: 'number', required: false, description: 'Page size (default 50)' },
        offset: { type: 'number', required: false, description: 'Page offset' },
      },
    },
    get_registry_stats: {
      id:          'get_registry_stats',
      description: 'Get aggregated stats about the WAB network (total sites, rings distribution, top intents).',
      url:         '/api/registry/stats',
      method:      'GET',
    },
    suggest_peers: {
      id:          'suggest_peers',
      description: 'Get peer-site suggestions for cross-discovery (gossip protocol).',
      url:         '/api/registry/suggest',
      method:      'GET',
      inputs: {
        domain: { type: 'string', required: false, description: 'Seed domain for similarity search' },
      },
    },
    list_plans: {
      id:          'list_plans',
      description: 'List all available WAB subscription plans with prices and features.',
      url:         '/api/plans',
      method:      'GET',
    },
    get_plan: {
      id:          'get_plan',
      description: 'Fetch a specific plan by ID.',
      url:         '/api/plans/:id',
      method:      'GET',
      inputs: {
        id: { type: 'string', required: true, description: 'Plan ID' },
      },
    },
    scan_qr: {
      id:          'scan_qr',
      description: 'Verify a ShieldQR code — returns trust ring, issuer, and risk score for the encoded URL.',
      url:         '/api/shieldqr/scan',
      method:      'POST',
      inputs: {
        url: { type: 'string', required: true, description: 'URL decoded from the QR' },
      },
    },
    recent_scans: {
      id:          'recent_scans',
      description: 'Get the most recent public ShieldQR scan reports.',
      url:         '/api/shieldqr/recent',
      method:      'GET',
    },
  },
  privacy: {
    allowed:    ['registry queries', 'public trust metadata', 'plan listings'],
    disallowed: ['admin endpoints', 'billing webhooks', 'individual user data'],
  },
};

let _trustPayloadCache = null;
function loadTrustPayload() {
  if (_trustPayloadCache) return _trustPayloadCache;
  try {
    const raw = require('fs').readFileSync(
      path.join(__dirname, '..', 'public', '.well-known', 'wab.json'), 'utf8');
    _trustPayloadCache = JSON.parse(raw);
  } catch { _trustPayloadCache = {}; }
  return _trustPayloadCache;
}

app.get('/.well-known/wab.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/json');
  // Merge signed trust artifact (untouched) with action manifest
  res.json({ ...loadTrustPayload(), ...WAB_ACTIONS_MANIFEST });
});

// WAB Beacon — /.wab — compact machine-readable trust signal for AI agents.
// Agents following the Gossip / Spider Protocol read this to learn:
//   ring, score, manifest, registry, and a list of peer WAB-enabled sites.
app.get('/.wab', (req, res) => {
  const { currentPublicKey, currentFingerprint } = require('./routes/notary');
  const registry = require('./routes/registry');
  // top 10 verified or highest-scored registry entries as peer hints
  let peers = [];
  try {
    const regData = JSON.parse(
      require('fs').readFileSync(
        require('path').join(__dirname, '..', 'data', 'registry.json'), 'utf8')
    );
    if (Array.isArray(regData)) {
      peers = regData
        .filter(e => e.active !== false)
        .sort((a, b) => (b.score || 0) - (a.score || 0) || (b.trust_ring || 0) - (a.trust_ring || 0))
        .slice(0, 10)
        .map(e => ({ domain: e.domain, trust_ring: e.trust_ring, intent_tags: (e.intent_tags || []).slice(0, 5) }));
    }
  } catch { /* registry may be empty */ }
  res.set('Cache-Control', 'public, max-age=120');
  res.set('Access-Control-Allow-Origin', '*');
  res.json({
    v:          1,
    protocol:   'wab/3.19',
    ring:       4,
    score:      94,
    manifest:   'https://webagentbridge.com/.well-known/wab.json',
    registry:   'https://webagentbridge.com/api/registry/discover',
    spider_report: 'https://webagentbridge.com/api/registry/report',
    notary_fp:  typeof currentFingerprint === 'function' ? currentFingerprint() : null,
    next:       peers,
    generated_at: new Date().toISOString(),
  });
});

// Discovery headers — advertised on every HTML/JSON response so AI agents,
// crawlers and MCP-style clients can find the WAB manifest and llms.txt
// without having to scrape. Mirrors the Mintlify X-Llms-Txt convention and
// adds X-WAB-Discovery alongside RFC 8288 Link rels.
// Phase 8: X-WAB-Enabled + X-WAB-Trust-Ring + X-WAB-Score + X-WAB-Registry
// signal preference to any agent that reads HTTP response headers.
// Phase 9: X-WAB-Next-Sites — WAB DNA header, top peers from registry (cached 60s)
// so every HTTP response carries network topology. This is the WAB Gossip DNA.
let _nextSitesCache = { value: '', exp: 0 };
function getNextSitesDNA() {
  if (Date.now() < _nextSitesCache.exp) return _nextSitesCache.value;
  try {
    const reg = JSON.parse(
      require('fs').readFileSync(path.join(__dirname, '..', 'data', 'registry.json'), 'utf8')
    );
    const top = Array.isArray(reg)
      ? reg.filter(e => e.active !== false)
          .sort((a, b) => (b.trust_ring || 0) - (a.trust_ring || 0) || (b.score || 0) - (a.score || 0))
          .slice(0, 5).map(e => e.domain).join(', ')
      : '';
    _nextSitesCache = { value: top, exp: Date.now() + 60000 };
    return top;
  } catch { return ''; }
}
app.use((req, res, next) => {
  res.set('X-WAB-Discovery',  '/.well-known/wab.json');
  res.set('X-WAB-Enabled',    'true');
  res.set('X-WAB-Trust-Ring', '4');
  res.set('X-WAB-Score',      '94');
  res.set('X-WAB-Registry',   '/api/registry/discover');
  res.set('X-Llms-Txt',       '/llms.txt');
  const nextSites = getNextSitesDNA();
  if (nextSites) res.set('X-WAB-Next-Sites', nextSites);
  res.append('Link', '</.well-known/wab.json>; rel="wab-manifest"; type="application/json"');
  res.append('Link', '</.wab>; rel="wab-beacon"; type="application/json"');
  res.append('Link', '</llms.txt>; rel="llms-txt"; type="text/plain"');
  res.append('Link', '</llms-full.txt>; rel="llms-full-txt"; type="text/plain"');
  next();
});

// WAB compliance badge — embeddable SVG. Usage:
//   <img src="https://webagentbridge.com/badge/example.com.svg">
// Returns green/amber/red based on whether the domain publishes a reachable
// /.well-known/wab.json (and optionally an Ed25519 signature). Result is
// cached in-process for 10 minutes to keep this endpoint cheap and DoS-safe.
const _badgeCache = new Map();
function _badgeSvg(label, value, color) {
  const labelW = 56;
  const valueW = Math.max(48, value.length * 7 + 14);
  const total  = labelW + valueW;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${label}: ${value}">
  <linearGradient id="b" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".1" stop-color="#aaa" stop-opacity=".1"/><stop offset=".9" stop-opacity=".3"/><stop offset="1" stop-opacity=".5"/></linearGradient>
  <mask id="m"><rect width="${total}" height="20" rx="3" fill="#fff"/></mask>
  <g mask="url(#m)">
    <rect width="${labelW}" height="20" fill="#1f2937"/>
    <rect x="${labelW}" width="${valueW}" height="20" fill="${color}"/>
    <rect width="${total}" height="20" fill="url(#b)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${labelW/2}" y="14">${label}</text>
    <text x="${labelW + valueW/2}" y="14">${value}</text>
  </g>
</svg>`;
}
app.get('/badge/:domain', async (req, res) => {
  let host = String(req.params.domain || '').replace(/\.svg$/i, '').trim().toLowerCase();
  host = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host)) {
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=60');
    return res.send(_badgeSvg('WAB', 'invalid', '#9ca3af'));
  }
  const cached = _badgeCache.get(host);
  if (cached && cached.exp > Date.now()) {
    res.type('image/svg+xml').set('Cache-Control', 'public, max-age=600').set('Access-Control-Allow-Origin', '*');
    return res.send(cached.svg);
  }
  let value = 'unknown', color = '#9ca3af';
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 3500);
    const r  = await fetch(`https://${host}/.well-known/wab.json`, { signal: ac.signal, redirect: 'follow' });
    clearTimeout(t);
    if (r.ok) {
      const j = await r.json().catch(() => null);
      const signed = !!(j && (j.signature || (j.trust && j.trust.signed)));
      value = signed ? 'verified' : 'enabled';
      color = signed ? '#10b981' : '#f59e0b';
    } else {
      value = 'missing'; color = '#ef4444';
    }
  } catch (_) {
    value = 'missing'; color = '#ef4444';
  }
  const svg = _badgeSvg('WAB', value, color);
  _badgeCache.set(host, { svg, exp: Date.now() + 10 * 60 * 1000 });
  res.type('image/svg+xml').set('Cache-Control', 'public, max-age=600').set('Access-Control-Allow-Origin', '*');
  return res.send(svg);
});

app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    }
  }
}));
app.use('/script', express.static(path.join(__dirname, '..', 'script')));

app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api', apiLimiter, apiRoutes);
app.use('/api/license', licenseLimiter, licenseRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/billing', apiLimiter, billingRoutes);
// genius-platform payment gateway — uses WAB's Stripe service (internal proxy)
app.use('/api/genius', geniusGateway);
app.use('/api/sovereign', apiLimiter, sovereignRoutes);
app.use('/api/mesh', apiLimiter, meshRoutes);
app.use('/api/commander', apiLimiter, commanderRoutes);
app.use('/api/ads', apiLimiter, adsRoutes);
app.use('/api/wab', wabApiRoutes);
app.use('/api/noscript', apiLimiter, noscriptRoutes);
app.use('/api/discovery', apiLimiter, discoveryRoutes);
app.use('/api/activate', apiLimiter, require('./routes/activate'));

// ── WAB Advanced Features v1.0 ──────────────────────────────────────────────
const { reputationRouter, collectiveRouter } = require('./routes/reputation');
const { intentRouter, privacyRouter }        = require('./routes/intent');
const { cacheRouter, offlineRouter }         = require('./routes/wab-cache');
// Trust Graph tier gate — tags & meters anonymous + keyed traffic.
// Mounted BEFORE the routers so it sees their requests.
const { apiTierMiddleware } = require('./middleware/api-tier');
app.use(['/api/reputation', '/api/truth', '/api/ring4/status'], apiTierMiddleware);
app.use('/api/reputation', apiLimiter, reputationRouter);
app.use('/api/collective', apiLimiter, collectiveRouter);
app.use('/api/intent',     apiLimiter, intentRouter);
app.use('/api/privacy',    apiLimiter, privacyRouter);
app.use('/api/cache',      apiLimiter, cacheRouter);
app.use('/api/offline',    apiLimiter, offlineRouter);

// ── WAB Truth Layer v1.0 (Semantic Memory + Temporal Trust + Action Graphs + Reality Anchor) ──
const { truthRouter } = require('./routes/truth-layer');
app.use('/api/truth', apiLimiter, truthRouter);

// ── WAB Ring 4 External Trust Verification (sovereign-agent trust API) ──
const { ring4Router } = require('./routes/ring4');
const { wabTrustMiddleware } = require('./middleware/wab-trust');
app.use(wabTrustMiddleware);
app.use('/api/ring4', apiLimiter, ring4Router);

// ── Agent Transaction Primitive (ATP) v3.9.0 — intents · transactions · signed receipts ──
app.use('/api/atp', apiLimiter, require('./routes/transactions'));

// ── Site Revocations & Appeals v3.11.0 — public transparency + owner appeals ──
app.use('/api/revocations', apiLimiter, require('./routes/revocations'));

// ── Agent-Driven Adoption v3.12.0 — canonical LLM agent system prompt ──
app.use('/api/agent', apiLimiter, require('./routes/agent-prompt'));

// ── Network Effect v3.14.0 — trusted-domains snapshot + revocations feeds ──
// (apiLimiter already applies via /api mount above; do not stack it here.)
app.use('/api', require('./routes/network'));

// ── Webhook Subscriptions v3.16.0 (Phase 4) — instant push for revocations ──
app.use('/api/webhooks', apiLimiter, require('./routes/webhooks'));

// ── WAB Commercial Foundations v3.8.0 (Partners · Trust Graph API · Governance SaaS · Enterprise Mesh) ──
app.use('/api/partners',         apiLimiter, require('./routes/partners'));
app.use('/api/keys',             apiLimiter, require('./routes/api-keys'));
app.use('/api/governance-saas',  apiLimiter, require('./routes/governance-saas'));
app.use('/api/enterprise-mesh',  apiLimiter, require('./routes/enterprise-mesh'));
// Trust Graph tier gate is mounted earlier (before /api/reputation et al.)
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/providers', apiLimiter, providerRoutes);
app.use('/api/governance', apiLimiter, governanceRoutes);
app.use('/api/plans', apiLimiter, require('./routes/plans'));
app.use('/api/admin/plans', apiLimiter, require('./routes/admin-plans'));
app.use('/api/admin/shieldqr', apiLimiter, require('./routes/admin-shieldqr'));
app.use('/api/admin/trust-monitor', apiLimiter, require('./routes/admin-trust-monitor'));
// Optional premium modules — mounted only when present (open-source repo
// excludes the ShieldLink stack which is a paid feature).
function mountOptional(prefix, modPath) {
  try { app.use(prefix, apiLimiter, require(modPath)); }
  catch (e) {
    if (e.code === 'MODULE_NOT_FOUND' && e.message.includes(modPath)) {
      console.log(`[optional] ${prefix} not mounted (${modPath} not present)`);
    } else { throw e; }
  }
}
mountOptional('/api/admin/shieldlink',   './routes/admin-shieldlink');
app.use('/api/shieldqr', apiLimiter, require('./routes/shieldqr'));
mountOptional('/api/shieldlink',         './routes/shieldlink');
mountOptional('/api/customer/shieldlink','./routes/customer-shieldlink');
app.use('/api/adopt', apiLimiter, require('./routes/adopt'));
app.use('/api/diagnose', apiLimiter, require('./routes/diagnose'));
app.use('/api/admin/outreach', apiLimiter, require('./routes/admin-outreach'));
app.use('/', apiLimiter, require('./routes/unsubscribe'));
// Also expose well-known discovery endpoints at the canonical root paths so
// agents can find them without the /api/discovery prefix (RFC 8615).

// /activate — WAB DNS Discovery activation guide (bilingual)
app.get('/activate', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'activate.html'));
});

// /one-click — interactive self-serve activation wizard (key-gen, sign, deploy via API)
app.get(['/one-click', '/one-click.html', '/activate/one-click'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'one-click.html'));
});

// /wab-features — WAB Advanced Features showcase (Reputation, Cache, Intent, Privacy, Collective, Offline)
app.get(['/wab-features', '/features'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-features.html'));
});
// /wab-truth — WAB Truth Layer showcase (Semantic Memory + Temporal Trust + Action Graphs + Reality Anchor)
app.get(['/wab-truth', '/truth'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-truth.html'));
});
// /milestones — Partners & Milestones (VEXR Ultra × WAB Ring 4 integration)
app.get(['/milestones'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'milestones.html'));
});
// /partners — Certified Partner Program (3 tiers · self-serve)
app.get(['/partners', '/partners.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'partners.html'));
});
// /trust-graph-api — Trust Graph API docs & self-serve key issuance
app.get(['/trust-graph-api', '/trust-graph-api.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'trust-graph-api.html'));
});
// /governance — Governance SaaS landing (EU AI Act audit trail)
app.get(['/governance', '/governance.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'governance.html'));
});
// /enterprise-mesh — Self-hosted Enterprise Mesh contact
app.get(['/enterprise-mesh', '/enterprise-mesh.html', '/enterprise'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'enterprise-mesh.html'));
});
// /ring4 — Ring 4 Trust Handshake protocol docs
app.get(['/ring4', '/trust-handshake'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'ring4.html'));
});
// /refusals — Public refusal log (anonymized constitutional refusal stats)
app.get('/refusals', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'refusals.html'));
});
// Trust & protocol pages
app.get(['/security', '/security.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'security.html'));
});
app.get(['/threat-model', '/threat-model.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'threat-model.html'));
});
app.get(['/responsible-disclosure', '/responsible-disclosure.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'responsible-disclosure.html'));
});
app.get(['/key-rotation', '/key-rotation.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'key-rotation.html'));
});
app.get(['/atp-semantics', '/atp-semantics.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'atp-semantics.html'));
});
app.get(['/benchmarks', '/benchmarks.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'benchmarks.html'));
});
app.get(['/wab-today', '/wab-today.html', '/architecture'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-today.html'));
});

// ── WAB Ecosystem v3.18.0 — Observatory · Notary · Research · URI scheme · Lens ──
app.use('/api/notary',      apiLimiter, require('./routes/notary'));
app.use('/api/observatory', apiLimiter, require('./routes/observatory'));
app.use('/api/research',    apiLimiter, require('./routes/research'));

// ── WAB Spider Network v3.19.0 — Public Registry + Spider Protocol ──
app.use('/api/registry',    apiLimiter, require('./routes/registry'));

// ── WAB Self-Propagating Protocol v3.20.0 — Training Signal + Viral Stats ──
app.use('/api/traces',      apiLimiter, require('./routes/traces'));

app.get(['/observatory', '/observatory.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'observatory.html'));
});
app.get(['/notary', '/notary.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'notary.html'));
});
app.get(['/research', '/research.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'research.html'));
});
app.get(['/wab-uri', '/wab-uri.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-uri.html'));
});
app.get(['/wab-email', '/wab-email.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-email.html'));
});
app.get(['/wab-p2p', '/wab-p2p.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-p2p.html'));
});
app.get(['/wab-lens', '/wab-lens.html'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-lens.html'));
});
app.get(['/wab-registry', '/wab-registry.html', '/registry'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-registry.html'));
});
app.get(['/wab-dataset', '/wab-dataset.html', '/dataset'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-dataset.html'));
});
app.get(['/viral-coefficient', '/viral-coefficient.html', '/viral'], noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'viral-coefficient.html'));
});

// /resolve?u=wab://host/action?... — universal handler for the wab:// URI scheme.
// Parses the URI, fetches the target manifest, validates the action and shows
// a confirmation page. Renders an inline HTML response so it works without JS.
app.get('/resolve', async (req, res) => {
  const raw = String(req.query.u || '');
  const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function page(title, body) {
    res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#0b0f17;color:#e5e7eb;margin:0;padding:48px 24px;max-width:640px;margin-inline:auto}
h1{font-size:22px}a{color:#60a5fa}code,pre{background:#0d1320;border:1px solid #1f2937;border-radius:6px;padding:2px 6px}
pre{padding:12px;overflow-x:auto;font-size:12px}.err{color:#ef4444}.ok{color:#10b981}
button,a.btn{display:inline-block;background:#60a5fa;color:#0b0f17;border:0;padding:10px 18px;border-radius:6px;font:inherit;font-weight:600;cursor:pointer;text-decoration:none;margin-top:12px}
</style></head><body>${body}<p style="margin-top:32px;font-size:12px;color:#9ca3af"><a href="/wab-uri">About the wab:// URI scheme</a></p></body></html>`);
  }
  if (!/^wab:\/\//i.test(raw)) {
    return page('Invalid wab:// URI', `<h1 class="err">Invalid wab:// URI</h1><p>The <code>u</code> parameter must start with <code>wab://</code>.</p>`);
  }
  let host, action, params;
  try {
    const u = new URL(raw.replace(/^wab:\/\//i, 'https://'));
    host = u.hostname.toLowerCase();
    action = u.pathname.replace(/^\/+/, '').split('/')[0] || '';
    params = Object.fromEntries(u.searchParams.entries());
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) || !action) throw new Error('bad uri');
  } catch (e) {
    return page('Invalid wab:// URI', `<h1 class="err">Could not parse</h1><pre>${esc(raw)}</pre>`);
  }
  let manifest = null;
  try {
    const ac = new AbortController();
    const t  = setTimeout(() => ac.abort(), 4000);
    const r  = await fetch(`https://${host}/.well-known/wab.json`, { signal: ac.signal, redirect: 'follow' });
    clearTimeout(t);
    if (r.ok) manifest = await r.json().catch(() => null);
  } catch (_) {}
  if (!manifest) {
    return page('Manifest not found', `<h1 class="err">${esc(host)} does not publish a WAB manifest</h1>
      <p>The wab:// URI cannot be resolved because <code>https://${esc(host)}/.well-known/wab.json</code> is not reachable.</p>`);
  }
  const actions = Array.isArray(manifest.actions) ? manifest.actions : [];
  const match = actions.find(a => a && a.id === action);
  if (!match) {
    return page('Action not found', `<h1 class="err">Unknown action <code>${esc(action)}</code></h1>
      <p>${esc(host)} publishes a manifest, but no action with id <code>${esc(action)}</code> is declared.</p>
      <p>Known actions: ${actions.map(a => `<code>${esc(a.id||'')}</code>`).join(', ') || '<em>none</em>'}</p>`);
  }
  const signed = !!(manifest.signature || (manifest.trust && manifest.trust.signed));
  return page(`Confirm: ${action} on ${host}`, `
    <h1>Confirm action</h1>
    <p>You are about to invoke <code>${esc(action)}</code> on <strong>${esc(host)}</strong>${signed ? ' <span class="ok">✓ signed manifest</span>' : ''}.</p>
    <h3 style="margin-top:24px;font-size:14px">Parameters</h3>
    <pre>${esc(JSON.stringify(params, null, 2))}</pre>
    <h3 style="margin-top:24px;font-size:14px">Endpoint</h3>
    <pre>${esc(match.method || 'POST')} ${esc(match.endpoint || '')}</pre>
    <form method="${esc(match.safe ? 'GET' : 'POST')}" action="${esc(match.endpoint || '#')}">
      ${Object.entries(params).map(([k,v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}
      <button type="submit">Proceed</button>
      <a class="btn" style="background:transparent;color:#e5e7eb;border:1px solid #1f2937;margin-left:6px" href="javascript:history.back()">Cancel</a>
    </form>`);
});
// /.well-known/jwks.json — standard JWKS discovery for OIDC/JWT ecosystem
app.get('/.well-known/jwks.json', (req, res) => {
  try {
    const { _internals } = require('./routes/ring4');
    return res.json(_internals.buildJwks());
  } catch (e) {
    return res.status(503).json({ error: 'jwks_unavailable', detail: e.message });
  }
});
app.get('/shieldqr', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'shieldqr.html'));
});
// ── ShieldLink landing + Trust Preview redirect ──
app.get('/shieldlink', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'shieldlink.html'));
});
app.get('/l/:token', noCache, (req, res) => {
  // Serve the Trust Preview page; the page calls /api/shieldlink/verify?token=
  res.sendFile(path.join(__dirname, '..', 'public', 'l-preview.html'));
});
app.get('/dashboard/shieldlink', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard-shieldlink.html'));
});
app.get('/activate-dns', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'activate.html'));
});
app.get('/provider-onboarding', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'provider-onboarding.html'));
});
app.get('/provider-sandbox', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'provider-sandbox.html'));
});
app.get('/cloudflare-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cloudflare-integration.html'));
});
app.get('/cpanel-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cpanel-integration.html'));
});
app.get('/route53-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'route53-integration.html'));
});
app.get('/plesk-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'plesk-integration.html'));
});
app.get('/gcp-dns-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'gcp-dns-integration.html'));
});
app.get('/azure-dns-integration', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'azure-dns-integration.html'));
});
app.get('/registrar-integrations', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'registrar-integrations.html'));
});
app.get('/adoption-metrics', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'adoption-metrics.html'));
});
app.get('/adopt', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'adopt.html'));
});
app.get('/wab-trust', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-trust.html'));
});
app.get('/wab-vs-protocols', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'wab-vs-protocols.html'));
});
app.use('/', apiLimiter, discoveryRoutes);
app.use('/api/premium', apiLimiter, premiumRoutes);
app.use('/api/admin/premium', apiLimiter, adminPremiumRoutes);
app.use('/api/workspace', apiLimiter, workspaceRoutes);
app.use('/api/universal', apiLimiter, universalRoutes);
app.use('/api/os', apiLimiter, runtimeRoutes);
app.use('/api/demo', apiLimiter, demoShowcaseRoutes);
app.use('/api/growth', apiLimiter, growthRoutes);
app.use('/api/v1', gatewayRoutes);

// Convenience alias: /api/negotiate/* → /api/sovereign/negotiation/*
app.get('/api/negotiate', apiLimiter, (req, res) => {
  res.json({
    engine: 'WAB Negotiation Engine',
    endpoints: {
      'POST /api/negotiate/rules': 'Create negotiation rules (auth required)',
      'GET  /api/negotiate/rules/:siteId': 'Get rules for a site',
      'PUT  /api/negotiate/rules/:ruleId': 'Update a rule (auth required)',
      'POST /api/negotiate/sessions': 'Open negotiation session',
      'POST /api/negotiate/sessions/:id/propose': 'Agent counter-offer',
      'POST /api/negotiate/sessions/:id/confirm': 'Confirm deal',
      'GET  /api/negotiate/stats/:siteId': 'Negotiation stats',
    },
  });
});
app.use('/api/negotiate', apiLimiter, (req, res, next) => {
  req.url = '/negotiation' + req.url;
  sovereignRoutes(req, res, next);
});

// ─── WAB Search Engine ────────────────────────────────────────────────

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests, please slow down' }
});

app.get('/api/search', searchLimiter, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [], cached: false });
  if (q.length > 200) return res.status(400).json({ error: 'Query too long' });
  const crypto = require('crypto');
  const ipHash = crypto.createHash('sha256').update(req.ip || '').digest('hex').slice(0, 16);
  const result = await search(q, ipHash);
  res.json(result);
});

app.get('/api/search/suggest', searchLimiter, (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ suggestions: [] });
  const suggestions = getSuggestions(q, 8);
  res.json({ suggestions });
});

app.get('/api/search/trending', apiLimiter, (req, res) => {
  const trending = getTrendingSearches(10);
  res.json({ trending });
});

app.get('/api/search/stats', apiLimiter, (req, res) => {
  const stats = getSearchStats();
  res.json(stats);
});

// Prevent browsers from caching HTML page routes
function noCache(req, res, next) {
  res.set('Cache-Control', 'no-cache, must-revalidate');
  next();
}

app.get('/dashboard', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});
app.get('/providers', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'providers.html'));
});
app.get('/mesh-dashboard', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesh-dashboard.html'));
});
app.get('/commander-dashboard', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'commander-dashboard.html'));
});
app.get('/docs', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'docs.html'));
});
app.get('/login', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
app.get('/register', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'register.html'));
});
app.get('/admin/login', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html'));
});
app.get('/admin', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'dashboard.html'));
});
app.get('/admin/snapshots', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'snapshots.html'));
});

// ─── Admin sub-pages (each backed by real API endpoints in /api/admin/*) ──
['users','sites','analytics','grants','payments','stripe','smtp','notifications','governance','discovery','trust','providers','plans','shieldqr','shieldlink','trust-monitor','outreach'].forEach((page) => {
  app.get('/admin/' + page, noCache, (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'admin', page + '.html'));
  });
});
app.get('/privacy', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.get('/terms', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});
app.get('/cookies', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cookies.html'));
});
app.get('/browser', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'browser.html'));
});
app.get('/workspace', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'agent-workspace.html'));
});
app.get('/growth', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'growth.html'));
});
app.get('/score', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'score.html'));
});
app.get('/sovereign', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'sovereign.html'));
});
app.get('/api', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'api.html'));
});

app.get('/phone-shield', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'phone-shield.html'));
});

app.get('/dns', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dns.html'));
});

// /integrations — bilingual deploy landing page
app.get('/integrations', noCache, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'integrations.html'));
});

// /demo — interactive WAB Demo Store (new)
app.use('/demo', demoStoreRoutes);

// Browser downloads
app.use('/downloads', express.static(path.join(__dirname, '..', 'downloads'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // Shell scripts served as plain text for curl | bash usage
    if (filePath.endsWith('.sh')) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
    } else {
      res.set('Content-Disposition', 'attachment');
    }
  }
}));

// WAB Discovery install shortcut: curl -fsSL https://webagentbridge.com/install | bash
app.get('/install', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, '..', 'downloads', 'quick-wab.sh'));
});

// Agent chat endpoint for WAB Browser — Real AI Agent
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many messages, please slow down' }
});

app.post('/api/wab/agent-chat', chatLimiter, async (req, res) => {
  const { message, context, sessionId, taskId, taskAction } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message required' });
  }
  if (message.length > 3000) {
    return res.status(400).json({ error: 'Message too long' });
  }

  const sid = sessionId || req.ip || 'anonymous';

  try {
    // ── Task actions (user responding to an active task) ──
    if (taskId && taskAction) {
      if (taskAction === 'answer') {
        const result = agentTasks.answerClarification(taskId, message);
        if (result.status === 'planning') {
          // Auto-execute after planning
          const execResult = await agentTasks.executeTask(taskId);
          return res.json({ ...execResult, type: 'task' });
        }
        return res.json({ ...result, type: 'task' });
      }
      if (taskAction === 'select') {
        const idx = parseInt(message.replace(/\D/g, '')) - 1;
        const result = agentTasks.selectOffer(taskId, idx);
        return res.json({ ...result, type: 'task' });
      }
      if (taskAction === 'cancel') {
        const result = agentTasks.cancelTask(taskId);
        return res.json({ ...result, type: 'task' });
      }
    }

    // ── Check if user wants to select from existing offers ──
    if (!taskId) {
      const selectMatch = message.match(/(?:اختر|اخت(?:ا|ي)ر|select|choose|pick)\s*(\d+)/i);
      if (selectMatch) {
        const tasks = agentTasks.getSessionTasks(sid, 1);
        if (tasks.length > 0 && tasks[0].status === 'presenting') {
          const idx = parseInt(selectMatch[1]) - 1;
          const result = agentTasks.selectOffer(tasks[0].id, idx);
          return res.json({ ...result, type: 'task' });
        }
      }
    }

    // ── Detect URL paste — create URL negotiation task ──
    const urlData = agentTasks.parseBookingUrl(message);
    if (urlData) {
      const task = agentTasks.createUrlTask(sid, message, urlData);
      const execResult = await agentTasks.executeUrlTask(task.taskId);
      return res.json({ ...execResult, type: 'task', urlData });
    }

    // ── Detect if this is a task-type request (booking, shopping, etc.) ──
    const intent = agentTasks.detectIntent(message);
    if (intent.confidence >= 0.7 && intent.intent !== 'general') {
      const task = agentTasks.createTask(sid, message);

      if (task.status === 'clarifying') {
        return res.json({ ...task, type: 'task' });
      }

      // If requirements are complete, auto-execute
      const execResult = await agentTasks.executeTask(task.taskId);
      return res.json({ ...execResult, type: 'task' });
    }

    // ── Regular chat (not a task) ──
    const chatContext = {
      url: context?.url || '',
      platform: context?.platform || 'unknown',
      sessionId: sid,
    };
    const result = await agentChat(message, chatContext);
    res.json(result);
  } catch (err) {
    console.error('[agent-chat] Error:', err.message);
    res.json({ reply: '🤖 عذراً، حدث خطأ. حاول مرة أخرى.', type: 'text' });
  }
});

// Agent task status & history
app.get('/api/wab/agent-task/:id', chatLimiter, (req, res) => {
  const state = agentTasks.getTaskState(req.params.id);
  if (!state) return res.status(404).json({ error: 'Task not found' });
  res.json(state);
});

app.get('/api/wab/agent-tasks', chatLimiter, (req, res) => {
  const sid = req.query.sessionId || req.ip || 'anonymous';
  const tasks = agentTasks.getSessionTasks(sid, 20);
  res.json({ tasks });
});

const pkg = require('../package.json');
app.use(`/v${pkg.version.split('.')[0]}`, express.static(path.join(__dirname, '..', 'script')));
app.use('/latest', express.static(path.join(__dirname, '..', 'script')));

app.get('*', (req, res) => {
  // API routes always return JSON 404
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', path: req.path });
  }
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});


// Prevent PM2 restarts from uncaught errors — log and continue
process.on('uncaughtException', (err) => {
  console.error('[process] uncaughtException:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[process] unhandledRejection:', reason?.message || reason);
});

// Run migrations on every load (including tests) so worker-isolated DBs have
// a complete schema before the first request.
runMigrations();

if (process.env.NODE_ENV !== 'test') {
  console.log('Running database migrations...');
  maybeBootstrapAdmin();
  initSearchEngine(db);

  // Purge old search cache every hour
  setInterval(purgeOldCache, 60 * 60 * 1000);

  const server = http.createServer(app);
  setupWebSocket(server);

  // Start Agent OS runtime
  runtime.start();

  // Start Cluster Orchestrator
  cluster.start();

  // Start the SSL Health Monitor cron (Extended Trust Layer).
  try { require('./services/ssl-monitor').start(); } catch (e) { console.warn('[ssl-monitor] start failed:', e.message); }

  // Start the Certificate Transparency Monitor (opt-in via WAB_CT_MONITOR=true).
  try { require('./services/ssl-ct-monitor').start(); } catch (e) { console.warn('[ct-monitor] start failed:', e.message); }

  // Start the ATP commission billing timer (opt-in via WAB_COMMISSION_BILLING_INTERVAL_HOURS).
  try {
    const r = require('./services/commission-billing').startPeriodicBilling();
    if (r) console.log(`[commission-billing] periodic cycle every ${r.intervalHours}h`);
  } catch (e) { console.warn('[commission-billing] start failed:', e.message); }

  // Start the revocation appeal-window sweep (opt-in via WAB_REVOCATION_SWEEP_INTERVAL_HOURS).
  try {
    const r = require('./services/revocations').startPeriodicSweep();
    if (r) console.log(`[revocations] periodic sweep every ${r.intervalHours}h`);
  } catch (e) { console.warn('[revocations] sweep start failed:', e.message); }

  server.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║   Web Agent Bridge v${pkg.version}                ║`);
    console.log(`  ║   Server running on http://localhost:${PORT} ║`);
    console.log(`  ║   WebSocket: ws://localhost:${PORT}/ws/analytics ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
