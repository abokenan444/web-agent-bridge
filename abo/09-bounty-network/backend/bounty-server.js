/**
 * WAB Bounty Network
 * Community-powered threat intelligence. Users earn WAB Credits
 * for discovering and reporting new scam URLs, dark patterns, and
 * platform violations. Verified reports are added to the global threat DB.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const url = require('url');

// ─── Reward Tiers ─────────────────────────────────────────────────────────────
const REWARD_TIERS = {
  PHISHING_URL:        { credits: 50,  usd_equivalent: 0.50,  label: 'Phishing URL' },
  SCAM_WEBSITE:        { credits: 100, usd_equivalent: 1.00,  label: 'Scam Website' },
  DARK_PATTERN:        { credits: 75,  usd_equivalent: 0.75,  label: 'Dark Pattern' },
  FAKE_REVIEW_NETWORK: { credits: 200, usd_equivalent: 2.00,  label: 'Fake Review Network' },
  PRICE_MANIPULATION:  { credits: 150, usd_equivalent: 1.50,  label: 'Price Manipulation' },
  DATA_BREACH:         { credits: 500, usd_equivalent: 5.00,  label: 'Data Breach' },
  PLATFORM_VIOLATION:  { credits: 300, usd_equivalent: 3.00,  label: 'Platform Violation' },
  NOVEL_ATTACK:        { credits: 1000,usd_equivalent: 10.00, label: 'Novel Attack Vector' },
};

// ─── In-memory stores ─────────────────────────────────────────────────────────
const submissions = new Map();
const hunters = new Map();       // hunterHash → HunterProfile
const leaderboard = [];
const verifiedThreats = new Map();

// ─── Seed some verified threats ───────────────────────────────────────────────
const seedThreats = [
  { url: 'paypa1-secure-login.com', type: 'PHISHING_URL', verifiedAt: '2026-04-10' },
  { url: 'amaz0n-deals-today.net', type: 'SCAM_WEBSITE', verifiedAt: '2026-04-12' },
  { url: 'crypto-wallet-verify.io', type: 'SCAM_WEBSITE', verifiedAt: '2026-04-15' },
  { url: 'irs-refund-claim-2026.org', type: 'PHISHING_URL', verifiedAt: '2026-04-18' },
];
seedThreats.forEach(t => verifiedThreats.set(t.url, { ...t, id: 'VT-' + crypto.randomBytes(4).toString('hex').toUpperCase() }));

// ─── Hunter Profile ───────────────────────────────────────────────────────────
class HunterProfile {
  constructor(hunterHash) {
    this.hash = hunterHash;
    this.credits = 0;
    this.submissions = 0;
    this.verified = 0;
    this.rank = 'ROOKIE';
    this.joinedAt = Date.now();
    this.badges = [];
  }

  addCredits(amount) {
    this.credits += amount;
    this.submissions++;
    this.updateRank();
  }

  verifySubmission(amount) {
    this.credits += amount;
    this.verified++;
    this.updateRank();
    this.checkBadges();
  }

  updateRank() {
    if (this.credits >= 10000) this.rank = 'ELITE';
    else if (this.credits >= 5000) this.rank = 'EXPERT';
    else if (this.credits >= 1000) this.rank = 'ADVANCED';
    else if (this.credits >= 200) this.rank = 'INTERMEDIATE';
    else this.rank = 'ROOKIE';
  }

  checkBadges() {
    if (this.verified >= 1 && !this.badges.includes('FIRST_BLOOD')) this.badges.push('FIRST_BLOOD');
    if (this.verified >= 10 && !this.badges.includes('THREAT_HUNTER')) this.badges.push('THREAT_HUNTER');
    if (this.verified >= 50 && !this.badges.includes('GUARDIAN')) this.badges.push('GUARDIAN');
    if (this.credits >= 1000 && !this.badges.includes('BOUNTY_MASTER')) this.badges.push('BOUNTY_MASTER');
  }

  toPublicJSON() {
    return {
      hunter_id: this.hash.substring(0, 12),
      credits: this.credits,
      rank: this.rank,
      submissions: this.submissions,
      verified_reports: this.verified,
      badges: this.badges,
      joined: new Date(this.joinedAt).toISOString().split('T')[0],
    };
  }
}

// ─── Bounty Engine ────────────────────────────────────────────────────────────
class BountyEngine {
  constructor() {
    this.totalCreditsAwarded = 0;
    this.totalThreatsFound = 0;
    this.startTime = Date.now();
    // Seed some hunters for leaderboard
    this._seedLeaderboard();
  }

  _seedLeaderboard() {
    const seedHunters = [
      { credits: 8750, rank: 'ELITE', verified: 87, badges: ['FIRST_BLOOD', 'THREAT_HUNTER', 'GUARDIAN', 'BOUNTY_MASTER'] },
      { credits: 5200, rank: 'EXPERT', verified: 52, badges: ['FIRST_BLOOD', 'THREAT_HUNTER', 'GUARDIAN', 'BOUNTY_MASTER'] },
      { credits: 3100, rank: 'EXPERT', verified: 31, badges: ['FIRST_BLOOD', 'THREAT_HUNTER', 'GUARDIAN'] },
      { credits: 1850, rank: 'ADVANCED', verified: 18, badges: ['FIRST_BLOOD', 'THREAT_HUNTER'] },
      { credits: 950, rank: 'INTERMEDIATE', verified: 9, badges: ['FIRST_BLOOD'] },
    ];
    seedHunters.forEach((data, i) => {
      const hash = 'seed-hunter-' + i;
      const hunter = new HunterProfile(hash);
      Object.assign(hunter, data);
      hunters.set(hash, hunter);
    });
  }

  getOrCreateHunter(token) {
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    if (!hunters.has(hash)) {
      hunters.set(hash, new HunterProfile(hash));
    }
    return hunters.get(hash);
  }

  submit(hunterToken, data) {
    const { reportType, targetUrl, description, evidence } = data;

    if (!reportType || !REWARD_TIERS[reportType]) {
      return { success: false, error: `Invalid report type. Valid types: ${Object.keys(REWARD_TIERS).join(', ')}` };
    }

    // Check for duplicate submission
    const urlHash = crypto.createHash('sha256').update(targetUrl || description || '').digest('hex');
    for (const [, sub] of submissions) {
      if (sub.url_hash === urlHash && sub.status !== 'REJECTED') {
        return { success: false, error: 'This threat has already been reported', existing_id: sub.id };
      }
    }

    const submissionId = 'SUB-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const tier = REWARD_TIERS[reportType];
    const hunter = this.getOrCreateHunter(hunterToken);

    const submission = {
      id: submissionId,
      url_hash: urlHash,
      report_type: reportType,
      target_url: targetUrl,
      description,
      evidence_urls: evidence || [],
      hunter_hash: hunter.hash.substring(0, 12),
      submitted_at: new Date().toISOString(),
      status: 'PENDING_REVIEW',
      pending_credits: tier.credits,
      usd_equivalent: tier.usd_equivalent,
      review_eta: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    submissions.set(submissionId, submission);
    hunter.addCredits(Math.floor(tier.credits * 0.1)); // 10% upfront, 90% on verification

    // Auto-verify obvious threats after 2 seconds (in production: human review queue)
    const isObvious = targetUrl && (
      /paypa[l1]/.test(targetUrl) ||
      /amaz[o0]n-/.test(targetUrl) ||
      /\.(xyz|info|online|site|top|click)$/.test(targetUrl)
    );

    if (isObvious) {
      setTimeout(() => this.verify(submissionId, 'AUTO_VERIFIED'), 2000);
    }

    return {
      success: true,
      submission_id: submissionId,
      status: 'PENDING_REVIEW',
      pending_credits: tier.credits,
      upfront_credits: Math.floor(tier.credits * 0.1),
      review_eta: submission.review_eta,
      hunter_profile: hunter.toPublicJSON(),
    };
  }

  verify(submissionId, verifier = 'WAB_TEAM') {
    const submission = submissions.get(submissionId);
    if (!submission) return { error: 'Submission not found' };
    if (submission.status !== 'PENDING_REVIEW') return { error: 'Already processed' };

    submission.status = 'VERIFIED';
    submission.verified_at = new Date().toISOString();
    submission.verified_by = verifier;

    // Add to verified threats DB
    if (submission.target_url) {
      verifiedThreats.set(submission.target_url, {
        id: 'VT-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        url: submission.target_url,
        type: submission.report_type,
        verifiedAt: new Date().toISOString().split('T')[0],
        source: 'BOUNTY_NETWORK',
      });
    }

    // Award remaining 90% credits to hunter
    const hunterHash = Object.keys(Object.fromEntries(hunters)).find(h =>
      hunters.get(h)?.hash.substring(0, 12) === submission.hunter_hash
    );
    if (hunterHash) {
      const hunter = hunters.get(hunterHash);
      const remainingCredits = Math.floor(submission.pending_credits * 0.9);
      hunter.verifySubmission(remainingCredits);
      this.totalCreditsAwarded += submission.pending_credits;
    }

    this.totalThreatsFound++;
    return { success: true, submission_id: submissionId, status: 'VERIFIED' };
  }

  getLeaderboard(limit = 10) {
    return Array.from(hunters.values())
      .sort((a, b) => b.credits - a.credits)
      .slice(0, limit)
      .map((h, i) => ({ rank: i + 1, ...h.toPublicJSON() }));
  }

  getStats() {
    return {
      total_submissions: submissions.size,
      verified_threats: verifiedThreats.size,
      total_hunters: hunters.size,
      total_credits_awarded: this.totalCreditsAwarded,
      pending_review: Array.from(submissions.values()).filter(s => s.status === 'PENDING_REVIEW').length,
      reward_tiers: REWARD_TIERS,
    };
  }
}

const bountyEngine = new BountyEngine();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-WAB-Hunter-Token');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);
  const hunterToken = req.headers['x-wab-hunter-token'] || 'anon-' + crypto.randomBytes(8).toString('hex');

  if (req.method === 'POST' && parsedUrl.pathname === '/bounty/submit') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const result = bountyEngine.submit(hunterToken, data);
        res.writeHead(result.success ? 201 : 400);
        res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/bounty/leaderboard') {
    const limit = parseInt(parsedUrl.query.limit) || 10;
    res.writeHead(200);
    res.end(JSON.stringify({ leaderboard: bountyEngine.getLeaderboard(limit) }));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/bounty/my-profile') {
    const hunter = bountyEngine.getOrCreateHunter(hunterToken);
    res.writeHead(200);
    res.end(JSON.stringify(hunter.toPublicJSON()));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/bounty/threats') {
    const threats = Array.from(verifiedThreats.values()).slice(0, 50);
    res.writeHead(200);
    res.end(JSON.stringify({ threats, total: verifiedThreats.size }));
    return;
  }

  if (parsedUrl.pathname === '/bounty/stats') {
    res.writeHead(200);
    res.end(JSON.stringify(bountyEngine.getStats()));
    return;
  }

  if (parsedUrl.pathname === '/bounty/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_BOUNTY_PORT) || 3009;
server.listen(PORT, () => {
  console.log(`[WAB Bounty Network] Running on port ${PORT}`);
  console.log(`[WAB Bounty Network] Verified threats: ${verifiedThreats.size}`);
});

module.exports = { BountyEngine };
