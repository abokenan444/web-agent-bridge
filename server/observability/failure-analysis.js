'use strict';

/**
 * Failure Analysis & Classification
 *
 * Classifies failures, detects patterns, and provides root cause analysis.
 */

const { bus } = require('../runtime/event-bus');

const FailureClass = {
  NETWORK: 'network',
  TIMEOUT: 'timeout',
  PERMISSION: 'permission',
  VALIDATION: 'validation',
  EXECUTION: 'execution',
  RATE_LIMIT: 'rate_limit',
  RESOURCE: 'resource',
  DEPENDENCY: 'dependency',
  UNKNOWN: 'unknown',
};

const Severity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
};

class FailureAnalyzer {
  constructor() {
    this._history = [];       // All failures
    this._patterns = new Map(); // pattern key → PatternInfo
    this._maxHistory = 10000;
    this._classifiers = this._defaultClassifiers();
  }

  /**
   * Classify a failure
   */
  classify(error, context = {}) {
    const failure = {
      id: `fail_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      error: {
        message: error.message || String(error),
        code: error.code || error.statusCode || null,
        stack: error.stack?.split('\n').slice(0, 5).join('\n') || null,
      },
      context: {
        taskId: context.taskId || null,
        agentId: context.agentId || null,
        action: context.action || null,
        domain: context.domain || null,
        siteId: context.siteId || null,
      },
      classification: null,
      severity: null,
      rootCause: null,
      retryable: false,
      suggestedFix: null,
    };

    // Run classifiers
    for (const classifier of this._classifiers) {
      const match = classifier.test(error, context);
      if (match) {
        failure.classification = match.class;
        failure.severity = match.severity;
        failure.rootCause = match.rootCause;
        failure.retryable = match.retryable;
        failure.suggestedFix = match.suggestedFix;
        break;
      }
    }

    // Fallback
    if (!failure.classification) {
      failure.classification = FailureClass.UNKNOWN;
      failure.severity = Severity.MEDIUM;
      failure.retryable = false;
    }

    // Record & detect pattern
    this._history.push(failure);
    this._evict();
    this._detectPattern(failure);

    bus.emit('failure.classified', {
      id: failure.id,
      classification: failure.classification,
      severity: failure.severity,
      retryable: failure.retryable,
    });

    return failure;
  }

  /**
   * Get failure by ID
   */
  getFailure(id) {
    return this._history.find(f => f.id === id) || null;
  }

  /**
   * Query failure history
   */
  query(filters = {}, limit = 50) {
    let results = this._history;

    if (filters.classification) {
      results = results.filter(f => f.classification === filters.classification);
    }
    if (filters.severity) {
      results = results.filter(f => f.severity === filters.severity);
    }
    if (filters.agentId) {
      results = results.filter(f => f.context.agentId === filters.agentId);
    }
    if (filters.taskId) {
      results = results.filter(f => f.context.taskId === filters.taskId);
    }
    if (filters.retryable !== undefined) {
      results = results.filter(f => f.retryable === filters.retryable);
    }
    if (filters.since) {
      results = results.filter(f => f.timestamp >= filters.since);
    }

    return results.slice(-limit).reverse();
  }

  /**
   * Get failure patterns
   */
  getPatterns() {
    return Array.from(this._patterns.values())
      .filter(p => p.count >= 3)
      .sort((a, b) => b.count - a.count)
      .map(p => ({
        key: p.key,
        classification: p.classification,
        count: p.count,
        firstSeen: p.firstSeen,
        lastSeen: p.lastSeen,
        frequency: p.count / ((p.lastSeen - p.firstSeen) / 60000 || 1),
        sample: p.sample,
      }));
  }

  /**
   * Get summary statistics
   */
  getSummary(since = 0) {
    const relevant = since ? this._history.filter(f => f.timestamp >= since) : this._history;

    const byClass = {};
    const bySeverity = {};
    let retryable = 0;

    for (const f of relevant) {
      byClass[f.classification] = (byClass[f.classification] || 0) + 1;
      bySeverity[f.severity] = (bySeverity[f.severity] || 0) + 1;
      if (f.retryable) retryable++;
    }

    return {
      total: relevant.length,
      byClassification: byClass,
      bySeverity: bySeverity,
      retryable,
      patternsDetected: this._patterns.size,
      activePatterns: Array.from(this._patterns.values()).filter(p => p.count >= 3).length,
    };
  }

  getStats() {
    return {
      totalFailures: this._history.length,
      patterns: this._patterns.size,
      classifiers: this._classifiers.length,
    };
  }

  // ── Internal ──

  _defaultClassifiers() {
    return [
      // Network errors
      {
        test: (err) => {
          const msg = (err.message || '').toLowerCase();
          if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND' || err.code === 'ECONNRESET' ||
              msg.includes('network') || msg.includes('dns') || msg.includes('socket') ||
              msg.includes('fetch failed') || msg.includes('econnaborted')) {
            return {
              class: FailureClass.NETWORK,
              severity: Severity.MEDIUM,
              rootCause: `Network error: ${err.code || err.message}`,
              retryable: true,
              suggestedFix: 'Retry with exponential backoff. Check network connectivity.',
            };
          }
        },
      },
      // Timeout
      {
        test: (err) => {
          const msg = (err.message || '').toLowerCase();
          if (err.code === 'ETIMEDOUT' || msg.includes('timeout') || msg.includes('timed out') ||
              msg.includes('aborted')) {
            return {
              class: FailureClass.TIMEOUT,
              severity: Severity.MEDIUM,
              rootCause: `Operation timed out: ${err.message}`,
              retryable: true,
              suggestedFix: 'Increase timeout or reduce payload size.',
            };
          }
        },
      },
      // Rate limit
      {
        test: (err) => {
          if (err.statusCode === 429 || err.code === 429 ||
              (err.message || '').toLowerCase().includes('rate limit')) {
            return {
              class: FailureClass.RATE_LIMIT,
              severity: Severity.LOW,
              rootCause: 'Rate limit exceeded',
              retryable: true,
              suggestedFix: 'Wait for rate limit window to reset. Reduce request frequency.',
            };
          }
        },
      },
      // Permission
      {
        test: (err) => {
          const code = err.statusCode || err.code;
          const msg = (err.message || '').toLowerCase();
          if (code === 401 || code === 403 || msg.includes('unauthorized') ||
              msg.includes('forbidden') || msg.includes('permission') || msg.includes('not allowed')) {
            return {
              class: FailureClass.PERMISSION,
              severity: Severity.HIGH,
              rootCause: `Permission denied: ${err.message}`,
              retryable: false,
              suggestedFix: 'Request required capabilities via capability negotiation.',
            };
          }
        },
      },
      // Validation
      {
        test: (err) => {
          const code = err.statusCode || err.code;
          const msg = (err.message || '').toLowerCase();
          if (code === 400 || code === 422 || msg.includes('valid') || msg.includes('required') ||
              msg.includes('schema') || msg.includes('missing')) {
            return {
              class: FailureClass.VALIDATION,
              severity: Severity.LOW,
              rootCause: `Validation error: ${err.message}`,
              retryable: false,
              suggestedFix: 'Check input schema. Ensure all required fields are present.',
            };
          }
        },
      },
      // Resource
      {
        test: (err) => {
          const code = err.statusCode || err.code;
          const msg = (err.message || '').toLowerCase();
          if (code === 404 || msg.includes('not found') || msg.includes('no such') ||
              msg.includes('does not exist')) {
            return {
              class: FailureClass.RESOURCE,
              severity: Severity.LOW,
              rootCause: `Resource not found: ${err.message}`,
              retryable: false,
              suggestedFix: 'Verify resource ID or path. Use discovery endpoint first.',
            };
          }
        },
      },
      // Dependency
      {
        test: (err) => {
          const msg = (err.message || '').toLowerCase();
          if (msg.includes('dependency') || msg.includes('upstream') || msg.includes('service unavailable') ||
              (err.statusCode || err.code) === 503) {
            return {
              class: FailureClass.DEPENDENCY,
              severity: Severity.HIGH,
              rootCause: `Dependency failure: ${err.message}`,
              retryable: true,
              suggestedFix: 'Check upstream service health. Use fallback provider if available.',
            };
          }
        },
      },
    ];
  }

  _detectPattern(failure) {
    const key = `${failure.classification}:${failure.context.action || 'unknown'}:${failure.context.domain || '*'}`;
    const existing = this._patterns.get(key);

    if (existing) {
      existing.count++;
      existing.lastSeen = failure.timestamp;
      existing.sample = failure.error.message;
    } else {
      this._patterns.set(key, {
        key,
        classification: failure.classification,
        count: 1,
        firstSeen: failure.timestamp,
        lastSeen: failure.timestamp,
        sample: failure.error.message,
      });
    }
  }

  _evict() {
    if (this._history.length > this._maxHistory) {
      this._history = this._history.slice(-this._maxHistory);
    }
  }
}

const failureAnalyzer = new FailureAnalyzer();

module.exports = { FailureAnalyzer, FailureClass, Severity, failureAnalyzer };
