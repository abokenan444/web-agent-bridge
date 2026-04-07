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
const premiumRoutes = require('./routes/premium');
const adminPremiumRoutes = require('./routes/admin-premium');
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
app.use('/api/wab', wabApiRoutes);
app.use('/api/noscript', apiLimiter, noscriptRoutes);
app.use('/api/discovery', apiLimiter, discoveryRoutes);
app.use('/api/premium', apiLimiter, premiumRoutes);
app.use('/api/admin/premium', apiLimiter, adminPremiumRoutes);

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
  if (message.length > 1000) {
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
  initSearchEngine(db);

  // Purge old search cache every hour
  setInterval(purgeOldCache, 60 * 60 * 1000);

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
