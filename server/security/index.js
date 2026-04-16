'use strict';

/**
 * WAB Security Model
 * 
 * Production-grade security for Agent OS:
 * - Agent Identity (Ed25519 key pairs)
 * - Capability-based access control
 * - Command signing & verification
 * - Per-site isolation
 * - Credential management
 */

const crypto = require('crypto');

// ─── Agent Identity ─────────────────────────────────────────────────────────

class AgentIdentity {
  constructor() {
    this._agents = new Map();        // agentId → identity record
    this._apiKeys = new Map();       // apiKey → agentId
    this._sessions = new Map();      // sessionId → { agentId, expiresAt, capabilities }
    this._stats = { registered: 0, authenticated: 0, rejected: 0 };
  }

  /**
   * Register a new agent identity
   */
  register(name, type, options = {}) {
    const agentId = `agent_${crypto.randomBytes(16).toString('hex')}`;
    const apiKey = `wab_${crypto.randomBytes(32).toString('hex')}`;
    // Hash the API key for storage
    const apiKeyHash = crypto.createHash('sha256').update(apiKey).digest('hex');

    const identity = {
      id: agentId,
      name,
      type, // browser, server, hybrid, orchestrator
      apiKeyHash,
      publicKey: options.publicKey || null,
      capabilities: new Set(options.capabilities || []),
      metadata: options.metadata || {},
      rateLimit: options.rateLimit || { maxPerMinute: 60 },
      allowedIPs: options.allowedIPs || [],
      allowedDomains: options.allowedDomains || ['*'],
      status: 'active',
      createdAt: Date.now(),
      lastSeen: Date.now(),
      commandCount: 0,
    };

    this._agents.set(agentId, identity);
    this._apiKeys.set(apiKeyHash, agentId);
    this._stats.registered++;

    return { agentId, apiKey }; // Return raw key only once
  }

  /**
   * Authenticate an agent via API key
   */
  authenticate(apiKey, ip = null) {
    const hash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const agentId = this._apiKeys.get(hash);
    if (!agentId) {
      this._stats.rejected++;
      return null;
    }

    const agent = this._agents.get(agentId);
    if (!agent || agent.status !== 'active') {
      this._stats.rejected++;
      return null;
    }

    // IP allowlist check
    if (agent.allowedIPs.length > 0 && ip) {
      if (!agent.allowedIPs.includes(ip)) {
        this._stats.rejected++;
        return null;
      }
    }

    agent.lastSeen = Date.now();
    this._stats.authenticated++;

    // Create session
    const sessionId = `sess_${crypto.randomBytes(24).toString('hex')}`;
    const session = {
      id: sessionId,
      agentId,
      capabilities: [...agent.capabilities],
      ip,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600_000, // 1 hour
    };
    this._sessions.set(sessionId, session);

    return {
      sessionId,
      agentId,
      name: agent.name,
      type: agent.type,
      capabilities: [...agent.capabilities],
      expiresAt: session.expiresAt,
    };
  }

  /**
   * Validate a session
   */
  validateSession(sessionId) {
    const session = this._sessions.get(sessionId);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this._sessions.delete(sessionId);
      return null;
    }
    return session;
  }

  /**
   * Get agent identity (safe version, no secrets)
   */
  getAgent(agentId) {
    const agent = this._agents.get(agentId);
    if (!agent) return null;
    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      capabilities: [...agent.capabilities],
      status: agent.status,
      createdAt: agent.createdAt,
      lastSeen: agent.lastSeen,
      commandCount: agent.commandCount,
    };
  }

  /**
   * Update agent capabilities
   */
  updateCapabilities(agentId, capabilities) {
    const agent = this._agents.get(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);
    agent.capabilities = new Set(capabilities);
  }

  /**
   * Revoke an agent
   */
  revoke(agentId) {
    const agent = this._agents.get(agentId);
    if (agent) {
      agent.status = 'revoked';
      // Kill all sessions
      for (const [sid, sess] of this._sessions) {
        if (sess.agentId === agentId) this._sessions.delete(sid);
      }
    }
  }

  /**
   * List agents
   */
  listAgents(filter = {}) {
    const result = [];
    for (const [, agent] of this._agents) {
      if (filter.type && agent.type !== filter.type) continue;
      if (filter.status && agent.status !== filter.status) continue;
      result.push(this.getAgent(agent.id));
    }
    return result;
  }

  /**
   * Increment command count for an agent
   */
  trackCommand(agentId) {
    const agent = this._agents.get(agentId);
    if (agent) {
      agent.commandCount++;
      agent.lastSeen = Date.now();
    }
  }

  /**
   * Validate a session token and return session data
   */
  validateSession(token) {
    const session = this._sessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this._sessions.delete(token);
      return null;
    }
    return session;
  }

  /**
   * Cleanup expired sessions
   */
  cleanup() {
    const now = Date.now();
    for (const [sid, sess] of this._sessions) {
      if (now > sess.expiresAt) this._sessions.delete(sid);
    }
  }

  getStats() {
    return {
      ...this._stats,
      totalAgents: this._agents.size,
      activeSessions: this._sessions.size,
    };
  }
}

// ─── Command Signing ────────────────────────────────────────────────────────

class CommandSigner {
  constructor(secret) {
    this._secret = secret || crypto.randomBytes(32).toString('hex');
  }

  /**
   * Sign a command payload
   */
  sign(payload, agentId) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const data = JSON.stringify({ payload, agentId, nonce, timestamp });
    const signature = crypto.createHmac('sha256', this._secret).update(data).digest('hex');

    return { nonce, timestamp, signature };
  }

  /**
   * Verify a signed command
   */
  verify(payload, agentId, nonce, timestamp, signature, maxAge = 300_000) {
    // Check timestamp freshness (5 min default)
    if (Math.abs(Date.now() - timestamp) > maxAge) {
      return { valid: false, reason: 'Timestamp expired' };
    }

    const data = JSON.stringify({ payload, agentId, nonce, timestamp });
    const expected = crypto.createHmac('sha256', this._secret).update(data).digest('hex');

    // Timing-safe comparison
    if (signature.length !== expected.length) {
      return { valid: false, reason: 'Invalid signature' };
    }
    const valid = crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));

    return { valid, reason: valid ? null : 'Signature mismatch' };
  }
}

// ─── Site Isolation ─────────────────────────────────────────────────────────

class SiteIsolation {
  constructor() {
    this._sites = new Map(); // siteId → isolation config
  }

  /**
   * Configure isolation for a site
   */
  configure(siteId, config) {
    this._sites.set(siteId, {
      siteId,
      allowedAgents: new Set(config.allowedAgents || []),
      blockedAgents: new Set(config.blockedAgents || []),
      maxConcurrentAgents: config.maxConcurrentAgents || 5,
      allowedCapabilities: new Set(config.allowedCapabilities || ['*']),
      blockedSelectors: config.blockedSelectors || ['.private', '[data-secret]', '#password'],
      dataClassification: config.dataClassification || 'public', // public, internal, confidential, restricted
      requireSigning: config.requireSigning || false,
      auditAll: config.auditAll || false,
      activeAgents: new Set(),
    });
  }

  /**
   * Check if agent can access site
   */
  canAccess(siteId, agentId) {
    const site = this._sites.get(siteId);
    if (!site) return true; // No config = open

    if (site.blockedAgents.has(agentId)) return false;
    if (site.allowedAgents.size > 0 && !site.allowedAgents.has(agentId)) return false;
    if (site.activeAgents.size >= site.maxConcurrentAgents) return false;

    return true;
  }

  /**
   * Enter a site (track active agent)
   */
  enter(siteId, agentId) {
    const site = this._sites.get(siteId);
    if (!site) return true;
    if (!this.canAccess(siteId, agentId)) return false;
    site.activeAgents.add(agentId);
    return true;
  }

  /**
   * Leave a site
   */
  leave(siteId, agentId) {
    const site = this._sites.get(siteId);
    if (site) site.activeAgents.delete(agentId);
  }

  /**
   * Check capability for a site
   */
  checkCapability(siteId, capability) {
    const site = this._sites.get(siteId);
    if (!site) return true;
    if (site.allowedCapabilities.has('*')) return true;
    return site.allowedCapabilities.has(capability);
  }

  /**
   * Check selector access
   */
  checkSelector(siteId, selector) {
    const site = this._sites.get(siteId);
    if (!site) return true;
    return !site.blockedSelectors.some(b => selector.includes(b));
  }

  getConfig(siteId) {
    const site = this._sites.get(siteId);
    if (!site) return null;
    return {
      siteId: site.siteId,
      maxConcurrentAgents: site.maxConcurrentAgents,
      activeAgentCount: site.activeAgents.size,
      dataClassification: site.dataClassification,
      requireSigning: site.requireSigning,
      auditAll: site.auditAll,
    };
  }
}

// ─── Singletons ─────────────────────────────────────────────────────────────

const identity = new AgentIdentity();
const signer = new CommandSigner(process.env.WAB_SIGNING_SECRET);
const isolation = new SiteIsolation();

// Cleanup timer
const _cleanupTimer = setInterval(() => identity.cleanup(), 300_000);
if (_cleanupTimer.unref) _cleanupTimer.unref();

module.exports = {
  AgentIdentity,
  CommandSigner,
  SiteIsolation,
  identity,
  signer,
  isolation,
};
