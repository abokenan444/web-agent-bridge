// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Trust Layer Protocol v2.5
// Open protocol — like HTTPS for platform trust
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';
const WELL_KNOWN_PATH = '/.well-known/wab.json';

// ── WAB Trust Verifier ────────────────────────────────────────────────────
class WABTrustVerifier {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  // Fetch and verify a domain's wab.json file
  async verify(domain) {
    const url = `https://${domain}${WELL_KNOWN_PATH}`;
    let manifest = null;
    let fetchError = null;

    try {
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json', 'X-WAB-Verifier': WAB_VER },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        manifest = await res.json();
      } else {
        fetchError = `HTTP ${res.status}`;
      }
    } catch (e) {
      fetchError = e.message;
    }

    // Validate manifest structure
    const validation = this._validateManifest(manifest);

    // Cross-check with WAB API
    let apiVerification = null;
    if (manifest && validation.valid) {
      try {
        const apiRes = await fetch(`${WAB_API}/trust/verify`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            'X-WAB-SDK': WAB_VER,
          },
          body: JSON.stringify({ domain, manifest }),
        });
        apiVerification = await apiRes.json();
      } catch (e) {
        apiVerification = { verified: false, error: e.message };
      }
    }

    return {
      domain,
      manifest_url:    url,
      manifest_found:  !!manifest,
      fetch_error:     fetchError,
      manifest:        manifest,
      validation:      validation,
      api_verified:    apiVerification?.verified || false,
      wab_certified:   manifest?.wab_certified === true && validation.valid && (apiVerification?.verified || false),
      checked_at:      new Date().toISOString(),
      powered_by:      'WAB Trust Layer Protocol | https://www.webagentbridge.com',
    };
  }

  // Validate the structure of a wab.json manifest
  _validateManifest(manifest) {
    if (!manifest) return { valid: false, errors: ['Manifest not found or not parseable'] };

    const errors = [];
    const warnings = [];

    if (typeof manifest.wab_certified !== 'boolean') errors.push('wab_certified must be a boolean');
    if (typeof manifest.fairness_score !== 'number' || manifest.fairness_score < 0 || manifest.fairness_score > 100)
      errors.push('fairness_score must be a number between 0 and 100');
    if (!manifest.last_audit || isNaN(Date.parse(manifest.last_audit)))
      errors.push('last_audit must be a valid ISO date string');
    if (!manifest.transparency_url || !manifest.transparency_url.startsWith('https://'))
      errors.push('transparency_url must be a valid HTTPS URL');

    // Warnings (non-blocking)
    const auditAge = (Date.now() - Date.parse(manifest.last_audit)) / (1000 * 60 * 60 * 24);
    if (auditAge > 90)  warnings.push(`Audit is ${Math.round(auditAge)} days old (recommended: < 90 days)`);
    if (!manifest.contact_email) warnings.push('contact_email is recommended');
    if (!manifest.dispute_url)   warnings.push('dispute_url is recommended');

    return { valid: errors.length === 0, errors, warnings };
  }
}

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

    const manifest = {
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

    return manifest;
  }

  static toJSON(manifest) {
    return JSON.stringify(manifest, null, 2);
  }

  // Generate the nginx/apache config to serve wab.json
  static nginxConfig(domain) {
    return `# WAB Trust Layer Protocol — nginx config for ${domain}
# Powered by WAB — Web Agent Bridge | https://www.webagentbridge.com

location = /.well-known/wab.json {
    alias /var/www/${domain}/wab.json;
    add_header Content-Type application/json;
    add_header Access-Control-Allow-Origin *;
    add_header Cache-Control "public, max-age=3600";
}`;
  }

  // Generate Express.js middleware to serve wab.json
  static expressMiddleware(manifest) {
    return function wabTrustMiddleware(req, res, next) {
      if (req.path === '/.well-known/wab.json') {
        return res.json({
          ...manifest,
          // Powered by WAB — Web Agent Bridge | https://www.webagentbridge.com
          _powered_by: 'WAB Trust Layer Protocol v2.5 | https://www.webagentbridge.com',
        });
      }
      next();
    };
  }
}

// ── WAB Trust Badge (embeddable) ──────────────────────────────────────────
class WABTrustBadge {
  static async generate(domain, apiKey) {
    const verifier = new WABTrustVerifier(apiKey);
    const result   = await verifier.verify(domain);

    const certified = result.wab_certified;
    const score     = result.manifest?.fairness_score || 0;
    const color     = certified ? '#22c55e' : score > 70 ? '#f59e0b' : '#94a3b8';
    const label     = certified ? 'WAB Certified' : 'Not Certified';
    const icon      = certified ? '✓' : '○';

    return `<a href="https://www.webagentbridge.com/verify/${domain}" target="_blank" rel="noopener noreferrer"
   style="display:inline-flex;align-items:center;gap:8px;background:#fff;border:2px solid ${color};
          border-radius:8px;padding:8px 14px;text-decoration:none;font-family:sans-serif;font-size:13px;">
  <span style="width:20px;height:20px;border-radius:50%;background:${color};color:#fff;
               display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;">${icon}</span>
  <span style="color:#1e293b;font-weight:600;">${label}</span>
  <span style="color:#94a3b8;font-size:11px;">WAB Trust Protocol</span>
</a>`;
  }
}

module.exports = { WABTrustVerifier, WABTrustManifest, WABTrustBadge, WELL_KNOWN_PATH };
