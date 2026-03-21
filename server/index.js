require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { setupWebSocket } = require('./ws');

const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const licenseRoutes = require('./routes/license');
const adminRoutes = require('./routes/admin');
const billingRoutes = require('./routes/billing');
const { handleWebhookEvent } = require('./services/stripe');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Security & Middleware ──────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      fontSrc: ["'self'", "https:", "data:"],
      frameSrc: ["'none'"],
      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(cors());

// Stripe webhook needs raw body — must be before express.json()
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    await handleWebhookEvent(req);
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
  legacyHeaders: false
});

// ─── Static Files ───────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/script', express.static(path.join(__dirname, '..', 'script')));

// ─── API Routes ─────────────────────────────────────────────────────────
app.use('/api/auth', apiLimiter, authRoutes);
app.use('/api', apiLimiter, apiRoutes);
app.use('/api/license', licenseLimiter, licenseRoutes);
app.use('/api/admin', apiLimiter, adminRoutes);
app.use('/api/billing', apiLimiter, billingRoutes);

// ─── HTML Routes ────────────────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
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

// ─── CDN Versioned Script ───────────────────────────────────────────────
const pkg = require('../package.json');
app.use(`/v${pkg.version.split('.')[0]}`, express.static(path.join(__dirname, '..', 'script')));
app.use('/latest', express.static(path.join(__dirname, '..', 'script')));

// ─── SPA Fallback ───────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (req.accepts('html')) {
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// ─── Start ──────────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
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
