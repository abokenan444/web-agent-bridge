'use strict';

/**
 * WAB Runtime - Main Entry Point
 * 
 * The Runtime is the core of the Agent OS. It provides:
 * - Task scheduling with retries and timeouts
 * - Agent state management with checkpoints
 * - Execution sandboxing
 * - Event-driven architecture
 * 
 * This is NOT a browser wrapper - it's a real execution runtime
 * comparable to Ray or Temporal.
 */

const { EventBus, bus } = require('./event-bus');
const { Scheduler, TaskState } = require('./scheduler');
const { StateManager } = require('./state-manager');
const { ExecutionSandbox } = require('./sandbox');

class WABRuntime {
  constructor(options = {}) {
    this.scheduler = new Scheduler({
      maxConcurrent: options.maxConcurrentTasks || 20,
      maxQueueSize: options.maxQueueSize || 1000,
      defaultRetries: options.defaultRetries || 3,
      defaultTimeout: options.defaultTimeout || 30000,
    });

    this.state = new StateManager({
      maxCheckpoints: options.maxCheckpoints || 50,
      ttl: options.stateTTL || 24 * 3600_000,
    });

    this.sandbox = new ExecutionSandbox({
      maxConcurrent: options.maxSandboxes || 100,
      defaultTimeout: options.sandboxTimeout || 30000,
    });

    this.events = bus;
    this._started = false;
    this._cleanupTimer = null;

    // Register built-in task handlers
    this._registerBuiltinHandlers();

    // Wire events
    this._wireEventHandlers();
  }

  /**
   * Start the runtime
   */
  start() {
    if (this._started) return;
    this._started = true;

    // Periodic cleanup
    this._cleanupTimer = setInterval(() => {
      this.state.cleanup();
      this.sandbox.cleanup();
    }, 600_000); // 10 min
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();

    this.events.emit('runtime.started', {
      timestamp: Date.now(),
      capabilities: this.getCapabilities(),
    });
  }

  /**
   * Stop the runtime
   */
  stop() {
    if (!this._started) return;
    this._started = false;
    if (this._cleanupTimer) clearInterval(this._cleanupTimer);
    this.events.emit('runtime.stopped', { timestamp: Date.now() });
  }

  /**
   * Submit a task
   */
  submitTask(task) {
    if (!this._started) throw new Error('Runtime not started');
    return this.scheduler.submit(task);
  }

  /**
   * Execute a task in a sandbox with full lifecycle
   */
  async executeInSandbox(taskId, handler, options = {}) {
    // Create sandbox
    const sbx = this.sandbox.create(taskId, options);

    // Save initial state
    this.state.save(taskId, { status: 'sandbox_created', sandboxId: sbx.id });
    this.state.checkpoint(taskId, 'pre-execution');

    try {
      const result = await this.sandbox.execute(sbx.id, handler);

      if (result.success) {
        this.state.save(taskId, { status: 'completed', result: result.result });
      } else {
        this.state.save(taskId, { status: 'failed', error: result.error });
      }

      return result;
    } finally {
      // Cleanup sandbox after a delay
      setTimeout(() => this.sandbox.destroy(sbx.id), 60000);
    }
  }

  /**
   * Register a task type handler
   */
  registerTaskHandler(taskType, handler) {
    this.scheduler.registerHandler(taskType, handler);
  }

  /**
   * Get runtime capabilities for protocol exposure
   */
  getCapabilities() {
    return {
      scheduler: { maxConcurrent: 20, retries: true, deadlines: true, dependencies: true },
      state: { checkpoints: true, rollback: true, ttl: true },
      sandbox: { isolation: true, resourceLimits: true, auditTrail: true },
      events: { async: true, replay: true, wildcards: true, deadLetter: true },
    };
  }

  /**
   * Get runtime health and stats
   */
  getHealth() {
    return {
      status: this._started ? 'running' : 'stopped',
      uptime: this._started ? Date.now() : 0,
      scheduler: this.scheduler.getStats(),
      state: this.state.getStats(),
      sandbox: this.sandbox.getStats(),
      events: this.events.getStats(),
    };
  }

  // ─── Built-in Handlers ──────────────────────────────────────────────────

  _registerBuiltinHandlers() {
    // Browser task handler (delegated to data plane)
    this.scheduler.registerHandler('browser', async (params, ctx) => {
      ctx.reportProgress(10, 0);
      // Browser tasks are handled by data-plane executor
      return { delegated: 'data-plane', params };
    });

    // API task handler
    this.scheduler.registerHandler('api', async (params, ctx) => {
      ctx.reportProgress(10, 0);
      return { delegated: 'data-plane', params };
    });

    // Extraction task handler
    this.scheduler.registerHandler('extraction', async (params, ctx) => {
      ctx.reportProgress(10, 0);
      return { delegated: 'data-plane', params };
    });

    // Workflow (composite) handler
    this.scheduler.registerHandler('workflow', async (params, ctx) => {
      const results = [];
      for (let i = 0; i < ctx.steps.length; i++) {
        ctx.reportProgress(Math.floor((i / ctx.steps.length) * 100), i);
        ctx.checkpoint({ step: i, results });

        const step = ctx.steps[i];
        const handler = this.scheduler._handlers.get(step.type || 'general');
        if (handler) {
          const result = await handler(step.params || {}, ctx);
          results.push({ step: i, result });
        }
      }
      ctx.reportProgress(100, ctx.steps.length);
      return { steps: results };
    });

    // Composite task (parallel execution)
    this.scheduler.registerHandler('composite', async (params, ctx) => {
      if (!params.tasks || !Array.isArray(params.tasks)) {
        throw new Error('Composite task requires tasks array');
      }
      const promises = params.tasks.map((t, i) => {
        const handler = this.scheduler._handlers.get(t.type || 'general');
        if (!handler) return { step: i, error: `No handler for: ${t.type}` };
        return handler(t.params || {}, ctx).then(r => ({ step: i, result: r }));
      });
      return { results: await Promise.allSettled(promises) };
    });

    // General purpose handler (pass-through)
    this.scheduler.registerHandler('general', async (params) => {
      return { received: params };
    });
  }

  // ─── Event Wiring ────────────────────────────────────────────────────────

  _wireEventHandlers() {
    // Track task states in state manager
    this.events.on('task.started', (data) => {
      this.state.save(data.taskId, { status: 'running', startedAt: Date.now(), attempt: data.attempt });
    });

    this.events.on('task.completed', (data) => {
      this.state.merge(data.taskId, { status: 'completed', duration: data.duration });
    });

    this.events.on('task.failed', (data) => {
      this.state.merge(data.taskId, { status: 'failed', error: data.error, attempts: data.attempts });
    });

    this.events.on('task.progress', (data) => {
      this.state.merge(data.taskId, { progress: data.progress, currentStep: data.step });
    });
  }
}

// Singleton runtime
const runtime = new WABRuntime();

module.exports = { WABRuntime, runtime, EventBus, bus, Scheduler, TaskState, StateManager, ExecutionSandbox };
