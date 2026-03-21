/**
 * WAB Caching Layer — In-memory cache with TTL for hot data
 * Reduces DB reads for license verification, config, and stats
 */
class Cache {
  constructor(defaultTTL = 60000) {
    this.store = new Map();
    this.defaultTTL = defaultTTL;
    // Periodic cleanup every 2 minutes
    this._interval = setInterval(() => this._cleanup(), 120000);
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    entry.hits++;
    return entry.value;
  }

  set(key, value, ttl) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + (ttl || this.defaultTTL),
      hits: 0
    });
  }

  del(key) {
    this.store.delete(key);
  }

  invalidatePattern(pattern) {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) this.store.delete(key);
    }
  }

  stats() {
    return {
      size: this.store.size,
      keys: Array.from(this.store.keys())
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
  }

  destroy() {
    clearInterval(this._interval);
    this.store.clear();
  }
}

/**
 * Analytics Queue — Batches analytics inserts for better write performance
 * Flushes every N seconds or when buffer reaches max size
 */
class AnalyticsQueue {
  constructor(db, options = {}) {
    this.db = db;
    this.buffer = [];
    this.maxSize = options.maxSize || 50;
    this.flushInterval = options.flushInterval || 5000; // 5 seconds
    this._timer = setInterval(() => this.flush(), this.flushInterval);
  }

  push(analytic) {
    this.buffer.push(analytic);
    if (this.buffer.length >= this.maxSize) {
      this.flush();
    }
  }

  flush() {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0);

    try {
      const insert = this.db.prepare(
        `INSERT INTO analytics (site_id, action_name, agent_id, trigger_type, success, metadata) VALUES (?, ?, ?, ?, ?, ?)`
      );
      const insertMany = this.db.transaction((items) => {
        for (const item of items) {
          insert.run(
            item.siteId,
            item.actionName,
            item.agentId || null,
            item.triggerType || null,
            item.success ? 1 : 0,
            JSON.stringify(item.metadata || {})
          );
        }
      });
      insertMany(batch);
    } catch (err) {
      console.error('[WAB Cache] Analytics batch insert failed:', err.message);
      // Put items back if batch fails
      this.buffer.unshift(...batch);
    }
  }

  destroy() {
    clearInterval(this._timer);
    this.flush(); // flush remaining
  }
}

// Singleton cache instance with 60s TTL
const cache = new Cache(60000);

module.exports = { Cache, AnalyticsQueue, cache };
