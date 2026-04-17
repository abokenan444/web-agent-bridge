'use strict';

/**
 * WAB External Queue — Pluggable Queue Backend
 *
 * Replaces the in-memory array queue with a durable, shared queue.
 * Supports multiple backends:
 *   - memory: In-process (default, backwards compatible)
 *   - redis:  Redis + BullMQ (distributed, persistent, production)
 *   - sqlite: SQLite-backed (single-node persistent, no Redis needed)
 *
 * The queue is shared between the Scheduler (enqueue) and Workers (dequeue).
 * All backends implement the same interface.
 */

const crypto = require('crypto');
const { bus } = require('./event-bus');

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE INTERFACE (all backends implement this)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} QueueItem
 * @property {string} id
 * @property {string} type
 * @property {number} priority
 * @property {object} data
 * @property {string} status - pending|processing|completed|failed|delayed
 * @property {number} attempts
 * @property {number} maxAttempts
 * @property {number} createdAt
 * @property {number} processAfter - delayed execution timestamp
 */

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY BACKEND (default — backwards compatible)
// ═══════════════════════════════════════════════════════════════════════════

class MemoryQueue {
  constructor(name, options = {}) {
    this.name = name;
    this._items = [];
    this._processing = new Map();
    this._completed = new Map();
    this._maxSize = options.maxSize || 10000;
    this._maxCompleted = options.maxCompleted || 1000;
    this._stats = { enqueued: 0, dequeued: 0, completed: 0, failed: 0 };
  }

  async enqueue(item) {
    if (this._items.length >= this._maxSize) {
      throw new Error(`Queue "${this.name}" is full (${this._maxSize})`);
    }

    const entry = {
      id: item.id || `q_${crypto.randomBytes(12).toString('hex')}`,
      type: item.type || 'default',
      priority: item.priority || 50,
      data: item.data || {},
      status: 'pending',
      attempts: 0,
      maxAttempts: item.maxAttempts || 3,
      timeout: item.timeout || 60000,
      createdAt: Date.now(),
      processAfter: item.delay ? Date.now() + item.delay : 0,
      groupId: item.groupId || null,
    };

    // Insert sorted by priority (descending)
    let inserted = false;
    for (let i = 0; i < this._items.length; i++) {
      if (entry.priority > this._items[i].priority) {
        this._items.splice(i, 0, entry);
        inserted = true;
        break;
      }
    }
    if (!inserted) this._items.push(entry);

    this._stats.enqueued++;
    return entry;
  }

  async dequeue(count = 1, workerId = null) {
    const now = Date.now();
    const result = [];

    for (let i = 0; i < this._items.length && result.length < count; i++) {
      const item = this._items[i];
      if (item.status !== 'pending') continue;
      if (item.processAfter && item.processAfter > now) continue;

      item.status = 'processing';
      item.attempts++;
      item.dequeuedAt = now;
      item.workerId = workerId;

      this._items.splice(i, 1);
      i--;

      this._processing.set(item.id, item);
      this._stats.dequeued++;
      result.push(item);
    }

    return result;
  }

  async complete(itemId, result) {
    const item = this._processing.get(itemId);
    if (!item) return null;

    item.status = 'completed';
    item.result = result;
    item.completedAt = Date.now();

    this._processing.delete(itemId);
    this._completed.set(itemId, item);
    this._evictCompleted();
    this._stats.completed++;

    return item;
  }

  async fail(itemId, error) {
    const item = this._processing.get(itemId);
    if (!item) return null;

    this._processing.delete(itemId);

    if (item.attempts < item.maxAttempts) {
      // Requeue with exponential backoff
      item.status = 'pending';
      item.lastError = error;
      item.processAfter = Date.now() + Math.min(1000 * Math.pow(2, item.attempts), 30000);
      this._items.push(item);
      // Re-sort
      this._items.sort((a, b) => b.priority - a.priority);
      return item;
    }

    item.status = 'failed';
    item.lastError = error;
    item.completedAt = Date.now();
    this._completed.set(itemId, item);
    this._evictCompleted();
    this._stats.failed++;

    return item;
  }

  async size() {
    return this._items.length;
  }

  async processingCount() {
    return this._processing.size;
  }

  async getItem(itemId) {
    return this._processing.get(itemId) ||
           this._items.find(i => i.id === itemId) ||
           this._completed.get(itemId) || null;
  }

  async purgeCompleted() {
    const count = this._completed.size;
    this._completed.clear();
    return count;
  }

  getStats() {
    return {
      ...this._stats,
      pending: this._items.filter(i => i.status === 'pending').length,
      delayed: this._items.filter(i => i.processAfter && i.processAfter > Date.now()).length,
      processing: this._processing.size,
      completedBuffer: this._completed.size,
    };
  }

  async close() { /* noop */ }

  _evictCompleted() {
    if (this._completed.size > this._maxCompleted) {
      const keys = Array.from(this._completed.keys());
      for (let i = 0; i < keys.length - this._maxCompleted; i++) {
        this._completed.delete(keys[i]);
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SQLITE BACKEND (persistent, single-node)
// ═══════════════════════════════════════════════════════════════════════════

class SQLiteQueue {
  constructor(name, options = {}) {
    this.name = name;
    this._db = options.db || require('../models/db').db;
    this._stats = { enqueued: 0, dequeued: 0, completed: 0, failed: 0 };

    this._db.exec(`
      CREATE TABLE IF NOT EXISTS queue_items (
        id TEXT PRIMARY KEY,
        queue_name TEXT NOT NULL,
        type TEXT DEFAULT 'default',
        priority INTEGER DEFAULT 50,
        data TEXT DEFAULT '{}',
        result TEXT,
        status TEXT DEFAULT 'pending',
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        timeout_ms INTEGER DEFAULT 60000,
        last_error TEXT,
        worker_id TEXT,
        group_id TEXT,
        process_after INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        dequeued_at INTEGER,
        completed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_items(queue_name, status, priority DESC);
      CREATE INDEX IF NOT EXISTS idx_queue_process ON queue_items(queue_name, status, process_after);
    `);

    this._stmts = {
      enqueue: this._db.prepare(`
        INSERT INTO queue_items (id, queue_name, type, priority, data, status, max_attempts, timeout_ms, process_after, group_id, created_at)
        VALUES (@id, @queue_name, @type, @priority, @data, 'pending', @max_attempts, @timeout_ms, @process_after, @group_id, @created_at)
      `),
      dequeue: this._db.prepare(`
        SELECT * FROM queue_items
        WHERE queue_name=? AND status='pending' AND process_after <= ?
        ORDER BY priority DESC, created_at ASC
        LIMIT ?
      `),
      markProcessing: this._db.prepare(`
        UPDATE queue_items SET status='processing', attempts=attempts+1, dequeued_at=?, worker_id=?
        WHERE id=? AND status='pending'
      `),
      complete: this._db.prepare(`
        UPDATE queue_items SET status='completed', result=?, completed_at=? WHERE id=?
      `),
      fail: this._db.prepare(`
        UPDATE queue_items SET status='failed', last_error=?, completed_at=? WHERE id=?
      `),
      requeue: this._db.prepare(`
        UPDATE queue_items SET status='pending', last_error=?, process_after=? WHERE id=?
      `),
      getItem: this._db.prepare(`SELECT * FROM queue_items WHERE id=?`),
      countByStatus: this._db.prepare(`
        SELECT status, COUNT(*) as count FROM queue_items WHERE queue_name=? GROUP BY status
      `),
      purge: this._db.prepare(`DELETE FROM queue_items WHERE queue_name=? AND status IN ('completed','failed')`),
      stuckItems: this._db.prepare(`
        SELECT * FROM queue_items WHERE queue_name=? AND status='processing' AND dequeued_at < ?
      `),
    };
  }

  async enqueue(item) {
    const id = item.id || `q_${crypto.randomBytes(12).toString('hex')}`;
    const entry = {
      id,
      queue_name: this.name,
      type: item.type || 'default',
      priority: item.priority || 50,
      data: JSON.stringify(item.data || {}),
      max_attempts: item.maxAttempts || 3,
      timeout_ms: item.timeout || 60000,
      process_after: item.delay ? Date.now() + item.delay : 0,
      group_id: item.groupId || null,
      created_at: Date.now(),
    };

    this._stmts.enqueue.run(entry);
    this._stats.enqueued++;
    return { ...entry, data: item.data || {}, status: 'pending', attempts: 0 };
  }

  async dequeue(count = 1, workerId = null) {
    const now = Date.now();
    const rows = this._stmts.dequeue.all(this.name, now, count);
    const result = [];

    for (const row of rows) {
      const changes = this._stmts.markProcessing.run(now, workerId, row.id);
      if (changes.changes > 0) {
        this._stats.dequeued++;
        result.push({
          id: row.id,
          type: row.type,
          priority: row.priority,
          data: _safeParse(row.data, {}),
          status: 'processing',
          attempts: row.attempts + 1,
          maxAttempts: row.max_attempts,
          timeout: row.timeout_ms,
          createdAt: row.created_at,
          groupId: row.group_id,
        });
      }
    }

    return result;
  }

  async complete(itemId, result) {
    this._stmts.complete.run(JSON.stringify(result || {}), Date.now(), itemId);
    this._stats.completed++;
    return this._getItem(itemId);
  }

  async fail(itemId, error) {
    const item = this._getItem(itemId);
    if (!item) return null;

    if (item.attempts < item.max_attempts) {
      const backoff = Math.min(1000 * Math.pow(2, item.attempts), 30000);
      this._stmts.requeue.run(error, Date.now() + backoff, itemId);
      return this._getItem(itemId);
    }

    this._stmts.fail.run(error, Date.now(), itemId);
    this._stats.failed++;
    return this._getItem(itemId);
  }

  async size() {
    const rows = this._stmts.countByStatus.all(this.name);
    const pending = rows.find(r => r.status === 'pending');
    return pending ? pending.count : 0;
  }

  async processingCount() {
    const rows = this._stmts.countByStatus.all(this.name);
    const proc = rows.find(r => r.status === 'processing');
    return proc ? proc.count : 0;
  }

  async getItem(itemId) {
    const row = this._getItem(itemId);
    if (!row) return null;
    return {
      ...row,
      data: _safeParse(row.data, {}),
      result: _safeParse(row.result, null),
    };
  }

  async purgeCompleted() {
    const result = this._stmts.purge.run(this.name);
    return result.changes;
  }

  /**
   * Recover stuck items (processing too long)
   */
  async recoverStuck(timeoutMs = 300000) {
    const cutoff = Date.now() - timeoutMs;
    const stuck = this._stmts.stuckItems.all(this.name, cutoff);
    let recovered = 0;
    for (const item of stuck) {
      if (item.attempts < item.max_attempts) {
        this._stmts.requeue.run('Stuck recovery', 0, item.id);
        recovered++;
      } else {
        this._stmts.fail.run('Stuck, max attempts reached', Date.now(), item.id);
      }
    }
    return recovered;
  }

  getStats() {
    const counts = {};
    for (const row of this._stmts.countByStatus.all(this.name)) {
      counts[row.status] = row.count;
    }
    return { ...this._stats, ...counts };
  }

  async close() { /* SQLite doesn't need explicit close per queue */ }

  _getItem(itemId) {
    return this._stmts.getItem.get(itemId) || null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REDIS BACKEND (distributed, production)
// ═══════════════════════════════════════════════════════════════════════════

class RedisQueue {
  constructor(name, options = {}) {
    this.name = name;
    this._connected = false;
    this._queue = null;
    this._worker = null;
    this._stats = { enqueued: 0, dequeued: 0, completed: 0, failed: 0 };
    this._pendingCallbacks = new Map();

    const redisUrl = options.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';

    try {
      const { Queue, Worker } = require('bullmq');
      const IORedis = require('ioredis');

      this._connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
      this._queue = new Queue(name, { connection: this._connection });

      if (options.startWorker !== false) {
        this._worker = new Worker(name, async (job) => {
          // Call registered processor
          if (this._processor) {
            return await this._processor(job.data, {
              jobId: job.id,
              attemptsMade: job.attemptsMade,
              name: job.name,
            });
          }
          return job.data;
        }, {
          connection: new IORedis(redisUrl, { maxRetriesPerRequest: null }),
          concurrency: options.concurrency || 10,
        });

        this._worker.on('completed', (job) => {
          this._stats.completed++;
          const cb = this._pendingCallbacks.get(job.id);
          if (cb) { cb.resolve(job.returnvalue); this._pendingCallbacks.delete(job.id); }
        });

        this._worker.on('failed', (job, err) => {
          this._stats.failed++;
          const cb = this._pendingCallbacks.get(job.id);
          if (cb) { cb.reject(err); this._pendingCallbacks.delete(job.id); }
        });
      }

      this._connected = true;
    } catch (err) {
      console.warn(`[Queue] Redis not available for queue "${name}": ${err.message}. Falling back to memory.`);
      this._fallback = new MemoryQueue(name, options);
    }
  }

  /**
   * Register a job processor
   */
  onProcess(processor) {
    this._processor = processor;
  }

  async enqueue(item) {
    if (this._fallback) return this._fallback.enqueue(item);

    const job = await this._queue.add(item.type || 'default', item.data || {}, {
      priority: 100 - (item.priority || 50), // BullMQ: lower = higher priority
      attempts: item.maxAttempts || 3,
      backoff: { type: 'exponential', delay: 1000 },
      delay: item.delay || 0,
      jobId: item.id || undefined,
      group: item.groupId ? { id: item.groupId } : undefined,
    });

    this._stats.enqueued++;
    return { id: job.id, type: item.type, priority: item.priority, status: 'pending', data: item.data };
  }

  async dequeue(count = 1) {
    if (this._fallback) return this._fallback.dequeue(count);
    // BullMQ workers pull automatically — this is for compatibility
    return [];
  }

  async complete(itemId, result) {
    if (this._fallback) return this._fallback.complete(itemId, result);
    // BullMQ handles this internally
    this._stats.completed++;
    return { id: itemId, status: 'completed', result };
  }

  async fail(itemId, error) {
    if (this._fallback) return this._fallback.fail(itemId, error);
    this._stats.failed++;
    return { id: itemId, status: 'failed', error };
  }

  async size() {
    if (this._fallback) return this._fallback.size();
    return await this._queue.getWaitingCount();
  }

  async processingCount() {
    if (this._fallback) return this._fallback.processingCount();
    return await this._queue.getActiveCount();
  }

  async getItem(itemId) {
    if (this._fallback) return this._fallback.getItem(itemId);
    const job = await this._queue.getJob(itemId);
    if (!job) return null;
    return {
      id: job.id,
      type: job.name,
      data: job.data,
      status: await job.getState(),
      attempts: job.attemptsMade,
    };
  }

  async purgeCompleted() {
    if (this._fallback) return this._fallback.purgeCompleted();
    await this._queue.clean(0, 0, 'completed');
    return 0;
  }

  getStats() {
    if (this._fallback) return { ...this._fallback.getStats(), backend: 'memory-fallback' };
    return { ...this._stats, backend: 'redis', connected: this._connected };
  }

  async close() {
    if (this._fallback) return this._fallback.close();
    if (this._worker) await this._worker.close();
    if (this._queue) await this._queue.close();
    if (this._connection) await this._connection.quit();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a queue with the configured backend.
 *
 * Environment variable: WAB_QUEUE_BACKEND = memory | sqlite | redis
 */
function createQueue(name, options = {}) {
  const backend = options.backend || process.env.WAB_QUEUE_BACKEND || 'sqlite';

  switch (backend) {
    case 'redis':
      return new RedisQueue(name, options);
    case 'sqlite':
      return new SQLiteQueue(name, options);
    case 'memory':
    default:
      return new MemoryQueue(name, options);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITER (works with any backend)
// ═══════════════════════════════════════════════════════════════════════════

class QueueRateLimiter {
  constructor(options = {}) {
    this._maxPerSecond = options.maxPerSecond || 100;
    this._maxPerMinute = options.maxPerMinute || 1000;
    this._window = [];
    this._minuteWindow = [];
  }

  check() {
    const now = Date.now();

    // Clean windows
    this._window = this._window.filter(t => now - t < 1000);
    this._minuteWindow = this._minuteWindow.filter(t => now - t < 60000);

    if (this._window.length >= this._maxPerSecond) return false;
    if (this._minuteWindow.length >= this._maxPerMinute) return false;

    this._window.push(now);
    this._minuteWindow.push(now);
    return true;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function _safeParse(str, fallback) {
  if (str == null) return fallback;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return fallback; }
}

module.exports = {
  createQueue,
  MemoryQueue,
  SQLiteQueue,
  RedisQueue,
  QueueRateLimiter,
};
