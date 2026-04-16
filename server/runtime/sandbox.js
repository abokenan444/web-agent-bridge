'use strict';

/**
 * WAB Runtime - Execution Sandbox
 * 
 * Isolates task execution. Each task runs in its own sandbox with:
 * - Resource limits (memory, CPU time, network)
 * - Permission boundaries
 * - Isolated state
 * - Audit trail
 */

const crypto = require('crypto');

class ExecutionSandbox {
  constructor(options = {}) {
    this._sandboxes = new Map();
    this._maxConcurrent = options.maxConcurrent || 100;
    this._defaultTimeout = options.defaultTimeout || 30000;
    this._stats = { created: 0, completed: 0, failed: 0, timedOut: 0 };
  }

  /**
   * Create a new sandbox for a task
   */
  create(taskId, options = {}) {
    if (this._sandboxes.size >= this._maxConcurrent) {
      throw new Error('Maximum concurrent sandbox limit reached');
    }

    const sandbox = {
      id: `sbx_${crypto.randomBytes(12).toString('hex')}`,
      taskId,
      agentId: options.agentId || null,
      siteId: options.siteId || null,

      // Resource limits
      limits: {
        timeout: options.timeout || this._defaultTimeout,
        maxMemory: options.maxMemory || 128 * 1024 * 1024, // 128MB
        maxNetworkCalls: options.maxNetworkCalls || 100,
        maxDomOperations: options.maxDomOperations || 1000,
        allowedDomains: options.allowedDomains || ['*'],
        blockedSelectors: options.blockedSelectors || [],
      },

      // Runtime state
      state: 'created',
      usage: {
        networkCalls: 0,
        domOperations: 0,
        startedAt: null,
        completedAt: null,
      },

      // Permission boundaries  
      capabilities: new Set(options.capabilities || []),

      // Audit trail
      audit: [],

      // Isolated key-value store
      store: new Map(),

      createdAt: Date.now(),
    };

    this._sandboxes.set(sandbox.id, sandbox);
    this._stats.created++;
    return sandbox;
  }

  /**
   * Execute a function within a sandbox
   */
  async execute(sandboxId, fn) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (!sandbox) throw new Error(`Sandbox not found: ${sandboxId}`);
    if (sandbox.state !== 'created' && sandbox.state !== 'running') {
      throw new Error(`Sandbox ${sandboxId} is in state ${sandbox.state}, cannot execute`);
    }

    sandbox.state = 'running';
    sandbox.usage.startedAt = Date.now();

    // Create scoped context for the function
    const context = this._createContext(sandbox);

    try {
      const result = await _withTimeout(fn(context), sandbox.limits.timeout);
      sandbox.state = 'completed';
      sandbox.usage.completedAt = Date.now();
      this._stats.completed++;

      sandbox.audit.push({
        action: 'complete',
        timestamp: Date.now(),
        duration: sandbox.usage.completedAt - sandbox.usage.startedAt,
      });

      return { success: true, result, sandbox: this._getSandboxSummary(sandbox) };
    } catch (err) {
      sandbox.state = err.message.includes('timed out') ? 'timeout' : 'failed';
      sandbox.usage.completedAt = Date.now();

      if (sandbox.state === 'timeout') this._stats.timedOut++;
      else this._stats.failed++;

      sandbox.audit.push({
        action: sandbox.state,
        timestamp: Date.now(),
        error: err.message,
      });

      return { success: false, error: err.message, sandbox: this._getSandboxSummary(sandbox) };
    }
  }

  /**
   * Create a scoped execution context
   */
  _createContext(sandbox) {
    const self = this;
    return {
      taskId: sandbox.taskId,
      agentId: sandbox.agentId,
      siteId: sandbox.siteId,

      // Capability check
      hasCapability(cap) {
        return sandbox.capabilities.has(cap);
      },

      requireCapability(cap) {
        if (!sandbox.capabilities.has(cap)) {
          throw new Error(`Sandbox lacks capability: ${cap}`);
        }
      },

      // Domain check
      checkDomain(domain) {
        if (sandbox.limits.allowedDomains[0] === '*') return true;
        return sandbox.limits.allowedDomains.some(d => domain.endsWith(d));
      },

      // Resource tracking
      trackNetworkCall() {
        sandbox.usage.networkCalls++;
        if (sandbox.usage.networkCalls > sandbox.limits.maxNetworkCalls) {
          throw new Error('Network call limit exceeded');
        }
      },

      trackDomOperation() {
        sandbox.usage.domOperations++;
        if (sandbox.usage.domOperations > sandbox.limits.maxDomOperations) {
          throw new Error('DOM operation limit exceeded');
        }
      },

      // Isolated store
      set(key, value) { sandbox.store.set(key, value); },
      get(key) { return sandbox.store.get(key); },

      // Audit
      log(action, details) {
        sandbox.audit.push({ action, details, timestamp: Date.now() });
      },

      // Selector validation
      checkSelector(selector) {
        for (const blocked of sandbox.limits.blockedSelectors) {
          if (selector.includes(blocked)) {
            throw new Error(`Selector blocked by sandbox policy: ${blocked}`);
          }
        }
        return true;
      },

      // Read sandbox time remaining
      get timeRemaining() {
        if (!sandbox.usage.startedAt) return sandbox.limits.timeout;
        return Math.max(0, sandbox.limits.timeout - (Date.now() - sandbox.usage.startedAt));
      },
    };
  }

  /**
   * Get sandbox summary (safe to expose)
   */
  _getSandboxSummary(sandbox) {
    return {
      id: sandbox.id,
      taskId: sandbox.taskId,
      state: sandbox.state,
      usage: { ...sandbox.usage },
      auditCount: sandbox.audit.length,
      duration: sandbox.usage.completedAt
        ? sandbox.usage.completedAt - sandbox.usage.startedAt
        : null,
    };
  }

  /**
   * Destroy a sandbox and free resources
   */
  destroy(sandboxId) {
    const sandbox = this._sandboxes.get(sandboxId);
    if (sandbox) {
      sandbox.store.clear();
      this._sandboxes.delete(sandboxId);
    }
  }

  /**
   * Get audit trail for a sandbox
   */
  getAudit(sandboxId) {
    const sandbox = this._sandboxes.get(sandboxId);
    return sandbox ? [...sandbox.audit] : [];
  }

  /**
   * List active sandboxes
   */
  listActive() {
    const active = [];
    for (const [, sb] of this._sandboxes) {
      if (sb.state === 'created' || sb.state === 'running') {
        active.push(this._getSandboxSummary(sb));
      }
    }
    return active;
  }

  getStats() {
    return { ...this._stats, active: this._sandboxes.size };
  }

  /**
   * Cleanup completed/failed sandboxes older than maxAge
   */
  cleanup(maxAge = 3600_000) {
    const cutoff = Date.now() - maxAge;
    let cleaned = 0;
    for (const [id, sb] of this._sandboxes) {
      if (sb.state !== 'created' && sb.state !== 'running' && sb.createdAt < cutoff) {
        sb.store.clear();
        this._sandboxes.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }
}

function _withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Sandbox execution timed out after ${ms}ms`)), ms);
    promise.then(r => { clearTimeout(timer); resolve(r); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

module.exports = { ExecutionSandbox };
