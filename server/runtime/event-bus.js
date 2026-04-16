'use strict';

/**
 * WAB Runtime - Event Bus
 * 
 * Async event system with typed events, middleware, replay buffer,
 * and dead-letter queue. This is the nervous system of the Agent OS.
 */

const crypto = require('crypto');

class EventBus {
  constructor(options = {}) {
    this._listeners = new Map();     // event → Set<{ id, handler, filter, once }>
    this._middleware = [];           // global middleware
    this._history = [];              // event replay buffer
    this._deadLetter = [];           // failed events
    this._maxHistory = options.maxHistory || 10000;
    this._maxDeadLetter = options.maxDeadLetter || 1000;
    this._stats = { emitted: 0, delivered: 0, failed: 0, dropped: 0 };
  }

  /**
   * Subscribe to an event
   * @returns {string} subscription ID for unsubscribe
   */
  on(event, handler, options = {}) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    const sub = {
      id: `sub_${crypto.randomBytes(8).toString('hex')}`,
      handler,
      filter: options.filter || null,
      once: options.once || false,
      priority: options.priority || 0,
    };
    this._listeners.get(event).add(sub);
    return sub.id;
  }

  /**
   * Subscribe once
   */
  once(event, handler, options = {}) {
    return this.on(event, handler, { ...options, once: true });
  }

  /**
   * Unsubscribe by subscription ID
   */
  off(subId) {
    for (const [, subs] of this._listeners) {
      for (const sub of subs) {
        if (sub.id === subId) { subs.delete(sub); return true; }
      }
    }
    return false;
  }

  /**
   * Remove all listeners for an event
   */
  removeAll(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }

  /**
   * Emit an event
   */
  async emit(event, data, metadata = {}) {
    const envelope = {
      id: `evt_${crypto.randomBytes(12).toString('hex')}`,
      event,
      data,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
        source: metadata.source || 'system',
      },
    };

    // Run global middleware
    for (const mw of this._middleware) {
      try {
        const result = await mw(envelope);
        if (result === false) {
          this._stats.dropped++;
          return envelope;
        }
      } catch (_) { /* middleware errors don't block */ }
    }

    // Store in history
    this._history.push(envelope);
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-Math.floor(this._maxHistory * 0.8));
    }

    this._stats.emitted++;

    // Get listeners (event + wildcard)
    const listeners = [];
    const exact = this._listeners.get(event);
    if (exact) for (const sub of exact) listeners.push(sub);
    const wild = this._listeners.get('*');
    if (wild) for (const sub of wild) listeners.push(sub);

    // Also match namespace wildcards: 'task.*' matches 'task.completed'
    for (const [pattern, subs] of this._listeners) {
      if (pattern === event || pattern === '*') continue;
      if (pattern.endsWith('.*') && event.startsWith(pattern.slice(0, -1))) {
        for (const sub of subs) listeners.push(sub);
      }
    }

    // Sort by priority (higher first)
    listeners.sort((a, b) => b.priority - a.priority);

    // Dispatch
    const toRemove = [];
    for (const sub of listeners) {
      try {
        if (sub.filter && !sub.filter(envelope.data, envelope.metadata)) continue;
        await sub.handler(envelope.data, envelope.metadata, envelope);
        this._stats.delivered++;
        if (sub.once) toRemove.push(sub);
      } catch (err) {
        this._stats.failed++;
        this._deadLetter.push({ envelope, error: err.message, subscriberId: sub.id, timestamp: Date.now() });
        if (this._deadLetter.length > this._maxDeadLetter) {
          this._deadLetter = this._deadLetter.slice(-Math.floor(this._maxDeadLetter * 0.8));
        }
      }
    }

    // Cleanup one-time subs
    for (const sub of toRemove) {
      for (const [, subs] of this._listeners) subs.delete(sub);
    }

    return envelope;
  }

  /**
   * Add global middleware
   */
  use(middleware) {
    this._middleware.push(middleware);
  }

  /**
   * Replay events matching filter since a timestamp
   */
  async replay(since, filter, handler) {
    const events = this._history.filter(
      e => e.metadata.timestamp >= since && (!filter || filter(e))
    );
    for (const e of events) {
      await handler(e.data, e.metadata, e);
    }
    return events.length;
  }

  /**
   * Wait for a specific event (returns a promise)
   */
  waitFor(event, timeout = 30000, filter = null) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(subId);
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      const subId = this.once(event, (data, meta) => {
        clearTimeout(timer);
        resolve({ data, meta });
      }, { filter });
    });
  }

  /**
   * Get dead letter queue
   */
  getDeadLetters(limit = 50) {
    return this._deadLetter.slice(-limit);
  }

  /**
   * Get stats
   */
  getStats() {
    return {
      ...this._stats,
      listeners: this._countListeners(),
      historySize: this._history.length,
      deadLetterSize: this._deadLetter.length,
    };
  }

  _countListeners() {
    let count = 0;
    for (const [, subs] of this._listeners) count += subs.size;
    return count;
  }
}

// Singleton event bus for the runtime
const bus = new EventBus();

module.exports = { EventBus, bus };
