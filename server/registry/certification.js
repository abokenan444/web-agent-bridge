'use strict';

/**
 * Agent Certification System
 *
 * Verifies that sites are agent-compatible, issues badges/certificates,
 * and enforces compliance checks for the WAP ecosystem.
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');

const CertLevel = {
  NONE: 'none',
  BASIC: 'basic',         // Has WAB script, basic commands exposed
  STANDARD: 'standard',   // Structured data, capability negotiation
  PREMIUM: 'premium',     // Full WAP support, semantic actions, discovery
  SOVEREIGN: 'sovereign', // P2P, no intermediary, full protocol
};

class CertificationEngine {
  constructor() {
    this._certificates = new Map();    // domain → Certificate
    this._checks = this._defaultChecks();
  }

  /**
   * Verify a site's agent compatibility
   */
  async verify(domain, probeData = {}) {
    const result = {
      domain,
      timestamp: Date.now(),
      level: CertLevel.NONE,
      checks: [],
      score: 0,
      maxScore: 0,
      badge: null,
      expiresAt: null,
    };

    // Run all checks
    for (const check of this._checks) {
      result.maxScore += check.weight;
      const checkResult = {
        name: check.name,
        category: check.category,
        weight: check.weight,
        passed: false,
        details: null,
      };

      try {
        const passed = check.test(probeData);
        checkResult.passed = passed;
        if (passed) result.score += check.weight;
      } catch (err) {
        checkResult.details = err.message;
      }

      result.checks.push(checkResult);
    }

    // Determine certification level
    const ratio = result.maxScore > 0 ? result.score / result.maxScore : 0;
    if (ratio >= 0.9) result.level = CertLevel.SOVEREIGN;
    else if (ratio >= 0.7) result.level = CertLevel.PREMIUM;
    else if (ratio >= 0.5) result.level = CertLevel.STANDARD;
    else if (ratio >= 0.25) result.level = CertLevel.BASIC;

    // Generate certificate if passes basic
    if (result.level !== CertLevel.NONE) {
      const cert = this._issueCertificate(domain, result);
      result.badge = cert.badge;
      result.expiresAt = cert.expiresAt;
      result.certificateId = cert.id;
    }

    bus.emit('certification.verified', {
      domain,
      level: result.level,
      score: result.score,
      maxScore: result.maxScore,
    });

    return result;
  }

  /**
   * Get certificate for a domain
   */
  getCertificate(domain) {
    const cert = this._certificates.get(domain);
    if (!cert) return null;
    if (cert.expiresAt < Date.now()) {
      this._certificates.delete(domain);
      return null;
    }
    return cert;
  }

  /**
   * List all active certificates
   */
  listCertificates(filters = {}, limit = 50) {
    const now = Date.now();
    let certs = Array.from(this._certificates.values()).filter(c => c.expiresAt >= now);

    if (filters.level) certs = certs.filter(c => c.level === filters.level);
    if (filters.minScore) certs = certs.filter(c => c.score >= filters.minScore);

    return certs.slice(0, limit).map(c => ({
      id: c.id,
      domain: c.domain,
      level: c.level,
      score: c.score,
      maxScore: c.maxScore,
      issuedAt: c.issuedAt,
      expiresAt: c.expiresAt,
      badge: c.badge,
    }));
  }

  /**
   * Revoke a certificate
   */
  revoke(domain) {
    this._certificates.delete(domain);
    bus.emit('certification.revoked', { domain });
  }

  /**
   * Get badge URL for a certification level
   */
  getBadge(level) {
    return `/badge/agent-${level}.svg`;
  }

  getStats() {
    return {
      totalCertificates: this._certificates.size,
      byLevel: this._countByLevel(),
      checks: this._checks.length,
    };
  }

  // ── Internal ──

  _issueCertificate(domain, result) {
    const id = `cert_${crypto.randomBytes(8).toString('hex')}`;
    const cert = {
      id,
      domain,
      level: result.level,
      score: result.score,
      maxScore: result.maxScore,
      checks: result.checks.map(c => ({ name: c.name, passed: c.passed })),
      issuedAt: Date.now(),
      expiresAt: Date.now() + 90 * 24 * 3600_000,  // 90 days
      badge: this.getBadge(result.level),
      signature: this._signCertificate(id, domain, result.level),
    };

    this._certificates.set(domain, cert);
    return cert;
  }

  _signCertificate(id, domain, level) {
    const secret = process.env.WAB_CERT_SECRET || 'wab-certification-key';
    return crypto
      .createHmac('sha256', secret)
      .update(`${id}:${domain}:${level}`)
      .digest('hex')
      .slice(0, 32);
  }

  _countByLevel() {
    const counts = {};
    for (const cert of this._certificates.values()) {
      counts[cert.level] = (counts[cert.level] || 0) + 1;
    }
    return counts;
  }

  _defaultChecks() {
    return [
      {
        name: 'wab_script_present',
        category: 'integration',
        weight: 10,
        test: (data) => !!(data.hasWABScript || data.wabVersion),
      },
      {
        name: 'well_known_discovery',
        category: 'protocol',
        weight: 10,
        test: (data) => !!(data.wellKnown || data.agentToolsJson),
      },
      {
        name: 'structured_metadata',
        category: 'data',
        weight: 8,
        test: (data) => !!(data.jsonLd || data.structuredData || data.openGraph),
      },
      {
        name: 'semantic_actions',
        category: 'protocol',
        weight: 10,
        test: (data) => !!(data.semanticActions && data.semanticActions.length > 0),
      },
      {
        name: 'capability_negotiation',
        category: 'security',
        weight: 10,
        test: (data) => !!data.capabilityNegotiation,
      },
      {
        name: 'command_schema',
        category: 'protocol',
        weight: 8,
        test: (data) => !!(data.commands && data.commands.length > 0),
      },
      {
        name: 'https_enabled',
        category: 'security',
        weight: 5,
        test: (data) => data.https !== false,
      },
      {
        name: 'cors_agent_friendly',
        category: 'security',
        weight: 5,
        test: (data) => !!data.corsAllowsAgents,
      },
      {
        name: 'rate_limit_info',
        category: 'fairness',
        weight: 5,
        test: (data) => !!data.rateLimitInfo,
      },
      {
        name: 'error_handling',
        category: 'reliability',
        weight: 5,
        test: (data) => !!data.errorSchemaProvided,
      },
      {
        name: 'data_privacy_declaration',
        category: 'compliance',
        weight: 7,
        test: (data) => !!(data.privacyPolicy || data.dataUsagePolicy),
      },
      {
        name: 'agent_terms_of_service',
        category: 'compliance',
        weight: 7,
        test: (data) => !!data.agentTOS,
      },
      {
        name: 'p2p_sovereign_support',
        category: 'sovereignty',
        weight: 10,
        test: (data) => !!data.sovereignMode,
      },
    ];
  }
}

const certificationEngine = new CertificationEngine();

module.exports = { CertificationEngine, CertLevel, certificationEngine };
