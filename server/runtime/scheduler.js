'use strict';

/**
 * WAB Runtime - Task Scheduler
 * 
 * Distributes and manages task execution with:
 * - Priority queue
 * - Retry logic with exponential backoff
 * - Timeout management
 * - Dependency resolution
 * - Concurrency control
 */

const crypto = require('crypto');
const { bus } = require('./event-bus');

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
    this._queue = [];                  // priority queue
    this._running = new Map();         // taskId → task
    this._completed = new Map();       // taskId → result (limited buffer)
    this._handlers = new Map();        // task type → handler function
    this._maxConcurrent = options.maxConcurrent || 20;
    this._maxQueueSize = options.maxQueueSize || 1000;
    this._maxCompleted = options.maxCompleted || 500;
    this._defaultRetries = options.defaultRetries || 3;
    this._defaultTimeout = options.defaultTimeout || 30000;
    this._processing = false;
    this._stats = { submitted: 0, completed: 0, failed: 0, retried: 0, cancelled: 0, timedOut: 0 };
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
    if (this._queue.length >= this._maxQueueSize) {
      throw new Error('Task queue is full');
    }

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

    while (this._queue.length > 0 && this._running.size < this._maxConcurrent) {
      const task = this._findNextReady();
      if (!task) break;

      // Remove from queue
      const idx = this._queue.indexOf(task);
      if (idx !== -1) this._queue.splice(idx, 1);

      // Check deadline
      if (task.deadline && Date.now() > task.deadline) {
        task.state = TaskState.CANCELLED;
        task.error = { code: 'DEADLINE_EXCEEDED', message: 'Task deadline has passed' };
        bus.emit('task.cancelled', { taskId: task.id, reason: 'deadline' });
        continue;
      }

      // Execute
      this._running.set(task.id, task);
      this._executeTask(task); // fire and forget
    }

    this._processing = false;
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

    const handler = this._handlers.get(task.type);
    if (!handler) {
      task.state = TaskState.FAILED;
      task.error = { code: 'NO_HANDLER', message: `No handler for task type: ${task.type}` };
      this._finishTask(task);
      return;
    }

    try {
      const result = await _withTimeout(
        handler(task.params, {
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
          },
        }),
        task.timeout
      );

      task.state = TaskState.COMPLETED;
      task.result = result;
      task.progress = 100;
      this._stats.completed++;
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
          this._queue.unshift(task); // Add back to front of queue
          this._processQueue();
        }, backoff);
        return;
      }

      task.state = TaskState.FAILED;
      task.error = { code: isTimeout ? 'TIMEOUT' : 'EXECUTION_ERROR', message: err.message };
      this._stats.failed++;
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
    return {
      ...this._stats,
      queueSize: this._queue.length,
      runningCount: this._running.size,
      completedBufferSize: this._completed.size,
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
