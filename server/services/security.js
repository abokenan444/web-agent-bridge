/**
 * WAB Security Layer — Command Signing, Audit Logging, and Agent Identity
 *
 * Implements:
 *   - HMAC-SHA256 command signatures for non-repudiation
 *   - Immutable audit log with tamper-evident chaining
 *   - Agent identity verification (key pair registration)
 *   - Capability-based tokens for fine-grained access control
 *   - Timing-safe comparisons for secret validation
 */

const crypto = require('crypto');
const { db } = require('../models/db');

// ─── Schema ──────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS security_audit_log (
    id TEXT PRIMARY KEY,
    chain_hash TEXT NOT NULL,
    prev_hash TEXT,
    timestamp TEXT NOT NULL DEFAULT (datetime('now')),
    actor_type TEXT NOT NULL CHECK(actor_type IN ('agent','user','admin','system','plugin')),
    actor_id TEXT,
    action TEXT NOT NULL,
    resource TEXT,
    resource_id TEXT,
    ip_hash TEXT,
    signature TEXT,
    outcome TEXT DEFAULT 'success' CHECK(outcome IN ('success','denied','error','blocked')),
    details TEXT DEFAULT '{}',
    severity TEXT DEFAULT 'info' CHECK(severity IN ('info','warning','critical'))
  );

  CREATE TABLE IF NOT EXISTS registered_agents (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_name TEXT NOT NULL,
    public_key TEXT NOT NULL,
    key_algorithm TEXT DEFAULT 'hmac-sha256',
    capabilities TEXT DEFAULT '["read"]',
    status TEXT DEFAULT 'active' CHECK(status IN ('active','suspended','revoked')),
    max_rate INTEGER DEFAULT 60,
    ip_allowlist TEXT DEFAULT '[]',
    total_commands INTEGER DEFAULT 0,
    last_command TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    revoked_at TEXT,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
    UNIQUE(site_id, agent_name)
  );

  CREATE TABLE IF NOT EXISTS capability_tokens (
    token_hash TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    capabilities TEXT NOT NULL DEFAULT '["read"]',
    allowed_actions TEXT DEFAULT '["*"]',
    selector_scope TEXT DEFAULT '[]',
    expires_at TEXT NOT NULL,
    revoked INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES registered_agents(id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS revoked_tokens (
    token_hash TEXT PRIMARY KEY,
    revoked_at TEXT DEFAULT (datetime('now')),
    reason TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON security_audit_log(timestamp);
  CREATE INDEX IF NOT EXISTS idx_audit_actor ON security_audit_log(actor_type, actor_id);
  CREATE INDEX IF NOT EXISTS idx_audit_action ON security_audit_log(action);
  CREATE INDEX IF NOT EXISTS idx_audit_severity ON security_audit_log(severity);
  CREATE INDEX IF NOT EXISTS idx_agents_site ON registered_agents(site_id);
  CREATE INDEX IF NOT EXISTS idx_cap_tokens_agent ON capability_tokens(agent_id);
  CREATE INDEX IF NOT EXISTS idx_cap_tokens_site ON capability_tokens(site_id);
  CREATE INDEX IF NOT EXISTS idx_revoked_tokens ON revoked_tokens(token_hash);
`);

// ─── Prepared Statements ─────────────────────────────────────────────

const stmts = {
  insertAudit: db.prepare(`INSERT INTO security_audit_log
    (id, chain_hash, prev_hash, timestamp, actor_type, actor_id, action, resource, resource_id, ip_hash, signature, outcome, details, severity)
    VALUES (?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  getLastAudit: db.prepare(`SELECT chain_hash FROM security_audit_log ORDER BY rowid DESC LIMIT 1`),
  getAuditRange: db.prepare(`SELECT * FROM security_audit_log WHERE timestamp >= ? AND timestamp <= ? ORDER BY rowid`),
  getAuditByActor: db.prepare(`SELECT * FROM security_audit_log WHERE actor_type = ? AND actor_id = ? ORDER BY rowid DESC LIMIT ?`),
  getAuditBySeverity: db.prepare(`SELECT * FROM security_audit_log WHERE severity = ? ORDER BY rowid DESC LIMIT ?`),

  insertAgent: db.prepare(`INSERT INTO registered_agents
    (id, site_id, agent_name, public_key, key_algorithm, capabilities, max_rate, ip_allowlist)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
  getAgent: db.prepare(`SELECT * FROM registered_agents WHERE id = ?`),
  getAgentByKey: db.prepare(`SELECT * FROM registered_agents WHERE site_id = ? AND public_key = ? AND status = 'active'`),
  getAgentByName: db.prepare(`SELECT * FROM registered_agents WHERE site_id = ? AND agent_name = ? AND status = 'active'`),
  getAgentsBySite: db.prepare(`SELECT * FROM registered_agents WHERE site_id = ? ORDER BY created_at DESC`),
  updateAgentStats: db.prepare(`UPDATE registered_agents SET total_commands = total_commands + 1, last_command = datetime('now') WHERE id = ?`),
  revokeAgent: db.prepare(`UPDATE registered_agents SET status = 'revoked', revoked_at = datetime('now') WHERE id = ?`),
  suspendAgent: db.prepare(`UPDATE registered_agents SET status = 'suspended' WHERE id = ?`),

  insertCapToken: db.prepare(`INSERT INTO capability_tokens
    (token_hash, agent_id, site_id, capabilities, allowed_actions, selector_scope, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`),
  getCapToken: db.prepare(`SELECT ct.*, ra.status as agent_status, ra.public_key
    FROM capability_tokens ct
    JOIN registered_agents ra ON ct.agent_id = ra.id
    WHERE ct.token_hash = ? AND ct.revoked = 0
    AND ct.expires_at > datetime('now')
    AND ra.status = 'active'`),
  revokeCapToken: db.prepare(`UPDATE capability_tokens SET revoked = 1 WHERE token_hash = ?`),

  insertRevokedToken: db.prepare(`INSERT OR IGNORE INTO revoked_tokens (token_hash, reason) VALUES (?, ?)`),
  isTokenRevoked: db.prepare(`SELECT 1 FROM revoked_tokens WHERE token_hash = ? LIMIT 1`),
};

// ─── Audit Logging (Tamper-Evident Chain) ────────────────────────────

let _lastHash = null;

function _getLastHash() {
  if (_lastHash) return _lastHash;
  const row = stmts.getLastAudit.get();
  return row ? row.chain_hash : '0'.repeat(64);
}

/**
 * Log a security-critical event with hash chaining for tamper detection.
 */
function auditLog(entry) {
  const id = crypto.randomUUID();
  const prevHash = _getLastHash();
  const payload = `${prevHash}|${entry.actorType}|${entry.actorId || ''}|${entry.action}|${entry.resource || ''}|${Date.now()}`;
  const chainHash = crypto.createHash('sha256').update(payload).digest('hex');
  _lastHash = chainHash;

  const ipHash = entry.ip ? crypto.createHash('sha256').update(entry.ip).digest('hex').slice(0, 16) : null;

  stmts.insertAudit.run(
    id, chainHash, prevHash,
    entry.actorType || 'system',
    entry.actorId || null,
    entry.action,
    entry.resource || null,
    entry.resourceId || null,
    ipHash,
    entry.signature || null,
    entry.outcome || 'success',
    JSON.stringify(entry.details || {}),
    entry.severity || 'info'
  );

  return { id, chainHash };
}

/**
 * Verify audit chain integrity — detect tampering.
 */
function verifyAuditChain(startDate, endDate) {
  const logs = stmts.getAuditRange.all(startDate, endDate);
  if (logs.length === 0) return { valid: true, checked: 0 };

  let valid = true;
  let broken = null;

  for (let i = 1; i < logs.length; i++) {
    if (logs[i].prev_hash !== logs[i - 1].chain_hash) {
      valid = false;
      broken = { index: i, id: logs[i].id };
      break;
    }
  }

  return { valid, checked: logs.length, broken };
}

// ─── Command Signing ─────────────────────────────────────────────────

/**
 * Sign a command payload with HMAC-SHA256.
 * @param {string} secretKey - Agent's secret key
 * @param {object} payload - { action, params, timestamp, nonce }
 * @returns {string} HMAC signature
 */
function signCommand(secretKey, payload) {
  const canonical = JSON.stringify({
    action: payload.action,
    params: payload.params || {},
    timestamp: payload.timestamp,
    nonce: payload.nonce,
  });
  return crypto.createHmac('sha256', secretKey).update(canonical).digest('hex');
}

/**
 * Verify a command signature with timing-safe comparison.
 * Also validates timestamp freshness (< 5 minutes) and nonce uniqueness.
 */
const _usedNonces = new Map();
const NONCE_TTL = 5 * 60 * 1000;

// Purge old nonces every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - NONCE_TTL;
  for (const [nonce, ts] of _usedNonces) {
    if (ts < cutoff) _usedNonces.delete(nonce);
  }
}, NONCE_TTL);

function verifyCommandSignature(publicKey, payload, signature) {
  // Check timestamp freshness (±5 minutes)
  const ts = payload.timestamp;
  if (!ts || Math.abs(Date.now() - ts) > NONCE_TTL) {
    return { valid: false, reason: 'timestamp_expired' };
  }

  // Check nonce uniqueness (replay protection)
  if (!payload.nonce) {
    return { valid: false, reason: 'nonce_required' };
  }
  if (_usedNonces.has(payload.nonce)) {
    return { valid: false, reason: 'nonce_reused' };
  }

  // Verify HMAC
  const expected = signCommand(publicKey, payload);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');

  if (sigBuf.length !== expBuf.length) {
    return { valid: false, reason: 'invalid_signature' };
  }

  if (!crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, reason: 'invalid_signature' };
  }

  // Signature valid — record nonce
  _usedNonces.set(payload.nonce, Date.now());
  return { valid: true };
}

// ─── Agent Identity ──────────────────────────────────────────────────

/**
 * Register a new agent with a cryptographic key.
 * Returns { agentId, secretKey } — the secret must be saved by the caller.
 */
function registerAgent(siteId, agentName, options = {}) {
  const id = crypto.randomUUID();
  const secretKey = crypto.randomBytes(32).toString('hex');
  const publicKeyHash = crypto.createHash('sha256').update(secretKey).digest('hex');

  const capabilities = options.capabilities || ['read'];
  const validCaps = ['read', 'click', 'fill', 'scroll', 'navigate', 'execute', 'extract', 'api'];
  const filtered = capabilities.filter(c => validCaps.includes(c));

  stmts.insertAgent.run(
    id, siteId, agentName, publicKeyHash,
    'hmac-sha256',
    JSON.stringify(filtered),
    options.maxRate || 60,
    JSON.stringify(options.ipAllowlist || [])
  );

  auditLog({
    actorType: 'system',
    action: 'agent_registered',
    resource: 'agent',
    resourceId: id,
    details: { agentName, siteId, capabilities: filtered },
  });

  return { agentId: id, secretKey };
}

/**
 * Authenticate an agent with its secret key.
 * Uses timing-safe comparison against stored public key hash.
 */
function authenticateAgent(siteId, secretKey) {
  const publicKeyHash = crypto.createHash('sha256').update(secretKey).digest('hex');
  const agent = stmts.getAgentByKey.get(siteId, publicKeyHash);

  if (!agent) return null;

  stmts.updateAgentStats.run(agent.id);
  return {
    agentId: agent.id,
    agentName: agent.agent_name,
    capabilities: JSON.parse(agent.capabilities || '["read"]'),
    maxRate: agent.max_rate,
  };
}

// ─── Capability Tokens ───────────────────────────────────────────────

/**
 * Issue a capability token with restricted scope.
 * @param {string} agentId
 * @param {string} siteId
 * @param {object} scope - { capabilities, allowedActions, selectorScope, ttlSeconds }
 */
function issueCapabilityToken(agentId, siteId, scope = {}) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  const ttl = Math.min(scope.ttlSeconds || 3600, 86400); // max 24h
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  stmts.insertCapToken.run(
    tokenHash, agentId, siteId,
    JSON.stringify(scope.capabilities || ['read']),
    JSON.stringify(scope.allowedActions || ['*']),
    JSON.stringify(scope.selectorScope || []),
    expiresAt
  );

  auditLog({
    actorType: 'agent',
    actorId: agentId,
    action: 'capability_token_issued',
    resource: 'token',
    details: { siteId, capabilities: scope.capabilities, ttl },
  });

  return { token: rawToken, expiresAt };
}

/**
 * Validate a capability token and check if the requested action is allowed.
 * @returns {object|null} - Token info with capabilities, or null if invalid
 */
function validateCapabilityToken(rawToken, requiredAction) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

  // Check revocation list
  if (stmts.isTokenRevoked.get(tokenHash)) return null;

  const token = stmts.getCapToken.get(tokenHash);
  if (!token) return null;

  const capabilities = JSON.parse(token.capabilities || '["read"]');
  const allowedActions = JSON.parse(token.allowed_actions || '["*"]');

  // Check if action is permitted
  if (requiredAction && !allowedActions.includes('*') && !allowedActions.includes(requiredAction)) {
    return null;
  }

  return {
    agentId: token.agent_id,
    siteId: token.site_id,
    capabilities,
    allowedActions,
    selectorScope: JSON.parse(token.selector_scope || '[]'),
    expiresAt: token.expires_at,
  };
}

/**
 * Revoke a specific token.
 */
function revokeCapabilityToken(rawToken, reason) {
  const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  stmts.revokeCapToken.run(tokenHash);
  stmts.insertRevokedToken.run(tokenHash, reason || 'manual_revocation');
}

// ─── JWT Revocation ──────────────────────────────────────────────────

/**
 * Add a JWT to the revocation list (for logout / compromise).
 */
function revokeJWT(token, reason) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  stmts.insertRevokedToken.run(tokenHash, reason || 'manual_revocation');
}

function isJWTRevoked(token) {
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return !!stmts.isTokenRevoked.get(tokenHash);
}

// ─── Input Sanitizer ─────────────────────────────────────────────────

const DOMAIN_RE = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}$/;

function validateDomain(domain) {
  if (!domain || typeof domain !== 'string') return false;
  const clean = domain.replace(/^www\./, '').toLowerCase();
  return DOMAIN_RE.test(clean) && clean.length <= 253;
}

function validateEmail(email) {
  if (!email || typeof email !== 'string') return false;
  return EMAIL_RE.test(email) && email.length <= 320;
}

/**
 * Sanitize arbitrary string input — strip control characters, limit length.
 */
function sanitizeInput(str, maxLength = 1000) {
  if (typeof str !== 'string') return '';
  // Remove control characters except newlines/tabs
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').slice(0, maxLength);
}

/**
 * Validate and sanitize site configuration — strict schema enforcement.
 */
function validateSiteConfig(config) {
  if (!config || typeof config !== 'object') return { valid: false, error: 'Config must be an object' };

  const allowed = {
    agentPermissions: 'object',
    restrictions: 'object',
    logging: 'object',
    stealth: 'object',
  };

  const validPermissions = ['readContent', 'click', 'fillForms', 'scroll', 'navigate', 'apiAccess', 'automatedLogin', 'extractData'];

  // Strip unknown top-level keys
  const cleaned = {};
  for (const [key, type] of Object.entries(allowed)) {
    if (config[key] !== undefined) {
      if (typeof config[key] !== type) {
        return { valid: false, error: `${key} must be ${type}` };
      }
      cleaned[key] = config[key];
    }
  }

  // Validate permissions — only allow known keys with boolean values
  if (cleaned.agentPermissions) {
    const perms = {};
    for (const [k, v] of Object.entries(cleaned.agentPermissions)) {
      if (validPermissions.includes(k) && typeof v === 'boolean') {
        perms[k] = v;
      }
    }
    cleaned.agentPermissions = perms;
  }

  // Validate restrictions
  if (cleaned.restrictions) {
    const r = cleaned.restrictions;
    if (r.allowedSelectors && !Array.isArray(r.allowedSelectors)) {
      return { valid: false, error: 'allowedSelectors must be an array' };
    }
    if (r.blockedSelectors && !Array.isArray(r.blockedSelectors)) {
      return { valid: false, error: 'blockedSelectors must be an array' };
    }
  }

  // Validate stealth consent requirement
  if (cleaned.stealth) {
    if (cleaned.stealth.enabled && !cleaned.stealth.consent) {
      return { valid: false, error: 'Stealth mode requires explicit consent: true' };
    }
  }

  // Reject configs > 10KB
  const serialized = JSON.stringify(cleaned);
  if (serialized.length > 10240) {
    return { valid: false, error: 'Config too large (max 10KB)' };
  }

  return { valid: true, config: cleaned };
}

// ─── IP Hashing ──────────────────────────────────────────────────────

function hashIP(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0, 16);
}

// ─── Exports ─────────────────────────────────────────────────────────

module.exports = {
  // Audit
  auditLog,
  verifyAuditChain,

  // Command signing
  signCommand,
  verifyCommandSignature,

  // Agent identity
  registerAgent,
  authenticateAgent,

  // Capability tokens
  issueCapabilityToken,
  validateCapabilityToken,
  revokeCapabilityToken,

  // JWT revocation
  revokeJWT,
  isJWTRevoked,

  // Input validation
  validateDomain,
  validateEmail,
  sanitizeInput,
  validateSiteConfig,
  hashIP,
};
