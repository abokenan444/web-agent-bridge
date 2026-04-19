// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Growth Suite v2.5 — Main Entry Point
// All 8 growth modules unified under one import
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const { WABCore }                                            = require('./shared/sdk/wab-core');
const { WABSafetyLayer, WABAgentWrapper }                    = require('./02-ai-safety-layer/src/wab-ai-safety');
const { WABScore }                                           = require('./03-wab-score/src/wab-score');
const { WABTrustVerifier, WABTrustManifest, WABTrustBadge }  = require('./04-trust-layer-protocol/src/wab-trust');
const { WABBountyClient, createBountyRouter }                = require('./05-bounty-network/src/wab-bounty');
const { WABDataMarketplace, DATASET_CATEGORIES }             = require('./06-data-marketplace/src/wab-data-marketplace');
const { WABEmailScanner }                                    = require('./07-email-protection/src/wab-email');
const { WABAffiliateIntelligence }                           = require('./08-affiliate-intelligence/src/wab-affiliate');

// ── WABGrowthSuite — unified factory ──────────────────────────────────────
class WABGrowthSuite {
  constructor(apiKey) {
    if (!apiKey) throw new Error('[WAB Growth Suite] API key required — https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;

    // Instantiate all modules
    this.core        = new WABCore(apiKey);
    this.score       = new WABScore(apiKey);
    this.trust       = new WABTrustVerifier(apiKey);
    this.bounty      = new WABBountyClient(apiKey);
    this.data        = new WABDataMarketplace(apiKey);
    this.email       = new WABEmailScanner(apiKey);
    this.affiliate   = new WABAffiliateIntelligence(apiKey);

    // Configure AI Safety Layer (static)
    WABSafetyLayer.configure(apiKey, { blockCritical: true, logAll: true });
    this.safety = WABSafetyLayer;
  }

  // ── Quick scan (most common use case) ────────────────────────────────
  async scan(url) {
    return this.core.scanURL(url);
  }

  // ── Full domain audit (all modules combined) ──────────────────────────
  async auditDomain(domain) {
    const [score, trust, security] = await Promise.allSettled([
      this.score.getScore(domain),
      this.trust.verify(domain),
      this.core.scanURL(`https://${domain}`),
    ]);

    return {
      domain,
      wab_score:    score.status === 'fulfilled'    ? score.value    : { error: score.reason?.message },
      trust_layer:  trust.status === 'fulfilled'    ? trust.value    : { error: trust.reason?.message },
      security:     security.status === 'fulfilled' ? security.value : { error: security.reason?.message },
      audited_at:   new Date().toISOString(),
      powered_by:   'WAB Growth Suite v2.5 | https://www.webagentbridge.com',
    };
  }

  // ── Wrap an AI agent with safety layer ───────────────────────────────
  wrapAgent(agent, policy = {}) {
    return new WABAgentWrapper(agent, this.apiKey, policy);
  }

  // ── Get Express router for bounty network ────────────────────────────
  bountyRouter(db) {
    return createBountyRouter(db, this.apiKey);
  }

  // ── Generate trust manifest for a domain ─────────────────────────────
  generateTrustManifest(options) {
    return WABTrustManifest.generate(options);
  }

  // ── Generate trust badge HTML ─────────────────────────────────────────
  async getTrustBadge(domain) {
    return WABTrustBadge.generate(domain, this.apiKey);
  }

  // ── Get version info ──────────────────────────────────────────────────
  get version() { return '2.5.0'; }
  get modules()  { return ['widget', 'ai-safety', 'wab-score', 'trust-protocol', 'bounty', 'data-marketplace', 'email-protection', 'affiliate-intelligence']; }
}

// ── Named exports ─────────────────────────────────────────────────────────
module.exports = {
  // Main suite
  WABGrowthSuite,

  // Individual modules
  WABCore,
  WABSafetyLayer,
  WABAgentWrapper,
  WABScore,
  WABTrustVerifier,
  WABTrustManifest,
  WABTrustBadge,
  WABBountyClient,
  createBountyRouter,
  WABDataMarketplace,
  DATASET_CATEGORIES,
  WABEmailScanner,
  WABAffiliateIntelligence,

  // Constants
  WAB_VERSION: '2.5.0',
  WAB_DOCS:    'https://www.webagentbridge.com/docs',
  WAB_API:     'https://api.webagentbridge.com/v1',
};
