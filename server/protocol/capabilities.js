'use strict';

/**
 * WAB Protocol (WABP) - Capabilities Negotiation
 * 
 * Dynamic capability negotiation between agents and sites.
 * Agents request capabilities → sites grant/deny based on policies.
 */

const crypto = require('crypto');

// ─── Capability Grant ───────────────────────────────────────────────────────

class CapabilityGrant {
  constructor(agentId, capabilities, constraints = {}) {
    this.id = `grant_${crypto.randomBytes(16).toString('hex')}`;
    this.agentId = agentId;
    this.capabilities = new Set(capabilities);
    this.constraints = {
      maxCalls: constraints.maxCalls || Infinity,
      expiresAt: constraints.expiresAt || (Date.now() + 3600_000),
      allowedDomains: constraints.allowedDomains || ['*'],
      rateLimit: constraints.rateLimit || { maxPerMinute: 60 },
      ipRestriction: constraints.ipRestriction || null,
    };
    this.usage = { calls: 0, lastUsed: 0 };
    this.revoked = false;
    this.createdAt = Date.now();
  }

  has(capability) {
    if (this.revoked) return false;
    if (Date.now() > this.constraints.expiresAt) return false;
    if (this.usage.calls >= this.constraints.maxCalls) return false;
    return this.capabilities.has(capability);
  }

  use(capability) {
    if (!this.has(capability)) return false;
    this.usage.calls++;
    this.usage.lastUsed = Date.now();
    return true;
  }

  revoke() {
    this.revoked = true;
  }

  toJSON() {
    return {
      id: this.id,
      agentId: this.agentId,
      capabilities: [...this.capabilities],
      constraints: this.constraints,
      usage: this.usage,
      revoked: this.revoked,
      createdAt: this.createdAt,
    };
  }
}

// ─── Capability Negotiator ──────────────────────────────────────────────────

class CapabilityNegotiator {
  constructor() {
    this._grants = new Map();      // grantId → CapabilityGrant
    this._agentGrants = new Map(); // agentId → Set<grantId>
    this._policies = new Map();    // siteId → policy object
  }

  /**
   * Set site-level capability policy
   */
  setPolicy(siteId, policy) {
    this._policies.set(siteId, {
      allowedCapabilities: new Set(policy.allowedCapabilities || []),
      deniedCapabilities: new Set(policy.deniedCapabilities || []),
      requireApproval: new Set(policy.requireApproval || []),
      maxGrantDuration: policy.maxGrantDuration || 3600_000,
      defaultRateLimit: policy.defaultRateLimit || { maxPerMinute: 60 },
      autoGrant: policy.autoGrant !== false,
    });
  }

  /**
   * Negotiate capabilities for an agent
   * Returns: { granted: string[], denied: string[], pending: string[], grant: CapabilityGrant }
   */
  negotiate(agentId, requestedCapabilities, siteId, constraints = {}) {
    const policy = this._policies.get(siteId);
    const granted = [];
    const denied = [];
    const pending = [];

    for (const cap of requestedCapabilities) {
      if (policy) {
        if (policy.deniedCapabilities.has(cap)) {
          denied.push(cap);
        } else if (policy.requireApproval.has(cap)) {
          pending.push(cap);
        } else if (policy.allowedCapabilities.has(cap) || policy.allowedCapabilities.has('*')) {
          granted.push(cap);
        } else if (policy.autoGrant) {
          granted.push(cap);
        } else {
          denied.push(cap);
        }
      } else {
        // No policy = grant low-risk capabilities only
        const riskLevel = _getCapabilityRisk(cap);
        if (riskLevel === 'low') granted.push(cap);
        else if (riskLevel === 'medium') pending.push(cap);
        else denied.push(cap);
      }
    }

    let grant = null;
    if (granted.length > 0) {
      const maxDuration = policy ? policy.maxGrantDuration : 3600_000;
      grant = new CapabilityGrant(agentId, granted, {
        ...constraints,
        expiresAt: Date.now() + Math.min(constraints.duration || maxDuration, maxDuration),
        rateLimit: policy ? policy.defaultRateLimit : constraints.rateLimit,
      });
      this._grants.set(grant.id, grant);
      if (!this._agentGrants.has(agentId)) this._agentGrants.set(agentId, new Set());
      this._agentGrants.get(agentId).add(grant.id);
    }

    return { granted, denied, pending, grant };
  }

  /**
   * Check if agent has capability via any active grant
   */
  check(agentId, capability) {
    const grantIds = this._agentGrants.get(agentId);
    if (!grantIds) return false;
    for (const gid of grantIds) {
      const grant = this._grants.get(gid);
      if (grant && grant.has(capability)) return true;
    }
    return false;
  }

  /**
   * Use a capability (decrements usage counter)
   */
  use(agentId, capability) {
    const grantIds = this._agentGrants.get(agentId);
    if (!grantIds) return false;
    for (const gid of grantIds) {
      const grant = this._grants.get(gid);
      if (grant && grant.use(capability)) return true;
    }
    return false;
  }

  /**
   * Revoke all grants for an agent
   */
  revokeAgent(agentId) {
    const grantIds = this._agentGrants.get(agentId);
    if (!grantIds) return;
    for (const gid of grantIds) {
      const grant = this._grants.get(gid);
      if (grant) grant.revoke();
    }
    this._agentGrants.delete(agentId);
  }

  /**
   * Get all active grants for an agent
   */
  getGrants(agentId) {
    const grantIds = this._agentGrants.get(agentId);
    if (!grantIds) return [];
    const grants = [];
    for (const gid of grantIds) {
      const grant = this._grants.get(gid);
      if (grant && !grant.revoked && Date.now() <= grant.constraints.expiresAt) {
        grants.push(grant.toJSON());
      }
    }
    return grants;
  }

  /**
   * Cleanup expired grants
   */
  cleanup() {
    const now = Date.now();
    for (const [gid, grant] of this._grants) {
      if (grant.revoked || now > grant.constraints.expiresAt) {
        this._grants.delete(gid);
        const agentGrants = this._agentGrants.get(grant.agentId);
        if (agentGrants) {
          agentGrants.delete(gid);
          if (agentGrants.size === 0) this._agentGrants.delete(grant.agentId);
        }
      }
    }
  }
}

// ─── Risk Assessment ────────────────────────────────────────────────────────

const _riskMap = {
  'browser.read': 'low', 'browser.scroll': 'low', 'browser.screenshot': 'low',
  'browser.click': 'medium', 'browser.fill': 'medium', 'browser.navigate': 'medium',
  'browser.execute': 'high',
  'data.extract': 'low', 'data.compare': 'low', 'data.store': 'medium',
  'agent.communicate': 'medium', 'agent.spawn': 'high', 'agent.delegate': 'high',
  'system.api': 'high', 'system.webhook': 'high', 'system.schedule': 'medium',
  'commerce.price': 'low', 'commerce.negotiate': 'high', 'commerce.purchase': 'critical',
  'ai.infer': 'medium', 'ai.vision': 'low', 'ai.embed': 'low',
};

function _getCapabilityRisk(capability) {
  return _riskMap[capability] || 'high';
}

module.exports = { CapabilityGrant, CapabilityNegotiator };
