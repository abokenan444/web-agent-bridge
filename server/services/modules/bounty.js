/**
 * WAB Bounty Network (09-bounty-network) — PUBLIC API, PRIVATE VERIFICATION RULES
 * Bug bounty and threat reporting network.
 * Report interface is open, verification rules are closed.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');

const reportStore = new Map();
const rewardStore = new Map();

const CATEGORIES = ['dark_pattern', 'price_manipulation', 'fake_reviews', 'hidden_fees', 'data_harvesting', 'accessibility_violation', 'misleading_ads', 'forced_subscription'];
const SEVERITY_REWARDS = { LOW: 10, MEDIUM: 50, HIGH: 200, CRITICAL: 500 };

let verifyReport;
try { verifyReport = require('./bounty-verification'); } catch { verifyReport = null; }

function createRouter(express) {
  const router = express.Router();

  router.post('/report', (req, res) => {
    const { platform, url: targetUrl, category, description, evidence_html, reporter_token } = req.body;
    if (!platform || !targetUrl || !category || !description) {
      return res.status(400).json({ error: 'platform, url, category, and description required' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Invalid category. Valid: ${CATEGORIES.join(', ')}` });
    }

    const reportId = 'RPT-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const reporterHash = crypto.createHmac('sha256', process.env.WAB_SECRET || 'wab-bounty-salt')
      .update(reporter_token || crypto.randomBytes(16).toString('hex')).digest('hex').substring(0, 16);

    const report = {
      report_id: reportId, platform, url: targetUrl, category, description,
      reporter_hash: reporterHash, severity: null, reward_usd: 0,
      status: 'SUBMITTED', submitted_at: new Date().toISOString(),
      verified: false, verification_notes: null,
    };

    if (verifyReport) {
      const verification = verifyReport(report, evidence_html);
      report.severity = verification.severity;
      report.verified = verification.verified;
      report.reward_usd = verification.verified ? (SEVERITY_REWARDS[verification.severity] || 0) : 0;
      report.status = verification.verified ? 'VERIFIED' : 'PENDING_REVIEW';
    } else {
      report.status = 'PENDING_REVIEW';
    }

    reportStore.set(reportId, report);
    res.status(201).json(report);
  });

  router.get('/report/:id', (req, res) => {
    const report = reportStore.get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    res.json(report);
  });

  router.get('/categories', (req, res) => {
    res.json({ categories: CATEGORIES, severity_rewards_usd: SEVERITY_REWARDS });
  });

  router.get('/leaderboard', (req, res) => {
    const reporters = {};
    for (const r of reportStore.values()) {
      if (r.verified) { reporters[r.reporter_hash] = (reporters[r.reporter_hash] || 0) + r.reward_usd; }
    }
    const leaderboard = Object.entries(reporters).map(([hash, total]) => ({ reporter_hash: hash, total_rewards_usd: total }))
      .sort((a, b) => b.total_rewards_usd - a.total_rewards_usd).slice(0, 20);
    res.json({ leaderboard });
  });

  router.get('/stats', (req, res) => {
    let verified = 0, totalReward = 0;
    for (const r of reportStore.values()) { if (r.verified) { verified++; totalReward += r.reward_usd; } }
    res.json({ total_reports: reportStore.size, verified_reports: verified, total_rewards_usd: totalReward, categories: CATEGORIES.length });
  });

  return router;
}

module.exports = { createRouter };
