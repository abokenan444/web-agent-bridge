'use strict';

/**
 * WAB Runtime - Task Scheduler
 * 
 * Distributes and manages task execution with:
 * - External queue backend (SQLite/Redis/Memory)
 * - Priority queue with persistent storage
 * - Retry logic with exponential backoff
 * - Timeout management
 * - Dependency resolution
 * - Concurrency control
 * - Deterministic replay integration
 * - Container isolation support
 */

const crypto = require('crypto');
const { bus } = require('./event-bus');
const { createQueue } = require('./queue');

// Task states
const TaskState = {
  QUEUED: 'queued',
  SCHEDULED: 'scheduled',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  RETRYING: 'retrying',
};

class Scheduler {
  constructor(options = {}) {
    this._queue = [];                  // fallback in-memory queue
    this._externalQueue = null;        // external queue backend
    this._running = new Map();         // taskId → task
    this._completed = new Map();       // taskId → result (limited buffer)
    this._handlers = new Map();        // task type → handler function
    this._replayEngine = null;         // optional replay integration
    this._containerRunner = null;      // optional container isolation
    this._maxConcurrent = options.maxConcurrent || 20;
    this._maxQueueSize = options.maxQueueSize || 1000;
    this._maxCompleted = options.maxCompleted || 500;
    this._defaultRetries = options.defaultRetries || 3;
    this._defaultTimeout = options.defaultTimeout || 30000;
    this._processing = false;
    this._stats = { submitted: 0, completed: 0, failed: 0, retried: 0, cancelled: 0, timedOut: 0 };

    // Initialize external queue
    try {
      this._externalQueue = createQueue('scheduler', {
        maxRetries: this._defaultRetries,
        processTimeout: this._defaultTimeout,
      });
    } catch {
      // Fallback to in-memory
      this._externalQueue = null;
    }
  }

  /**
   * Attach the replay engine for deterministic recording
   */
  setReplayEngine(engine) {
    this._replayEngine = engine;
  }

  /**
   * Attach the container runner for process isolation
   */
  setContainerRunner(runner) {
    this._containerRunner = runner;
  }

  /**
   * Register a handler for a task type
   */
  registerHandler(taskType, handler) {
    this._handlers.set(taskType, handler);
  }

  /**
   * Submit a task to the scheduler
   */
  submit(task) {
    const taskEntry = {
      id: task.id || `task_${crypto.randomBytes(16).toString('hex')}`,
      type: task.type || 'general',
      objective: task.objective || '',
      params: task.params || {},
      steps: task.steps || [],
      priority: task.priority || 50,
      agentId: task.agentId || null,
      siteId: task.siteId || null,
      traceId: task.traceId || `trace_${crypto.randomBytes(16).toString('hex')}`,

      // Execution config
      retries: task.retries !== undefined ? task.retries : this._defaultRetries,
      retriesLeft: task.retries !== undefined ? task.retries : this._defaultRetries,
      timeout: task.timeout || this._defaultTimeout,
      deadline: task.deadline || null,
      isolate: task.isolate || false,  // run in container if true

      // Dependencies
      dependsOn: task.dependsOn || [],

      // State
      state: TaskState.QUEUED,
      attempt: 0,
      currentStep: 0,
      result: null,
      error: null,
      progress: 0,

      // Timestamps
      submittedAt: Date.now(),
      scheduledAt: null,
      startedAt: null,
      completedAt: null,

      // Checkpoints (for resume/rollback)
      checkpoints: [],
    };

    // Add to queue (external or in-memory)
    if (this._externalQueue) {
      this._externalQueue.enqueue({
        type: taskEntry.type,
        data: taskEntry,
        priority: taskEntry.priority,
        maxAttempts: taskEntry.retries + 1,
        timeoutMs: taskEntry.timeout,
        groupId: taskEntry.agentId || null,
      });
    } else {
      if (this._queue.length >= this._maxQueueSize) {
        throw new Error('Task queue is full');
      }
      // Insert by priority (higher priority = earlier in queue)
      let inserted = false;
      for (let i = 0; i < this._queue.length; i++) {
        if (taskEntry.priority > this._queue[i].priority) {
          this._queue.splice(i, 0, taskEntry);
          inserted = true;
          break;
        }
      }
      if (!inserted) this._queue.push(taskEntry);
    }

    this._stats.submitted++;
    bus.emit('task.queued', { taskId: taskEntry.id, type: taskEntry.type, priority: taskEntry.priority });

    // Try to process immediately
    this._processQueue();

    return {
      taskId: taskEntry.id,
      status: taskEntry.state,
      position: this._queue.indexOf(taskEntry),
    };
  }

  /**
   * Process the task queue
   */
  async _processQueue() {
    if (this._processing) return;
    this._processing = true;

    try {
      while (this._running.size < this._maxConcurrent) {
        let task = null;

        if (this._externalQueue) {
          // Dequeue from external queue
          const item = this._externalQueue.dequeue();
          if (!item) break;
          task = item.data;
          task._queueItemId = item.id;
        } else {
          // Dequeue from in-memory queue
          if (this._queue.length === 0) break;
          task = this._findNextReady();
          if (!task) break;
          const idx = this._queue.indexOf(task);
          if (idx !== -1) this._queue.splice(idx, 1);
        }

        // Check deadline
        if (task.deadline && Date.now() > task.deadline) {
          task.state = TaskState.CANCELLED;
          task.error = { code: 'DEADLINE_EXCEEDED', message: 'Task deadline has passed' };
          if (this._externalQueue && task._queueItemId) {
            this._externalQueue.fail(task._queueItemId, 'Deadline exceeded');
          }
          bus.emit('task.cancelled', { taskId: task.id, reason: 'deadline' });
          continue;
        }

        // Execute
        this._running.set(task.id, task);
        this._executeTask(task); // fire and forget
      }
    } finally {
      this._processing = false;
    }
  }

  /**
   * Find next task whose dependencies are satisfied
   */
  _findNextReady() {
    for (const task of this._queue) {
      if (task.dependsOn.length === 0) return task;
      const allDone = task.dependsOn.every(depId => {
        const dep = this._completed.get(depId);
        return dep && dep.state === TaskState.COMPLETED;
      });
      if (allDone) return task;
    }
    return null;
  }

  /**
   * Execute a single task
   */
  async _executeTask(task) {
    task.state = TaskState.RUNNING;
    task.startedAt = Date.now();
    task.attempt++;

    bus.emit('task.started', { taskId: task.id, attempt: task.attempt, type: task.type });

    // Start deterministic recording
    if (this._replayEngine) {
      this._replayEngine.startRecording(task.id, {
        type: task.type,
        params: task.params,
        objective: task.objective,
        attempt: task.attempt,
      });
    }

    const handler = this._handlers.get(task.type);
    if (!handler) {
      task.state = TaskState.FAILED;
      task.error = { code: 'NO_HANDLER', message: `No handler for task type: ${task.type}` };
      if (this._replayEngine) {
        this._replayEngine.completeRecording(task.id, null, task.error);
      }
      this._finishTask(task);
      return;
    }

    try {
      let result;

      const ctx = {
        taskId: task.id,
        agentId: task.agentId,
        siteId: task.siteId,
        traceId: task.traceId,
        steps: task.steps,
        attempt: task.attempt,
        reportProgress: (pct, step) => {
          task.progress = pct;
          if (step !== undefined) task.currentStep = step;
          bus.emit('task.progress', { taskId: task.id, progress: pct, step });
        },
        checkpoint: (data) => {
          task.checkpoints.push({ data, timestamp: Date.now(), step: task.currentStep });
          if (this._replayEngine) {
            this._replayEngine.saveCheckpoint(task.id, `step-${task.currentStep}`, data);
          }
        },
        recordStep: (step) => {
          if (this._replayEngine) {
            this._replayEngine.recordStep(task.id, step);
          }
        },
        recordSideEffect: (effect) => {
          if (this._replayEngine) {
            this._replayEngine.recordSideEffect(task.id, effect);
          }
        },
      };

      // Execute in container if isolation requested
      if (task.isolate && this._containerRunner && typeof task.params === 'object' && task.params._code) {
        const containerResult = await this._containerRunner.runInProcess(task.id, task.params._code, {
          params: task.params,
          timeout: task.timeout,
          maxMemory: task.params._maxMemory || 256 * 1024 * 1024,
        });
        if (!containerResult.success) {
          throw new Error(containerResult.error || 'Container execution failed');
        }
        result = containerResult.result;
      } else {
        result = await _withTimeout(handler(task.params, ctx), task.timeout);
      }

      task.state = TaskState.COMPLETED;
      task.result = result;
      task.progress = 100;
      this._stats.completed++;

      // Complete recording
      if (this._replayEngine) {
        this._replayEngine.completeRecording(task.id, result);
      }

      // Mark complete in external queue
      if (this._externalQueue && task._queueItemId) {
        this._externalQueue.complete(task._queueItemId, result);
      }

      bus.emit('task.completed', { taskId: task.id, duration: Date.now() - task.startedAt });
    } catch (err) {
      const isTimeout = err.message.includes('timed out');
      if (isTimeout) this._stats.timedOut++;

      if (task.retriesLeft > 0 && !isTimeout) {
        // Retry with exponential backoff
        task.retriesLeft--;
        task.state = TaskState.RETRYING;
        this._stats.retried++;
        const backoff = Math.min(1000 * Math.pow(2, task.attempt - 1), 30000);
        bus.emit('task.retrying', { taskId: task.id, attempt: task.attempt, backoff });

        setTimeout(() => {
          this._running.delete(task.id);
          if (this._externalQueue) {
            // Re-enqueue in external queue
            this._externalQueue.enqueue({
              type: task.type,
              data: task,
              priority: task.priority,
              maxAttempts: task.retriesLeft + 1,
              timeoutMs: task.timeout,
            });
          } else {
            this._queue.unshift(task);
          }
          this._processQueue();
        }, backoff);
        return;
      }

      task.state = TaskState.FAILED;
      task.error = { code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR', message: err.message };
      this._stats.failed++;

      // Complete recording with error
      if (this._replayEngine) {
        this._replayEngine.completeRecording(task.id, null, err);
      }

      // Mark failed in external queue
      if (this._externalQueue && task._queueItemId) {
        this._externalQueue.fail(task._queueItemId, err.message);
      }

      bus.emit('task.failed', { taskId: task.id, error: err.message, attempts: task.attempt });
    }

    this._finishTask(task);
  }

  /**
   * Finish a task (move to completed buffer)
   */
  _finishTask(task) {
    task.completedAt = Date.now();
    this._running.delete(task.id);

    // Store in completed buffer
    this._completed.set(task.id, task);
    if (this._completed.size > this._maxCompleted) {
      const oldest = this._completed.keys().next().value;
      this._completed.delete(oldest);
    }

    // Process more tasks
    this._processQueue();
  }

  /**
   * Get task status
   */
  getTask(taskId) {
    // Check running
    let task = this._running.get(taskId);
    if (!task) {
      // Check queue
      task = this._queue.find(t => t.id === taskId);
    }
    if (!task) {
      // Check completed
      task = this._completed.get(taskId);
    }
    if (!task) return null;

    return {
      id: task.id,
      type: task.type,
      objective: task.objective,
      state: task.state,
      progress: task.progress,
      currentStep: task.currentStep,
      totalSteps: task.steps.length,
      attempt: task.attempt,
      result: task.result,
      error: task.error,
      checkpoints: task.checkpoints.length,
      submittedAt: task.submittedAt,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
    };
  }

  /**
   * Cancel a task
   */
  cancel(taskId) {
    // Remove from queue
    const idx = this._queue.findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const task = this._queue.splice(idx, 1)[0];
      task.state = TaskState.CANCELLED;
      task.completedAt = Date.now();
      this._completed.set(task.id, task);
      this._stats.cancelled++;
      bus.emit('task.cancelled', { taskId, reason: 'user' });
      return true;
    }

    // Mark running task as cancelled (handler must check)
    const running = this._running.get(taskId);
    if (running) {
      running.state = TaskState.CANCELLED;
      this._stats.cancelled++;
      bus.emit('task.cancelled', { taskId, reason: 'user' });
      return true;
    }

    return false;
  }

  /**
   * Pause a running task (handler must support this)
   */
  pause(taskId) {
    const task = this._running.get(taskId);
    if (task && task.state === TaskState.RUNNING) {
      task.state = TaskState.PAUSED;
      bus.emit('task.paused', { taskId });
      return true;
    }
    return false;
  }

  /**
   * Resume a paused task
   */
  resume(taskId) {
    const task = this._running.get(taskId);
    if (task && task.state === TaskState.PAUSED) {
      task.state = TaskState.RUNNING;
      bus.emit('task.resumed', { taskId });
      return true;
    }
    return false;
  }

  /**
   * Get scheduler stats
   */
  getStats() {
    const queueSize = this._externalQueue
      ? this._externalQueue.size()
      : this._queue.length;

    return {
      ...this._stats,
      queueSize,
      queueBackend: this._externalQueue ? this._externalQueue.constructor.name : 'memory',
      runningCount: this._running.size,
      completedBufferSize: this._completed.size,
      replayEnabled: !!this._replayEngine,
      containerEnabled: !!this._containerRunner,
    };
  }

  /**
   * List tasks by state
   */
  listTasks(state, limit = 50) {
    const tasks = [];

    if (!state || state === TaskState.QUEUED) {
      for (const t of this._queue.slice(0, limit)) {
        tasks.push(this.getTask(t.id));
      }
    }
    if (!state || state === TaskState.RUNNING) {
      for (const [, t] of this._running) {
        if (tasks.length >= limit) break;
        tasks.push(this.getTask(t.id));
      }
    }
    if (!state || [TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED].includes(state)) {
      for (const [, t] of this._completed) {
        if (tasks.length >= limit) break;
        if (!state || t.state === state) tasks.push(this.getTask(t.id));
      }
    }

    return tasks.slice(0, limit);
  }
}

function _withTimeout(promise, ms) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms);
    promise.then(r => { clearTimeout(timer); resolve(r); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

module.exports = { Scheduler, TaskState };
