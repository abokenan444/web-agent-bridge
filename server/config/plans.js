'use strict';

/**
 * WAB Business Model Configuration
 *
 * Defines what is OPEN (free core for adoption) and what is CLOSED (paid for revenue).
 *
 * Principle: "Open what creates network effects. Close what creates operational value."
 *
 * OPEN (Core — free forever):
 *   - WAP Protocol (schema, discovery, permissions)
 *   - SDK + Client Runtime (JS, integrations)
 *   - Browser Execution Layer (basic)
 *   - Adapters (MCP, REST, Browser)
 *   - Registry (read-only — search commands, sites, templates)
 *   - Basic agent registration & authentication
 *
 * CLOSED (Paid — revenue layer):
 *   - Workspace / Control Plane (dashboard, monitoring, agent management)
 *   - Advanced Orchestration (scheduling, retries, pipelines, distributed exec)
 *   - Observability (tracing, analytics, performance insights)
 *   - Enterprise Security (signing, audit logs, compliance, IP allowlists)
 *   - Hosted Runtime (cloud execution, auto-scaling)
 *   - Marketplace commissions (10-20%)
 */

// ─── Plans ──────────────────────────────────────────────────────────────

const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: 'month',
    description: 'Core WAP protocol + SDK for developers & site integration',
    limits: {
      agents: 3,
      tasksPerDay: 50,
      executionsPerDay: 100,
      sessions: 5,
      maxConcurrency: 2,
      replayRecordings: 10,
      computeMinutesPerDay: 10,
      storageMB: 50,
      webhooks: 1,
      customAgents: 1,
      apiCallsPerMinute: 20,
    },
    features: {
      // OPEN — always available
      protocol: true,
      sdk: true,
      browserExecution: true,
      adapters: true,             // MCP, REST, Browser adapters
      registryRead: true,         // Browse commands, sites, templates
      agentRegistration: true,
      basicAuth: true,
      discovery: true,            // /.well-known/agent-tools.json
      capabilityNegotiation: true,
      semanticActions: true,      // Basic semantic actions
      communityTemplates: true,

      // CLOSED — not available on free
      workspace: false,
      advancedOrchestration: false,
      observability: false,
      enterpriseSecurity: false,
      hostedRuntime: false,
      marketplace: false,
      failureAnalysis: false,
      replayEngine: false,
      certification: false,
      llmInference: false,
      prioritySupport: false,
      customDomain: false,
      sla: false,
      auditLog: false,
      advancedAnalytics: false,
      dataExtraction: false,
      trafficIntelligence: false,
      exploitShield: false,
      visionAnalysis: false,
      swarmExecution: false,
      agentMemory: false,
    },
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    price: 29,
    interval: 'month',
    stripePrice: process.env.STRIPE_PRICE_STARTER,
    description: 'For developers building production agents',
    limits: {
      agents: 10,
      tasksPerDay: 500,
      executionsPerDay: 1000,
      sessions: 25,
      maxConcurrency: 5,
      replayRecordings: 100,
      computeMinutesPerDay: 60,
      storageMB: 500,
      webhooks: 5,
      customAgents: 5,
      apiCallsPerMinute: 60,
    },
    features: {
      // OPEN
      protocol: true,
      sdk: true,
      browserExecution: true,
      adapters: true,
      registryRead: true,
      agentRegistration: true,
      basicAuth: true,
      discovery: true,
      capabilityNegotiation: true,
      semanticActions: true,
      communityTemplates: true,

      // PAID — now available
      workspace: true,
      advancedOrchestration: true,
      observability: true,         // Basic observability (metrics, logs)
      failureAnalysis: true,
      replayEngine: true,
      llmInference: true,
      advancedAnalytics: true,
      dataExtraction: true,
      agentMemory: true,

      // Still closed
      enterpriseSecurity: false,
      hostedRuntime: false,
      marketplace: false,
      certification: false,
      prioritySupport: false,
      customDomain: false,
      sla: false,
      auditLog: false,
      trafficIntelligence: false,
      exploitShield: false,
      visionAnalysis: false,
      swarmExecution: false,
    },
  },

  pro: {
    id: 'pro',
    name: 'Pro',
    price: 99,
    interval: 'month',
    stripePrice: process.env.STRIPE_PRICE_PRO,
    description: 'For teams & companies running agents at scale',
    limits: {
      agents: 50,
      tasksPerDay: 5000,
      executionsPerDay: 10000,
      sessions: 100,
      maxConcurrency: 20,
      replayRecordings: 1000,
      computeMinutesPerDay: 300,
      storageMB: 5000,
      webhooks: 25,
      customAgents: 25,
      apiCallsPerMinute: 200,
    },
    features: {
      // All OPEN
      protocol: true, sdk: true, browserExecution: true, adapters: true,
      registryRead: true, agentRegistration: true, basicAuth: true,
      discovery: true, capabilityNegotiation: true, semanticActions: true,
      communityTemplates: true,

      // All Starter features
      workspace: true, advancedOrchestration: true, observability: true,
      failureAnalysis: true, replayEngine: true, llmInference: true,
      advancedAnalytics: true, dataExtraction: true, agentMemory: true,

      // New in Pro
      hostedRuntime: true,
      marketplace: true,         // Publish & sell on marketplace
      certification: true,
      trafficIntelligence: true,
      exploitShield: true,
      visionAnalysis: true,
      swarmExecution: true,
      auditLog: true,
      customDomain: true,

      // Enterprise only
      enterpriseSecurity: false,
      prioritySupport: false,
      sla: false,
    },
  },

  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    price: null, // Custom pricing
    interval: 'month',
    stripePrice: process.env.STRIPE_PRICE_ENTERPRISE,
    description: 'For organizations needing security, compliance & dedicated support',
    limits: {
      agents: -1,        // Unlimited
      tasksPerDay: -1,
      executionsPerDay: -1,
      sessions: -1,
      maxConcurrency: 100,
      replayRecordings: -1,
      computeMinutesPerDay: -1,
      storageMB: -1,
      webhooks: -1,
      customAgents: -1,
      apiCallsPerMinute: 1000,
    },
    features: {
      // Everything
      protocol: true, sdk: true, browserExecution: true, adapters: true,
      registryRead: true, agentRegistration: true, basicAuth: true,
      discovery: true, capabilityNegotiation: true, semanticActions: true,
      communityTemplates: true,
      workspace: true, advancedOrchestration: true, observability: true,
      failureAnalysis: true, replayEngine: true, llmInference: true,
      advancedAnalytics: true, dataExtraction: true, agentMemory: true,
      hostedRuntime: true, marketplace: true, certification: true,
      trafficIntelligence: true, exploitShield: true, visionAnalysis: true,
      swarmExecution: true, auditLog: true, customDomain: true,

      // Enterprise exclusive
      enterpriseSecurity: true,
      prioritySupport: true,
      sla: true,
    },
  },
};

// ─── Usage-Based Pricing (Pay-as-you-go overages) ───────────────────

const USAGE_PRICING = {
  execution: { unit: 'execution', price: 0.001, description: '$0.001 per execution beyond plan limit' },
  computeMinute: { unit: 'minute', price: 0.01, description: '$0.01 per compute minute beyond plan limit' },
  storage: { unit: 'MB', price: 0.05, description: '$0.05 per MB/month beyond plan limit' },
  llmToken: { unit: '1K tokens', price: 0.002, description: '$0.002 per 1K tokens (pass-through + margin)' },
  agent: { unit: 'agent', price: 2.00, description: '$2/month per additional agent beyond plan limit' },
};

// ─── Marketplace Commissions ────────────────────────────────────────

const MARKETPLACE = {
  commission: 0.15,        // 15% platform fee
  minPrice: 0.99,
  maxPrice: 999.99,
  payoutThreshold: 25.00,  // Minimum balance for payout
  categories: [
    'automation', 'scraping', 'commerce', 'analytics',
    'security', 'integration', 'ai-agent', 'template',
    'adapter', 'plugin',
  ],
};

// ─── Feature Gate Mapping ───────────────────────────────────────────
// Maps API path patterns to required features

const FEATURE_GATES = {
  // Advanced orchestration
  '/tasks': { feature: 'advancedOrchestration', methods: ['POST'] },
  '/tasks/*/pause': { feature: 'advancedOrchestration', methods: ['POST'] },
  '/tasks/*/resume': { feature: 'advancedOrchestration', methods: ['POST'] },
  '/execute/pipeline': { feature: 'advancedOrchestration', methods: ['POST'] },

  // Observability (write/analysis — reads are free for basic health)
  '/observability/metrics': { feature: 'observability', methods: ['GET'] },
  '/observability/traces': { feature: 'observability', methods: ['GET'] },
  '/observability/logs': { feature: 'observability', methods: ['GET'] },

  // Replay engine
  '/replay': { feature: 'replayEngine', methods: ['GET', 'POST'] },

  // Failure analysis
  '/failures': { feature: 'failureAnalysis', methods: ['GET', 'POST'] },

  // Sessions (beyond free limit)
  '/sessions': { feature: 'workspace', methods: ['POST'] },

  // Certification
  '/certification/verify': { feature: 'certification', methods: ['POST'] },

  // LLM
  '/llm/complete': { feature: 'llmInference', methods: ['POST'] },
  '/llm/embed': { feature: 'llmInference', methods: ['POST'] },

  // Control plane
  '/deployments': { feature: 'workspace', methods: ['POST'] },
  '/policies': { feature: 'workspace', methods: ['POST'] },

  // Signing (enterprise)
  '/sign': { feature: 'enterpriseSecurity', methods: ['POST'] },
  '/verify': { feature: 'enterpriseSecurity', methods: ['POST'] },

  // Swarm
  '/premium/v2/swarm': { feature: 'swarmExecution', methods: ['POST'] },

  // Vision
  '/premium/v2/vision': { feature: 'visionAnalysis', methods: ['POST'] },

  // Marketplace
  '/marketplace/publish': { feature: 'marketplace', methods: ['POST'] },
};

// ─── Helpers ────────────────────────────────────────────────────────

function getPlan(tier) {
  return PLANS[tier] || PLANS.free;
}

function getLimit(tier, limitName) {
  const plan = getPlan(tier);
  return plan.limits[limitName] ?? 0;
}

function hasFeature(tier, featureName) {
  const plan = getPlan(tier);
  return plan.features[featureName] === true;
}

function isUnlimited(tier, limitName) {
  return getLimit(tier, limitName) === -1;
}

function listPlans(includeEnterprise = true) {
  const plans = Object.values(PLANS);
  return includeEnterprise ? plans : plans.filter(p => p.id !== 'enterprise');
}

function getUpgradePath(currentTier) {
  const order = ['free', 'starter', 'pro', 'enterprise'];
  const idx = order.indexOf(currentTier);
  if (idx === -1 || idx >= order.length - 1) return null;
  return PLANS[order[idx + 1]];
}

function checkFeatureGate(path, method) {
  for (const [pattern, gate] of Object.entries(FEATURE_GATES)) {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '[^/]+') + '(/|$)');
    if (regex.test(path) && gate.methods.includes(method)) {
      return gate.feature;
    }
  }
  return null; // No gate — free access
}

module.exports = {
  PLANS,
  USAGE_PRICING,
  MARKETPLACE,
  FEATURE_GATES,
  getPlan,
  getLimit,
  hasFeature,
  isUnlimited,
  listPlans,
  getUpgradePath,
  checkFeatureGate,
};
