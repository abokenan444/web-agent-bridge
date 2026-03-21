const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { verifyLicense, recordAnalytic, findSiteByLicense } = require('../models/db');
const { broadcastAnalytic } = require('../ws');
const { cache, AnalyticsQueue } = require('../utils/cache');

const analyticsQueue = new AnalyticsQueue(recordAnalytic);

// ─── Session Token Store (in-memory, TTL 1 hour) ────────────────────
const sessionTokens = new Map();
const SESSION_TTL = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessionTokens) {
    if (now > data.expiresAt) sessionTokens.delete(token);
  }
}, 5 * 60 * 1000);

router.post('/verify', (req, res) => {
  const { domain, licenseKey } = req.body;

  if (!domain || !licenseKey) {
    return res.status(400).json({ valid: false, error: 'Domain and licenseKey are required', tier: 'free' });
  }

  // Cache license verification for 60 seconds (hot path optimization)
  const cacheKey = `license:${domain}:${licenseKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const result = verifyLicense(domain, licenseKey);
  cache.set(cacheKey, result, 60000);
  res.json(result);
});

// ─── Secure Token Exchange ──────────────────────────────────────────
// Client sends licenseKey → server validates → returns short-lived session token
// The session token is domain-locked and expires in 1 hour
router.post('/token', (req, res) => {
  const { licenseKey } = req.body;
  const origin = req.get('origin') || req.get('referer');
  let domain;
  try {
    domain = origin ? new URL(origin).hostname : req.hostname;
  } catch {
    domain = req.hostname;
  }

  if (!licenseKey) {
    return res.status(400).json({ error: 'licenseKey is required' });
  }

  // Cache license verification for token exchange too
  const cacheKey = `license:${domain}:${licenseKey}`;
  let result = cache.get(cacheKey);
  if (!result) {
    result = verifyLicense(domain, licenseKey);
    cache.set(cacheKey, result, 60000);
  }
  if (!result.valid) {
    return res.status(403).json({ error: result.error || 'Invalid license', tier: 'free' });
  }

  const sessionToken = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + SESSION_TTL;

  sessionTokens.set(sessionToken, {
    domain,
    tier: result.tier,
    permissions: result.allowedPermissions,
    licenseKey,
    expiresAt
  });

  res.json({
    sessionToken,
    tier: result.tier,
    permissions: result.allowedPermissions,
    expiresIn: SESSION_TTL / 1000
  });
});

// ─── Validate Session Token ─────────────────────────────────────────
router.post('/session', (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) {
    return res.status(400).json({ valid: false, error: 'sessionToken required' });
  }

  const session = sessionTokens.get(sessionToken);
  if (!session || Date.now() > session.expiresAt) {
    sessionTokens.delete(sessionToken);
    return res.status(401).json({ valid: false, error: 'Session expired or invalid' });
  }

  const origin = req.get('origin') || req.get('referer');
  let requestDomain;
  try {
    requestDomain = origin ? new URL(origin).hostname : req.hostname;
  } catch {
    requestDomain = req.hostname;
  }

  if (requestDomain !== session.domain) {
    return res.status(403).json({ valid: false, error: 'Domain mismatch' });
  }

  res.json({
    valid: true,
    tier: session.tier,
    permissions: session.permissions
  });
});

router.post('/track', (req, res) => {
  const { licenseKey, actionName, agentId, triggerType, success, metadata } = req.body;

  if (!licenseKey || !actionName) {
    return res.status(400).json({ error: 'licenseKey and actionName are required' });
  }

  try {
    const site = findSiteByLicense.get(licenseKey);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    analyticsQueue.push({
      siteId: site.id,
      actionName,
      agentId,
      triggerType,
      success: success !== false,
      metadata
    });

    // Broadcast real-time analytics via WebSocket
    broadcastAnalytic(site.id, {
      actionName,
      agentId,
      triggerType,
      success: success !== false
    });

    res.json({ recorded: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record analytics' });
  }
});

module.exports = router;
