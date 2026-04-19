// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Growth Suite — Shared Core SDK
// Powered by WAB — Web Agent Bridge v2.5
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API_BASE = 'https://api.webagentbridge.com/v1';
const WAB_VERSION  = '2.5.0';

class WABCore {
  constructor(apiKey) {
    if (!apiKey) throw new Error('WAB API key required — get yours free at https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;
    this.baseURL = WAB_API_BASE;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VERSION,
      'X-WAB-Suite': 'growth-suite-2.5',
    };
  }

  async _post(endpoint, body) {
    const res = await fetch(`${this.baseURL}/${endpoint}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`WAB API error ${res.status}: ${err.message || res.statusText}`);
    }
    return res.json();
  }

  async _get(endpoint, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const url = `${this.baseURL}/${endpoint}${qs ? '?' + qs : ''}`;
    const res = await fetch(url, { headers: this._headers() });
    if (!res.ok) throw new Error(`WAB API error ${res.status}`);
    return res.json();
  }

  // ── Scam Shield ──────────────────────────────────
  async scanURL(url) {
    return this._post('shield/scan', { url });
  }

  async scanBatch(urls) {
    return this._post('shield/scan-batch', { urls });
  }

  // ── Fairness System ───────────────────────────────
  async checkFairness(platform) {
    return this._post('fairness/check', { platform });
  }

  async getScore(platform) {
    return this._get('fairness/score', { platform });
  }

  // ── Deals Engine ──────────────────────────────────
  async findDeals(query, options = {}) {
    return this._post('deals/search', { query, ...options });
  }

  // ── AI Agent ──────────────────────────────────────
  async agentQuery(message, context = '') {
    return this._post('agent/query', { query: message, context });
  }

  // ── Bounty Network ────────────────────────────────
  async submitBounty(url, reporterToken, evidence = '') {
    return this._post('bounty/submit', { url, reporter_token: reporterToken, evidence });
  }

  async getBountyStatus(bountyId) {
    return this._get(`bounty/status/${bountyId}`);
  }

  // ── WAB Score ─────────────────────────────────────
  async getWABScore(domain) {
    return this._get('score/domain', { domain });
  }

  async getScoreHistory(domain, months = 6) {
    return this._get('score/history', { domain, months });
  }

  // ── Affiliate Intelligence ────────────────────────
  async analyzeAffiliate(networkId, affiliateId) {
    return this._post('affiliate/analyze', { network_id: networkId, affiliate_id: affiliateId });
  }

  async getAffiliateReport(networkId) {
    return this._get('affiliate/report', { network_id: networkId });
  }

  // ── Data Marketplace ──────────────────────────────
  async getDatasets(category) {
    return this._get('data/datasets', { category });
  }

  async purchaseDataset(datasetId, licenseType) {
    return this._post('data/purchase', { dataset_id: datasetId, license_type: licenseType });
  }
}

// Node.js + Browser compatible export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WABCore, WAB_API_BASE, WAB_VERSION };
} else if (typeof window !== 'undefined') {
  window.WABCore = WABCore;
}
