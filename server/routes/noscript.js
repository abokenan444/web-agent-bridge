const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { findSiteById, findSiteByLicense, recordAnalytic, verifyLicense, db } = require('../models/db');
const { broadcastAnalytic } = require('../ws');
let premium;
try { premium = require('../services/premium'); } catch (_) { premium = null; }

const rateLimit = require('express-rate-limit');

const TRANSPARENT_GIF = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

const WAB_VERSION = '1.1.0';

// ─── Rate limiter for pixel endpoint (300 req/min per IP) ────────────
const pixelLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler(_req, res) {
    res.set('Content-Type', 'image/gif');
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.end(TRANSPARENT_GIF);
  }
});

// ─── Helpers ─────────────────────────────────────────────────────────

function sendGif(res) {
  res.set('Content-Type', 'image/gif');
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.end(TRANSPARENT_GIF);
}

function getSiteConfig(site) {
  let config = {};
  try { config = JSON.parse(site.config || '{}'); } catch (_) {}
  return config;
}

function getPermissionsList(config) {
  const perms = config.agentPermissions || {};
  return Object.entries(perms)
    .filter(([, v]) => v)
    .map(([k]) => k);
}

function premiumIntegrate(siteId, actionName, req) {
  if (!premium) return;
  try {
    const ua = req.headers['user-agent'] || '';
    const ip = req.ip || req.connection.remoteAddress || '';
    premium.recordAgentVisit(siteId, { userAgent: ua, ip });
    premium.triggerWebhooks(siteId, 'noscript.track', {
      actionName,
      source: 'noscript'
    }).catch(() => {});
    premium.logAudit(siteId, {
      action: actionName,
      resourceType: 'noscript',
      details: { source: 'noscript' },
      ipAddress: ip,
      userAgent: ua
    });
  } catch (_) {}
}

// ═════════════════════════════════════════════════════════════════════
// 1. Tracking Pixel: GET /pixel/:siteId
// ═════════════════════════════════════════════════════════════════════

router.get('/pixel/:siteId', pixelLimiter, (req, res) => {
  try {
    const site = findSiteById.get(req.params.siteId);
    if (!site) return sendGif(res);

    const action = req.query.action || 'pageview';
    const ref = req.query.ref || null;
    const agent = req.query.agent || null;
    const t = req.query.t || null;

    recordAnalytic({
      siteId: site.id,
      actionName: action,
      agentId: agent,
      triggerType: t || 'noscript_pixel',
      success: true,
      metadata: { ref, source: 'noscript_pixel' }
    });

    broadcastAnalytic(site.id, {
      actionName: action,
      agentId: agent,
      triggerType: t || 'noscript_pixel',
      success: true
    });

    premiumIntegrate(site.id, action, req);
  } catch (_) {
    // Always return the GIF regardless of errors
  }

  sendGif(res);
});

// ═════════════════════════════════════════════════════════════════════
// 2. CSS Tracker: GET /css/:siteId
// ═════════════════════════════════════════════════════════════════════

router.get('/css/:siteId', (req, res) => {
  try {
    const siteId = req.params.siteId;
    const site = findSiteById.get(siteId);
    if (!site) {
      res.status(404).set('Content-Type', 'text/css').end('/* site not found */');
      return;
    }

    const p = `/api/noscript/pixel/${siteId}`;

    const css = `/* WAB NoScript CSS Tracker — ${siteId} */

/* Page load tracking */
body::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  overflow: hidden;
  background-image: url('${p}?action=css_pageview&t=css');
}

/* Form submission tracking */
form:focus-within::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  overflow: hidden;
  background-image: url('${p}?action=form_interaction&t=css');
}

/* Link hover tracking (captures intent) */
a:hover::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  overflow: hidden;
  background-image: url('${p}?action=link_hover&t=css');
}

/* Scroll tracking via anchor detection */
:target::before {
  content: '';
  display: block;
  width: 0;
  height: 0;
  overflow: hidden;
  background-image: url('${p}?action=anchor_navigate&t=css');
}

/* Input focus tracking */
input:focus ~ .wab-track, textarea:focus ~ .wab-track, select:focus ~ .wab-track {
  background-image: url('${p}?action=input_focus&t=css');
}

/* Checkbox/radio change tracking */
input[type="checkbox"]:checked ~ .wab-track {
  background-image: url('${p}?action=checkbox_check&t=css');
}

/* Print detection */
@media print {
  body::before {
    content: '';
    display: block;
    width: 0;
    height: 0;
    overflow: hidden;
    background-image: url('${p}?action=print&t=css');
  }
}

/* Custom data attribute tracking: [data-wab-track] */
[data-wab-track]:hover::after {
  content: '';
  display: block;
  width: 0;
  height: 0;
  overflow: hidden;
  background-image: url('${p}?action=custom_hover&t=css');
}
`;

    res.set('Content-Type', 'text/css');
    res.set('Cache-Control', 'no-store');
    res.set('X-Content-Type-Options', 'nosniff');
    res.end(css);
  } catch (err) {
    res.status(500).set('Content-Type', 'text/css').end('/* internal error */');
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3. SSR Bridge Page: GET /bridge/:siteId
// ═════════════════════════════════════════════════════════════════════

router.get('/bridge/:siteId', (req, res) => {
  try {
    const site = findSiteById.get(req.params.siteId);
    if (!site) return res.status(404).send('<!DOCTYPE html><html><body><h1>Site not found</h1></body></html>');

    const siteId = site.id;
    const config = getSiteConfig(site);
    const permissions = getPermissionsList(config);
    const permissionsStr = permissions.join(',') || 'none';
    const siteName = site.name || site.domain;

    const permissionsObj = config.agentPermissions || {};
    const ldJson = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Web Agent Bridge',
      applicationCategory: 'AI Agent Middleware',
      operatingSystem: 'Any',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      'wab:siteId': siteId,
      'wab:tier': site.tier,
      'wab:permissions': permissionsObj,
      'wab:domain': site.domain,
      'wab:noscriptEndpoints': {
        pixel: `/api/noscript/pixel/${siteId}`,
        css: `/api/noscript/css/${siteId}`,
        form: '/api/noscript/action',
        serverTrack: '/api/noscript/server-track'
      }
    }, null, 2);

    const permissionsListHtml = permissions.length > 0
      ? permissions.map(p => `<li>${escapeHtml(p)}</li>`).join('\n            ')
      : '<li>No permissions enabled</li>';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="wab:site-id" content="${escapeAttr(siteId)}">
  <meta name="wab:tier" content="${escapeAttr(site.tier)}">
  <meta name="wab:version" content="${WAB_VERSION}">
  <meta name="wab:permissions" content="${escapeAttr(permissionsStr)}">
  <meta name="wab:noscript" content="true">
  <link rel="stylesheet" href="/api/noscript/css/${escapeAttr(siteId)}">
  <title>WAB Bridge &mdash; ${escapeHtml(siteName)}</title>
  <script type="application/ld+json">
${ldJson}
  </script>
</head>
<body itemscope itemtype="https://schema.org/WebApplication">
  <meta itemprop="name" content="Web Agent Bridge">
  <meta itemprop="applicationCategory" content="AI Agent Middleware">
  <meta itemprop="operatingSystem" content="Any">

  <h1>Web Agent Bridge &mdash; ${escapeHtml(siteName)}</h1>
  <p>This page provides a JavaScript-free interface for AI agents.</p>

  <section id="config">
    <h2>Site Configuration</h2>
    <dl>
      <dt>Site ID</dt><dd>${escapeHtml(siteId)}</dd>
      <dt>Domain</dt><dd>${escapeHtml(site.domain)}</dd>
      <dt>Tier</dt><dd>${escapeHtml(site.tier)}</dd>
      <dt>Permissions</dt>
      <dd><ul>
            ${permissionsListHtml}
      </ul></dd>
    </dl>
  </section>

  <section id="actions">
    <h2>Available Actions</h2>
    <form method="POST" action="/api/noscript/action">
      <input type="hidden" name="siteId" value="${escapeAttr(siteId)}">
      <p><label>Action Name: <input type="text" name="actionName" required></label></p>
      <p><label>Agent ID: <input type="text" name="agentId"></label></p>
      <p><label>Data (JSON): <textarea name="data" rows="4" cols="50"></textarea></label></p>
      <p><button type="submit">Execute Action</button></p>
    </form>
  </section>

  <section id="agent-instructions">
    <h2>AI Agent Integration (No-JS Mode)</h2>
    <h3>Tracking Pixel</h3>
    <pre>&lt;img src="/api/noscript/pixel/${escapeHtml(siteId)}?action=pageview" width="1" height="1" alt=""&gt;</pre>
    <h3>CSS Tracker</h3>
    <pre>&lt;link rel="stylesheet" href="/api/noscript/css/${escapeHtml(siteId)}"&gt;</pre>
    <h3>Server-to-Server API</h3>
    <pre>POST /api/noscript/server-track
Content-Type: application/json
X-WAB-API-Key: YOUR_API_KEY
{ "siteId": "${escapeHtml(siteId)}", "actionName": "...", "agentId": "...", "metadata": {} }</pre>
  </section>

  <noscript>
    <img src="/api/noscript/pixel/${escapeAttr(siteId)}?action=bridge_view" width="1" height="1" alt="">
  </noscript>
</body>
</html>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('X-WAB-SiteId', siteId);
    res.set('X-WAB-Tier', site.tier);
    res.set('X-WAB-Version', WAB_VERSION);
    res.send(html);
  } catch (err) {
    res.status(500).send('<!DOCTYPE html><html><body><h1>Internal Server Error</h1></body></html>');
  }
});

// ═════════════════════════════════════════════════════════════════════
// 4. Form Action Handler: POST /action
// ═════════════════════════════════════════════════════════════════════

router.post('/action', express.urlencoded({ extended: false }), (req, res) => {
  try {
    const { siteId, actionName, agentId, data, redirect } = req.body;

    if (!siteId || !actionName) {
      return res.status(400).send(buildSimplePage('Bad Request', '<p>siteId and actionName are required.</p>'));
    }

    const referer = req.get('referer') || req.get('origin') || '';
    if (!referer) {
      return res.status(403).send(buildSimplePage('Forbidden', '<p>Missing Referer header.</p>'));
    }

    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).send(buildSimplePage('Not Found', '<p>Site not found.</p>'));
    }

    let metadata = {};
    if (data) {
      try { metadata = JSON.parse(data); } catch (_) { metadata = { raw: data }; }
    }

    recordAnalytic({
      siteId: site.id,
      actionName,
      agentId: agentId || null,
      triggerType: 'noscript_form',
      success: true,
      metadata
    });

    broadcastAnalytic(site.id, {
      actionName,
      agentId: agentId || null,
      triggerType: 'noscript_form',
      success: true
    });

    premiumIntegrate(site.id, actionName, req);

    if (redirect && isSafeRedirect(redirect, site.domain, referer)) {
      return res.redirect(303, redirect);
    }

    res.send(buildSimplePage('Action Recorded', `
      <p>Your action <strong>${escapeHtml(actionName)}</strong> has been recorded successfully.</p>
      <p><a href="/api/noscript/bridge/${escapeAttr(siteId)}">Back to Bridge</a></p>
    `));
  } catch (err) {
    res.status(500).send(buildSimplePage('Error', '<p>An internal error occurred.</p>'));
  }
});

// ═════════════════════════════════════════════════════════════════════
// 5. Server-to-Server Track: POST /server-track
// ═════════════════════════════════════════════════════════════════════

router.post('/server-track', express.json(), (req, res) => {
  try {
    const apiKey = req.get('X-WAB-API-Key');
    if (!apiKey) {
      return res.status(401).json({ error: 'X-WAB-API-Key header is required' });
    }

    const { siteId, actionName, agentId, triggerType, success, metadata } = req.body;
    if (!siteId || !actionName) {
      return res.status(400).json({ error: 'siteId and actionName are required' });
    }

    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    if (site.api_key !== apiKey) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    recordAnalytic({
      siteId: site.id,
      actionName,
      agentId: agentId || null,
      triggerType: triggerType || 'server',
      success: success !== false,
      metadata: metadata || {}
    });

    broadcastAnalytic(site.id, {
      actionName,
      agentId: agentId || null,
      triggerType: triggerType || 'server',
      success: success !== false
    });

    premiumIntegrate(site.id, actionName, req);

    res.json({ recorded: true, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to record analytics' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6. Embed Snippet: GET /embed/:siteId
// ═════════════════════════════════════════════════════════════════════

router.get('/embed/:siteId', (req, res) => {
  try {
    const siteId = req.params.siteId;
    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).set('Content-Type', 'text/html').end('<!-- site not found -->');
    }

    const html = `<div id="wab-noscript-embed" style="position:absolute;width:0;height:0;overflow:hidden;">
  <img src="/api/noscript/pixel/${escapeAttr(siteId)}?action=embed_load" width="1" height="1" alt="">
  <link rel="stylesheet" href="/api/noscript/css/${escapeAttr(siteId)}">
</div>`;

    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    res.status(500).set('Content-Type', 'text/html').end('<!-- internal error -->');
  }
});

// ═════════════════════════════════════════════════════════════════════
// 7. Health/Status: GET /status/:siteId
// ═════════════════════════════════════════════════════════════════════

router.get('/status/:siteId', (req, res) => {
  try {
    const siteId = req.params.siteId;
    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }

    res.json({
      siteId: site.id,
      active: !!site.active,
      tier: site.tier,
      noscriptEnabled: true,
      endpoints: {
        pixel: `/api/noscript/pixel/${siteId}`,
        css: `/api/noscript/css/${siteId}`,
        bridge: `/api/noscript/bridge/${siteId}`,
        form: '/api/noscript/action',
        serverTrack: '/api/noscript/server-track',
        embed: `/api/noscript/embed/${siteId}`
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Utility functions ───────────────────────────────────────────────

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(str) {
  return escapeHtml(str);
}

function buildSimplePage(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${escapeHtml(title)}</title></head>
<body>
  <h1>${escapeHtml(title)}</h1>
  ${bodyContent}
</body>
</html>`;
}

function isSafeRedirect(url, siteDomain, referer) {
  try {
    const parsed = new URL(url, 'http://placeholder');

    if (parsed.hostname === 'placeholder' || !parsed.hostname) return true;

    const normTarget = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const normSite = (siteDomain || '').toLowerCase().replace(/^www\./, '');

    if (normTarget === normSite) return true;

    if (referer) {
      try {
        const refHost = new URL(referer).hostname.toLowerCase().replace(/^www\./, '');
        if (normTarget === refHost) return true;
      } catch (_) {}
    }

    return false;
  } catch (_) {
    return false;
  }
}

module.exports = router;
