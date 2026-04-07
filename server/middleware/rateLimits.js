/**
 * Comprehensive rate limits for all security-sensitive endpoints.
 */

const rateLimit = require('express-rate-limit');

// ─── Auth endpoints ──────────────────────────────────────────────────

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many authentication attempts, please try again later' }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later' }
});

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin login attempts, please try again later' }
});

// ─── WAB API endpoints ───────────────────────────────────────────────

const wabAuthenticateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.siteId || req.body?.apiKey || 'anon'}`,
  message: { error: 'Too many WAB authentication attempts' }
});

const wabActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.wabSession?.siteId || 'anon'}`,
  message: { error: 'Too many action requests, please slow down' }
});

// ─── General API endpoints ───────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' }
});

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many search requests' }
});

// ─── License endpoints (existing) ────────────────────────────────────

const licenseTokenLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many token requests, please try again later' }
});

const licenseTrackLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${req.ip}:${req.body?.sessionToken || req.body?.siteId || 'anon'}`,
  message: { error: 'Too many track requests, please try again later' }
});

module.exports = {
  authLimiter,
  registerLimiter,
  adminLoginLimiter,
  wabAuthenticateLimiter,
  wabActionLimiter,
  apiLimiter,
  searchLimiter,
  licenseTokenLimiter,
  licenseTrackLimiter,
};
