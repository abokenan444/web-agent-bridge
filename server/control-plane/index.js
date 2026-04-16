'use strict';

/**
 * WAB Control Plane
 *
 * Management layer for the Agent OS. Handles:
 * - Agent lifecycle management
 * - Policy enforcement
 * - Deployment management
 * - Configuration distribution
 *
 * The Control Plane is separated from the Data Plane.
 * It decides WHAT to do and WHO can do it.
 * The Data Plane executes the actual work.
 */

const crypto = require('crypto');
const { bus } = require('../runtime/event-bus');
const { identity } = require('../security');

// ─── Agent Lifecycle Manager ────────────────────────────────────────────────

class AgentManager {
  constructor() {
    this._deployments = new Map();  // deploymentId → deployment config
    this._assignments = new Map();  // agentId → Set<siteId>
    this._healthChecks = new Map(); // agentId → last health check
  }

  /**
   * Deploy an agent to the runtime
   */
  deploy(agentId, config = {}) {
    const agent = identity.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const deploymentId = `deploy_${crypto.randomBytes(12).toString('hex')}`;
    const deployment = {
      id: deploymentId,
      agentId,
      config: {
        autoRestart: config.autoRestart !== false,
        maxRetries: config.maxRetries || 5,
        healthCheckInterval: config.healthCheckInterval || 60_000,
        resources: {
          maxMemory: config.maxMemory || 256 * 1024 * 1024,
          maxCpu: config.maxCpu || 80,   // percentage
          maxTasks: config.maxTasks || 10,
        },
        environment: config.environment || 'production',
        version: config.version || '1.0.0',
      },
      status: 'deployed',
      restartCount: 0,
      deployedAt: Date.now(),
      lastHealthCheck: null,
    };

    this._deployments.set(deploymentId, deployment);
    bus.emit('agent.deployed', { agentId, deploymentId });

    return deployment;
  }

  /**
   * Assign agent to sites
   */
  assign(agentId, siteIds) {
    if (!this._assignments.has(agentId)) this._assignments.set(agentId, new Set());
    const set = this._assignments.get(agentId);
    for (const siteId of siteIds) set.add(siteId);
    bus.emit('agent.assigned', { agentId, sites: siteIds });
  }

  /**
   * Unassign agent from sites
   */
  unassign(agentId, siteIds) {
    const set = this._assignments.get(agentId);
    if (!set) return;
    for (const siteId of siteIds) set.delete(siteId);
  }

  /**
   * Get sites assigned to an agent
   */
  getAssignments(agentId) {
    const set = this._assignments.get(agentId);
    return set ? [...set] : [];
  }

  /**
   * Record a health check
   */
  recordHealthCheck(agentId, health) {
    this._healthChecks.set(agentId, {
      ...health,
      timestamp: Date.now(),
      status: health.healthy ? 'healthy' : 'unhealthy',
    });

    if (!health.healthy) {
      bus.emit('agent.unhealthy', { agentId, reason: health.reason || 'unknown' });
    }
  }

  /**
   * Get agent health
   */
  getHealth(agentId) {
    return this._healthChecks.get(agentId) || null;
  }

  /**
   * Undeploy an agent
   */
  undeploy(deploymentId) {
    const deployment = this._deployments.get(deploymentId);
    if (deployment) {
      deployment.status = 'undeployed';
      bus.emit('agent.undeployed', { agentId: deployment.agentId, deploymentId });
    }
  }

  /**
   * List all deployments
   */
  listDeployments(filter = {}) {
    const result = [];
    for (const [, d] of this._deployments) {
      if (filter.status && d.status !== filter.status) continue;
      if (filter.agentId && d.agentId !== filter.agentId) continue;
      result.push(d);
    }
    return result;
  }
}

// ─── Policy Engine ──────────────────────────────────────────────────────────

class PolicyEngine {
  constructor() {
    this._policies = new Map();    // policyId → policy definition
    this._bindings = new Map();    // entityId → Set<policyId>
  }

  /**
   * Create a policy
   */
  createPolicy(policy) {
    const policyId = `policy_${crypto.randomBytes(12).toString('hex')}`;
    const def = {
      id: policyId,
      name: policy.name || 'Unnamed Policy',
      description: policy.description || '',
      type: policy.type || 'agent', // agent, site, global

      // Rules
      rules: (policy.rules || []).map(r => ({
        id: `rule_${crypto.randomBytes(6).toString('hex')}`,
        action: r.action, // allow, deny, require
        resource: r.resource, // capability, selector, domain, rate
        condition: r.condition || {}, // { equals, contains, pattern, min, max }
        effect: r.effect || 'deny', // allow, deny, audit
      })),

      // Rate limits
      rateLimit: policy.rateLimit || null,

      // Time constraints
      schedule: policy.schedule || null, // { start, end, timezone, days: [] }

      priority: policy.priority || 0,
      enabled: policy.enabled !== false,
      createdAt: Date.now(),
    };

    this._policies.set(policyId, def);
    return def;
  }

  /**
   * Bind a policy to an entity (agent, site, global)
   */
  bind(entityId, policyId) {
    if (!this._bindings.has(entityId)) this._bindings.set(entityId, new Set());
    this._bindings.get(entityId).add(policyId);
  }

  /**
   * Unbind a policy
   */
  unbind(entityId, policyId) {
    const bindings = this._bindings.get(entityId);
    if (bindings) bindings.delete(policyId);
  }

  /**
   * Evaluate policies for an entity against an action
   */
  evaluate(entityId, action, context = {}) {
    const policyIds = this._bindings.get(entityId) || new Set();
    const globalIds = this._bindings.get('*') || new Set();
    const allIds = new Set([...policyIds, ...globalIds]);

    const results = [];
    let finalEffect = 'allow'; // default allow

    // Sort policies by priority
    const policies = [];
    for (const pid of allIds) {
      const policy = this._policies.get(pid);
      if (policy && policy.enabled) policies.push(policy);
    }
    policies.sort((a, b) => b.priority - a.priority);

    for (const policy of policies) {
      for (const rule of policy.rules) {
        if (rule.action !== action && rule.action !== '*') continue;

        const match = this._evaluateCondition(rule.condition, context);
        if (match) {
          results.push({
            policyId: policy.id,
            policyName: policy.name,
            ruleId: rule.id,
            effect: rule.effect,
            resource: rule.resource,
          });

          if (rule.effect === 'deny') finalEffect = 'deny';
        }
      }
    }

    return {
      allowed: finalEffect === 'allow',
      effect: finalEffect,
      evaluatedPolicies: results,
    };
  }

  /**
   * Evaluate a rule condition
   */
  _evaluateCondition(condition, context) {
    if (!condition || Object.keys(condition).length === 0) return true;

    for (const [key, value] of Object.entries(condition)) {
      const contextValue = context[key];
      if (contextValue === undefined) return false;

      if (typeof value === 'object' && value !== null) {
        if (value.equals !== undefined && contextValue !== value.equals) return false;
        if (value.contains && !String(contextValue).includes(value.contains)) return false;
        if (value.pattern && !new RegExp(value.pattern).test(String(contextValue))) return false;
        if (value.min !== undefined && contextValue < value.min) return false;
        if (value.max !== undefined && contextValue > value.max) return false;
        if (value.in && !value.in.includes(contextValue)) return false;
      } else {
        if (contextValue !== value) return false;
      }
    }
    return true;
  }

  /**
   * Get policy
   */
  getPolicy(policyId) {
    return this._policies.get(policyId) || null;
  }

  /**
   * List policies
   */
  listPolicies(entityId) {
    if (entityId) {
      const ids = this._bindings.get(entityId) || new Set();
      return [...ids].map(id => this._policies.get(id)).filter(Boolean);
    }
    return Array.from(this._policies.values());
  }

  /**
   * Delete a policy
   */
  deletePolicy(policyId) {
    this._policies.delete(policyId);
    for (const [, bindings] of this._bindings) {
      bindings.delete(policyId);
    }
  }
}

// ─── Singletons ─────────────────────────────────────────────────────────────

const agentManager = new AgentManager();
const policyEngine = new PolicyEngine();

module.exports = { AgentManager, PolicyEngine, agentManager, policyEngine };
