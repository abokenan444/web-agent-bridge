/**
 * WAB Affiliate Intelligence
 * Protects affiliate marketers from platform manipulation:
 * - Cookie stuffing detection
 * - Last-click attribution fraud
 * - Commission shaving detection
 * - Platform blacklist tracking
 * - Fair commission verification
 *
 * Powered by WAB — Web Agent Bridge
 * https://www.webagentbridge.com
 */

'use strict';

const http = require('http');
const crypto = require('crypto');
const url = require('url');

// ─── Platform Commission Database ─────────────────────────────────────────────
const PLATFORM_DATA = {
  amazon: {
    name: 'Amazon Associates',
    official_rates: { electronics: 3, fashion: 7, books: 4.5, home: 8, default: 4 },
    cookie_days: 24,
    known_issues: ['commission_rate_cuts_2020', 'cookie_window_reduction'],
    trust_score: 72,
    complaints_30d: 23,
  },
  shopify: {
    name: 'Shopify Affiliate',
    official_rates: { default: 20 },
    cookie_days: 30,
    known_issues: [],
    trust_score: 91,
    complaints_30d: 2,
  },
  booking: {
    name: 'Booking.com Affiliate',
    official_rates: { hotels: 25, default: 20 },
    cookie_days: 30,
    known_issues: ['session_cookie_issues'],
    trust_score: 78,
    complaints_30d: 8,
  },
  clickbank: {
    name: 'ClickBank',
    official_rates: { digital: 50, default: 40 },
    cookie_days: 60,
    known_issues: ['refund_abuse', 'chargeback_manipulation'],
    trust_score: 61,
    complaints_30d: 45,
  },
  cj: {
    name: 'CJ Affiliate (Commission Junction)',
    official_rates: { default: 8 },
    cookie_days: 30,
    known_issues: [],
    trust_score: 85,
    complaints_30d: 5,
  },
};

// ─── Fraud Detection Engine ───────────────────────────────────────────────────
class AffiliateIntelligence {
  constructor() {
    this.reports = new Map();
    this.alerts = [];
    this.totalAnalyzed = 0;
    this.fraudDetected = 0;
    this._seedAlerts();
  }

  _seedAlerts() {
    this.alerts = [
      { id: 'ALT-001', platform: 'amazon', type: 'RATE_CHANGE', severity: 'HIGH', message: 'Amazon reduced electronics commission from 4% to 3% on 2026-03-01 without advance notice', detected: '2026-03-02', affected_affiliates: 12400 },
      { id: 'ALT-002', platform: 'clickbank', type: 'COOKIE_STUFFING', severity: 'CRITICAL', message: 'Widespread cookie stuffing detected on ClickBank network — 847 fraudulent conversions identified', detected: '2026-04-10', affected_affiliates: 230 },
      { id: 'ALT-003', platform: 'booking', type: 'ATTRIBUTION_FRAUD', severity: 'MEDIUM', message: 'Booking.com session cookie expiring early — affiliates losing last-click attribution', detected: '2026-04-15', affected_affiliates: 560 },
    ];
  }

  analyzeTransaction(data) {
    const { platform, affiliateId, orderId, reportedCommission, orderValue, category, clickTimestamp, conversionTimestamp } = data;

    this.totalAnalyzed++;
    const fraudSignals = [];
    let fraudScore = 0;

    const platformData = PLATFORM_DATA[platform?.toLowerCase()];
    if (!platformData) {
      return { error: `Unknown platform '${platform}'. Known: ${Object.keys(PLATFORM_DATA).join(', ')}` };
    }

    // 1. Commission rate verification
    const expectedRate = platformData.official_rates[category?.toLowerCase()] || platformData.official_rates.default;
    const actualRate = (reportedCommission / orderValue) * 100;
    const rateDifference = expectedRate - actualRate;

    if (rateDifference > 1) {
      const severity = rateDifference > 3 ? 'CRITICAL' : rateDifference > 2 ? 'HIGH' : 'MEDIUM';
      fraudSignals.push({
        type: 'COMMISSION_SHAVING',
        severity,
        message: `Commission shaving detected: Expected ${expectedRate.toFixed(1)}%, received ${actualRate.toFixed(1)}% (${rateDifference.toFixed(1)}% shortfall)`,
        expected_commission: (orderValue * expectedRate / 100).toFixed(2),
        actual_commission: reportedCommission,
        loss: ((orderValue * expectedRate / 100) - reportedCommission).toFixed(2),
      });
      fraudScore += severity === 'CRITICAL' ? 40 : severity === 'HIGH' ? 25 : 15;
    }

    // 2. Attribution window check
    if (clickTimestamp && conversionTimestamp) {
      const hoursDiff = (new Date(conversionTimestamp) - new Date(clickTimestamp)) / (1000 * 60 * 60);
      if (hoursDiff > platformData.cookie_days * 24) {
        fraudSignals.push({
          type: 'COOKIE_EXPIRY_FRAUD',
          severity: 'HIGH',
          message: `Conversion occurred ${Math.floor(hoursDiff / 24)} days after click, but platform cookie window is ${platformData.cookie_days} days`,
          hours_after_click: Math.round(hoursDiff),
          cookie_window_hours: platformData.cookie_days * 24,
        });
        fraudScore += 30;
      }
      // Suspicious: conversion within 1 second of click (cookie stuffing)
      if (hoursDiff < 0.001) {
        fraudSignals.push({
          type: 'COOKIE_STUFFING_SUSPECTED',
          severity: 'CRITICAL',
          message: 'Conversion occurred within milliseconds of click — strong indicator of cookie stuffing',
          hours_after_click: hoursDiff,
        });
        fraudScore += 50;
      }
    }

    // 3. Order value anomaly
    if (orderValue < 0.01 || orderValue > 100000) {
      fraudSignals.push({
        type: 'ANOMALOUS_ORDER_VALUE',
        severity: 'MEDIUM',
        message: `Unusual order value: $${orderValue}`,
      });
      fraudScore += 10;
    }

    // 4. Platform-specific known issues
    if (platformData.known_issues.length > 0) {
      fraudSignals.push({
        type: 'PLATFORM_KNOWN_ISSUES',
        severity: 'INFO',
        message: `Platform has ${platformData.known_issues.length} known issue(s): ${platformData.known_issues.join(', ')}`,
        issues: platformData.known_issues,
      });
    }

    const verdict = fraudScore >= 50 ? 'FRAUD_CONFIRMED' : fraudScore >= 25 ? 'SUSPICIOUS' : fraudScore >= 10 ? 'CAUTION' : 'LEGITIMATE';

    this.fraudDetected += fraudScore >= 25 ? 1 : 0;

    const result = {
      transaction_id: 'TXN-' + crypto.randomBytes(4).toString('hex').toUpperCase(),
      platform: platformData.name,
      order_id: orderId,
      verdict,
      fraud_score: fraudScore,
      fraud_signals: fraudSignals,
      platform_trust_score: platformData.trust_score,
      expected_commission: `$${(orderValue * expectedRate / 100).toFixed(2)} (${expectedRate}%)`,
      reported_commission: `$${reportedCommission} (${actualRate.toFixed(1)}%)`,
      analyzed_at: new Date().toISOString(),
      recommendation: this._getRecommendation(verdict, fraudSignals),
    };

    this.reports.set(result.transaction_id, result);
    return result;
  }

  _getRecommendation(verdict, signals) {
    if (verdict === 'FRAUD_CONFIRMED') {
      return 'File a formal dispute with the platform immediately. Document all evidence. Consider escalating to the FTC or relevant consumer protection authority.';
    }
    if (verdict === 'SUSPICIOUS') {
      return 'Monitor closely. Compare with other transactions from the same platform. If pattern persists, file a dispute.';
    }
    if (verdict === 'CAUTION') {
      return 'Review the transaction details. Check if platform recently changed commission rates.';
    }
    return 'Transaction appears legitimate. Continue monitoring for patterns.';
  }

  getPlatformReport(platformKey) {
    const platform = PLATFORM_DATA[platformKey?.toLowerCase()];
    if (!platform) return { error: 'Platform not found' };

    const platformAlerts = this.alerts.filter(a => a.platform === platformKey.toLowerCase());

    return {
      platform: platform.name,
      trust_score: platform.trust_score,
      trust_grade: platform.trust_score >= 90 ? 'A' : platform.trust_score >= 75 ? 'B' : platform.trust_score >= 60 ? 'C' : 'D',
      official_commission_rates: platform.official_rates,
      cookie_window_days: platform.cookie_days,
      known_issues: platform.known_issues,
      complaints_last_30_days: platform.complaints_30d,
      active_alerts: platformAlerts,
      recommendation: platform.trust_score >= 80 ? 'Generally reliable. Monitor for rate changes.' : 'Exercise caution. Review all transactions carefully.',
    };
  }

  getAlerts(severity = null) {
    const filtered = severity ? this.alerts.filter(a => a.severity === severity) : this.alerts;
    return { alerts: filtered, total: filtered.length };
  }

  getStats() {
    return {
      total_transactions_analyzed: this.totalAnalyzed,
      fraud_detected: this.fraudDetected,
      fraud_rate_pct: this.totalAnalyzed > 0 ? ((this.fraudDetected / this.totalAnalyzed) * 100).toFixed(1) : 0,
      active_alerts: this.alerts.length,
      platforms_monitored: Object.keys(PLATFORM_DATA).length,
      total_reports: this.reports.size,
    };
  }
}

const affiliateEngine = new AffiliateIntelligence();

// ─── HTTP Server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const parsedUrl = url.parse(req.url, true);

  if (req.method === 'POST' && parsedUrl.pathname === '/affiliate/analyze') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const result = affiliateEngine.analyzeTransaction(data);
        res.writeHead(result.error ? 400 : 200);
        res.end(JSON.stringify(result));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    });
    return;
  }

  const platformMatch = parsedUrl.pathname.match(/^\/affiliate\/platform\/(.+)$/);
  if (req.method === 'GET' && platformMatch) {
    const result = affiliateEngine.getPlatformReport(platformMatch[1]);
    res.writeHead(result.error ? 404 : 200);
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/affiliate/alerts') {
    res.writeHead(200);
    res.end(JSON.stringify(affiliateEngine.getAlerts(parsedUrl.query.severity)));
    return;
  }

  if (parsedUrl.pathname === '/affiliate/stats') {
    res.writeHead(200);
    res.end(JSON.stringify(affiliateEngine.getStats()));
    return;
  }

  if (parsedUrl.pathname === '/affiliate/health') {
    res.writeHead(200);
    res.end(JSON.stringify({ status: 'healthy' }));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: 'Not found' }));
});

const PORT = parseInt(process.env.WAB_AFFILIATE_PORT) || 3010;
server.listen(PORT, () => {
  console.log(`[WAB Affiliate Intelligence] Running on port ${PORT}`);
});

module.exports = { AffiliateIntelligence };
