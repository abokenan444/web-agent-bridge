/**
 * WAB Agent Firewall (01-agent-firewall) — PUBLIC API, PRIVATE DETECTION LOGIC
 * Scans URLs and content for prompt injections, phishing, and dark patterns.
 * API is open, deep detection rules are closed.
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const crypto = require('crypto');

const BASIC_THREATS = [
  /ignore\s+(all\s+)?previous\s+instructions/gi,
  /you\s+are\s+now\s+in\s+developer\s+mode/gi,
  /disregard\s+(your\s+)?(prior\s+|previous\s+)?instructions/gi,
  /<\s*script[^>]*>.*?<\/\s*script\s*>/gis,
  /transfer\s+\$?\d+.*?to\s+(?:wallet|account|address)/gi,
  /data:text\/html.*base64/gi,
  /javascript:void/gi,
];

const MALICIOUS_DOMAINS = new Set([
  'paypa1.com', 'amaz0n.com', 'g00gle.com', 'faceb00k.com',
  'secure-paypal-login.com', 'amazon-security-alert.com',
]);

let deepDetection;
try { deepDetection = require('./firewall-engine'); } catch { deepDetection = null; }

const scanLog = [];

function createRouter(express) {
  const router = express.Router();

  router.post('/scan', (req, res) => {
    const { url: targetUrl, content, agent_id } = req.body;
    const startTime = Date.now();

    const urlThreats = [];
    const contentThreats = [];
    let riskScore = 0;

    if (targetUrl) {
      try {
        const parsed = new URL(targetUrl);
        const hostname = parsed.hostname.toLowerCase();
        if (MALICIOUS_DOMAINS.has(hostname)) { urlThreats.push({ type: 'MALICIOUS_DOMAIN', severity: 'CRITICAL', detail: hostname }); riskScore += 40; }
        if (/[^\x00-\x7F]/.test(hostname)) { urlThreats.push({ type: 'HOMOGRAPH_ATTACK', severity: 'HIGH', detail: hostname }); riskScore += 25; }
        if (/(?:password|token|apikey|secret)=/i.test(targetUrl)) { urlThreats.push({ type: 'DATA_EXFILTRATION', severity: 'HIGH', detail: 'Sensitive params in URL' }); riskScore += 25; }
      } catch { urlThreats.push({ type: 'INVALID_URL', severity: 'LOW' }); }
    }

    if (content && typeof content === 'string') {
      for (const pattern of BASIC_THREATS) {
        const matches = content.match(pattern);
        if (matches) { contentThreats.push({ type: 'PROMPT_INJECTION', matches: matches.slice(0, 3), count: matches.length }); riskScore += 30; }
      }
      if (deepDetection) {
        const deep = deepDetection.analyze(content, targetUrl);
        contentThreats.push(...(deep.threats || []));
        riskScore += deep.score || 0;
      }
    }

    riskScore = Math.min(100, riskScore);
    const verdict = riskScore === 0 ? 'CLEAN' : riskScore > 50 ? 'BLOCKED' : 'WARNING';
    const scanId = crypto.randomBytes(8).toString('hex');

    scanLog.push({ scan_id: scanId, url: targetUrl, verdict, risk_score: riskScore, timestamp: new Date().toISOString() });
    if (scanLog.length > 5000) scanLog.splice(0, scanLog.length - 5000);

    res.json({
      scan_id: scanId, verdict, risk_score: riskScore,
      url_threats: urlThreats, content_threats: contentThreats,
      processing_time_ms: Date.now() - startTime, scanned_at: new Date().toISOString(),
    });
  });

  router.get('/stats', (req, res) => {
    let blocked = 0, warnings = 0;
    for (const s of scanLog) { if (s.verdict === 'BLOCKED') blocked++; if (s.verdict === 'WARNING') warnings++; }
    res.json({ total_scans: scanLog.length, blocked, warnings, clean: scanLog.length - blocked - warnings });
  });

  return router;
}

module.exports = { createRouter };
