/**
 * WAB Growth Suite v2.5 — Full API Routes
 *
 * Real, functional endpoints for all 8 modules:
 *  1. Shield / Widget  → POST /scan
 *  2. AI Safety Layer  → POST /safety/check
 *  3. WAB Score        → GET  /score/:domain, POST /score/batch
 *  4. Trust Layer      → GET  /trust/verify/:domain, POST /trust/register
 *  5. Bounty Network   → POST /bounty/submit, GET /bounty/status/:id, ...
 *  6. Data Marketplace → GET  /data/datasets, POST /data/purchase, ...
 *  7. Email Protection → POST /email/scan
 *  8. Affiliate Intel  → GET  /affiliate/analyze/:network, POST /affiliate/detect-fraud
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { db } = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const { calculateNeutralityScore } = require('../services/fairness');

// ── Helpers ───────────────────────────────────────────────────────────
function uuid() { return crypto.randomUUID ? crypto.randomUUID() : require('uuid').v4(); }

function jsonParse(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

const GRADES = [
  { min: 95, grade: 'A+', label: 'Exceptional',    color: '#22c55e' },
  { min: 90, grade: 'A',  label: 'Excellent',      color: '#4ade80' },
  { min: 85, grade: 'A-', label: 'Very Good',       color: '#86efac' },
  { min: 80, grade: 'B+', label: 'Good',            color: '#a3e635' },
  { min: 75, grade: 'B',  label: 'Above Average',   color: '#facc15' },
  { min: 70, grade: 'B-', label: 'Satisfactory',    color: '#fbbf24' },
  { min: 65, grade: 'C+', label: 'Below Average',   color: '#f59e0b' },
  { min: 60, grade: 'C',  label: 'Fair',            color: '#fb923c' },
  { min: 55, grade: 'C-', label: 'Poor',            color: '#f97316' },
  { min: 50, grade: 'D',  label: 'Very Poor',       color: '#ef4444' },
  { min:  0, grade: 'F',  label: 'Failing',         color: '#dc2626' },
];

function getGrade(score) {
  for (const g of GRADES) {
    if (score >= g.min) return g;
  }
  return GRADES[GRADES.length - 1];
}

// Threat pattern database (real patterns, not placeholders)
const THREAT_PATTERNS = [
  { pattern: /paypal|paypa[l1]/i, type: 'phishing', weight: 95 },
  { pattern: /login.*verify|verify.*account/i, type: 'credential_phishing', weight: 90 },
  { pattern: /free.*prize|winner.*claim/i, type: 'advance_fee_scam', weight: 85 },
  { pattern: /bit\.ly|tinyurl|t\.co/i, type: 'url_shortener', weight: 30 },
  { pattern: /\.xyz$|\.tk$|\.ml$|\.ga$|\.cf$/i, type: 'suspicious_tld', weight: 40 },
  { pattern: /crypto.*invest|bitcoin.*double/i, type: 'crypto_scam', weight: 92 },
  { pattern: /pharmacy|v[i1]agra|c[i1]al[i1]s/i, type: 'pharma_spam', weight: 70 },
  { pattern: /download.*free|crack.*software/i, type: 'malware_lure', weight: 80 },
  { pattern: /apple.*id.*locked|icloud.*suspend/i, type: 'phishing', weight: 93 },
  { pattern: /bank.*transfer|wire.*urgent/i, type: 'bec_fraud', weight: 88 },
];

const PHISHING_EMAIL_PATTERNS = [
  { pattern: /urgent|immediately|act now|expire/i, label: 'Urgency language' },
  { pattern: /verify your (account|identity|email)/i, label: 'Account verification request' },
  { pattern: /you have won|congratulations.*winner/i, label: 'Prize/lottery claim' },
  { pattern: /click here|click below/i, label: 'Suspicious call-to-action' },
  { pattern: /account.*(suspend|terminat|restrict|locked)/i, label: 'Account threat' },
  { pattern: /confirm your (details|identity|payment)/i, label: 'Confirmation request' },
  { pattern: /update.*(billing|payment|card) info/i, label: 'Info update request' },
  { pattern: /\$[\d,]+.*charged|transaction.*\$[\d,]+/i, label: 'Fake charge notification' },
];

const KNOWN_NETWORKS = {
  amazon_associates: { name: 'Amazon Associates', avg_commission: 4, avg_payout_days: 60, cookie_days: 1, trust_base: 82 },
  shareasale:        { name: 'ShareASale',        avg_commission: 8, avg_payout_days: 20, cookie_days: 30, trust_base: 78 },
  cj_affiliate:     { name: 'CJ Affiliate',      avg_commission: 7, avg_payout_days: 30, cookie_days: 30, trust_base: 75 },
  clickbank:         { name: 'ClickBank',          avg_commission: 50, avg_payout_days: 45, cookie_days: 60, trust_base: 61 },
  rakuten:           { name: 'Rakuten',            avg_commission: 5, avg_payout_days: 30, cookie_days: 30, trust_base: 73 },
  impact:            { name: 'Impact',             avg_commission: 6, avg_payout_days: 30, cookie_days: 30, trust_base: 80 },
  awin:              { name: 'Awin',               avg_commission: 5, avg_payout_days: 30, cookie_days: 30, trust_base: 76 },
  partnerstack:      { name: 'PartnerStack',       avg_commission: 20, avg_payout_days: 15, cookie_days: 90, trust_base: 85 },
};

const FRAUD_PATTERNS = {
  cookie_stuffing:    { severity: 'CRITICAL', label: 'Cookie Stuffing',       description: 'Unauthorized cookie injection to steal attribution' },
  click_fraud:        { severity: 'CRITICAL', label: 'Click Fraud',           description: 'Automated fake clicks inflating metrics' },
  commission_shaving: { severity: 'HIGH',     label: 'Commission Shaving',    description: 'Network reduces valid commission amounts' },
  late_attribution:   { severity: 'HIGH',     label: 'Late Attribution',      description: 'Delayed tracking causes missed valid sales' },
  low_cvr:            { severity: 'MEDIUM',   label: 'Low Conversion Rate',   description: 'CVR significantly below industry benchmark' },
  payment_delays:     { severity: 'MEDIUM',   label: 'Payment Delays',        description: 'Payouts consistently later than promised' },
  tos_changes:        { severity: 'MEDIUM',   label: 'TOS Changes',           description: 'Frequent or sudden commission/term changes' },
};

const REWARD_TIERS = {
  CRITICAL:  { credits: 50,  label: 'Critical Threat' },
  HIGH:      { credits: 25,  label: 'High Risk' },
  MEDIUM:    { credits: 10,  label: 'Medium Risk' },
  LOW:       { credits:  5,  label: 'Low Risk' },
  DUPLICATE: { credits:  1,  label: 'Duplicate' },
  INVALID:   { credits:  0,  label: 'Invalid' },
};


// ═══════════════════════════════════════════════════════════════════════
// 1. SHIELD / WIDGET — URL Threat Scanning
// ═══════════════════════════════════════════════════════════════════════

router.post('/scan', (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url is required' });

  let parsedUrl;
  try { parsedUrl = new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const hostname = parsedUrl.hostname.toLowerCase();
  let riskScore = 0;
  const threats = [];

  // Run pattern analysis
  for (const tp of THREAT_PATTERNS) {
    if (tp.pattern.test(url) || tp.pattern.test(hostname)) {
      riskScore = Math.max(riskScore, tp.weight);
      threats.push({ type: tp.type, confidence: tp.weight });
    }
  }

  // Heuristics
  if (hostname.length > 40) { riskScore = Math.max(riskScore, 45); threats.push({ type: 'long_domain', confidence: 45 }); }
  if ((hostname.match(/\./g) || []).length > 4) { riskScore = Math.max(riskScore, 50); threats.push({ type: 'excessive_subdomains', confidence: 50 }); }
  if (/\d{4,}/.test(hostname)) { riskScore = Math.max(riskScore, 35); threats.push({ type: 'numeric_domain', confidence: 35 }); }
  if (parsedUrl.protocol === 'http:') { riskScore = Math.max(riskScore, 20); threats.push({ type: 'no_ssl', confidence: 20 }); }

  // Check DB for known domains
  const cached = db.prepare('SELECT * FROM wab_scores WHERE domain = ?').get(hostname);
  if (cached && cached.security_score !== undefined) {
    const secRisk = 100 - cached.security_score;
    if (secRisk > riskScore) riskScore = secRisk;
  }

  let status = 'SAFE';
  if (riskScore >= 80) status = 'CRITICAL';
  else if (riskScore >= 50) status = 'WARNING';
  else if (riskScore >= 25) status = 'NOTICE';

  res.json({
    url,
    domain: hostname,
    status,
    risk_score: riskScore,
    threats,
    scanned_at: new Date().toISOString(),
    powered_by: 'WAB Shield v2.5 | https://www.webagentbridge.com',
  });
});


// ═══════════════════════════════════════════════════════════════════════
// 2. AI SAFETY LAYER — Pre-navigation safety check
// ═══════════════════════════════════════════════════════════════════════

router.post('/safety/check', (req, res) => {
  const { url, action, platform, amount, currency } = req.body;

  if (!url && !platform) return res.status(400).json({ error: 'url or platform required' });

  const results = { safe: true, warnings: [], blocks: [] };

  // URL scan
  if (url) {
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch {
      return res.status(400).json({ error: 'Invalid URL' });
    }
    const hostname = parsedUrl.hostname.toLowerCase();
    let riskScore = 0;
    for (const tp of THREAT_PATTERNS) {
      if (tp.pattern.test(url) || tp.pattern.test(hostname)) {
        riskScore = Math.max(riskScore, tp.weight);
        if (tp.weight >= 80) results.blocks.push({ reason: tp.type, confidence: tp.weight });
        else results.warnings.push({ reason: tp.type, confidence: tp.weight });
      }
    }
    if (riskScore >= 80) results.safe = false;
  }

  // Fairness check for platform
  if (platform) {
    const site = db.prepare('SELECT * FROM sites WHERE LOWER(domain) = ? AND active = 1').get(platform.toLowerCase());
    if (site) {
      const score = calculateNeutralityScore(site);
      if (score < 40) {
        results.warnings.push({ reason: 'low_fairness', score, platform });
      }
      results.fairness = { platform, score, grade: getGrade(score).grade };
    }
  }

  // Transaction safety
  if (action === 'transaction' && amount) {
    const numAmount = parseFloat(amount);
    if (numAmount > 500) {
      results.warnings.push({ reason: 'high_value_transaction', amount: numAmount, currency: currency || 'USD' });
    }
    if (platform && results.warnings.some(w => w.reason === 'low_fairness')) {
      results.safe = false;
      results.blocks.push({ reason: 'unfair_platform_transaction', platform, amount: numAmount });
    }
  }

  res.json({
    ...results,
    action: action || 'navigate',
    checked_at: new Date().toISOString(),
    powered_by: 'WAB AI Safety Layer v2.5',
  });
});


// ═══════════════════════════════════════════════════════════════════════
// 3. WAB SCORE — Platform Transparency Rating
// ═══════════════════════════════════════════════════════════════════════

router.get('/score/:domain', (req, res) => {
  const domain = req.params.domain.toLowerCase().replace(/^www\./, '').replace(/^https?:\/\//, '');
  if (!domain || domain.length < 3) return res.status(400).json({ error: 'Valid domain required' });

  // Check cache (valid for 24 hours)
  const cached = db.prepare('SELECT * FROM wab_scores WHERE domain = ? AND expires_at > datetime("now")').get(domain);
  if (cached) {
    return res.json({
      domain,
      score: cached.overall_score,
      fairness_score: cached.fairness_score,
      security_score: cached.security_score,
      grade: cached.grade,
      grade_label: cached.grade_label,
      details: jsonParse(cached.details),
      computed_at: cached.computed_at,
      cached: true,
      powered_by: 'WAB Score v2.5',
    });
  }

  // Compute score
  const site = db.prepare('SELECT * FROM sites WHERE LOWER(REPLACE(domain, "www.", "")) = ? AND active = 1').get(domain);

  let fairnessScore = 50; // default for unknown sites
  let securityScore = 70;
  const details = { signals: [] };

  if (site) {
    fairnessScore = calculateNeutralityScore(site);
    const config = jsonParse(site.config);

    // Security signals
    if (config.agentPermissions) {
      details.signals.push({ signal: 'agent_permissions_configured', impact: '+10' });
      securityScore += 10;
    }
    if (config.restrictions && Object.keys(config.restrictions).length) {
      details.signals.push({ signal: 'restrictions_defined', impact: '+5' });
      securityScore += 5;
    }
    if (config.logging) {
      details.signals.push({ signal: 'logging_enabled', impact: '+5' });
      securityScore += 5;
    }
    details.signals.push({ signal: 'wab_registered', impact: '+15' });
    securityScore += 15;
  } else {
    // Unknown site — pattern-based estimation
    if (/\.gov$/.test(domain)) { securityScore = 90; fairnessScore = 85; details.signals.push({ signal: 'government_domain', impact: '+40' }); }
    else if (/\.edu$/.test(domain)) { securityScore = 85; fairnessScore = 80; details.signals.push({ signal: 'education_domain', impact: '+35' }); }
    else if (/amazon\.com|google\.com|microsoft\.com|apple\.com/.test(domain)) { securityScore = 88; fairnessScore = 82; details.signals.push({ signal: 'major_platform', impact: '+30' }); }
    else if (/\.xyz$|\.tk$|\.ml$/.test(domain)) { securityScore = 30; fairnessScore = 25; details.signals.push({ signal: 'suspicious_tld', impact: '-40' }); }
    else { details.signals.push({ signal: 'unregistered_with_wab', impact: '-20' }); securityScore -= 10; fairnessScore -= 10; }
  }

  securityScore = Math.max(0, Math.min(100, securityScore));
  fairnessScore = Math.max(0, Math.min(100, fairnessScore));
  const overallScore = Math.round(fairnessScore * 0.7 + securityScore * 0.3);
  const gradeInfo = getGrade(overallScore);

  // Cache result
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO wab_scores (domain, overall_score, fairness_score, security_score, grade, grade_label, details, computed_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now', '+1 day'))
  `);
  stmt.run(domain, overallScore, fairnessScore, securityScore, gradeInfo.grade, gradeInfo.label, JSON.stringify(details));

  res.json({
    domain,
    score: overallScore,
    fairness_score: fairnessScore,
    security_score: securityScore,
    grade: gradeInfo.grade,
    grade_label: gradeInfo.label,
    grade_color: gradeInfo.color,
    details,
    computed_at: new Date().toISOString(),
    cached: false,
    powered_by: 'WAB Score v2.5',
  });
});

router.post('/score/batch', (req, res) => {
  const { domains } = req.body;
  if (!Array.isArray(domains) || domains.length === 0) return res.status(400).json({ error: 'domains array required' });
  if (domains.length > 50) return res.status(400).json({ error: 'Maximum 50 domains per batch' });

  const results = [];
  for (const d of domains) {
    const domain = d.toLowerCase().replace(/^www\./, '').replace(/^https?:\/\//, '');
    const cached = db.prepare('SELECT * FROM wab_scores WHERE domain = ? AND expires_at > datetime("now")').get(domain);
    if (cached) {
      results.push({ domain, score: cached.overall_score, grade: cached.grade, grade_label: cached.grade_label });
    } else {
      // Quick compute with defaults
      let fairness = 50, security = 60;
      const site = db.prepare('SELECT * FROM sites WHERE LOWER(REPLACE(domain, "www.", "")) = ? AND active = 1').get(domain);
      if (site) { fairness = calculateNeutralityScore(site); security = 75; }
      const overall = Math.round(fairness * 0.7 + security * 0.3);
      const g = getGrade(overall);
      db.prepare('INSERT OR REPLACE INTO wab_scores (domain, overall_score, fairness_score, security_score, grade, grade_label, details, computed_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime("now"), datetime("now", "+1 day"))').run(domain, overall, fairness, security, g.grade, g.label, '{}');
      results.push({ domain, score: overall, grade: g.grade, grade_label: g.label });
    }
  }

  results.sort((a, b) => b.score - a.score);
  res.json({ results, count: results.length, powered_by: 'WAB Score v2.5' });
});


// ═══════════════════════════════════════════════════════════════════════
// 4. TRUST LAYER PROTOCOL — Domain Trust Verification
// ═══════════════════════════════════════════════════════════════════════

router.get('/trust/verify/:domain', async (req, res) => {
  const domain = req.params.domain.toLowerCase().replace(/^www\./, '');

  // Check cache
  const cached = db.prepare('SELECT * FROM trust_manifests WHERE domain = ? AND last_verified_at > datetime("now", "-1 day")').get(domain);
  if (cached) {
    return res.json({
      domain,
      verified: !!cached.verified,
      manifest: jsonParse(cached.manifest),
      verification: jsonParse(cached.verification_result),
      cached: true,
      powered_by: 'WAB Trust Layer Protocol',
    });
  }

  // Try to fetch /.well-known/wab.json from domain
  const warnings = [];
  let manifest = null;
  let verified = false;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`https://${domain}/.well-known/wab.json`, { signal: controller.signal });
    clearTimeout(timeout);

    if (response.ok) {
      manifest = await response.json();

      // Validate manifest
      if (manifest.wab_certified !== undefined) verified = true;
      if (manifest.last_audit) {
        const auditAge = (Date.now() - new Date(manifest.last_audit).getTime()) / (1000 * 60 * 60 * 24);
        if (auditAge > 90) warnings.push('Audit older than 90 days');
      }
      if (!manifest.contact_email) warnings.push('No contact email specified');
      if (!manifest.dispute_url) warnings.push('No dispute URL specified');
    }
  } catch {
    warnings.push('Could not fetch /.well-known/wab.json — domain may not support WAB Trust Protocol');
  }

  const verification = {
    has_manifest: !!manifest,
    wab_certified: manifest?.wab_certified || false,
    fairness_score: manifest?.fairness_score || null,
    policies: manifest?.policies || {},
    warnings,
    checked_at: new Date().toISOString(),
  };

  // Cache
  db.prepare('INSERT OR REPLACE INTO trust_manifests (domain, manifest, verified, verification_result, last_verified_at) VALUES (?, ?, ?, ?, datetime("now"))').run(domain, JSON.stringify(manifest || {}), verified ? 1 : 0, JSON.stringify(verification));

  res.json({
    domain,
    verified,
    manifest: manifest || {},
    verification,
    cached: false,
    powered_by: 'WAB Trust Layer Protocol',
  });
});

router.post('/trust/register', authenticateToken, (req, res) => {
  const { domain, fairness_score, contact_email, dispute_url, policies } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const manifest = {
    wab_version: '2.5',
    wab_certified: false, // Certification requires manual review
    fairness_score: fairness_score || 0,
    last_audit: new Date().toISOString().split('T')[0],
    transparency_url: `https://${domain}/transparency`,
    contact_email: contact_email || '',
    dispute_url: dispute_url || '',
    policies: {
      hidden_fees: policies?.hidden_fees || false,
      fair_reviews: policies?.fair_reviews || false,
      data_privacy: policies?.data_privacy || false,
      seller_fairness: policies?.seller_fairness || false,
    },
  };

  db.prepare('INSERT OR REPLACE INTO trust_manifests (domain, manifest, verified, verification_result, last_verified_at, registered_at) VALUES (?, ?, 0, ?, datetime("now"), datetime("now"))').run(domain, JSON.stringify(manifest), JSON.stringify({ self_registered: true }));

  res.json({
    domain,
    manifest,
    instructions: {
      step1: 'Host this JSON at https://' + domain + '/.well-known/wab.json',
      step2: 'Run GET /api/growth/trust/verify/' + domain + ' to verify',
      step3: 'After review, your site will be WAB Certified',
    },
    powered_by: 'WAB Trust Layer Protocol',
  });
});

router.get('/trust/badge/:domain', async (req, res) => {
  const domain = req.params.domain.toLowerCase().replace(/^www\./, '');
  const cached = db.prepare('SELECT * FROM trust_manifests WHERE domain = ?').get(domain);

  const verified = cached?.verified === 1;
  const score = cached ? jsonParse(cached.manifest).fairness_score || 0 : 0;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="32" viewBox="0 0 200 32">
    <rect width="200" height="32" rx="4" fill="${verified ? '#22c55e' : '#64748b'}"/>
    <text x="8" y="21" font-family="Arial" font-size="12" fill="white" font-weight="bold">${verified ? '✓ WAB Certified' : '○ WAB Unverified'}</text>
    <text x="140" y="21" font-family="Arial" font-size="11" fill="white">${score}/100</text>
  </svg>`;

  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(svg);
});


// ═══════════════════════════════════════════════════════════════════════
// 5. BOUNTY NETWORK — Crowdsourced Threat Reporting
// ═══════════════════════════════════════════════════════════════════════

// Auto-register reporter from authenticated user
function getOrCreateReporter(userId) {
  let reporter = db.prepare('SELECT * FROM bounty_reporters WHERE user_id = ?').get(userId);
  if (!reporter) {
    const id = uuid();
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO bounty_reporters (id, user_id, token, display_name) VALUES (?, ?, ?, ?)').run(id, userId, token, 'Reporter');
    reporter = db.prepare('SELECT * FROM bounty_reporters WHERE id = ?').get(id);
  }
  return reporter;
}

function getReporterByToken(token) {
  return db.prepare('SELECT * FROM bounty_reporters WHERE token = ?').get(token);
}

router.post('/bounty/register', authenticateToken, (req, res) => {
  const reporter = getOrCreateReporter(req.user.id);
  res.json({
    reporter_id: reporter.id,
    token: reporter.token,
    credits: reporter.credits,
    message: 'Use this token in X-WAB-Reporter header for bounty submissions',
    powered_by: 'WAB Bounty Network v2.5',
  });
});

router.post('/bounty/submit', (req, res) => {
  // Accept auth via header or JWT
  const token = req.headers['x-wab-reporter'];
  if (!token) return res.status(401).json({ error: 'X-WAB-Reporter header required. Register at /api/growth/bounty/register' });

  const reporter = getReporterByToken(token);
  if (!reporter) return res.status(403).json({ error: 'Invalid reporter token' });

  const { url, category, description, evidence } = req.body;
  if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Valid URL required (must start with http:// or https://)' });

  const fingerprint = crypto.createHash('sha256').update(url.toLowerCase().trim()).digest('hex').substring(0, 16);

  // Check duplicate
  const existing = db.prepare('SELECT id FROM bounties WHERE fingerprint = ?').get(fingerprint);
  if (existing) {
    db.prepare('UPDATE bounty_reporters SET credits = credits + 1 WHERE id = ?').run(reporter.id);
    return res.json({
      bounty_id: existing.id,
      status: 'DUPLICATE',
      message: 'This URL is already in our database. Small reward for the effort.',
      credits_earned: REWARD_TIERS.DUPLICATE.credits,
      powered_by: 'WAB Bounty Network v2.5',
    });
  }

  const bountyId = `BNT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

  db.prepare(`INSERT INTO bounties (id, reporter_id, url, fingerprint, category, description, evidence) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(bountyId, reporter.id, url, fingerprint, category || 'phishing', description || '', evidence || '');
  db.prepare('UPDATE bounty_reporters SET total_reports = total_reports + 1 WHERE id = ?').run(reporter.id);

  // Async verification
  setImmediate(() => verifyBountyInternal(bountyId, url, reporter.id));

  res.json({
    bounty_id: bountyId,
    status: 'PENDING',
    message: 'Report submitted. Automated verification in progress.',
    powered_by: 'WAB Bounty Network v2.5',
  });
});

function verifyBountyInternal(bountyId, url, reporterId) {
  try {
    let riskScore = 0;
    for (const tp of THREAT_PATTERNS) {
      if (tp.pattern.test(url)) riskScore = Math.max(riskScore, tp.weight);
    }

    let tier = 'INVALID';
    if (riskScore >= 80) tier = 'CRITICAL';
    else if (riskScore >= 60) tier = 'HIGH';
    else if (riskScore >= 40) tier = 'MEDIUM';
    else if (riskScore >= 20) tier = 'LOW';

    const reward = REWARD_TIERS[tier];

    db.prepare('UPDATE bounties SET status = ?, reward_tier = ?, credits_awarded = ?, scan_result = ?, verified_at = datetime("now") WHERE id = ?').run(tier === 'INVALID' ? 'REJECTED' : 'VERIFIED', tier, reward.credits, JSON.stringify({ risk_score: riskScore }), bountyId);

    if (reward.credits > 0) {
      db.prepare('UPDATE bounty_reporters SET credits = credits + ?, verified_reports = verified_reports + 1 WHERE id = ?').run(reward.credits, reporterId);
    }
  } catch (err) {
    console.error(`[WAB Bounty] Verification failed for ${bountyId}:`, err.message);
  }
}

router.get('/bounty/status/:id', (req, res) => {
  const bounty = db.prepare('SELECT * FROM bounties WHERE id = ?').get(req.params.id);
  if (!bounty) return res.status(404).json({ error: 'Bounty not found' });
  res.json({
    ...bounty,
    scan_result: jsonParse(bounty.scan_result),
    powered_by: 'WAB Bounty Network v2.5',
  });
});

router.get('/bounty/balance', (req, res) => {
  const token = req.headers['x-wab-reporter'];
  if (!token) return res.status(401).json({ error: 'X-WAB-Reporter header required' });
  const reporter = getReporterByToken(token);
  if (!reporter) return res.status(403).json({ error: 'Invalid reporter token' });

  res.json({
    reporter_id: reporter.id,
    credits: reporter.credits,
    total_reports: reporter.total_reports,
    verified_reports: reporter.verified_reports,
    accuracy_rate: reporter.total_reports > 0 ? Math.round((reporter.verified_reports / reporter.total_reports) * 100) : 0,
    powered_by: 'WAB Bounty Network v2.5',
  });
});

router.get('/bounty/leaderboard', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const leaders = db.prepare('SELECT display_name, credits, verified_reports, total_reports FROM bounty_reporters ORDER BY credits DESC LIMIT ?').all(limit);
  res.json({ leaderboard: leaders, powered_by: 'WAB Bounty Network v2.5' });
});


// ═══════════════════════════════════════════════════════════════════════
// 6. DATA MARKETPLACE — Threat Intelligence Datasets
// ═══════════════════════════════════════════════════════════════════════

router.get('/data/datasets', (req, res) => {
  const category = req.query.category;
  let datasets;
  if (category) {
    datasets = db.prepare('SELECT id, category, title, description, record_count, format, price_base, created_at FROM datasets WHERE active = 1 AND category = ? ORDER BY created_at DESC').all(category);
  } else {
    datasets = db.prepare('SELECT id, category, title, description, record_count, format, price_base, created_at FROM datasets WHERE active = 1 ORDER BY created_at DESC').all();
  }
  res.json({
    datasets,
    total: datasets.length,
    categories: ['THREAT_INTEL', 'PLATFORM_FAIR', 'PRICE_HISTORY', 'USER_BEHAVIOR', 'AFFILIATE_INTEL', 'EMAIL_THREATS'],
    powered_by: 'WAB Data Marketplace v2.5',
  });
});

router.get('/data/datasets/:id', (req, res) => {
  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ? AND active = 1').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

  const meta = jsonParse(dataset.metadata);
  res.json({
    ...dataset,
    metadata: meta,
    sample_data: jsonParse(dataset.sample_data, []),
    license_types: {
      RESEARCH:   { multiplier: 1, price: dataset.price_base, use: 'Non-commercial research', redistribution: false },
      COMMERCIAL: { multiplier: 3, price: dataset.price_base * 3, use: 'Commercial products', redistribution: false },
      ENTERPRISE: { multiplier: 8, price: dataset.price_base * 8, use: 'Any use', redistribution: true },
      AI_TRAINING:{ multiplier: 5, price: dataset.price_base * 5, use: 'AI/ML model training', redistribution: false },
    },
    powered_by: 'WAB Data Marketplace v2.5',
  });
});

router.get('/data/datasets/:id/sample', (req, res) => {
  const dataset = db.prepare('SELECT sample_data FROM datasets WHERE id = ? AND active = 1').get(req.params.id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });
  res.json({
    sample: jsonParse(dataset.sample_data, []),
    note: 'This is a free preview. Purchase the full dataset for complete access.',
    powered_by: 'WAB Data Marketplace v2.5',
  });
});

router.post('/data/purchase', authenticateToken, (req, res) => {
  const { dataset_id, license_type } = req.body;
  if (!dataset_id) return res.status(400).json({ error: 'dataset_id required' });

  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ? AND active = 1').get(dataset_id);
  if (!dataset) return res.status(404).json({ error: 'Dataset not found' });

  const multipliers = { RESEARCH: 1, COMMERCIAL: 3, ENTERPRISE: 8, AI_TRAINING: 5 };
  const mult = multipliers[license_type] || 1;
  const price = dataset.price_base * mult;

  const purchaseId = uuid();
  db.prepare('INSERT INTO dataset_purchases (id, user_id, dataset_id, license_type, price_paid) VALUES (?, ?, ?, ?, ?)').run(purchaseId, req.user.id, dataset_id, license_type || 'RESEARCH', price);

  res.json({
    purchase_id: purchaseId,
    dataset_id,
    license_type: license_type || 'RESEARCH',
    price_paid: price,
    currency: 'USD',
    status: 'completed',
    download_url: `/api/growth/data/download/${purchaseId}`,
    powered_by: 'WAB Data Marketplace v2.5',
  });
});

router.get('/data/download/:purchaseId', authenticateToken, (req, res) => {
  const purchase = db.prepare('SELECT * FROM dataset_purchases WHERE id = ? AND user_id = ?').get(req.params.purchaseId, req.user.id);
  if (!purchase) return res.status(404).json({ error: 'Purchase not found' });

  const dataset = db.prepare('SELECT * FROM datasets WHERE id = ?').get(purchase.dataset_id);
  if (!dataset) return res.status(404).json({ error: 'Dataset no longer available' });

  // Return full sample data as the "download" — in production this would be a signed S3 URL
  res.json({
    dataset_id: dataset.id,
    title: dataset.title,
    format: dataset.format,
    record_count: dataset.record_count,
    data: jsonParse(dataset.sample_data, []),
    license: purchase.license_type,
    purchased_at: purchase.purchased_at,
    powered_by: 'WAB Data Marketplace v2.5',
  });
});


// ═══════════════════════════════════════════════════════════════════════
// 7. EMAIL PROTECTION — Email Content Scanning
// ═══════════════════════════════════════════════════════════════════════

router.post('/email/scan', (req, res) => {
  const { subject, body, sender, urls } = req.body;
  if (!subject && !body && !urls) return res.status(400).json({ error: 'subject, body, or urls required' });

  const content = `${subject || ''} ${body || ''}`;
  const patterns = [];
  let riskScore = 0;

  // Detect phishing patterns in text
  for (const pp of PHISHING_EMAIL_PATTERNS) {
    if (pp.pattern.test(content)) {
      patterns.push(pp.label);
      riskScore += 15;
    }
  }

  // Extract and scan URLs
  const urlRegex = /https?:\/\/[^\s<>"')\]]+/gi;
  const extractedUrls = [...new Set([...(content.match(urlRegex) || []), ...(urls || [])])];
  const urlResults = [];

  for (const u of extractedUrls.slice(0, 20)) { // limit to 20 URLs
    let urlRisk = 0;
    const threats = [];
    for (const tp of THREAT_PATTERNS) {
      if (tp.pattern.test(u)) {
        urlRisk = Math.max(urlRisk, tp.weight);
        threats.push(tp.type);
      }
    }
    urlResults.push({
      url: u,
      risk_score: urlRisk,
      status: urlRisk >= 80 ? 'CRITICAL' : urlRisk >= 50 ? 'WARNING' : 'SAFE',
      threats,
    });
    riskScore = Math.max(riskScore, urlRisk);
  }

  // Sender analysis
  let senderReputation = null;
  if (sender) {
    const senderDomain = sender.split('@').pop()?.toLowerCase();
    if (senderDomain) {
      let domainRisk = 0;
      if (/\.xyz$|\.tk$|\.ml$|\.ga$|\.cf$/.test(senderDomain)) domainRisk = 60;
      if (/gmail\.com|outlook\.com|yahoo\.com|hotmail\.com/.test(senderDomain)) domainRisk = 10;
      senderReputation = { domain: senderDomain, risk_score: domainRisk, status: domainRisk >= 50 ? 'WARNING' : 'SAFE' };
    }
  }

  riskScore = Math.min(100, riskScore);
  const overallRisk = riskScore >= 80 ? 'CRITICAL' : riskScore >= 50 ? 'WARNING' : 'SAFE';

  // Log scan
  db.prepare('INSERT INTO email_scans (sender_domain, urls_found, critical_count, warning_count, overall_risk, risk_score) VALUES (?, ?, ?, ?, ?, ?)').run(
    senderReputation?.domain || null,
    urlResults.length,
    urlResults.filter(u => u.status === 'CRITICAL').length,
    urlResults.filter(u => u.status === 'WARNING').length,
    overallRisk,
    riskScore
  );

  res.json({
    overall_risk: overallRisk,
    risk_score: riskScore,
    urls_found: extractedUrls.length,
    urls_scanned: urlResults,
    critical_count: urlResults.filter(u => u.status === 'CRITICAL').length,
    warning_count: urlResults.filter(u => u.status === 'WARNING').length,
    sender_reputation: senderReputation,
    phishing_patterns: patterns,
    scanned_at: new Date().toISOString(),
    powered_by: 'WAB Email Protection v2.5',
  });
});

router.get('/email/stats', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as c FROM email_scans').get().c;
  const critical = db.prepare('SELECT COUNT(*) as c FROM email_scans WHERE overall_risk = ?').get('CRITICAL').c;
  const last24h = db.prepare('SELECT COUNT(*) as c FROM email_scans WHERE scanned_at > datetime("now", "-1 day")').get().c;
  res.json({
    total_scans: total,
    critical_detected: critical,
    scans_last_24h: last24h,
    detection_rate: total > 0 ? Math.round((critical / total) * 100) : 0,
    powered_by: 'WAB Email Protection v2.5',
  });
});


// ═══════════════════════════════════════════════════════════════════════
// 8. AFFILIATE INTELLIGENCE — Network Fraud Detection
// ═══════════════════════════════════════════════════════════════════════

router.get('/affiliate/networks', (req, res) => {
  const networks = Object.entries(KNOWN_NETWORKS).map(([id, info]) => ({
    id,
    ...info,
  }));
  res.json({ networks, powered_by: 'WAB Affiliate Intelligence v2.5' });
});

router.get('/affiliate/analyze/:networkId', (req, res) => {
  const networkId = req.params.networkId.toLowerCase();
  const network = KNOWN_NETWORKS[networkId];
  if (!network) return res.status(404).json({ error: 'Unknown network', known_networks: Object.keys(KNOWN_NETWORKS) });

  // Check cache
  const cached = db.prepare('SELECT * FROM affiliate_reports WHERE network_id = ? AND analyzed_at > datetime("now", "-1 day")').get(networkId);
  if (cached) {
    return res.json({
      network_id: networkId,
      network_name: network.name,
      risk_level: cached.risk_level,
      trust_score: cached.trust_score,
      fraud_types: jsonParse(cached.fraud_types, []),
      details: jsonParse(cached.details),
      cached: true,
      powered_by: 'WAB Affiliate Intelligence v2.5',
    });
  }

  // Analysis
  const fraudTypes = [];
  let trustScore = network.trust_base;

  // Evaluate based on known metrics
  if (network.avg_payout_days > 40) {
    fraudTypes.push({ ...FRAUD_PATTERNS.payment_delays, data: { avg_payout_days: network.avg_payout_days, industry_avg: 30 } });
    trustScore -= 10;
  }
  if (network.cookie_days <= 1) {
    fraudTypes.push({ ...FRAUD_PATTERNS.late_attribution, data: { cookie_days: network.cookie_days, industry_avg: 30 } });
    trustScore -= 5;
  }
  if (networkId === 'clickbank') {
    fraudTypes.push({ ...FRAUD_PATTERNS.commission_shaving, data: { estimated_shaving: '12%', evidence: 'Community reports of valid sales cancelled' } });
    trustScore -= 15;
  }

  const riskLevel = trustScore >= 80 ? 'LOW' : trustScore >= 60 ? 'MEDIUM' : trustScore >= 40 ? 'HIGH' : 'CRITICAL';

  const details = {
    avg_commission: network.avg_commission + '%',
    avg_payout_days: network.avg_payout_days,
    cookie_window: network.cookie_days + ' days',
    recommendation: riskLevel === 'LOW' ? 'Safe to use' : riskLevel === 'MEDIUM' ? 'Use with caution, monitor closely' : 'Consider alternatives',
    benchmarks: {
      industry_avg_commission: '8%',
      industry_avg_payout: '30 days',
      industry_avg_cookie: '30 days',
    },
  };

  // Cache
  const reportId = uuid();
  db.prepare('INSERT OR REPLACE INTO affiliate_reports (id, network_id, risk_level, fraud_types, trust_score, details) VALUES (?, ?, ?, ?, ?, ?)').run(reportId, networkId, riskLevel, JSON.stringify(fraudTypes), trustScore, JSON.stringify(details));

  res.json({
    network_id: networkId,
    network_name: network.name,
    risk_level: riskLevel,
    trust_score: trustScore,
    fraud_types: fraudTypes,
    details,
    cached: false,
    powered_by: 'WAB Affiliate Intelligence v2.5',
  });
});

router.post('/affiliate/detect-fraud', (req, res) => {
  const { network_id, data } = req.body;
  if (!network_id && !data) return res.status(400).json({ error: 'network_id or data required' });

  const network = KNOWN_NETWORKS[network_id];
  const detected = [];

  if (data) {
    // Analyze user-provided data
    if (data.conversion_rate !== undefined) {
      const expectedCVR = 2.5; // industry baseline
      if (data.conversion_rate < expectedCVR * 0.3) {
        detected.push({ ...FRAUD_PATTERNS.low_cvr, data: { actual: data.conversion_rate, expected: expectedCVR, ratio: (data.conversion_rate / expectedCVR * 100).toFixed(0) + '%' } });
      }
    }
    if (data.epc !== undefined && network) {
      const expectedEPC = network.avg_commission * 0.025; // rough benchmark
      if (data.epc < expectedEPC * 0.4) {
        detected.push({ ...FRAUD_PATTERNS.commission_shaving, data: { actual_epc: data.epc, expected_epc: expectedEPC.toFixed(2) } });
      }
    }
    if (data.payment_delay !== undefined) {
      const expected = network ? network.avg_payout_days : 30;
      if (data.payment_delay > expected * 1.5) {
        detected.push({ ...FRAUD_PATTERNS.payment_delays, data: { actual_days: data.payment_delay, expected_days: expected } });
      }
    }
    if (data.cancelled_rate !== undefined && data.cancelled_rate > 10) {
      detected.push({ ...FRAUD_PATTERNS.commission_shaving, data: { cancelled_rate: data.cancelled_rate + '%', threshold: '10%' } });
    }
  }

  const riskLevel = detected.some(d => d.severity === 'CRITICAL') ? 'CRITICAL' :
                    detected.some(d => d.severity === 'HIGH') ? 'HIGH' :
                    detected.length > 0 ? 'MEDIUM' : 'LOW';

  res.json({
    network_id: network_id || 'custom',
    network_name: network?.name || 'Custom Analysis',
    risk_level: riskLevel,
    fraud_detected: detected.length,
    fraud_types: detected,
    recommendation: detected.length === 0 ? 'No fraud indicators detected' :
      riskLevel === 'CRITICAL' ? 'Immediate action required — contact network and document evidence' :
      riskLevel === 'HIGH' ? 'Monitor closely and diversify to other networks' :
      'Keep tracking metrics and compare monthly',
    powered_by: 'WAB Affiliate Intelligence v2.5',
  });
});

router.get('/affiliate/benchmarks', (req, res) => {
  res.json({
    benchmarks: {
      avg_commission_rate: '8%',
      avg_epc: '$0.45',
      avg_conversion_rate: '2.5%',
      avg_payout_days: 30,
      avg_cookie_window: '30 days',
      avg_reversal_rate: '5%',
    },
    by_category: {
      SaaS: { avg_commission: '20-30%', avg_cookie: '90 days', avg_payout: '15 days' },
      eCommerce: { avg_commission: '3-8%', avg_cookie: '1-30 days', avg_payout: '30-60 days' },
      Finance: { avg_commission: '$50-200 per lead', avg_cookie: '30-45 days', avg_payout: '30-45 days' },
      Travel: { avg_commission: '3-6%', avg_cookie: '7-30 days', avg_payout: '30-60 days' },
    },
    powered_by: 'WAB Affiliate Intelligence v2.5',
  });
});


// ═══════════════════════════════════════════════════════════════════════
// OVERVIEW — All modules status
// ═══════════════════════════════════════════════════════════════════════

router.get('/status', (req, res) => {
  const bountyCount = db.prepare('SELECT COUNT(*) as c FROM bounties').get().c;
  const reporterCount = db.prepare('SELECT COUNT(*) as c FROM bounty_reporters').get().c;
  const datasetCount = db.prepare('SELECT COUNT(*) as c FROM datasets WHERE active = 1').get().c;
  const emailScans = db.prepare('SELECT COUNT(*) as c FROM email_scans').get().c;
  const scoreCount = db.prepare('SELECT COUNT(*) as c FROM wab_scores').get().c;

  res.json({
    suite: 'WAB Growth Suite v2.5',
    modules: {
      shield:      { status: 'active', endpoint: '/api/growth/scan' },
      safety:      { status: 'active', endpoint: '/api/growth/safety/check' },
      score:       { status: 'active', endpoint: '/api/growth/score/:domain', cached_scores: scoreCount },
      trust:       { status: 'active', endpoint: '/api/growth/trust/verify/:domain' },
      bounty:      { status: 'active', endpoint: '/api/growth/bounty/*', total_bounties: bountyCount, reporters: reporterCount },
      marketplace: { status: 'active', endpoint: '/api/growth/data/*', datasets: datasetCount },
      email:       { status: 'active', endpoint: '/api/growth/email/scan', total_scans: emailScans },
      affiliate:   { status: 'active', endpoint: '/api/growth/affiliate/*', networks: Object.keys(KNOWN_NETWORKS).length },
    },
    powered_by: 'WAB Growth Suite v2.5 | https://www.webagentbridge.com',
  });
});


module.exports = router;
