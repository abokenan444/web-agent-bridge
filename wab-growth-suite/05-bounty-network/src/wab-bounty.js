// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Bounty Network v2.5
// Crowdsourced scam detection — users earn credits for reports
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const crypto = require('crypto');
const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';

// ── Reward tiers ──────────────────────────────────────────────────────────
const REWARD_TIERS = {
  CRITICAL:  { credits: 50,  label: 'Critical Threat',  description: 'Active phishing/malware — immediate danger' },
  HIGH:      { credits: 25,  label: 'High Risk',        description: 'Confirmed scam or fraud' },
  MEDIUM:    { credits: 10,  label: 'Medium Risk',      description: 'Suspicious behavior or deceptive practices' },
  LOW:       { credits:  5,  label: 'Low Risk',         description: 'Minor violation or unverified concern' },
  DUPLICATE: { credits:  1,  label: 'Duplicate',        description: 'Already in our database — small reward for effort' },
  INVALID:   { credits:  0,  label: 'Invalid',          description: 'Not a real threat' },
};

// ── WABBountyClient (for reporters) ──────────────────────────────────────
class WABBountyClient {
  constructor(reporterToken) {
    if (!reporterToken) throw new Error('Reporter token required — register at https://www.webagentbridge.com/bounty');
    this.token = reporterToken;
  }

  _headers() {
    return {
      'X-WAB-Reporter': this.token,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VER,
      'X-WAB-Source': 'bounty-client',
    };
  }

  async _post(endpoint, body) {
    const res = await fetch(`${WAB_API}/${endpoint}`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WAB Bounty API error ${res.status}`);
    return res.json();
  }

  async _get(endpoint, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${WAB_API}/${endpoint}${qs ? '?' + qs : ''}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`WAB Bounty API error ${res.status}`);
    return res.json();
  }

  // Submit a new bounty report
  async submit(url, options = {}) {
    const { evidence = '', category = 'phishing', description = '', screenshot = null } = options;

    // Generate a unique fingerprint for deduplication
    const fingerprint = crypto.createHash('sha256')
      .update(url.toLowerCase().trim())
      .digest('hex')
      .substring(0, 16);

    return this._post('bounty/submit', {
      url,
      fingerprint,
      category,     // phishing | malware | scam | fake-shop | counterfeit | other
      description,
      evidence,
      screenshot,   // base64 encoded image (optional)
      submitted_at: new Date().toISOString(),
    });
  }

  // Check status of a submitted report
  async getStatus(bountyId) {
    return this._get(`bounty/status/${bountyId}`);
  }

  // Get reporter's balance and history
  async getBalance() {
    return this._get('bounty/balance');
  }

  // Get leaderboard
  async getLeaderboard(limit = 10) {
    return this._get('bounty/leaderboard', { limit });
  }

  // Redeem credits
  async redeem(credits, redeemType = 'subscription') {
    // redeemType: 'subscription' | 'payout' | 'donation'
    return this._post('bounty/redeem', { credits, type: redeemType });
  }
}

// ── WABBountyServer (Express router for WAB backend) ──────────────────────
function createBountyRouter(db, wabApiKey) {
  // db: any database adapter with .get(), .set(), .increment() methods
  // This creates a real Express router — no placeholder logic

  const express = require('express');
  const router  = express.Router();

  // Middleware: validate reporter token
  async function validateReporter(req, res, next) {
    const token = req.headers['x-wab-reporter'];
    if (!token) return res.status(401).json({ error: 'Reporter token required' });

    const reporter = await db.get(`reporter:${token}`);
    if (!reporter) return res.status(403).json({ error: 'Invalid reporter token' });

    req.reporter = reporter;
    next();
  }

  // POST /submit — Submit a bounty report
  router.post('/submit', validateReporter, async (req, res) => {
    const { url, fingerprint, category, description, evidence } = req.body;

    if (!url || !url.startsWith('http')) {
      return res.status(400).json({ error: 'Valid URL required' });
    }

    // Check for duplicate
    const existing = await db.get(`bounty:fp:${fingerprint}`);
    if (existing) {
      // Still reward the reporter a small amount for the effort
      await db.increment(`reporter:${req.reporter.id}:credits`, REWARD_TIERS.DUPLICATE.credits);
      return res.json({
        bounty_id:    existing.id,
        status:       'DUPLICATE',
        message:      'This URL is already in our database.',
        credits_earned: REWARD_TIERS.DUPLICATE.credits,
        powered_by:   'WAB Bounty Network | https://www.webagentbridge.com',
      });
    }

    // Create new bounty
    const bountyId = `BNT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const bounty = {
      id:           bountyId,
      url,
      fingerprint,
      category,
      description,
      evidence,
      reporter_id:  req.reporter.id,
      status:       'PENDING',
      submitted_at: new Date().toISOString(),
      verified_at:  null,
      reward_tier:  null,
      credits:      0,
    };

    await db.set(`bounty:${bountyId}`, bounty);
    await db.set(`bounty:fp:${fingerprint}`, { id: bountyId });

    // Queue for verification (async)
    setImmediate(() => verifyBounty(bountyId, url, wabApiKey, db));

    res.json({
      bounty_id:   bountyId,
      status:      'PENDING',
      message:     'Report submitted. You will be notified when verified (usually within 24 hours).',
      powered_by:  'WAB Bounty Network | https://www.webagentbridge.com',
    });
  });

  // GET /status/:id — Check bounty status
  router.get('/status/:id', validateReporter, async (req, res) => {
    const bounty = await db.get(`bounty:${req.params.id}`);
    if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
    if (bounty.reporter_id !== req.reporter.id) return res.status(403).json({ error: 'Access denied' });
    res.json({ ...bounty, powered_by: 'WAB Bounty Network | https://www.webagentbridge.com' });
  });

  // GET /balance — Get reporter balance
  router.get('/balance', validateReporter, async (req, res) => {
    const credits  = await db.get(`reporter:${req.reporter.id}:credits`) || 0;
    const reports  = await db.get(`reporter:${req.reporter.id}:reports`) || 0;
    const verified = await db.get(`reporter:${req.reporter.id}:verified`) || 0;
    res.json({
      reporter_id:     req.reporter.id,
      credits_balance: credits,
      total_reports:   reports,
      verified_reports: verified,
      accuracy_rate:   reports > 0 ? Math.round((verified / reports) * 100) : 0,
      powered_by:      'WAB Bounty Network | https://www.webagentbridge.com',
    });
  });

  return router;
}

// ── Async bounty verifier (runs in background) ────────────────────────────
async function verifyBounty(bountyId, url, wabApiKey, db) {
  try {
    const res = await fetch(`${WAB_API}/shield/scan`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${wabApiKey}`,
        'Content-Type': 'application/json',
        'X-WAB-SDK': WAB_VER,
      },
      body: JSON.stringify({ url }),
    });
    const scan   = await res.json();
    const bounty = await db.get(`bounty:${bountyId}`);
    if (!bounty) return;

    let tier = 'INVALID';
    if      (scan.status === 'CRITICAL' && scan.risk_score >= 90) tier = 'CRITICAL';
    else if (scan.status === 'CRITICAL')                           tier = 'HIGH';
    else if (scan.status === 'WARNING')                            tier = 'MEDIUM';
    else if (scan.risk_score > 30)                                 tier = 'LOW';

    const reward = REWARD_TIERS[tier];
    bounty.status      = 'VERIFIED';
    bounty.verified_at = new Date().toISOString();
    bounty.reward_tier = tier;
    bounty.credits     = reward.credits;

    await db.set(`bounty:${bountyId}`, bounty);
    if (reward.credits > 0) {
      await db.increment(`reporter:${bounty.reporter_id}:credits`, reward.credits);
      await db.increment(`reporter:${bounty.reporter_id}:verified`, 1);
    }
    await db.increment(`reporter:${bounty.reporter_id}:reports`, 1);
  } catch (e) {
    console.error(`[WAB Bounty] Verification failed for ${bountyId}:`, e.message);
  }
}

module.exports = { WABBountyClient, createBountyRouter, REWARD_TIERS };
