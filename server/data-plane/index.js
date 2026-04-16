'use strict';

/**
 * WAB Data Plane
 *
 * Execution engine that actually does the work:
 * - Browser automation (via puppeteer/playwright or bridge)
 * - API execution
 * - Workflow orchestration
 * - DOM abstraction (semantic actions instead of raw selectors)
 *
 * The Data Plane only executes what the Control Plane authorizes.
 */

const { bus } = require('../runtime/event-bus');
const { tracer, metrics } = require('../observability');
const { isolation } = require('../security');

// ─── Semantic DOM Abstraction ───────────────────────────────────────────────

/**
 * Maps semantic actions to site-specific implementations.
 * Instead of click('.add-to-cart'), you call execute('checkout.addItem', { productId })
 */
class SemanticActionResolver {
  constructor() {
    this._mappings = new Map(); // `${domain}:${semanticAction}` → implementation
    this._defaults = new Map(); // semanticAction → default implementation
  }

  /**
   * Register a semantic action mapping for a domain
   */
  register(domain, semanticAction, implementation) {
    const key = `${domain}:${semanticAction}`;
    this._mappings.set(key, {
      domain,
      action: semanticAction,
      selector: implementation.selector || null,
      handler: implementation.handler || null,
      params: implementation.params || {},
      strategy: implementation.strategy || 'selector', // selector, handler, api
      confidence: implementation.confidence || 1.0,
      lastVerified: Date.now(),
    });
  }

  /**
   * Register a default semantic action (fallback)
   */
  registerDefault(semanticAction, implementation) {
    this._defaults.set(semanticAction, implementation);
  }

  /**
   * Resolve a semantic action to a concrete implementation
   */
  resolve(domain, semanticAction) {
    const key = `${domain}:${semanticAction}`;
    let impl = this._mappings.get(key);

    // Try wildcard domain
    if (!impl) {
      const wildKey = `*:${semanticAction}`;
      impl = this._mappings.get(wildKey);
    }

    // Try default
    if (!impl) {
      impl = this._defaults.get(semanticAction);
    }

    return impl || null;
  }

  /**
   * List all semantic actions for a domain
   */
  listActions(domain) {
    const actions = [];
    for (const [key, impl] of this._mappings) {
      if (key.startsWith(`${domain}:`) || key.startsWith('*:')) {
        actions.push({
          action: impl.action,
          domain: impl.domain,
          strategy: impl.strategy,
          confidence: impl.confidence,
        });
      }
    }
    return actions;
  }
}

// ─── Task Executor ──────────────────────────────────────────────────────────

class Executor {
  constructor() {
    this._resolver = new SemanticActionResolver();
    this._handlers = new Map();
    this._stats = { executed: 0, succeeded: 0, failed: 0 };

    // Register built-in semantic actions defaults
    this._registerDefaults();
  }

  get resolver() { return this._resolver; }

  /**
   * Register an execution handler
   */
  registerHandler(type, handler) {
    this._handlers.set(type, handler);
  }

  /**
   * Execute a task
   */
  async execute(task, context = {}) {
    const { traceId, spanId } = tracer.startTrace(`execute:${task.type || 'general'}`);
    const endTimer = metrics.startTimer('executor.task.duration', { type: task.type || 'general' });

    try {
      // Check site isolation
      if (task.siteId && task.agentId) {
        if (!isolation.canAccess(task.siteId, task.agentId)) {
          throw new Error(`Agent ${task.agentId} denied access to site ${task.siteId}`);
        }
        isolation.enter(task.siteId, task.agentId);
      }

      let result;

      // Route to handler based on task type
      const handler = this._handlers.get(task.type);
      if (handler) {
        result = await handler(task, { ...context, traceId, spanId, resolver: this._resolver });
      } else if (task.type === 'semantic') {
        result = await this._executeSemantic(task, traceId);
      } else if (task.type === 'pipeline') {
        result = await this._executePipeline(task, traceId);
      } else if (task.type === 'parallel') {
        result = await this._executeParallel(task, traceId);
      } else {
        throw new Error(`Unknown task type: ${task.type}`);
      }

      this._stats.executed++;
      this._stats.succeeded++;
      metrics.increment('executor.tasks.success', 1, { type: task.type });

      tracer.endSpan(traceId, spanId, { success: true });
      endTimer();

      bus.emit('executor.completed', {
        taskId: task.id,
        type: task.type,
        traceId,
        duration: endTimer(),
      });

      return { success: true, result, traceId };
    } catch (err) {
      this._stats.executed++;
      this._stats.failed++;
      metrics.increment('executor.tasks.failure', 1, { type: task.type });

      tracer.endSpan(traceId, spanId, { error: err.message });
      endTimer();

      bus.emit('executor.failed', {
        taskId: task.id,
        type: task.type,
        error: err.message,
        traceId,
      });

      return { success: false, error: err.message, traceId };
    } finally {
      // Leave site isolation
      if (task.siteId && task.agentId) {
        isolation.leave(task.siteId, task.agentId);
      }
    }
  }

  /**
   * Execute a semantic action (domain.action instead of raw selector)
   */
  async _executeSemantic(task, traceId) {
    const { domain, action, params } = task;
    if (!domain || !action) throw new Error('Semantic tasks require domain and action');

    const span = tracer.startSpan(traceId, `semantic:${domain}.${action}`);

    const impl = this._resolver.resolve(task.siteDomain || '*', `${domain}.${action}`);
    if (!impl) {
      tracer.endSpan(traceId, span.id, { error: 'No implementation' });
      throw new Error(`No semantic action found: ${domain}.${action}`);
    }

    tracer.addEvent(traceId, span.id, 'resolved', {
      strategy: impl.strategy,
      confidence: impl.confidence,
    });

    let result;
    if (impl.strategy === 'handler' && impl.handler) {
      result = await impl.handler(params);
    } else if (impl.strategy === 'api') {
      result = { delegated: 'api', endpoint: impl.selector, params };
    } else {
      result = {
        resolvedSelector: impl.selector,
        params: { ...impl.params, ...params },
        confidence: impl.confidence,
      };
    }

    tracer.endSpan(traceId, span.id, { success: true });
    return result;
  }

  /**
   * Execute a pipeline (sequential steps)
   */
  async _executePipeline(task, traceId) {
    const steps = task.steps || [];
    const results = [];
    let previousResult = null;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const span = tracer.startSpan(traceId, `pipeline:step:${i}:${step.action || step.type}`);

      try {
        const stepTask = {
          ...step,
          type: step.type || 'semantic',
          input: previousResult,
          siteId: task.siteId,
          agentId: task.agentId,
          siteDomain: task.siteDomain,
        };

        const result = await this.execute(stepTask, { parentTraceId: traceId });
        previousResult = result.result;
        results.push({ step: i, success: true, result: result.result });

        tracer.endSpan(traceId, span.id, { success: true });

        if (!result.success && (task.stopOnError !== false)) {
          throw new Error(`Pipeline step ${i} failed: ${result.error}`);
        }
      } catch (err) {
        tracer.endSpan(traceId, span.id, { error: err.message });
        results.push({ step: i, success: false, error: err.message });
        if (task.stopOnError !== false) throw err;
      }
    }

    return { steps: results, totalSteps: steps.length };
  }

  /**
   * Execute tasks in parallel
   */
  async _executeParallel(task, traceId) {
    const tasks = task.tasks || [];
    const span = tracer.startSpan(traceId, `parallel:${tasks.length}_tasks`);

    const promises = tasks.map((t, i) => {
      const subTask = {
        ...t,
        type: t.type || 'semantic',
        siteId: task.siteId,
        agentId: task.agentId,
        siteDomain: task.siteDomain,
      };
      return this.execute(subTask, { parentTraceId: traceId })
        .then(r => ({ index: i, ...r }))
        .catch(e => ({ index: i, success: false, error: e.message }));
    });

    const results = await Promise.all(promises);
    tracer.endSpan(traceId, span.id, { success: true, count: results.length });

    return { results, totalTasks: tasks.length };
  }

  /**
   * Register default semantic actions
   */
  _registerDefaults() {
    // Commerce domain
    this._resolver.registerDefault('checkout.addItem', {
      selector: '[data-action="add-to-cart"], .add-to-cart, #add-to-cart',
      strategy: 'selector',
      confidence: 0.8,
    });

    this._resolver.registerDefault('checkout.viewCart', {
      selector: '[data-action="view-cart"], .cart-icon, #cart',
      strategy: 'selector',
      confidence: 0.7,
    });

    this._resolver.registerDefault('checkout.submit', {
      selector: '[data-action="checkout"], .checkout-btn, #checkout',
      strategy: 'selector',
      confidence: 0.7,
    });

    this._resolver.registerDefault('search.query', {
      selector: 'input[type="search"], input[name="q"], #search',
      strategy: 'selector',
      confidence: 0.8,
    });

    this._resolver.registerDefault('search.submit', {
      selector: 'button[type="submit"], .search-btn',
      strategy: 'selector',
      confidence: 0.7,
    });

    this._resolver.registerDefault('auth.login', {
      selector: 'form[action*="login"], #login-form',
      strategy: 'selector',
      confidence: 0.7,
    });

    this._resolver.registerDefault('navigation.next', {
      selector: 'a[rel="next"], .next-page, .pagination .next',
      strategy: 'selector',
      confidence: 0.7,
    });

    this._resolver.registerDefault('content.read', {
      selector: 'main, article, .content, #content',
      strategy: 'selector',
      confidence: 0.8,
    });
  }

  getStats() {
    return { ...this._stats };
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

const executor = new Executor();

module.exports = { Executor, SemanticActionResolver, executor };
