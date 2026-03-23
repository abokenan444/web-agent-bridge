/**
 * Stricter rate limits for license token / track endpoints (used inside license router).
 */

const rateLimit = require('express-rate-limit');

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

module.exports = { licenseTokenLimiter, licenseTrackLimiter };
