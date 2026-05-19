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
app.get('/.well-known/wab.json', (req, res) => {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.type('application/json');
  res.sendFile(path.join(__dirname, '..', 'public', '.well-known', 'wab.json'));
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

if (process.env.NODE_ENV !== 'test') {
  console.log('Running database migrations...');
  runMigrations();
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
