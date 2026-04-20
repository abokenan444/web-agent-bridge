/**
 * WAB Dark Pattern Detector + DSA Compliance Engine
 * Detects all 17 OECD-classified dark patterns and generates
 * EU DSA/DMA compliant audit reports.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const https = require('https');
const url = require('url');
const crypto = require('crypto');

// ─── OECD Dark Pattern Taxonomy (17 categories) ──────────────────────────────
const DARK_PATTERNS = [
  {
    id: 'DP001', category: 'FALSE_URGENCY', name: 'False Urgency',
    description: 'Creates artificial time pressure to force quick decisions',
    severity: 'HIGH', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /\b(\d+)\s*(hours?|minutes?|seconds?)\s*(left|remaining|only)\b/gi,
      /limited\s+time\s+(offer|deal|sale)/gi,
      /offer\s+expires?\s+(in|at)/gi,
      /sale\s+ends?\s+(in|at|soon)/gi,
      /\bcountdown\b/gi,
      /hurry[,!]?\s*(up)?\s*(before|while)/gi,
      /\bflash\s+sale\b/gi,
    ]
  },
  {
    id: 'DP002', category: 'SCARCITY_MANIPULATION', name: 'Scarcity Manipulation',
    description: 'Falsely implies limited availability to pressure purchase',
    severity: 'HIGH', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /only\s+(\d+)\s+left\s+(in\s+stock|available)/gi,
      /\d+\s+people\s+(are\s+)?(viewing|watching|looking\s+at)\s+this/gi,
      /\d+\s+(sold|purchased)\s+(in\s+the\s+last|today)/gi,
      /almost\s+(gone|sold\s+out)/gi,
      /last\s+(\d+)\s+(items?|units?|pieces?)/gi,
      /in\s+high\s+demand/gi,
    ]
  },
  {
    id: 'DP003', category: 'HIDDEN_COSTS', name: 'Hidden Costs',
    description: 'Conceals fees until late in checkout process',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /\+\s*(tax|vat|gst|fees?|charges?|surcharge)/gi,
      /price\s+(shown\s+)?(before|excludes?)\s+(tax|vat|fees?)/gi,
      /additional\s+(fees?|charges?|costs?)\s+(may\s+apply|apply)/gi,
      /service\s+fee\s+(of\s+)?\$?\d+/gi,
      /booking\s+fee\s+(of\s+)?\$?\d+/gi,
      /convenience\s+fee/gi,
      /resort\s+fee/gi,
    ]
  },
  {
    id: 'DP004', category: 'TRICK_QUESTION', name: 'Trick Question / Pre-checked',
    description: 'Uses confusing opt-out language or pre-checked boxes for unwanted subscriptions',
    severity: 'HIGH', dsa_article: 'Article 25(1)(c)',
    patterns: [
      /checked.*?(newsletter|marketing|promotional|offers?|updates?)/gi,
      /uncheck\s+(to\s+)?(opt.out|remove|cancel)/gi,
      /by\s+(default|checking)\s+(you\s+)?(agree|consent|accept)/gi,
      /do\s+not\s+(check|tick)\s+(if\s+you\s+(don.t|do\s+not))/gi,
    ]
  },
  {
    id: 'DP005', category: 'ROACH_MOTEL', name: 'Roach Motel',
    description: 'Easy to sign up, very difficult to cancel or unsubscribe',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(d)',
    patterns: [
      /cancel\s+(by\s+)?(calling|phone|mail|writing)/gi,
      /to\s+cancel.*?call\s+(\+?\d[\d\s\-]+)/gi,
      /cancellation\s+(must\s+be\s+)?(submitted|requested|done)\s+(in\s+writing|by\s+mail)/gi,
      /\d+\s+days?\s+notice\s+(required\s+)?to\s+cancel/gi,
    ]
  },
  {
    id: 'DP006', category: 'CONFIRMSHAMING', name: 'Confirmshaming',
    description: 'Uses guilt-tripping language on decline/opt-out buttons',
    severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /no\s+thanks[,.]?\s*(i\s+)?(don.t|hate|prefer\s+not|want\s+to\s+miss)/gi,
      /i\s+don.t\s+want\s+(to\s+)?(save|get|receive|enjoy|benefit)/gi,
      /no[,.]?\s*i\s+(hate|don.t\s+like|prefer\s+not\s+to\s+save)/gi,
      /decline\s+and\s+(miss|lose|give\s+up)/gi,
    ]
  },
  {
    id: 'DP007', category: 'FORCED_CONTINUITY', name: 'Forced Continuity',
    description: 'Automatically charges after free trial without clear notice',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /free\s+trial.*?automatically\s+(renews?|charges?|bills?)/gi,
      /after\s+(your\s+)?trial.*?(charged|billed|renewed)/gi,
      /cancel\s+(before|anytime\s+before)\s+(your\s+)?trial\s+ends/gi,
      /subscription\s+(will\s+)?(auto.?renew|automatically\s+renew)/gi,
    ]
  },
  {
    id: 'DP008', category: 'MISDIRECTION', name: 'Misdirection',
    description: 'Draws attention away from important information',
    severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /\*\s*(see\s+)?(terms|conditions|restrictions|exclusions)\s+(apply|for\s+details)/gi,
      /\(1\)\s*(terms|conditions|see\s+below)/gi,
    ]
  },
  {
    id: 'DP009', category: 'DISGUISED_ADS', name: 'Disguised Advertisements',
    description: 'Presents paid content as organic results or editorial content',
    severity: 'HIGH', dsa_article: 'Article 26',
    patterns: [
      /sponsored.*?(?:result|listing|content|post)/gi,
      /promoted.*?(?:result|listing|content)/gi,
      /featured\s+(?:listing|result|product)/gi,
    ]
  },
  {
    id: 'DP010', category: 'NAGGING', name: 'Nagging',
    description: 'Repeatedly interrupts user experience to push unwanted actions',
    severity: 'LOW', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /don.t\s+(miss\s+out|leave\s+yet|go\s+yet)/gi,
      /wait[!,]?\s*(before\s+you\s+go|don.t\s+leave)/gi,
      /are\s+you\s+sure\s+you\s+want\s+to\s+leave/gi,
    ]
  },
  {
    id: 'DP011', category: 'BASKET_SNEAKING', name: 'Basket Sneaking',
    description: 'Adds items to cart without explicit user consent',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /automatically\s+added\s+to\s+(your\s+)?cart/gi,
      /included\s+(in\s+your\s+order|automatically)/gi,
      /added\s+for\s+(your\s+)?convenience/gi,
    ]
  },
  {
    id: 'DP012', category: 'BAIT_AND_SWITCH', name: 'Bait and Switch',
    description: 'Advertises one product/price but delivers different one',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /advertised\s+price.*?not\s+available/gi,
      /this\s+item\s+is\s+(no\s+longer\s+)?available.*?similar/gi,
    ]
  },
  {
    id: 'DP013', category: 'PRIVACY_ZUCKERING', name: 'Privacy Zuckering',
    description: 'Tricks users into sharing more data than intended',
    severity: 'HIGH', dsa_article: 'Article 25(1)(c)',
    patterns: [
      /by\s+(continuing|using|signing\s+up).*?you\s+(agree\s+to\s+share|consent\s+to\s+share)/gi,
      /your\s+data\s+(may\s+be\s+)?shared\s+with\s+(our\s+)?partners/gi,
      /we\s+(may\s+)?share\s+your\s+(personal\s+)?information\s+with\s+third\s+parties/gi,
    ]
  },
  {
    id: 'DP014', category: 'SOCIAL_PROOF_MANIPULATION', name: 'Fake Social Proof',
    description: 'Uses fabricated or misleading social proof',
    severity: 'HIGH', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /\d+\s+(customers?|people|users?)\s+(are\s+)?(viewing|watching)\s+this\s+(right\s+now|now)/gi,
      /\d+\s+(bought|purchased|ordered)\s+(this\s+)?(today|in\s+the\s+last\s+\d+\s+hours?)/gi,
    ]
  },
  {
    id: 'DP015', category: 'INTERFACE_INTERFERENCE', name: 'Interface Interference',
    description: 'Visually highlights preferred option to manipulate choice',
    severity: 'MEDIUM', dsa_article: 'Article 25(1)(a)',
    patterns: [
      /most\s+popular\s+(plan|option|choice)/gi,
      /recommended\s+(for\s+you|plan|option)/gi,
      /best\s+value\s+(plan|option)/gi,
    ]
  },
  {
    id: 'DP016', category: 'DRIP_PRICING', name: 'Drip Pricing',
    description: 'Reveals price components gradually throughout checkout',
    severity: 'HIGH', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /processing\s+fee\s+(of\s+)?\$?\d+(\.\d+)?/gi,
      /delivery\s+fee\s+(of\s+)?\$?\d+(\.\d+)?/gi,
      /handling\s+fee\s+(of\s+)?\$?\d+(\.\d+)?/gi,
      /\+\s*\$\d+(\.\d+)?\s*(fee|charge|surcharge)/gi,
    ]
  },
  {
    id: 'DP017', category: 'DISGUISED_SUBSCRIPTION', name: 'Disguised Subscription',
    description: 'Hides subscription terms in one-time purchase flow',
    severity: 'CRITICAL', dsa_article: 'Article 25(1)(b)',
    patterns: [
      /one.time\s+(purchase|payment).*?(subscription|recurring|monthly|annual)/gi,
      /\$\d+.*?\/\s*(month|year|mo|yr).*?billed\s+(monthly|annually|yearly)/gi,
      /membership\s+(fee|charge)\s+(of\s+)?\$\d+/gi,
    ]
  },
];

// ─── DSA Compliance Checker ───────────────────────────────────────────────────
class DSAComplianceEngine {
  constructor() {
    this.auditStore = new Map();
    this.stats = { totalAudits: 0, violations: 0, platformsAudited: new Set() };
  }

  // Scan HTML content for dark patterns
  scanContent(html, pageUrl) {
    const findings = [];
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    for (const dp of DARK_PATTERNS) {
      const matches = [];
      for (const pattern of dp.patterns) {
        const found = text.match(pattern);
        if (found) {
          matches.push(...found.slice(0, 3));
        }
      }
      if (matches.length > 0) {
        findings.push({
          pattern_id: dp.id,
          category: dp.category,
          name: dp.name,
          description: dp.description,
          severity: dp.severity,
          dsa_article: dp.dsa_article,
          evidence: [...new Set(matches)].slice(0, 3),
          occurrence_count: matches.length,
        });
      }
    }

    return findings;
  }

  // Calculate compliance score (0-100, 100 = fully compliant)
  calculateComplianceScore(findings) {
    if (findings.length === 0) return 100;
    const severityPenalty = { LOW: 5, MEDIUM: 15, HIGH: 25, CRITICAL: 40 };
    const totalPenalty = findings.reduce((sum, f) => sum + (severityPenalty[f.severity] || 10), 0);
    return Math.max(0, 100 - totalPenalty);
  }

  // Generate DSA compliance report
  async generateReport(targetUrl) {
    const auditId = 'AUDIT-' + crypto.randomBytes(8).toString('hex').toUpperCase();
    const startTime = Date.now();

    // Fetch the page
    let html = '';
    let fetchError = null;
    try {
      html = await this.fetchPage(targetUrl);
    } catch (e) {
      fetchError = e.message;
      html = '';
    }

    const findings = this.scanContent(html, targetUrl);
    const complianceScore = this.calculateComplianceScore(findings);
    const criticalViolations = findings.filter(f => f.severity === 'CRITICAL');
    const highViolations = findings.filter(f => f.severity === 'HIGH');

    const report = {
      audit_id: auditId,
      wab_version: '1.0',
      audit_timestamp: new Date().toISOString(),
      target_url: targetUrl,
      platform: new URL(targetUrl).hostname,
      fetch_error: fetchError,
      compliance_score: complianceScore,
      compliance_grade: complianceScore >= 90 ? 'A' : complianceScore >= 75 ? 'B' : complianceScore >= 60 ? 'C' : complianceScore >= 40 ? 'D' : 'F',
      dsa_compliant: criticalViolations.length === 0 && complianceScore >= 70,
      total_violations: findings.length,
      critical_violations: criticalViolations.length,
      high_violations: highViolations.length,
      medium_violations: findings.filter(f => f.severity === 'MEDIUM').length,
      low_violations: findings.filter(f => f.severity === 'LOW').length,
      violations: findings,
      applicable_regulations: [
        'EU Digital Services Act (DSA) — Regulation (EU) 2022/2065',
        'EU Digital Markets Act (DMA) — Regulation (EU) 2022/1925',
        'OECD Recommendation on Consumer Protection in E-Commerce',
        'US FTC Act Section 5 — Unfair or Deceptive Acts',
        'UK Consumer Rights Act 2015',
      ],
      recommendations: this.generateRecommendations(findings),
      processing_time_ms: Date.now() - startTime,
      next_audit_recommended: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      report_hash: crypto.createHash('sha256')
        .update(auditId + targetUrl + JSON.stringify(findings))
        .digest('hex'),
    };

    this.auditStore.set(auditId, report);
    this.stats.totalAudits++;
    if (findings.length > 0) this.stats.violations += findings.length;
    this.stats.platformsAudited.add(report.platform);

    return report;
  }

  generateRecommendations(findings) {
    const recs = [];
    const categories = new Set(findings.map(f => f.category));

    if (categories.has('HIDDEN_COSTS') || categories.has('DRIP_PRICING')) {
      recs.push({
        priority: 'CRITICAL',
        action: 'Display total price including all fees before checkout initiation',
        regulation: 'DSA Article 25(1)(b), EU Consumer Rights Directive Art. 6',
        deadline: '30 days',
      });
    }
    if (categories.has('FORCED_CONTINUITY') || categories.has('DISGUISED_SUBSCRIPTION')) {
      recs.push({
        priority: 'CRITICAL',
        action: 'Add explicit subscription disclosure with opt-in checkbox before payment',
        regulation: 'DSA Article 25(1)(b)',
        deadline: '30 days',
      });
    }
    if (categories.has('ROACH_MOTEL')) {
      recs.push({
        priority: 'CRITICAL',
        action: 'Implement one-click cancellation accessible from account settings',
        regulation: 'DSA Article 25(1)(d), EU Consumer Rights Directive',
        deadline: '60 days',
      });
    }
    if (categories.has('FALSE_URGENCY') || categories.has('SCARCITY_MANIPULATION')) {
      recs.push({
        priority: 'HIGH',
        action: 'Remove countdown timers and stock indicators unless based on real data',
        regulation: 'DSA Article 25(1)(a)',
        deadline: '14 days',
      });
    }
    if (categories.has('TRICK_QUESTION')) {
      recs.push({
        priority: 'HIGH',
        action: 'Replace pre-checked marketing consent boxes with explicit opt-in',
        regulation: 'GDPR Article 7, DSA Article 25(1)(c)',
        deadline: '14 days',
      });
    }
    if (categories.has('CONFIRMSHAMING')) {
      recs.push({
        priority: 'MEDIUM',
        action: 'Replace guilt-tripping decline language with neutral alternatives',
        regulation: 'DSA Article 25(1)(a)',
        deadline: '30 days',
      });
    }
    if (recs.length === 0) {
      recs.push({
        priority: 'LOW',
        action: 'Continue monitoring for new dark patterns. Schedule quarterly audits.',
        regulation: 'DSA Article 25',
        deadline: '90 days',
      });
    }
    return recs;
  }

  fetchPage(targetUrl) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(targetUrl);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      const options = {
        hostname: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': 'WAB-DSA-Compliance-Scanner/1.0 (https://www.webagentbridge.com)',
          'Accept': 'text/html,application/xhtml+xml',
        },
        timeout: 10000,
      };
      const req = protocol.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; if (data.length > 500000) req.abort(); });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.on('timeout', () => { req.abort(); reject(new Error('Request timed out')); });
      req.end();
    });
  }
}

const engine = new DSAComplianceEngine();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  // POST /dsa/audit — Full page audit
  if (req.method === 'POST' && parsedUrl.pathname === '/dsa/audit') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { url: targetUrl } = JSON.parse(body);
        if (!targetUrl) { res.writeHead(400); res.end(JSON.stringify({ error: 'url required' })); return; }
        const report = await engine.generateReport(targetUrl);
        res.writeHead(200);
        res.end(JSON.stringify(report));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // POST /dsa/scan — Scan raw HTML
  if (req.method === 'POST' && parsedUrl.pathname === '/dsa/scan') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const { html, pageUrl } = JSON.parse(body);
        const findings = engine.scanContent(html || '', pageUrl || '');
        const score = engine.calculateComplianceScore(findings);
        res.writeHead(200);
        res.end(JSON.stringify({
          compliance_score: score,
          compliance_grade: score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 60 ? 'C' : score >= 40 ? 'D' : 'F',
          violations: findings,
          total_violations: findings.length,
        }));
      } catch (e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // GET /dsa/patterns — List all 17 dark patterns
  if (req.method === 'GET' && parsedUrl.pathname === '/dsa/patterns') {
    res.writeHead(200);
    res.end(JSON.stringify(DARK_PATTERNS.map(dp => ({
      id: dp.id, category: dp.category, name: dp.name,
      description: dp.description, severity: dp.severity, dsa_article: dp.dsa_article,
    }))));
    return;
  }

  // GET /dsa/report/:auditId
  const reportMatch = parsedUrl.pathname.match(/^\/dsa\/report\/(.+)$/);
  if (req.method === 'GET' && reportMatch) {
    const report = engine.auditStore.get(reportMatch[1]);
    if (!report) { res.writeHead(404); res.end(JSON.stringify({ error: 'Report not found' })); return; }
    res.writeHead(200);
    res.end(JSON.stringify(report));
    return;
  }

  // GET /dsa/stats
  if (parsedUrl.pathname === '/dsa/stats') {
    res.writeHead(200);
    res.end(JSON.stringify({
      total_audits: engine.stats.totalAudits,
      total_violations: engine.stats.violations,
      platforms_audited: engine.stats.platformsAudited.size,
      dark_patterns_tracked: DARK_PATTERNS.length,
    }));
    return;
  }

  if (parsedUrl.pathname === '/dsa/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_DSA_PORT) || 3003;
server.listen(PORT, () => {
  console.log(`[WAB DSA Compliance] Running on port ${PORT}`);
});

module.exports = { DSAComplianceEngine, DARK_PATTERNS };
