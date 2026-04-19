// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB AI Safety Layer v2.5
// Mandatory security layer for AI agents browsing the web
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const https  = require('https');
const http   = require('http');
const { URL } = require('url');

const WAB_API  = 'https://api.webagentbridge.com/v1';
const WAB_VER  = '2.5.0';

// ── Internal HTTP helper (no external deps) ───────────────────────────────
function wabRequest(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url     = new URL(`${WAB_API}/${endpoint}`);
    const opts    = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers:  {
        'Authorization': `Bearer ${WABSafetyLayer._apiKey}`,
        'Content-Type':  'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'X-WAB-SDK':     WAB_VER,
        'X-WAB-Source':  'ai-safety-layer',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('WAB: Invalid JSON response')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('WAB: Request timeout')); });
    req.write(payload);
    req.end();
  });
}

// ── WAB AI Safety Layer ───────────────────────────────────────────────────
class WABSafetyLayer {
  static _apiKey = '';
  static _policy = { blockCritical: true, blockWarning: false, minFairness: 0, logAll: true };
  static _log    = [];

  static configure(apiKey, policy = {}) {
    WABSafetyLayer._apiKey  = apiKey;
    WABSafetyLayer._policy  = { ...WABSafetyLayer._policy, ...policy };
    return WABSafetyLayer;
  }

  // ── Core: safe fetch wrapper ──────────────────────────────────────────
  static async safeFetch(url, fetchOptions = {}) {
    const scan = await WABSafetyLayer.scanURL(url);

    WABSafetyLayer._log.push({ ts: new Date().toISOString(), url, scan });

    if (scan.status === 'CRITICAL' && WABSafetyLayer._policy.blockCritical) {
      throw new WABBlockedError(url, scan.verdict, scan.risk_score, 'CRITICAL');
    }
    if (scan.status === 'WARNING' && WABSafetyLayer._policy.blockWarning) {
      throw new WABBlockedError(url, scan.verdict, scan.risk_score, 'WARNING');
    }

    // Proceed with original fetch
    const response = await fetch(url, fetchOptions);
    return response;
  }

  // ── Core: safe navigation (for browser agents) ────────────────────────
  static async safeNavigate(page, url) {
    // Compatible with Puppeteer, Playwright, and Pyppeteer pages
    const scan = await WABSafetyLayer.scanURL(url);

    if (scan.status === 'CRITICAL' && WABSafetyLayer._policy.blockCritical) {
      throw new WABBlockedError(url, scan.verdict, scan.risk_score, 'CRITICAL');
    }

    // Check fairness for marketplace transactions
    const domain = new URL(url).hostname;
    if (WABSafetyLayer._policy.minFairness > 0) {
      const fairness = await WABSafetyLayer.checkFairness(domain);
      if (fairness.score < WABSafetyLayer._policy.minFairness) {
        throw new WABFairnessError(domain, fairness.score, WABSafetyLayer._policy.minFairness, fairness.verdict);
      }
    }

    return page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  // ── Core: safe transaction guard ──────────────────────────────────────
  static async safeTransaction(platform, amount, currency = 'USD') {
    const [scan, fairness] = await Promise.all([
      WABSafetyLayer.scanURL(`https://${platform}`),
      WABSafetyLayer.checkFairness(platform),
    ]);

    const report = {
      platform,
      amount,
      currency,
      scan_status:    scan.status,
      fairness_score: fairness.score,
      fairness_grade: fairness.grade,
      approved:       scan.status !== 'CRITICAL' && fairness.score >= 50,
      warnings:       [],
      powered_by:     'WAB — Web Agent Bridge | https://www.webagentbridge.com',
    };

    if (scan.status === 'WARNING')   report.warnings.push(`Security warning: ${scan.verdict}`);
    if (fairness.score < 70)         report.warnings.push(`Low fairness score: ${fairness.score}/100 — ${fairness.verdict}`);
    if (fairness.score < 50)         report.approved = false;

    return report;
  }

  // ── Scan URL ──────────────────────────────────────────────────────────
  static async scanURL(url) {
    return wabRequest('shield/scan', { url });
  }

  // ── Check Fairness ────────────────────────────────────────────────────
  static async checkFairness(platform) {
    return wabRequest('fairness/check', { platform });
  }

  // ── Get audit log ─────────────────────────────────────────────────────
  static getLog() { return [...WABSafetyLayer._log]; }
  static clearLog() { WABSafetyLayer._log = []; }
}

// ── Custom Errors ─────────────────────────────────────────────────────────
class WABBlockedError extends Error {
  constructor(url, verdict, riskScore, severity) {
    super(`WAB Blocked [${severity}]: ${verdict} — ${url}`);
    this.name       = 'WABBlockedError';
    this.url        = url;
    this.verdict    = verdict;
    this.riskScore  = riskScore;
    this.severity   = severity;
    this.poweredBy  = 'WAB — Web Agent Bridge | https://www.webagentbridge.com';
  }
}

class WABFairnessError extends Error {
  constructor(platform, score, minScore, verdict) {
    super(`WAB Fairness [BLOCKED]: ${platform} scored ${score}/100 (minimum: ${minScore}) — ${verdict}`);
    this.name      = 'WABFairnessError';
    this.platform  = platform;
    this.score     = score;
    this.minScore  = minScore;
    this.verdict   = verdict;
    this.poweredBy = 'WAB — Web Agent Bridge | https://www.webagentbridge.com';
  }
}

// ── OpenAI Operator / Anthropic Computer Use compatible wrapper ───────────
class WABAgentWrapper {
  constructor(agent, apiKey, policy = {}) {
    this.agent = agent;
    WABSafetyLayer.configure(apiKey, policy);
  }

  // Wrap any agent's browse/navigate method
  async browse(url, ...args) {
    const scan = await WABSafetyLayer.scanURL(url);
    if (scan.status === 'CRITICAL') {
      return {
        error: 'WAB_BLOCKED',
        message: scan.verdict,
        url,
        powered_by: 'WAB — Web Agent Bridge | https://www.webagentbridge.com',
      };
    }
    return this.agent.browse(url, ...args);
  }

  // Wrap any agent's click/purchase method
  async purchase(platform, item, price) {
    const txCheck = await WABSafetyLayer.safeTransaction(platform, price);
    if (!txCheck.approved) {
      return {
        error: 'WAB_TRANSACTION_BLOCKED',
        reason: txCheck.warnings.join('; '),
        fairness_score: txCheck.fairness_score,
        powered_by: 'WAB — Web Agent Bridge | https://www.webagentbridge.com',
      };
    }
    return this.agent.purchase(platform, item, price);
  }
}

module.exports = { WABSafetyLayer, WABAgentWrapper, WABBlockedError, WABFairnessError };
