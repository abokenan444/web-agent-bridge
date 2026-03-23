const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const {
  verifyLicense,
  recordAnalytic,
  findSiteByLicense,
  findSiteById,
  db
} = require('../models/db');
const { broadcastAnalytic } = require('../ws');
const { cache, AnalyticsQueue } = require('../utils/cache');
const { licenseTokenLimiter, licenseTrackLimiter } = require('../middleware/rateLimits');

const analyticsQueue = new AnalyticsQueue(db, { maxSize: 50, maxBufferTotal: 5000 });

// ─── Session Token Store (in-memory, TTL 1 hour) ────────────────────
const sessionTokens = new Map();
const SESSION_TTL = 60 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [token, data] of sessionTokens) {
    if (now > data.expiresAt) sessionTokens.delete(token);
  }
}, 5 * 60 * 1000);

function normalizeHost(host) {
  if (!host) return '';
  let h = String(host).toLowerCase().trim();
  if (h.startsWith('www.')) h = h.slice(4);
  return h;
}

function getRequestHostname(req) {
  const origin = req.get('origin') || req.get('referer');
  try {
    return origin ? new URL(origin).hostname : req.hostname;
  } catch {
    return req.hostname;
  }
}

function allowDevInsecureOrigin(hostname) {
  if (process.env.NODE_ENV === 'production') return false;
  if (process.env.ALLOW_INSECURE_LICENSE_ORIGIN !== 'true') return false;
  const n = normalizeHost(hostname);
  return n === 'localhost' || n === '127.0.0.1' || n === '[::1]';
}

// ─── Verify (domain + license OR session + siteId) ─────────────────
router.post('/verify', (req, res) => {
  const { domain, licenseKey, siteId, sessionToken } = req.body;

  if (sessionToken && siteId) {
    const session = sessionTokens.get(sessionToken);
    if (!session || Date.now() > session.expiresAt) {
      sessionTokens.delete(sessionToken);
      return res.json({ valid: false, error: 'Session expired or invalid', tier: 'free' });
    }
    const requestDomain = getRequestHostname(req);
    if (normalizeHost(requestDomain) !== normalizeHost(session.domain)) {
      return res.json({ valid: false, error: 'Domain mismatch', tier: 'free' });
    }
    if (session.siteId !== siteId) {
      return res.json({ valid: false, error: 'Invalid site', tier: 'free' });
    }
    return res.json({
      valid: true,
      tier: session.tier,
      domain: session.domain,
      allowedPermissions: session.permissions
    });
  }

  if (!domain || !licenseKey) {
    return res.status(400).json({ valid: false, error: 'Domain and licenseKey are required (or sessionToken + siteId)', tier: 'free' });
  }

  const cacheKey = `license:${domain}:${licenseKey}`;
  const cached = cache.get(cacheKey);
  if (cached) return res.json(cached);

  const result = verifyLicense(domain, licenseKey);
  cache.set(cacheKey, result, 60000);
  res.json(result);
});

// ─── Token exchange: siteId (preferred) or licenseKey (legacy) ─────
router.post('/token', licenseTokenLimiter, (req, res) => {
  const { licenseKey, siteId } = req.body;
  const domain = getRequestHostname(req);
  const normReq = normalizeHost(domain);

  const finishSession = (site, result) => {
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + SESSION_TTL;
    sessionTokens.set(sessionToken, {
      siteId: site.id,
      domain: site.domain,
      tier: result.tier,
      permissions: result.allowedPermissions,
      expiresAt
    });
    res.json({
      sessionToken,
      siteId: site.id,
      tier: result.tier,
      permissions: result.allowedPermissions,
      expiresIn: SESSION_TTL / 1000
    });
  };

  if (siteId && !licenseKey) {
    const site = findSiteById.get(siteId);
    if (!site || !site.active) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const originOk =
      normReq === normalizeHost(site.domain) ||
      allowDevInsecureOrigin(domain);
    if (!originOk) {
      return res.status(403).json({ error: 'Origin does not match registered site domain' });
    }
    const cacheKey = `license:${site.domain}:${site.license_key}`;
    let result = cache.get(cacheKey);
    if (!result) {
      result = verifyLicense(site.domain, site.license_key);
      cache.set(cacheKey, result, 60000);
    }
    if (!result.valid) {
      return res.status(403).json({ error: result.error || 'Invalid license', tier: 'free' });
    }
    return finishSession(site, result);
  }

  if (!licenseKey) {
    return res.status(400).json({ error: 'siteId or licenseKey is required' });
  }

  const cacheKey = `license:${domain}:${licenseKey}`;
  let result = cache.get(cacheKey);
  if (!result) {
    result = verifyLicense(domain, licenseKey);
    cache.set(cacheKey, result, 60000);
  }
  if (!result.valid) {
    return res.status(403).json({ error: result.error || 'Invalid license', tier: 'free' });
  }

  const site = findSiteByLicense.get(licenseKey);
  if (!site) {
    return res.status(404).json({ error: 'Site not found' });
  }

  finishSession(site, result);
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

  const requestDomain = getRequestHostname(req);
  if (normalizeHost(requestDomain) !== normalizeHost(session.domain)) {
    return res.status(403).json({ valid: false, error: 'Domain mismatch' });
  }

  res.json({
    valid: true,
    siteId: session.siteId,
    tier: session.tier,
    permissions: session.permissions
  });
});

// ─── Analytics track (session-bound; licenseKey deprecated) ──────
router.post('/track', licenseTrackLimiter, (req, res) => {
  const { sessionToken, actionName, agentId, triggerType, success, metadata, licenseKey } = req.body;

  if (!actionName) {
    return res.status(400).json({ error: 'actionName is required' });
  }

  let site;
  if (sessionToken) {
    const session = sessionTokens.get(sessionToken);
    if (!session || Date.now() > session.expiresAt) {
      sessionTokens.delete(sessionToken);
      return res.status(401).json({ error: 'Session expired or invalid' });
    }
    const requestDomain = getRequestHostname(req);
    if (normalizeHost(requestDomain) !== normalizeHost(session.domain)) {
      return res.status(403).json({ error: 'Origin does not match session domain' });
    }
    site = findSiteById.get(session.siteId);
    if (!site || !site.active) {
      return res.status(404).json({ error: 'Site not found' });
    }
  } else if (licenseKey && process.env.ALLOW_LEGACY_LICENSE_TRACK === 'true') {
    site = findSiteByLicense.get(licenseKey);
    if (!site) return res.status(404).json({ error: 'Site not found' });
  } else {
    return res.status(400).json({
      error: 'sessionToken is required. Obtain via POST /api/license/token (see installation snippet).'
    });
  }

  try {
    analyticsQueue.push({
      siteId: site.id,
      actionName,
      agentId,
      triggerType,
      success: success !== false,
      metadata
    });

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
