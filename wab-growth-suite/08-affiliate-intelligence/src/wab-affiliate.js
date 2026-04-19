// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Affiliate Intelligence v2.5
// Protect affiliate marketers from unfair networks & fraud
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';

// ── Known affiliate networks database ────────────────────────────────────
const KNOWN_NETWORKS = {
  'amazon-associates': { name: 'Amazon Associates',   domain: 'affiliate-program.amazon.com', tier: 'MAJOR' },
  'shareasale':        { name: 'ShareASale',           domain: 'shareasale.com',               tier: 'MAJOR' },
  'cj-affiliate':      { name: 'CJ Affiliate',         domain: 'cj.com',                       tier: 'MAJOR' },
  'clickbank':         { name: 'ClickBank',            domain: 'clickbank.com',                tier: 'MAJOR' },
  'rakuten':           { name: 'Rakuten Advertising',  domain: 'rakutenadvertising.com',       tier: 'MAJOR' },
  'impact':            { name: 'Impact',               domain: 'impact.com',                   tier: 'MAJOR' },
  'awin':              { name: 'Awin',                 domain: 'awin.com',                     tier: 'MAJOR' },
  'partnerstack':      { name: 'PartnerStack',         domain: 'partnerstack.com',             tier: 'MAJOR' },
};

// ── Fraud detection patterns ──────────────────────────────────────────────
const FRAUD_PATTERNS = [
  { id: 'cookie-stuffing',    label: 'Cookie Stuffing',       severity: 'CRITICAL', description: 'Unauthorized cookie injection to steal commissions' },
  { id: 'click-fraud',        label: 'Click Fraud',           severity: 'CRITICAL', description: 'Fake clicks to inflate traffic metrics' },
  { id: 'commission-shaving', label: 'Commission Shaving',    severity: 'HIGH',     description: 'Network cancels valid sales to reduce payouts' },
  { id: 'late-attribution',   label: 'Late Attribution',      severity: 'HIGH',     description: 'Delayed tracking causing missed commissions' },
  { id: 'low-conversion',     label: 'Suspicious Low CVR',    severity: 'MEDIUM',   description: 'Conversion rate significantly below industry average' },
  { id: 'payment-delay',      label: 'Payment Delays',        severity: 'MEDIUM',   description: 'Consistent late or missing commission payments' },
  { id: 'tos-changes',        label: 'Sudden TOS Changes',    severity: 'MEDIUM',   description: 'Unexpected changes to commission structure or terms' },
];

// ── WABAffiliateIntelligence client ───────────────────────────────────────
class WABAffiliateIntelligence {
  constructor(apiKey) {
    if (!apiKey) throw new Error('WAB API key required — https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VER,
      'X-WAB-Source': 'affiliate-intelligence',
    };
  }

  async _post(ep, body) {
    const res = await fetch(`${WAB_API}/${ep}`, { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`WAB Affiliate API error ${res.status}`);
    return res.json();
  }

  async _get(ep, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${WAB_API}/${ep}${qs ? '?' + qs : ''}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`WAB Affiliate API error ${res.status}`);
    return res.json();
  }

  // ── Analyze a network ─────────────────────────────────────────────────
  async analyzeNetwork(networkId) {
    const network = KNOWN_NETWORKS[networkId];
    if (!network) throw new Error(`Unknown network: ${networkId}. Known: ${Object.keys(KNOWN_NETWORKS).join(', ')}`);

    const [fairness, security] = await Promise.all([
      this._post('fairness/check', { platform: network.domain }),
      this._post('shield/scan',    { url: `https://${network.domain}` }),
    ]);

    return {
      network_id:       networkId,
      network_name:     network.name,
      domain:           network.domain,
      tier:             network.tier,
      fairness_score:   fairness.score,
      fairness_grade:   fairness.grade,
      security_status:  security.status,
      payment_reliability: fairness.payment_reliability || 'UNKNOWN',
      commission_accuracy: fairness.commission_accuracy || 'UNKNOWN',
      analyzed_at:      new Date().toISOString(),
      powered_by:       'WAB Affiliate Intelligence | https://www.webagentbridge.com',
    };
  }

  // ── Detect fraud in affiliate data ────────────────────────────────────
  async detectFraud(data) {
    const {
      networkId,
      clicks,
      conversions,
      commissions,
      expectedCVR,     // Expected conversion rate (e.g., 0.02 = 2%)
      expectedEPC,     // Expected earnings per click (e.g., 0.50)
      paymentHistory,  // Array of { date, amount, expected, status }
    } = data;

    const detectedFraud = [];
    const warnings      = [];

    // Check conversion rate anomaly
    const actualCVR = clicks > 0 ? conversions / clicks : 0;
    if (expectedCVR && actualCVR < expectedCVR * 0.3) {
      detectedFraud.push({
        ...FRAUD_PATTERNS.find(p => p.id === 'low-conversion'),
        details: `CVR is ${(actualCVR * 100).toFixed(2)}% vs expected ${(expectedCVR * 100).toFixed(2)}%`,
      });
    }

    // Check EPC anomaly
    const actualEPC = clicks > 0 ? commissions / clicks : 0;
    if (expectedEPC && actualEPC < expectedEPC * 0.4) {
      warnings.push(`EPC is $${actualEPC.toFixed(3)} vs expected $${expectedEPC.toFixed(3)}`);
    }

    // Check payment history
    if (paymentHistory && paymentHistory.length > 0) {
      const latePayments = paymentHistory.filter(p => p.status === 'LATE' || p.status === 'MISSING');
      const shavedPayments = paymentHistory.filter(p => p.amount < p.expected * 0.9);

      if (latePayments.length / paymentHistory.length > 0.2) {
        detectedFraud.push({
          ...FRAUD_PATTERNS.find(p => p.id === 'payment-delay'),
          details: `${latePayments.length} of ${paymentHistory.length} payments were late or missing`,
        });
      }

      if (shavedPayments.length / paymentHistory.length > 0.15) {
        detectedFraud.push({
          ...FRAUD_PATTERNS.find(p => p.id === 'commission-shaving'),
          details: `${shavedPayments.length} payments were significantly below expected amount`,
        });
      }
    }

    // Cross-check with WAB API
    const apiCheck = await this._post('affiliate/fraud-check', {
      network_id:  networkId,
      clicks,
      conversions,
      commissions,
    }).catch(() => null);

    if (apiCheck?.fraud_detected) {
      apiCheck.patterns?.forEach(p => {
        if (!detectedFraud.find(f => f.id === p.id)) {
          detectedFraud.push(p);
        }
      });
    }

    const riskLevel = detectedFraud.some(f => f.severity === 'CRITICAL') ? 'CRITICAL'
                    : detectedFraud.some(f => f.severity === 'HIGH')     ? 'HIGH'
                    : warnings.length > 0                                 ? 'MEDIUM'
                    : 'LOW';

    return {
      network_id:      networkId,
      risk_level:      riskLevel,
      fraud_detected:  detectedFraud.length > 0,
      fraud_patterns:  detectedFraud,
      warnings,
      metrics: {
        clicks, conversions, commissions,
        actual_cvr: actualCVR,
        actual_epc: actualEPC,
      },
      recommendation: riskLevel === 'CRITICAL' ? 'STOP — Pause all campaigns immediately and contact network support.'
                    : riskLevel === 'HIGH'     ? 'CAUTION — Review all recent conversions and request audit.'
                    : riskLevel === 'MEDIUM'   ? 'MONITOR — Watch closely and document all anomalies.'
                    : 'NORMAL — No significant issues detected.',
      analyzed_at:    new Date().toISOString(),
      powered_by:     'WAB Affiliate Intelligence | https://www.webagentbridge.com',
    };
  }

  // ── Get industry benchmark for a category ────────────────────────────
  async getBenchmark(category) {
    // category: 'ecommerce' | 'saas' | 'finance' | 'travel' | 'health' | 'education'
    return this._get('affiliate/benchmarks', { category });
  }

  // ── Compare multiple networks ─────────────────────────────────────────
  async compareNetworks(networkIds) {
    const results = await Promise.allSettled(networkIds.map(id => this.analyzeNetwork(id)));
    return results.map((r, i) => ({
      network_id: networkIds[i],
      ...(r.status === 'fulfilled' ? r.value : { error: r.reason.message }),
    })).sort((a, b) => (b.fairness_score || 0) - (a.fairness_score || 0));
  }

  // ── Generate affiliate health report ─────────────────────────────────
  async generateReport(networkId, periodDays = 30) {
    const [analysis, benchmarks] = await Promise.all([
      this.analyzeNetwork(networkId),
      this.getBenchmark('ecommerce').catch(() => null),
    ]);

    return {
      report_type:  'AFFILIATE_HEALTH',
      network:      analysis,
      benchmarks,
      period_days:  periodDays,
      generated_at: new Date().toISOString(),
      powered_by:   'WAB Affiliate Intelligence | https://www.webagentbridge.com',
    };
  }
}

module.exports = { WABAffiliateIntelligence, KNOWN_NETWORKS, FRAUD_PATTERNS };
