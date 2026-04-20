/**
 * WAB Protocol Validator
 * Validates wab.json files against the WAB Trust Protocol v1.0 spec.
 * Also serves as a public API for fetching and verifying platform declarations.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

// ─── Validation Rules ─────────────────────────────────────────────────────────
const REQUIRED_FIELDS = ['wab_version', 'platform', 'compliance', 'contact'];
const REQUIRED_PLATFORM_FIELDS = ['name', 'domain', 'type', 'jurisdiction'];
const VALID_PLATFORM_TYPES = ['marketplace', 'travel', 'finance', 'social', 'software', 'media', 'other'];
const VALID_COMPLIANCE_STATUSES = ['compliant', 'partial', 'non_compliant', 'exempt'];
const SUPPORTED_VERSIONS = ['1.0'];

// ─── Validator ────────────────────────────────────────────────────────────────
class WABProtocolValidator {
  validate(declaration) {
    const errors = [];
    const warnings = [];
    const score = { total: 0, max: 100 };

    // 1. Check required top-level fields
    for (const field of REQUIRED_FIELDS) {
      if (!declaration[field]) {
        errors.push({ field, message: `Required field '${field}' is missing`, severity: 'ERROR' });
      }
    }

    if (errors.length > 0) {
      return this.buildResult(declaration, errors, warnings, 0, false);
    }

    // 2. Version check
    if (!SUPPORTED_VERSIONS.includes(declaration.wab_version)) {
      errors.push({ field: 'wab_version', message: `Unsupported version '${declaration.wab_version}'. Supported: ${SUPPORTED_VERSIONS.join(', ')}`, severity: 'ERROR' });
    } else {
      score.total += 5;
    }

    // 3. Platform fields
    for (const field of REQUIRED_PLATFORM_FIELDS) {
      if (!declaration.platform[field]) {
        errors.push({ field: `platform.${field}`, message: `Required platform field '${field}' is missing`, severity: 'ERROR' });
      }
    }

    if (declaration.platform.type && !VALID_PLATFORM_TYPES.includes(declaration.platform.type)) {
      errors.push({ field: 'platform.type', message: `Invalid platform type '${declaration.platform.type}'`, severity: 'ERROR' });
    } else {
      score.total += 5;
    }

    if (!Array.isArray(declaration.platform.jurisdiction) || declaration.platform.jurisdiction.length === 0) {
      warnings.push({ field: 'platform.jurisdiction', message: 'At least one jurisdiction should be specified', severity: 'WARNING' });
    } else {
      score.total += 5;
    }

    // 4. Compliance section
    const compliance = declaration.compliance || {};

    if (compliance.eu_dsa) {
      if (!VALID_COMPLIANCE_STATUSES.includes(compliance.eu_dsa.status)) {
        errors.push({ field: 'compliance.eu_dsa.status', message: `Invalid DSA status '${compliance.eu_dsa.status}'`, severity: 'ERROR' });
      } else {
        score.total += 15;
        if (compliance.eu_dsa.status === 'compliant') score.total += 5;
      }
      if (!compliance.eu_dsa.last_audit) {
        warnings.push({ field: 'compliance.eu_dsa.last_audit', message: 'DSA audit date should be provided', severity: 'WARNING' });
      }
    } else {
      warnings.push({ field: 'compliance.eu_dsa', message: 'EU DSA compliance section is missing', severity: 'WARNING' });
    }

    if (compliance.dark_patterns) {
      const dp = compliance.dark_patterns;
      const darkPatternFields = ['confirmshaming', 'hidden_costs', 'fake_urgency', 'roach_motel', 'misdirection'];
      const declared = darkPatternFields.filter(f => typeof dp[f] === 'boolean').length;
      score.total += Math.floor(declared / darkPatternFields.length * 15);

      const violations = darkPatternFields.filter(f => dp[f] === true);
      if (violations.length > 0) {
        warnings.push({
          field: 'compliance.dark_patterns',
          message: `Platform self-declares ${violations.length} dark pattern(s): ${violations.join(', ')}`,
          severity: 'WARNING',
          violations,
        });
      }
    } else {
      warnings.push({ field: 'compliance.dark_patterns', message: 'Dark pattern self-declaration is missing', severity: 'WARNING' });
    }

    // 5. Pricing transparency
    if (declaration.pricing) {
      const pricing = declaration.pricing;
      if (pricing.price_history_available && pricing.price_history_days < 30) {
        errors.push({ field: 'pricing.price_history_days', message: 'EU Omnibus Directive requires minimum 30 days of price history', severity: 'ERROR' });
      } else if (pricing.price_history_available) {
        score.total += 10;
      }
      if (pricing.hidden_fees === false) score.total += 5;
    } else {
      warnings.push({ field: 'pricing', message: 'Pricing transparency section is missing', severity: 'WARNING' });
    }

    // 6. Fairness
    if (declaration.fairness) {
      const fairness = declaration.fairness;
      if (fairness.paid_ranking && !fairness.paid_ranking_labeled) {
        errors.push({ field: 'fairness.paid_ranking_labeled', message: 'EU DSA requires paid rankings to be clearly labeled', severity: 'ERROR' });
      }
      if (fairness.ranking_algorithm_disclosed) score.total += 5;
      if (fairness.review_verification) score.total += 5;
      if (fairness.wab_fairness_score) score.total += 5;
    }

    // 7. Contact
    if (!declaration.contact.legal_email) {
      errors.push({ field: 'contact.legal_email', message: 'Legal email is required', severity: 'ERROR' });
    } else {
      score.total += 5;
    }

    // 8. Meta / signature
    if (declaration.meta) {
      if (declaration.meta.signature) {
        score.total += 10; // Signed by WAB Notary
      }
      if (declaration.meta.valid_until) {
        const validUntil = new Date(declaration.meta.valid_until);
        if (validUntil < new Date()) {
          warnings.push({ field: 'meta.valid_until', message: 'This declaration has expired', severity: 'WARNING' });
        }
      }
    }

    const isValid = errors.filter(e => e.severity === 'ERROR').length === 0;
    return this.buildResult(declaration, errors, warnings, Math.min(100, score.total), isValid);
  }

  buildResult(declaration, errors, warnings, score, isValid) {
    const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F';
    return {
      valid: isValid,
      wab_trust_score: score,
      grade,
      errors: errors.filter(e => e.severity === 'ERROR'),
      warnings,
      platform_name: declaration.platform?.name || 'Unknown',
      platform_domain: declaration.platform?.domain || 'Unknown',
      validated_at: new Date().toISOString(),
      protocol_version: '1.0',
      summary: isValid
        ? `Platform declaration is valid. Trust Score: ${score}/100 (Grade ${grade})`
        : `Declaration has ${errors.filter(e => e.severity === 'ERROR').length} error(s) that must be fixed.`,
    };
  }

  // Fetch and validate a live wab.json from a domain
  async fetchAndValidate(domain) {
    return new Promise((resolve) => {
      const cleanDomain = domain.replace(/^https?:\/\//, '').split('/')[0];
      const options = {
        hostname: cleanDomain,
        path: '/wab.json',
        method: 'GET',
        timeout: 5000,
        headers: { 'User-Agent': 'WAB-Protocol-Validator/1.0' },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const declaration = JSON.parse(data);
            const validation = this.validate(declaration);
            resolve({ found: true, domain: cleanDomain, url: `https://${cleanDomain}/wab.json`, ...validation, raw: declaration });
          } catch (e) {
            resolve({ found: true, domain: cleanDomain, valid: false, error: 'Invalid JSON in wab.json', raw_response: data.substring(0, 200) });
          }
        });
      });

      req.on('error', () => {
        resolve({ found: false, domain: cleanDomain, valid: false, error: 'No wab.json found at this domain', suggestion: `Add a wab.json file at https://${cleanDomain}/wab.json to participate in the WAB Trust Protocol` });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ found: false, domain: cleanDomain, valid: false, error: 'Request timed out' });
      });

      req.end();
    });
  }
}

const validator = new WABProtocolValidator();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  // POST /protocol/validate — Validate a wab.json document
  if (req.method === 'POST' && parsedUrl.pathname === '/protocol/validate') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const declaration = JSON.parse(body);
        res.writeHead(200);
        res.end(JSON.stringify(validator.validate(declaration)));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON: ' + e.message })); }
    });
    return;
  }

  // GET /protocol/check/:domain — Fetch and validate live wab.json
  const checkMatch = parsedUrl.pathname.match(/^\/protocol\/check\/(.+)$/);
  if (req.method === 'GET' && checkMatch) {
    validator.fetchAndValidate(checkMatch[1]).then(result => {
      res.writeHead(200);
      res.end(JSON.stringify(result));
    });
    return;
  }

  // GET /protocol/spec — Return the JSON Schema spec
  if (req.method === 'GET' && parsedUrl.pathname === '/protocol/spec') {
    const fs = require('fs');
    const specPath = require('path').join(__dirname, '../spec/wab-protocol-v1.json');
    try {
      const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
      res.writeHead(200);
      res.end(JSON.stringify(spec));
    } catch (e) {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Spec file not found' }));
    }
    return;
  }

  if (parsedUrl.pathname === '/protocol/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy', protocol_version: '1.0' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_PROTOCOL_PORT) || 3008;
server.listen(PORT, () => {
  console.log(`[WAB Protocol Validator] Running on port ${PORT}`);
});

module.exports = { WABProtocolValidator };
