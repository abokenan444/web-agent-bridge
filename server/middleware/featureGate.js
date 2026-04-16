'use strict';

/**
 * Feature Gate Middleware for Agent OS
 *
 * Enforces plan-based access control on /api/os/* endpoints.
 * Checks tier features and usage limits before allowing access.
 *
 * OPEN endpoints (always free): protocol, registry read, discovery, adapters read,
 *   agent registration, basic health, SDK downloads
 *
 * GATED endpoints: orchestration, observability details, replay, failure analysis,
 *   sessions beyond limit, LLM inference, certification, signing, hosted runtime,
 *   marketplace publish, swarm, vision
 */

const { checkFeatureGate, hasFeature, getPlan } = require('../config/plans');
const metering = require('../services/metering');
const { metrics } = require('../observability');

/**
 * Feature Gate Middleware
 * Checks if the requesting agent/user has the required feature in their plan.
 *
 * Requires req.agentTier to be set (by auth middleware or license verification).
 * Falls back to 'free' if not set.
 */
function featureGate(req, res, next) {
  const tier = req.agentTier || req.session?.tier || 'free';
  const requiredFeature = checkFeatureGate(req.path, req.method);

  // No gate on this endpoint — free access
  if (!requiredFeature) return next();

  // Check feature
  if (!hasFeature(tier, requiredFeature)) {
    metrics.increment('feature_gate.denied', 1, { feature: requiredFeature, tier });
    const plan = getPlan(tier);
    return res.status(403).json({
      error: 'Feature not available on your plan',
      feature: requiredFeature,
      currentPlan: tier,
      upgrade: `This feature requires a higher plan. Visit /api/os/plans for available plans.`,
      upgradeUrl: '/api/os/plans',
    });
  }

  metrics.increment('feature_gate.allowed', 1, { feature: requiredFeature, tier });
  next();
}

/**
 * Usage Limit Middleware
 * Enforces per-metric limits (executions/day, tasks/day, etc.) based on plan.
 */
function usageLimit(metric) {
  return function (req, res, next) {
    const tier = req.agentTier || req.session?.tier || 'free';
    const entityId = req.agentId || req.session?.agentId || req.ip;

    const result = metering.record(entityId, metric, tier);

    if (!result.allowed) {
      metrics.increment('usage_limit.exceeded', 1, { metric, tier });
      return res.status(429).json({
        error: 'Usage limit exceeded',
        metric,
        current: result.current,
        limit: result.limit,
        overage: result.overageAmount,
        overageCost: result.overageCost,
        upgrade: 'Upgrade your plan for higher limits or enable pay-as-you-go overages.',
        upgradeUrl: '/api/os/plans',
      });
    }

    // Attach usage info to response headers
    if (result.limit > 0) {
      res.set('X-WAB-Usage-Current', String(result.current));
      res.set('X-WAB-Usage-Limit', String(result.limit));
      res.set('X-WAB-Usage-Remaining', String(Math.max(0, result.limit - result.current)));
    }

    next();
  };
}

module.exports = { featureGate, usageLimit };
