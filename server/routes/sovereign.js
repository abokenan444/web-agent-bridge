/**
 * Sovereign API Routes
 * ════════════════════════════════════════════════════════════════════════
 * Routes for: Decentralized Reputation, Real-time Negotiation,
 * Anti-Hallucination Shield, and Sovereign Dashboard data.
 */

const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');

const reputation = require('../services/reputation');
const negotiation = require('../services/negotiation');
const verification = require('../services/verification');
const priceShield = require('../services/price-shield');

// ═══════════════════════════════════════════════════════════════════════
// REPUTATION API
// ═══════════════════════════════════════════════════════════════════════

// Register an agent for the reputation network
router.post('/reputation/agents', (req, res) => {
  const { agentKey } = req.body;
  if (!agentKey || agentKey.length < 16) {
    return res.status(400).json({ error: 'agentKey must be at least 16 characters' });
  }
  const result = reputation.registerAgent(agentKey);
  res.json(result);
});

// Submit a trust attestation
router.post('/reputation/attestations', (req, res) => {
  const { siteId, agentId, interactionType, outcome,
    priceAccuracy, responseTimeMs, dataIntegrity, visionVerified, details } = req.body;

  if (!siteId || !agentId || !interactionType || !outcome) {
    return res.status(400).json({ error: 'siteId, agentId, interactionType, and outcome are required' });
  }

  const result = reputation.createAttestation({
    siteId, agentId, interactionType, outcome,
    priceAccuracy, responseTimeMs, dataIntegrity, visionVerified, details
  });

  if (result.error) return res.status(429).json(result);
  res.json(result);
});

// Get site reputation
router.get('/reputation/sites/:siteId', (req, res) => {
  const result = reputation.getReputation(req.params.siteId);
  res.json(result);
});

// Reputation leaderboard
router.get('/reputation/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = reputation.getReputationLeaderboard(limit);
  res.json(result);
});

// Search by reputation
router.get('/reputation/search', (req, res) => {
  const { category = 'all', minScore = 60 } = req.query;
  const result = reputation.searchByReputation(category, parseFloat(minScore));
  res.json(result);
});

// Verify an attestation
router.get('/reputation/verify/:attestationId', (req, res) => {
  const result = reputation.verifyAttestation(req.params.attestationId);
  res.json(result);
});

// Challenge a site's reputation
router.post('/reputation/challenges', (req, res) => {
  const { siteId, challengerAgent, reason, evidence } = req.body;
  if (!siteId || !challengerAgent || !reason) {
    return res.status(400).json({ error: 'siteId, challengerAgent, and reason are required' });
  }
  const result = reputation.challengeReputation(siteId, challengerAgent, reason, evidence);
  res.json(result);
});

// ═══════════════════════════════════════════════════════════════════════
// NEGOTIATION API
// ═══════════════════════════════════════════════════════════════════════

// Create negotiation rules (site owner)
router.post('/negotiation/rules', authenticateToken, (req, res) => {
  const { siteId, ruleName, conditionType, discountType, discountValue,
    maxDiscountPct, minOrderValue, requiresAgentReputation } = req.body;

  if (!siteId || !ruleName || !conditionType || !discountType || discountValue == null) {
    return res.status(400).json({ error: 'siteId, ruleName, conditionType, discountType, and discountValue are required' });
  }

  const result = negotiation.createRule(siteId, {
    ruleName, conditionType, discountType, discountValue,
    maxDiscountPct, minOrderValue, requiresAgentReputation
  });
  res.json(result);
});

// Get negotiation rules for a site
router.get('/negotiation/rules/:siteId', (req, res) => {
  const rules = negotiation.getRules(req.params.siteId);
  res.json(rules);
});

// Update a negotiation rule
router.put('/negotiation/rules/:ruleId', authenticateToken, (req, res) => {
  negotiation.updateRule(req.params.ruleId, req.body);
  res.json({ updated: true });
});

// Open negotiation session (agent)
router.post('/negotiation/sessions', (req, res) => {
  const { siteId, agentId, itemId, itemName, originalPrice } = req.body;
  if (!siteId || !agentId || !originalPrice) {
    return res.status(400).json({ error: 'siteId, agentId, and originalPrice are required' });
  }

  const result = negotiation.openSession(siteId, agentId, { itemId, itemName, originalPrice });
  res.json(result);
});

// Agent makes a proposal
router.post('/negotiation/sessions/:sessionId/propose', (req, res) => {
  const { strategy, proposedDiscount, arguments: args } = req.body;
  if (!strategy || proposedDiscount == null) {
    return res.status(400).json({ error: 'strategy and proposedDiscount are required' });
  }

  const result = negotiation.agentPropose(req.params.sessionId, {
    strategy, proposedDiscount, arguments: args
  });

  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Confirm a deal
router.post('/negotiation/sessions/:sessionId/confirm', (req, res) => {
  const result = negotiation.confirmDeal(req.params.sessionId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Get negotiation stats for a site
router.get('/negotiation/stats/:siteId', authenticateToken, (req, res) => {
  const stats = negotiation.getNegotiationStats(req.params.siteId);
  res.json(stats);
});

// Get agent savings
router.get('/negotiation/savings/:agentId', (req, res) => {
  const savings = negotiation.getAgentSavings(req.params.agentId);
  res.json(savings);
});

// ═══════════════════════════════════════════════════════════════════════
// VERIFICATION (Anti-Hallucination Shield) API
// ═══════════════════════════════════════════════════════════════════════

// Verify a price (DOM vs Vision)
router.post('/verify/price', (req, res) => {
  const { siteId, agentId, url, domValue, visionValue, category, itemName } = req.body;
  if (!siteId || !domValue) {
    return res.status(400).json({ error: 'siteId and domValue are required' });
  }

  const result = verification.verifyPrice({
    siteId, agentId, url, domValue, visionValue, category, itemName
  });
  res.json(result);
});

// Verify text
router.post('/verify/text', (req, res) => {
  const { siteId, agentId, url, domValue, visionValue, fieldName } = req.body;
  if (!siteId || !domValue) {
    return res.status(400).json({ error: 'siteId and domValue are required' });
  }

  const result = verification.verifyText({
    siteId, agentId, url, domValue, visionValue, fieldName
  });
  res.json(result);
});

// Full page verification
router.post('/verify/page', (req, res) => {
  const { siteId, agentId, url, domData, visionData } = req.body;
  if (!siteId || !domData) {
    return res.status(400).json({ error: 'siteId and domData are required' });
  }

  const result = verification.verifyPage({
    siteId, agentId, url, domData, visionData: visionData || {}
  });
  res.json(result);
});

// Human confirmation for a verification result
router.post('/verify/:verificationId/confirm', (req, res) => {
  const { approved } = req.body;
  const result = verification.confirmVerification(req.params.verificationId, approved);
  res.json(result);
});

// Get shield stats for a site
router.get('/verify/stats/:siteId', (req, res) => {
  const stats = verification.getShieldStats(req.params.siteId);
  res.json(stats);
});

// Get global shield stats
router.get('/verify/stats', (req, res) => {
  const stats = verification.getGlobalShieldStats();
  res.json(stats);
});

// Update price benchmark
router.post('/verify/benchmarks', (req, res) => {
  const { category, itemPattern, price } = req.body;
  if (!category || !itemPattern || price == null) {
    return res.status(400).json({ error: 'category, itemPattern, and price are required' });
  }
  verification.updateBenchmark(category, itemPattern, price);
  res.json({ updated: true });
});

// ═══════════════════════════════════════════════════════════════════════
// SOVEREIGN DASHBOARD DATA API
// ═══════════════════════════════════════════════════════════════════════

router.get('/dashboard/sovereign', authenticateToken, (req, res) => {
  const userId = req.user.id;

  // Get user's sites
  const { db: database } = require('../models/db');
  const sites = database.prepare('SELECT id, domain FROM sites WHERE user_id = ?').all(userId);

  const dashboardData = {
    overview: {
      sitesProtected: sites.length,
      shieldStatus: 'active'
    },
    reputation: {},
    negotiation: {},
    shield: {},
    privacy: { trackingAttempts: 0, intentionsEncrypted: 0, dataShielded: 0 }
  };

  // Aggregate data across all user's sites
  let totalAttestations = 0, totalDeals = 0, totalSaved = 0;
  let totalChecks = 0, totalBlocked = 0;
  const siteDetails = [];

  for (const site of sites) {
    const rep = reputation.getReputation(site.id);
    const negStats = negotiation.getNegotiationStats(site.id);
    const shieldStats = verification.getShieldStats(site.id);

    totalAttestations += rep.totalAttestations || 0;
    totalDeals += negStats.deals_made || 0;
    totalSaved += negStats.total_discount_given || 0;
    totalChecks += shieldStats.total_checks || 0;
    totalBlocked += (shieldStats.halted_operations || 0) + (shieldStats.blocked_operations || 0);

    siteDetails.push({
      siteId: site.id,
      domain: site.domain,
      reputationScore: rep.reputationScore,
      trustLevel: rep.trustLevel,
      dealsMade: negStats.deals_made || 0,
      avgSavings: negStats.avg_savings || 0,
      integrityRating: shieldStats.integrity_rating
    });
  }

  dashboardData.reputation = {
    totalAttestations,
    avgReputationScore: siteDetails.length > 0
      ? Math.round(siteDetails.reduce((s, d) => s + d.reputationScore, 0) / siteDetails.length)
      : 50
  };

  dashboardData.negotiation = {
    totalDeals,
    totalSaved: Math.round(totalSaved * 100) / 100
  };

  dashboardData.shield = {
    totalChecks,
    threatsBlocked: totalBlocked,
    integrityScore: siteDetails.length > 0
      ? Math.round(siteDetails.reduce((s, d) => s + d.integrityRating, 0) / siteDetails.length)
      : 100
  };

  dashboardData.sites = siteDetails;

  res.json(dashboardData);
});

// ═══════════════════════════════════════════════════════════════════════
// DYNAMIC PRICING SHIELD API
// ═══════════════════════════════════════════════════════════════════════

// Get available identity personas
router.get('/price-shield/personas', (req, res) => {
  res.json(priceShield.getPersonas());
});

// Create a new price scan
router.post('/price-shield/scans', (req, res) => {
  const { siteId, url, itemName, category } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  const result = priceShield.createScan({ siteId, url, itemName, category });
  res.json(result);
});

// Record a probe result for a scan
router.post('/price-shield/scans/:scanId/probes', (req, res) => {
  const { personaId, priceText, currency, responseHeaders, cookiesReceived, durationMs } = req.body;
  if (!personaId || !priceText) {
    return res.status(400).json({ error: 'personaId and priceText are required' });
  }
  const result = priceShield.recordProbe(req.params.scanId, {
    personaId, priceText, currency, responseHeaders, cookiesReceived, durationMs
  });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Analyze a scan (after probes are recorded)
router.post('/price-shield/scans/:scanId/analyze', (req, res) => {
  const result = priceShield.analyzeScan(req.params.scanId);
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Quick scan — all-in-one (provide probes + get analysis)
router.post('/price-shield/quick-scan', (req, res) => {
  const { url, itemName, siteId, category, probes } = req.body;
  if (!url || !probes || !Array.isArray(probes) || probes.length < 2) {
    return res.status(400).json({ error: 'url and at least 2 probes are required' });
  }
  const result = priceShield.quickScan({ url, itemName, siteId, category, probes });
  if (result.error) return res.status(400).json(result);
  res.json(result);
});

// Get scan report
router.get('/price-shield/scans/:scanId', (req, res) => {
  const result = priceShield.getScanReport(req.params.scanId);
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

// Get global price shield statistics
router.get('/price-shield/stats', (req, res) => {
  res.json(priceShield.getGlobalStats());
});

// Get price history for a URL
router.get('/price-shield/history', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: 'url query parameter is required' });
  const limit = Math.min(parseInt(req.query.limit) || 30, 100);
  res.json(priceShield.getPriceHistory(url, limit));
});

// Get manipulation log for a site
router.get('/price-shield/manipulations/:siteId', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const result = priceShield.getGlobalStats();
  res.json(result.topManipulators.find(m => m.siteId === req.params.siteId) || { siteId: req.params.siteId, incidents: 0 });
});

module.exports = router;
