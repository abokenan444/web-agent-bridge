'use strict';

/**
 * Usage Metering Service
 *
 * Tracks executions, agents, compute time, API calls, and storage per agent/site.
 * Enforces plan limits and records overages for billing.
 */

const db = require('../models/db').db || require('../models/db');
const { getLimit, isUnlimited, USAGE_PRICING } = require('../config/plans');
const { bus } = require('../runtime/event-bus');

// ─── Storage ────────────────────────────────────────────────────────

// In-memory counters with periodic flush to DB
const _counters = new Map(); // key → { count, lastReset }

function _key(entityId, metric) {
  return `${entityId}:${metric}`;
}

function _today() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function _getCounter(entityId, metric) {
  const key = _key(entityId, metric);
  const entry = _counters.get(key);
  const today = _today();

  // Reset daily counters
  if (!entry || entry.lastReset !== today) {
    _counters.set(key, { count: 0, lastReset: today, overage: 0 });
    return _counters.get(key);
  }
  return entry;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Record a usage event and check limits
 * @returns {{ allowed: boolean, current: number, limit: number, overage: boolean }}
 */
function record(entityId, metric, tier, amount = 1) {
  const counter = _getCounter(entityId, metric);
  const limit = getLimit(tier, metric);

  counter.count += amount;

  // Unlimited
  if (isUnlimited(tier, metric)) {
    bus.emit('metering.recorded', { entityId, metric, amount, current: counter.count });
    return { allowed: true, current: counter.count, limit: -1, overage: false };
  }

  const isOver = counter.count > limit;
  if (isOver) {
    counter.overage += amount;
    bus.emit('metering.overage', { entityId, metric, current: counter.count, limit, overage: counter.overage });
  } else {
    bus.emit('metering.recorded', { entityId, metric, amount, current: counter.count });
  }

  return {
    allowed: !isOver,
    current: counter.count,
    limit,
    overage: isOver,
    overageAmount: isOver ? counter.overage : 0,
    overageCost: isOver ? counter.overage * (USAGE_PRICING[metric]?.price || 0) : 0,
  };
}

/**
 * Check if a usage would exceed the limit (without recording)
 */
function check(entityId, metric, tier, amount = 1) {
  const counter = _getCounter(entityId, metric);
  const limit = getLimit(tier, metric);

  if (isUnlimited(tier, metric)) {
    return { allowed: true, current: counter.count, limit: -1, remaining: Infinity };
  }

  const remaining = Math.max(0, limit - counter.count);
  return {
    allowed: counter.count + amount <= limit,
    current: counter.count,
    limit,
    remaining,
  };
}

/**
 * Get current usage for an entity
 */
function getUsage(entityId, tier) {
  const metrics = [
    'agents', 'tasksPerDay', 'executionsPerDay', 'sessions',
    'computeMinutesPerDay', 'apiCallsPerMinute',
  ];

  const usage = {};
  for (const metric of metrics) {
    const counter = _getCounter(entityId, metric);
    const limit = getLimit(tier, metric);
    usage[metric] = {
      current: counter.count,
      limit: isUnlimited(tier, metric) ? -1 : limit,
      percentage: isUnlimited(tier, metric) ? 0 : (limit > 0 ? Math.round((counter.count / limit) * 100) : 0),
      overage: counter.overage || 0,
    };
  }

  return usage;
}

/**
 * Get usage summary for billing
 */
function getBillingSummary(entityId) {
  const overages = {};
  let totalCost = 0;

  for (const [key, counter] of _counters) {
    if (!key.startsWith(entityId + ':')) continue;
    if (counter.overage > 0) {
      const metric = key.split(':')[1];
      const pricing = USAGE_PRICING[metric];
      const cost = pricing ? counter.overage * pricing.price : 0;
      overages[metric] = {
        overage: counter.overage,
        unitPrice: pricing?.price || 0,
        cost,
      };
      totalCost += cost;
    }
  }

  return { entityId, overages, totalCost, period: _today() };
}

/**
 * Reset counters (for testing or admin)
 */
function reset(entityId, metric = null) {
  if (metric) {
    _counters.delete(_key(entityId, metric));
  } else {
    for (const key of _counters.keys()) {
      if (key.startsWith(entityId + ':')) _counters.delete(key);
    }
  }
}

/**
 * Get global stats
 */
function getStats() {
  let totalEntities = new Set();
  let totalEvents = 0;
  for (const [key, counter] of _counters) {
    totalEntities.add(key.split(':')[0]);
    totalEvents += counter.count;
  }
  return {
    trackedEntities: totalEntities.size,
    totalEvents,
    counterEntries: _counters.size,
  };
}

module.exports = {
  record,
  check,
  getUsage,
  getBillingSummary,
  reset,
  getStats,
};
