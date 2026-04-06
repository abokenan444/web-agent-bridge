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
const { maybeBootstrapAdmin } = require('./models/db');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const sovereignRoutes = require('./routes/sovereign');
const meshRoutes = require('./routes/mesh');
const commanderRoutes = require('./routes/commander');
const adsRoutes = require('./routes/ads');
const { handleWebhookRequest } = require('./services/stripe');

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
  ? ["'self'"]
  : ["'self'", "'unsafe-inline'"];
const styleSrc = process.env.CSP_ALLOW_UNSAFE_INLINE === 'false'
  ? ["'self'"]
  : ["'self'", "'unsafe-inline'"];

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc,
        scriptSrcAttr: scriptSrc,
        styleSrc,
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

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

app.use(express.static(path.join(__dirname, '..', 'public')));
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

// Search proxy for PWA browser — scrapes DuckDuckGo HTML lite
app.get('/api/search', apiLimiter, async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ results: [] });

  // Try DuckDuckGo HTML lite first
  let results = await searchDDG(q);
  if (results.length === 0) {
    // Fallback: try Google search scraping
    results = await searchGoogle(q);
  }
  res.json({ results });
});

async function searchDDG(q) {
  try {
    const ddgUrl = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q);
    const resp = await fetch(ddgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    const html = await resp.text();
    const results = [];
    const resultPattern = /<a[^>]+class="result__a"[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetPattern = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    const urls = [];
    const titles = [];
    const snippets = [];
    let m;
    while ((m = resultPattern.exec(html)) !== null) {
      urls.push(m[1]);
      titles.push(m[2].replace(/<[^>]+>/g, '').trim());
    }
    while ((m = snippetPattern.exec(html)) !== null) {
      snippets.push(m[1].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").trim());
    }
    for (let i = 0; i < Math.min(urls.length, 10); i++) {
      let url = urls[i];
      const uddg = url.match(/uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      if (!url.startsWith('http')) continue;
      results.push({ title: titles[i] || url, url, snippet: snippets[i] || '' });
    }
    return results;
  } catch (e) {
    return [];
  }
}

async function searchGoogle(q) {
  try {
    const gUrl = 'https://www.google.com/search?q=' + encodeURIComponent(q) + '&num=10&hl=en';
    const resp = await fetch(gUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
      },
    });
    const html = await resp.text();
    const results = [];
    // Google wraps results in <a href="/url?q=ACTUAL_URL&...">
    const linkPattern = /<a[^>]+href="\/url\?q=([^&"]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkPattern.exec(html)) !== null && results.length < 10) {
      const url = decodeURIComponent(m[1]);
      if (!url.startsWith('http')) continue;
      // Skip Google's own links
      try { if (new URL(url).hostname.includes('google.')) continue; } catch(e) { continue; }
      const title = m[2].replace(/<[^>]+>/g, '').trim();
      if (!title) continue;
      results.push({ title, url, snippet: '' });
    }
    return results;
  } catch (e) {
    return [];
  }
}

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});
app.get('/mesh-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'mesh-dashboard.html'));
});
app.get('/commander-dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'commander-dashboard.html'));
});
app.get('/docs', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'docs.html'));
});
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'login.html'));
});
app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'register.html'));
});
app.get('/admin/login', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'login.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'dashboard.html'));
});
app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'privacy.html'));
});
app.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'terms.html'));
});
app.get('/cookies', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'cookies.html'));
});
app.get('/browser', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'browser.html'));
});

// Browser downloads
app.use('/downloads', express.static(path.join(__dirname, '..', 'downloads'), {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    res.set('Content-Disposition', 'attachment');
  }
}));

// Agent chat endpoint for WAB Browser
app.post('/api/wab/agent-chat', (req, res) => {
  const { message, context } = req.body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Message required' });
  }
  // Return structured response — can be expanded with AI integration later
  const msg = message.toLowerCase();
  let reply = '';

  if (msg.includes('ghost') || msg.includes('شبح')) {
    reply = '👻 Ghost Mode يحمي خصوصيتك عبر تدوير User-Agent، إخفاء بصمة Canvas، حظر WebRTC، وإرسال DNT. مثالي للتصفح الخاص بدون تتبع.';
  } else if (msg.includes('shield') || msg.includes('درع') || msg.includes('حماية')) {
    reply = '🛡️ Scam Shield يحلل كل موقع تلقائياً: فحص النطاق، TLD، انتحال العلامات التجارية، هجمات Homograph، وأنماط الاحتيال في المحتوى.';
  } else if (msg.includes('search') || msg.includes('بحث')) {
    reply = '🔍 Smart Search يدعم DuckDuckGo (افتراضي)، Google، Bing، Startpage مع اقتراحات فورية. غيّر المحرك من القائمة > Search Engine.';
  } else if (msg.includes('safe') || msg.includes('آمن') || msg.includes('أمان')) {
    const url = context?.url || '';
    reply = url ? (url.startsWith('https') ? '🔒 الاتصال مشفر SSL/TLS ✅ — Scam Shield يعمل تلقائياً.' : '⚠️ اتصال غير مشفر — تجنب إدخال بيانات حساسة.') : '📄 لا توجد صفحة محملة حالياً.';
  } else if (msg.includes('help') || msg.includes('مساعدة')) {
    reply = '🤖 أنا وكيل WAB Browser. أستطيع مساعدتك في:\\n• تحليل أمان الصفحة\\n• شرح ميزات المتصفح\\n• نصائح الخصوصية والحماية\\n• البحث والتنقل';
  } else {
    reply = '🤖 مرحباً! أنا وكيل WAB Browser الذكي. اسألني عن: أمان المواقع، Ghost Mode، Scam Shield، أو أي ميزة في المتصفح.';
  }

  res.json({ reply, type: 'text' });
});

const pkg = require('../package.json');
app.use(`/v${pkg.version.split('.')[0]}`, express.static(path.join(__dirname, '..', 'script')));
app.use('/latest', express.static(path.join(__dirname, '..', 'script')));

app.get('*', (req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

if (process.env.NODE_ENV !== 'test') {
  console.log('Running database migrations...');
  runMigrations();
  maybeBootstrapAdmin();

  const server = http.createServer(app);
  setupWebSocket(server);

  server.listen(PORT, () => {
    console.log(`\n  ╔══════════════════════════════════════════╗`);
    console.log(`  ║   Web Agent Bridge v${pkg.version}                ║`);
    console.log(`  ║   Server running on http://localhost:${PORT} ║`);
    console.log(`  ║   WebSocket: ws://localhost:${PORT}/ws/analytics ║`);
    console.log(`  ╚══════════════════════════════════════════╝\n`);
  });
}

module.exports = app;
