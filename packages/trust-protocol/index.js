// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Trust Protocol — Manifest Generator v2.5
// Open source — MIT License
//
// This module provides tools to generate and serve wab.json manifests.
// The verification engine is proprietary (server-side only).
//
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WELL_KNOWN_PATH = '/.well-known/wab.json';

// ── WAB Trust Manifest Generator ─────────────────────────────────────────
class WABTrustManifest {
  static generate(options = {}) {
    const {
      domain,
      fairnessScore = 0,
      contactEmail  = '',
      disputeUrl    = '',
      policies      = [],
    } = options;

    if (!domain) throw new Error('domain is required');

    return {
      wab_certified:     false, // Set to true after official WAB audit
      fairness_score:    fairnessScore,
      last_audit:        new Date().toISOString().split('T')[0],
      transparency_url:  `https://www.webagentbridge.com/verify/${domain}`,
      contact_email:     contactEmail,
      dispute_url:       disputeUrl || `https://${domain}/disputes`,
      policies: {
        hidden_fees:     policies.includes('no-hidden-fees'),
        fair_reviews:    policies.includes('fair-reviews'),
        data_privacy:    policies.includes('data-privacy'),
        seller_fairness: policies.includes('seller-fairness'),
      },
      schema_version:    '2.5',
      powered_by:        'WAB Trust Layer Protocol | https://www.webagentbridge.com',
    };
  }

  static toJSON(manifest) {
    return JSON.stringify(manifest, null, 2);
  }

  // Generate nginx config to serve wab.json
  static nginxConfig(domain) {
    return `# WAB Trust Layer Protocol — nginx config for ${domain}
location = /.well-known/wab.json {
    alias /var/www/${domain}/wab.json;
    add_header Content-Type application/json;
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "public, max-age=3600";
}`;
  }

  // Express.js middleware to serve wab.json
  static expressMiddleware(manifest) {
    return function wabTrustMiddleware(req, res, next) {
      if (req.path === '/.well-known/wab.json') {
        return res.json(manifest);
      }
      next();
    };
  }
}

module.exports = { WABTrustManifest, WELL_KNOWN_PATH };
