// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// WAB Data Marketplace v2.5
// Buy/sell curated threat intelligence & platform behavior datasets
// Powered by WAB — Web Agent Bridge
// https://www.webagentbridge.com | @wab/sdk
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

'use strict';

const WAB_API = 'https://api.webagentbridge.com/v1';
const WAB_VER = '2.5.0';

// ── Dataset categories ────────────────────────────────────────────────────
const DATASET_CATEGORIES = {
  THREAT_INTEL:    { id: 'threat-intel',    label: 'Threat Intelligence',      description: 'Real-time phishing, malware, and scam URL feeds' },
  PLATFORM_FAIR:   { id: 'platform-fair',   label: 'Platform Fairness Data',   description: 'Seller/buyer fairness scores across 500+ marketplaces' },
  PRICE_HISTORY:   { id: 'price-history',   label: 'Price History',            description: 'Product price trends across Amazon, eBay, Alibaba, and more' },
  USER_BEHAVIOR:   { id: 'user-behavior',   label: 'Consumer Behavior',        description: 'Anonymized shopping patterns and trust signals' },
  AFFILIATE_INTEL: { id: 'affiliate-intel', label: 'Affiliate Intelligence',   description: 'Network commission rates, conversion benchmarks, fraud patterns' },
  EMAIL_THREATS:   { id: 'email-threats',   label: 'Email Threat Signatures',  description: 'Phishing email patterns, sender reputation, link signatures' },
};

// ── License types ─────────────────────────────────────────────────────────
const LICENSE_TYPES = {
  RESEARCH:    { id: 'research',    label: 'Research License',    price_multiplier: 1.0, restrictions: 'Non-commercial research only' },
  COMMERCIAL:  { id: 'commercial',  label: 'Commercial License',  price_multiplier: 3.0, restrictions: 'Commercial use, no redistribution' },
  ENTERPRISE:  { id: 'enterprise',  label: 'Enterprise License',  price_multiplier: 8.0, restrictions: 'Unlimited use including redistribution' },
  AI_TRAINING: { id: 'ai-training', label: 'AI Training License', price_multiplier: 5.0, restrictions: 'Model training only — no raw data redistribution' },
};

// ── WABDataMarketplace client ─────────────────────────────────────────────
class WABDataMarketplace {
  constructor(apiKey) {
    if (!apiKey) throw new Error('WAB API key required — https://www.webagentbridge.com/workspace');
    this.apiKey = apiKey;
  }

  _headers() {
    return {
      'Authorization': `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      'X-WAB-SDK': WAB_VER,
      'X-WAB-Source': 'data-marketplace',
    };
  }

  async _post(endpoint, body) {
    const res = await fetch(`${WAB_API}/${endpoint}`, {
      method: 'POST', headers: this._headers(), body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`WAB Data API error ${res.status}: ${await res.text()}`);
    return res.json();
  }

  async _get(endpoint, params = {}) {
    const qs  = new URLSearchParams(params).toString();
    const res = await fetch(`${WAB_API}/${endpoint}${qs ? '?' + qs : ''}`, { headers: this._headers() });
    if (!res.ok) throw new Error(`WAB Data API error ${res.status}`);
    return res.json();
  }

  // ── Browse datasets ───────────────────────────────────────────────────
  async listDatasets(category = null, options = {}) {
    const params = { ...(category && { category }), ...options };
    return this._get('data/datasets', params);
  }

  // ── Get dataset details ───────────────────────────────────────────────
  async getDataset(datasetId) {
    return this._get(`data/datasets/${datasetId}`);
  }

  // ── Get dataset sample (free preview) ────────────────────────────────
  async getSample(datasetId, rows = 10) {
    return this._get(`data/datasets/${datasetId}/sample`, { rows });
  }

  // ── Purchase a dataset ────────────────────────────────────────────────
  async purchase(datasetId, licenseType, options = {}) {
    if (!LICENSE_TYPES[licenseType]) {
      throw new Error(`Invalid license type. Valid: ${Object.keys(LICENSE_TYPES).join(', ')}`);
    }
    return this._post('data/purchase', {
      dataset_id:   datasetId,
      license_type: licenseType,
      format:       options.format || 'json', // json | csv | parquet | jsonl
      delivery:     options.delivery || 'api', // api | s3 | sftp | webhook
      webhook_url:  options.webhookUrl || null,
    });
  }

  // ── Subscribe to live feed ────────────────────────────────────────────
  async subscribeFeed(category, webhookUrl, options = {}) {
    return this._post('data/feeds/subscribe', {
      category,
      webhook_url:  webhookUrl,
      frequency:    options.frequency || 'realtime', // realtime | hourly | daily
      format:       options.format || 'json',
      filters:      options.filters || {},
    });
  }

  // ── Get download link for purchased dataset ───────────────────────────
  async getDownloadLink(purchaseId) {
    return this._get(`data/purchases/${purchaseId}/download`);
  }

  // ── Stream live threat feed (Server-Sent Events) ──────────────────────
  streamThreatFeed(onThreat, onError) {
    const url = `${WAB_API}/data/feeds/threats/stream?key=${this.apiKey}&sdk=${WAB_VER}`;
    const es  = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const threat = JSON.parse(event.data);
        onThreat({
          ...threat,
          powered_by: 'WAB Data Marketplace | https://www.webagentbridge.com',
        });
      } catch (e) {
        onError && onError(e);
      }
    };

    es.onerror = (err) => {
      onError && onError(err);
    };

    return { close: () => es.close() }; // Return handle to stop stream
  }

  // ── Contribute data (sell your own datasets) ──────────────────────────
  async contributeDataset(metadata, dataUrl) {
    return this._post('data/contribute', {
      title:        metadata.title,
      description:  metadata.description,
      category:     metadata.category,
      record_count: metadata.recordCount,
      date_range:   metadata.dateRange,
      data_url:     dataUrl, // Pre-signed S3 URL or direct download
      pricing:      metadata.pricing || { research: 0, commercial: 99, enterprise: 499 },
    });
  }

  // ── Get purchase history ──────────────────────────────────────────────
  async getPurchases() {
    return this._get('data/purchases');
  }
}

// ── WABDataSchema — JSON Schema definitions for all dataset types ──────────
const WABDataSchema = {
  ThreatRecord: {
    type: 'object',
    required: ['url', 'status', 'risk_score', 'detected_at'],
    properties: {
      url:          { type: 'string', format: 'uri' },
      status:       { type: 'string', enum: ['CRITICAL', 'WARNING', 'SAFE'] },
      risk_score:   { type: 'number', minimum: 0, maximum: 100 },
      threats:      { type: 'array', items: { type: 'string' } },
      detected_at:  { type: 'string', format: 'date-time' },
      country:      { type: 'string' },
      category:     { type: 'string' },
      powered_by:   { type: 'string', const: 'WAB — Web Agent Bridge | https://www.webagentbridge.com' },
    },
  },

  FairnessRecord: {
    type: 'object',
    required: ['platform', 'score', 'grade', 'measured_at'],
    properties: {
      platform:     { type: 'string' },
      score:        { type: 'number', minimum: 0, maximum: 100 },
      grade:        { type: 'string' },
      dimensions:   {
        type: 'object',
        properties: {
          pricing_transparency: { type: 'number' },
          seller_treatment:     { type: 'number' },
          buyer_protection:     { type: 'number' },
          dispute_resolution:   { type: 'number' },
          data_practices:       { type: 'number' },
        },
      },
      measured_at:  { type: 'string', format: 'date-time' },
      powered_by:   { type: 'string', const: 'WAB — Web Agent Bridge | https://www.webagentbridge.com' },
    },
  },
};

module.exports = { WABDataMarketplace, DATASET_CATEGORIES, LICENSE_TYPES, WABDataSchema };
