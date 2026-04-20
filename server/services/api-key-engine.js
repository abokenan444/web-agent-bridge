/**
 * WAB API Key Engine
 * Authentication, authorization, rate limiting, and quota management
 * for all WAB advanced modules.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');

// ─── Plan Definitions ─────────────────────────────────────────────────────────
const PLANS = {
  FREE: {
    name: 'Free',
    price_usd: 0,
    requests_per_day: 100,
    requests_per_minute: 10,
    modules_allowed: ['dark-pattern', 'price', 'protocol', 'bounty'],
    features: {
      agent_firewall: false, notary: false, dark_pattern: true,
      collective_bargaining: false, gov_intelligence: false,
      price_time_machine: true, neural: false, protocol: true,
      bounty: true, affiliate: false,
    },
    support: 'community',
    data_retention_days: 7,
  },
  PRO: {
    name: 'Pro',
    price_usd: 29,
    requests_per_day: 10000,
    requests_per_minute: 100,
    modules_allowed: ['agent-firewall', 'dark-pattern', 'neural', 'bounty', 'affiliate', 'protocol', 'price', 'bargaining'],
    features: {
      agent_firewall: true, notary: false, dark_pattern: true,
      collective_bargaining: true, gov_intelligence: false,
      price_time_machine: true, neural: true, protocol: true,
      bounty: true, affiliate: true,
    },
    support: 'email',
    data_retention_days: 90,
  },
  BUSINESS: {
    name: 'Business',
    price_usd: 149,
    requests_per_day: 100000,
    requests_per_minute: 500,
    modules_allowed: ['all'],
    features: {
      agent_firewall: true, notary: true, dark_pattern: true,
      collective_bargaining: true, gov_intelligence: true,
      price_time_machine: true, neural: true, protocol: true,
      bounty: true, affiliate: true,
    },
    support: 'priority',
    data_retention_days: 365,
  },
  ENTERPRISE: {
    name: 'Enterprise',
    price_usd: null,
    requests_per_day: Infinity,
    requests_per_minute: Infinity,
    modules_allowed: ['all'],
    features: {
      agent_firewall: true, notary: true, dark_pattern: true,
      collective_bargaining: true, gov_intelligence: true,
      price_time_machine: true, neural: true, protocol: true,
      bounty: true, affiliate: true,
    },
    support: 'dedicated',
    data_retention_days: Infinity,
    custom_sla: true,
    on_premise: true,
  },
  INTERNAL: {
    name: 'Internal',
    price_usd: 0,
    requests_per_day: Infinity,
    requests_per_minute: Infinity,
    modules_allowed: ['all'],
    features: Object.fromEntries(
      ['agent_firewall','notary','dark_pattern','collective_bargaining','gov_intelligence',
       'price_time_machine','neural','protocol','bounty','affiliate'].map(k => [k, true])
    ),
    support: 'internal',
    data_retention_days: Infinity,
  },
};

const keyStore = new Map();
const usageStore = new Map();
const rateLimitStore = new Map();

class WABKeyEngine {
  constructor() {
    this.internalKey = this._seedInternalKeys();
  }

  _seedInternalKeys() {
    const internalKey = 'wab_internal_' + crypto.randomBytes(16).toString('hex');
    keyStore.set(internalKey, {
      key: internalKey, key_id: 'kid_internal_001', plan: 'INTERNAL',
      owner: 'WAB Core Team', email: 'dev@webagentbridge.com',
      environment: 'internal', created_at: new Date().toISOString(),
      last_used: null, active: true, scopes: ['*'],
    });
    return internalKey;
  }

  generateKey(options = {}) {
    const { plan = 'FREE', owner, email, environment = 'live', scopes = [], metadata = {} } = options;
    if (!PLANS[plan]) throw new Error(`Invalid plan: ${plan}`);
    if (!owner) throw new Error('owner is required');
    if (!email) throw new Error('email is required');

    const planPrefix = plan.toLowerCase().substring(0, 3);
    const randomPart = crypto.randomBytes(20).toString('hex');
    const apiKey = `wab_${environment}_${planPrefix}_${randomPart}`;
    const keyId = 'kid_' + crypto.randomBytes(8).toString('hex');
    const webhookSecret = 'whsec_' + crypto.randomBytes(24).toString('hex');

    const keyRecord = {
      key: apiKey, key_id: keyId, plan, plan_details: PLANS[plan],
      owner, email, environment,
      created_at: new Date().toISOString(),
      expires_at: plan === 'FREE' ? new Date(Date.now() + 365 * 86400000).toISOString() : null,
      last_used: null, active: true,
      scopes: scopes.length > 0 ? scopes : this._defaultScopes(plan),
      webhook_secret: webhookSecret, metadata, total_requests: 0,
    };

    keyStore.set(apiKey, keyRecord);
    usageStore.set(apiKey, { today: 0, this_month: 0, total: 0, by_module: {}, by_day: {}, last_reset: new Date().toDateString() });

    return {
      api_key: apiKey, key_id: keyId, webhook_secret: webhookSecret, plan,
      plan_details: { name: PLANS[plan].name, requests_per_day: PLANS[plan].requests_per_day, requests_per_minute: PLANS[plan].requests_per_minute, modules_allowed: PLANS[plan].modules_allowed },
      created_at: keyRecord.created_at, expires_at: keyRecord.expires_at,
    };
  }

  validate(apiKey, module = null) {
    if (!apiKey) return { valid: false, error: 'API key is required', code: 'MISSING_KEY' };
    const record = keyStore.get(apiKey);
    if (!record) return { valid: false, error: 'Invalid API key', code: 'INVALID_KEY' };
    if (!record.active) return { valid: false, error: 'API key has been revoked', code: 'REVOKED_KEY' };
    if (record.expires_at && new Date(record.expires_at) < new Date()) {
      return { valid: false, error: 'API key has expired', code: 'EXPIRED_KEY' };
    }

    if (module) {
      const plan = PLANS[record.plan];
      const hasAccess = plan.modules_allowed.includes('all') || plan.modules_allowed.includes(module);
      if (!hasAccess) {
        return { valid: false, error: `Module '${module}' not available on ${plan.name} plan`, code: 'INSUFFICIENT_PLAN',
          upgrade_url: 'https://www.webagentbridge.com/#pricing', current_plan: plan.name, required_plan: this._getMinPlanForModule(module) };
      }
    }

    const rateCheck = this._checkRateLimit(apiKey, record.plan);
    if (!rateCheck.allowed) {
      return { valid: false, error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED', retry_after_seconds: rateCheck.retry_after, limit: rateCheck.limit };
    }

    const usage = usageStore.get(apiKey);
    this._resetDailyIfNeeded(apiKey, usage);
    const plan = PLANS[record.plan];
    if (usage.today >= plan.requests_per_day) {
      return { valid: false, error: 'Daily quota exceeded', code: 'QUOTA_EXCEEDED', used: usage.today, limit: plan.requests_per_day, upgrade_url: 'https://www.webagentbridge.com/#pricing' };
    }

    this._recordUsage(apiKey, module);
    return { valid: true, key_id: record.key_id, plan: record.plan, plan_name: plan.name, owner: record.owner, environment: record.environment, features: plan.features,
      usage: { today: usage.today + 1, limit_today: plan.requests_per_day, remaining_today: plan.requests_per_day - usage.today - 1 } };
  }

  revoke(apiKey, reason = 'user_request') {
    const record = keyStore.get(apiKey);
    if (!record) return { success: false, error: 'Key not found' };
    record.active = false; record.revoked_at = new Date().toISOString(); record.revoke_reason = reason;
    return { success: true, message: 'Key revoked', revoked_at: record.revoked_at };
  }

  rotate(oldKey) {
    const record = keyStore.get(oldKey);
    if (!record) return { success: false, error: 'Key not found' };
    this.revoke(oldKey, 'rotation');
    return { success: true, ...this.generateKey({ plan: record.plan, owner: record.owner, email: record.email, environment: record.environment, metadata: { ...record.metadata, rotated_from: record.key_id } }) };
  }

  getUsage(apiKey) {
    const record = keyStore.get(apiKey);
    if (!record) return { error: 'Key not found' };
    const usage = usageStore.get(apiKey) || {};
    this._resetDailyIfNeeded(apiKey, usage);
    const plan = PLANS[record.plan];
    return { key_id: record.key_id, plan: record.plan, plan_name: plan.name, today: usage.today, this_month: usage.this_month, total: usage.total,
      limit_per_day: plan.requests_per_day, limit_per_minute: plan.requests_per_minute, remaining_today: Math.max(0, plan.requests_per_day - usage.today),
      by_module: usage.by_module, last_used: record.last_used, created_at: record.created_at };
  }

  listKeys(adminKey) {
    const adminRecord = keyStore.get(adminKey);
    if (!adminRecord || adminRecord.plan !== 'INTERNAL') return { error: 'Admin access required' };
    return { total: keyStore.size, keys: Array.from(keyStore.values()).map(r => ({
      key_id: r.key_id, plan: r.plan, owner: r.owner, email: r.email, environment: r.environment, active: r.active,
      created_at: r.created_at, last_used: r.last_used, total_requests: r.total_requests || 0 })) };
  }

  getPlans() {
    return Object.entries(PLANS).filter(([k]) => k !== 'INTERNAL').map(([key, plan]) => ({
      id: key, name: plan.name, price_usd: plan.price_usd, requests_per_day: plan.requests_per_day,
      requests_per_minute: plan.requests_per_minute, features: plan.features, support: plan.support }));
  }

  _checkRateLimit(apiKey, plan) {
    const limit = PLANS[plan].requests_per_minute;
    if (limit === Infinity) return { allowed: true };
    const now = Date.now(); const window = 60000;
    const rl = rateLimitStore.get(apiKey) || { count: 0, windowStart: now };
    if (now - rl.windowStart > window) { rl.count = 0; rl.windowStart = now; }
    if (rl.count >= limit) { return { allowed: false, retry_after: Math.ceil((rl.windowStart + window - now) / 1000), limit }; }
    rl.count++; rateLimitStore.set(apiKey, rl);
    return { allowed: true };
  }

  _recordUsage(apiKey, module) {
    const record = keyStore.get(apiKey); const usage = usageStore.get(apiKey);
    const today = new Date().toISOString().split('T')[0];
    usage.today++; usage.this_month++; usage.total++;
    if (module) usage.by_module[module] = (usage.by_module[module] || 0) + 1;
    usage.by_day[today] = (usage.by_day[today] || 0) + 1;
    record.last_used = new Date().toISOString();
    record.total_requests = (record.total_requests || 0) + 1;
  }

  _resetDailyIfNeeded(apiKey, usage) {
    const today = new Date().toDateString();
    if (usage.last_reset !== today) { usage.today = 0; usage.last_reset = today; usageStore.set(apiKey, usage); }
  }

  _defaultScopes(plan) {
    if (plan === 'FREE') return ['read'];
    if (plan === 'PRO') return ['read', 'write'];
    return ['read', 'write', 'admin'];
  }

  _getMinPlanForModule(module) {
    const map = { 'agent-firewall': 'PRO', 'notary': 'BUSINESS', 'dark-pattern': 'FREE', 'bargaining': 'PRO', 'gov': 'BUSINESS', 'price': 'FREE', 'neural': 'PRO', 'protocol': 'FREE', 'bounty': 'FREE', 'affiliate': 'PRO' };
    return map[module] || 'PRO';
  }

  _nextMidnight() {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(0, 0, 0, 0); return d.toISOString();
  }
}

module.exports = { WABKeyEngine, PLANS };
