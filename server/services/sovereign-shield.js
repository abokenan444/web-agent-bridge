'use strict';

const crypto = require('crypto');

const SUSPICIOUS_TLDS = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'click', 'work', 'bid', 'review', 'stream', 'zip'
]);

// Seed list: high-risk infra patterns + commonly abused domains.
// This list is intentionally conservative to reduce false positives.
const SEED_INDICATORS = [
  { host: 'api.telegram-cdn.com', level: 'high', source: 'research' },
  { host: 'cdn-whatsapp-secure.com', level: 'high', source: 'research' },
  { host: 'icloud-security-check.com', level: 'high', source: 'research' },
  { host: 'appleid-login-secure.com', level: 'high', source: 'research' },
  { host: 'google-auth-verify.net', level: 'high', source: 'research' },
  { host: 'meta-business-security.com', level: 'high', source: 'research' }
];

const RISKY_APPS = new Set(['whatsapp', 'messenger', 'telegram', 'signal', 'mail', 'gmail', 'photos', 'gallery']);

const state = {
  indicators: new Map(), // host -> { host, level, source, firstSeen, lastSeen, reports, confidence }
  reportsByHost: new Map(), // host -> Map(reporterFingerprint -> timestamp)
  events: [],
  stats: {
    analyzed: 0,
    blocked: 0,
    warned: 0,
    vaultEncryptOps: 0,
    vaultDecryptOps: 0,
    communityReports: 0
  },
  version: 1
};

for (const seed of SEED_INDICATORS) {
  const now = Date.now();
  state.indicators.set(seed.host, {
    host: seed.host,
    level: seed.level,
    source: seed.source,
    firstSeen: now,
    lastSeen: now,
    reports: 1,
    confidence: 0.7
  });
}

function recordEvent(type, payload) {
  state.events.unshift({
    id: crypto.randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    payload
  });
  if (state.events.length > 500) state.events.pop();
}

function normalizeHost(value) {
  if (!value || typeof value !== 'string') return '';
  let host = value.trim().toLowerCase();
  if (!host) return '';
  try {
    if (host.startsWith('http://') || host.startsWith('https://')) {
      host = new URL(host).hostname.toLowerCase();
    }
  } catch {
    return '';
  }
  return host.replace(/^www\./, '');
}

function getRootDomain(host) {
  const parts = host.split('.');
  if (parts.length < 2) return host;
  return parts.slice(-2).join('.');
}

function hasKnownIndicator(host) {
  if (!host) return null;
  const root = getRootDomain(host);
  if (state.indicators.has(host)) return state.indicators.get(host);
  if (state.indicators.has(root)) return state.indicators.get(root);
  for (const [indicatorHost, indicator] of state.indicators.entries()) {
    if (host.endsWith('.' + indicatorHost)) return indicator;
  }
  return null;
}

function heuristicScore({ app, host, bytesOut = 0, bytesIn = 0, background = false, micAccess = false, cameraAccess = false, contactsAccess = false }) {
  let score = 0;
  const reasons = [];

  const tld = host.split('.').pop() || '';
  if (SUSPICIOUS_TLDS.has(tld)) {
    score += 25;
    reasons.push('suspicious_tld');
  }

  if ((host.match(/-/g) || []).length >= 3) {
    score += 10;
    reasons.push('hyphen_abuse');
  }

  if (/\d{4,}/.test(host)) {
    score += 10;
    reasons.push('numeric_domain_pattern');
  }

  const root = getRootDomain(host);
  const trustedBrands = ['apple.com', 'google.com', 'microsoft.com', 'meta.com', 'whatsapp.com'];
  if ((root.includes('apple') || root.includes('google') || root.includes('meta') || root.includes('microsoft'))
    && !trustedBrands.includes(root)) {
    score += 30;
    reasons.push('possible_brand_impersonation');
  }

  const appName = String(app || '').toLowerCase();
  const totalBytes = Number(bytesOut || 0) + Number(bytesIn || 0);
  if (background && totalBytes > 2_000_000 && RISKY_APPS.has(appName)) {
    score += 20;
    reasons.push('background_high_transfer');
  }

  if ((micAccess || cameraAccess || contactsAccess) && background) {
    score += 20;
    reasons.push('sensitive_access_in_background');
  }

  if (bytesOut > 5_000_000 && bytesIn < 300_000) {
    score += 15;
    reasons.push('possible_exfiltration_pattern');
  }

  return { score: Math.min(score, 100), reasons };
}

function analyzeConnection(payload) {
  const app = String(payload?.app || payload?.appName || 'unknown').slice(0, 120);
  const host = normalizeHost(payload?.destination || payload?.host || payload?.url || '');
  if (!host) {
    return { error: 'destination/host/url required' };
  }

  const indicator = hasKnownIndicator(host);
  const heuristic = heuristicScore({
    app,
    host,
    bytesOut: Number(payload?.bytesOut || 0),
    bytesIn: Number(payload?.bytesIn || 0),
    background: Boolean(payload?.background),
    micAccess: Boolean(payload?.micAccess),
    cameraAccess: Boolean(payload?.cameraAccess),
    contactsAccess: Boolean(payload?.contactsAccess)
  });

  let riskScore = heuristic.score;
  let decision = 'allow';
  const reasons = [...heuristic.reasons];

  if (indicator) {
    riskScore = Math.max(riskScore, indicator.level === 'high' ? 95 : 80);
    reasons.push('known_indicator_match');
  }

  if (riskScore >= 85) decision = 'block';
  else if (riskScore >= 45) decision = 'warn';

  state.stats.analyzed += 1;
  if (decision === 'block') state.stats.blocked += 1;
  if (decision === 'warn') state.stats.warned += 1;

  const result = {
    app,
    host,
    riskScore,
    decision,
    reasons,
    indicator: indicator ? {
      host: indicator.host,
      level: indicator.level,
      source: indicator.source,
      confidence: indicator.confidence
    } : null,
    analyzedAt: new Date().toISOString()
  };

  recordEvent('connection_analysis', result);
  return result;
}

function getIntelFeed() {
  return {
    schema: 'wab-sovereign-shield-v1',
    version: state.version,
    generatedAt: new Date().toISOString(),
    indicators: Array.from(state.indicators.values()).map((i) => ({
      host: i.host,
      level: i.level,
      confidence: i.confidence,
      source: i.source,
      lastSeen: new Date(i.lastSeen).toISOString()
    }))
  };
}

function submitThreatReport(payload) {
  const host = normalizeHost(payload?.host || payload?.destination || payload?.url || '');
  const reporter = String(payload?.reporterFingerprint || payload?.deviceFingerprint || payload?.reporter || '').slice(0, 128);
  const severity = String(payload?.severity || 'medium').toLowerCase();
  if (!host || !reporter) return { error: 'host and reporterFingerprint are required' };

  state.stats.communityReports += 1;

  if (!state.reportsByHost.has(host)) state.reportsByHost.set(host, new Map());
  state.reportsByHost.get(host).set(reporter, Date.now());
  const uniqueReports = state.reportsByHost.get(host).size;

  const level = severity === 'critical' ? 'high' : (severity === 'low' ? 'medium' : 'high');
  const now = Date.now();
  const existing = state.indicators.get(host);

  const next = {
    host,
    level: existing?.level || level,
    source: existing?.source || 'community',
    firstSeen: existing?.firstSeen || now,
    lastSeen: now,
    reports: (existing?.reports || 0) + 1,
    confidence: Math.min(0.4 + uniqueReports * 0.15, 0.98)
  };

  // Auto-promote to blocklist-grade indicator after 3 independent reports.
  if (uniqueReports >= 3) {
    next.level = 'high';
    next.source = 'community-verified';
    state.version += 1;
  }

  state.indicators.set(host, next);

  const result = {
    accepted: true,
    host,
    uniqueReports,
    promoted: uniqueReports >= 3,
    confidence: next.confidence,
    intelVersion: state.version
  };

  recordEvent('community_report', {
    host,
    uniqueReports,
    promoted: result.promoted,
    severity
  });

  return result;
}

function getStats() {
  const topThreats = Array.from(state.indicators.values())
    .sort((a, b) => (b.reports - a.reports) || (b.confidence - a.confidence))
    .slice(0, 20)
    .map((i) => ({ host: i.host, reports: i.reports, confidence: i.confidence, level: i.level, source: i.source }));

  return {
    ...state.stats,
    indicators: state.indicators.size,
    intelVersion: state.version,
    topThreats
  };
}

function getRecentEvents(limit = 50) {
  const n = Math.max(1, Math.min(Number(limit) || 50, 200));
  return state.events.slice(0, n);
}

function deriveKey(passphrase, salt) {
  return crypto.pbkdf2Sync(passphrase, salt, 250000, 32, 'sha256');
}

function encryptVault(plaintext, passphrase) {
  if (typeof plaintext !== 'string' || !plaintext.length) return { error: 'plaintext is required' };
  if (typeof passphrase !== 'string' || passphrase.length < 10) return { error: 'passphrase must be at least 10 chars' };

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(passphrase, salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  state.stats.vaultEncryptOps += 1;
  recordEvent('vault_encrypt', { bytes: encrypted.length });

  return {
    algorithm: 'aes-256-gcm',
    kdf: 'pbkdf2-sha256',
    iterations: 250000,
    payload: {
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      data: encrypted.toString('base64')
    }
  };
}

function decryptVault(payload, passphrase) {
  if (!payload || typeof payload !== 'object') return { error: 'payload is required' };
  if (typeof passphrase !== 'string' || !passphrase.length) return { error: 'passphrase is required' };

  try {
    const salt = Buffer.from(payload.salt, 'base64');
    const iv = Buffer.from(payload.iv, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');
    const data = Buffer.from(payload.data, 'base64');

    const key = deriveKey(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');

    state.stats.vaultDecryptOps += 1;
    recordEvent('vault_decrypt', { bytes: data.length });

    return { plaintext };
  } catch {
    return { error: 'decrypt_failed' };
  }
}

module.exports = {
  analyzeConnection,
  getIntelFeed,
  submitThreatReport,
  getStats,
  getRecentEvents,
  encryptVault,
  decryptVault
};
