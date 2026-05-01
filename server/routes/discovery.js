/**
 * WAB Discovery Protocol — Auto-generated discovery documents and
 * public registry of WAB-enabled sites with fairness scoring.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { findSiteById, db } = require('../models/db');
const { authenticateToken } = require('../middleware/auth');
const { safeFetch } = require('../utils/safe-fetch');
const { verify } = require('../../packages/dns-verify/src/index');

// Fairness module is proprietary — provide stubs when not available
let calculateNeutralityScore, fairnessWeightedSearch, registerInDirectory, getDirectoryListings, generateFairnessReport;
try {
  ({
    calculateNeutralityScore,
    fairnessWeightedSearch,
    registerInDirectory,
    getDirectoryListings,
    generateFairnessReport
  } = require('../services/fairness'));
} catch {
  calculateNeutralityScore = () => ({ score: 0, label: 'unrated' });
  fairnessWeightedSearch = (_q, candidates) => candidates;
  registerInDirectory = () => ({});
  getDirectoryListings = () => [];
  generateFairnessReport = () => ({ status: 'unavailable' });
}

const WAB_VERSION = '1.2.0';

db.exec(`
  CREATE TABLE IF NOT EXISTS discovery_usage_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT NOT NULL,
    mode TEXT NOT NULL,
    preferred_use_case TEXT,
    selected_action TEXT,
    readiness_ok INTEGER DEFAULT 0,
    execution_attempted INTEGER DEFAULT 0,
    execution_succeeded INTEGER DEFAULT 0,
    value_score REAL DEFAULT 0,
    end_to_end_ms INTEGER,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_discovery_usage_runs_domain_time
    ON discovery_usage_runs(domain, created_at DESC);
`);

// ─── Helpers ─────────────────────────────────────────────────────────

function findSiteByDomain(domain) {
  if (!domain) return null;
  const normalized = domain.toLowerCase().replace(/^www\./, '');
  return db.prepare(
    "SELECT * FROM sites WHERE LOWER(REPLACE(domain, 'www.', '')) = ? AND active = 1 LIMIT 1"
  ).get(normalized);
}

function getRequestDomain(req) {
  const origin = req.get('origin');
  if (origin) {
    try { return new URL(origin).hostname; } catch (_) {}
  }
  const host = req.get('host');
  if (host) return host.split(':')[0];
  return req.hostname;
}

function parseSiteConfig(site) {
  try { return JSON.parse(site.config || '{}'); } catch (_) { return {}; }
}

function sanitizeDomain(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/:\d+$/, '')
    .replace(/^www\./, '');
}

function deriveEndpointFromRecord(rawRecords, parsedRecord) {
  if (parsedRecord && parsedRecord.endpoint) return parsedRecord.endpoint;
  const first = (rawRecords || [])[0] || '';
  const match = /endpoint=([^;\s]+)/i.exec(first);
  return match ? match[1] : null;
}

function summarizeUseCase(wabDoc) {
  const raw = (wabDoc && wabDoc.use_case) ||
    (wabDoc && wabDoc.provider && wabDoc.provider.use_case) ||
    (wabDoc && wabDoc.provider && wabDoc.provider.category) ||
    '';
  if (raw) return String(raw);

  const commands = new Set((wabDoc && wabDoc.capabilities && wabDoc.capabilities.commands) || []);
  if (commands.has('checkout')) return 'checkout';
  if (commands.has('booking')) return 'booking';
  if (commands.has('message') || commands.has('messaging')) return 'messaging';
  if (commands.has('search')) return 'search';
  if (commands.has('read') || commands.has('readContent')) return 'content-reading';
  return 'general-automation';
}

function hostAllowList(domain, endpointHost) {
  const list = [domain, '*.' + domain];
  if (endpointHost && endpointHost !== domain) {
    list.push(endpointHost);
    list.push('*.' + endpointHost);
  }
  return Array.from(new Set(list));
}

function toBooleanState(v) {
  return v ? 'yes' : 'no';
}

function buildProviderRecordTemplate(domain, endpointOverride) {
  const hostFqdn = `_wab.${domain}`;
  let endpoint = endpointOverride;
  if (!endpoint) {
    endpoint = `https://${domain}/.well-known/wab.json`;
  }
  return {
    domain,
    record: {
      host: '_wab',
      host_fqdn: hostFqdn,
      type: 'TXT',
      ttl_recommended: 3600,
      value: `v=wab1; endpoint=${endpoint}`,
    },
    endpoint,
  };
}

function buildProviderEnablePlan(domain, options = {}) {
  const action = options.action === 'disable' ? 'disable' : 'enable';
  const endpointOverride = options.endpointOverride || null;
  const template = buildProviderRecordTemplate(domain, endpointOverride);

  const enableSteps = [
    {
      step: 1,
      title: 'Write DNS TXT record',
      operation: 'dns.write_record',
      payload: template.record,
    },
    {
      step: 2,
      title: 'Verify propagation (poll)',
      operation: 'http.poll',
      endpoint: `/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`,
      until: "status == 'enabled'",
      interval_seconds: 20,
      timeout_seconds: 1200,
    },
    {
      step: 3,
      title: 'Optional deep check',
      operation: 'http.get',
      endpoint: `/api/discovery/test-agent?domain=${encodeURIComponent(domain)}`,
      optional: true,
    }
  ];

  const disableSteps = [
    {
      step: 1,
      title: 'Delete DNS TXT record',
      operation: 'dns.delete_record',
      payload: {
        host: '_wab',
        host_fqdn: `_wab.${domain}`,
        type: 'TXT',
      },
    },
    {
      step: 2,
      title: 'Verify disabled state (poll)',
      operation: 'http.poll',
      endpoint: `/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`,
      until: "status == 'disabled'",
      interval_seconds: 20,
      timeout_seconds: 1200,
    }
  ];

  return {
    domain,
    action,
    protocol: 'wab-dns-discovery-v1',
    objective: action === 'enable'
      ? 'Enable WAB DNS Discovery with one click.'
      : 'Disable WAB DNS Discovery with one click.',
    template,
    verification: {
      status: `/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`,
      verify_live: `/api/discovery/verify-live?domain=${encodeURIComponent(domain)}`,
      test_agent: `/api/discovery/test-agent?domain=${encodeURIComponent(domain)}`,
    },
    rollback: {
      on_enable_failure: 'Delete _wab TXT and mark state as disabled.',
      on_disable_failure: 'Re-check provider DNS write propagation and retry delete.',
    },
    steps: action === 'enable' ? enableSteps : disableSteps,
  };
}

function buildCallbackSignature(payloadText, secret) {
  if (!secret) return null;
  const sig = crypto.createHmac('sha256', secret).update(payloadText).digest('hex');
  return `sha256=${sig}`;
}

async function deliverBatchCallback(callbackUrl, callbackSecret, payload) {
  const body = JSON.stringify(payload);
  const signature = buildCallbackSignature(body, callbackSecret);
  const headers = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-wab-event': 'provider.verify-batch.completed',
    'x-wab-request-id': payload.request_id,
  };
  if (signature) headers['x-wab-signature'] = signature;

  const res = await safeFetch(callbackUrl, {
    method: 'POST',
    headers,
    body,
  }, {
    requireHttps: true,
    timeoutMs: 10000,
    maxBytes: 1024 * 1024,
    allowedContentTypes: ['application/json', 'text/plain', 'text/html'],
  });

  return {
    ok: !!res.ok,
    http_status: res.status,
  };
}

function resolveAbsoluteUrl(origin, pathOrUrl) {
  if (!pathOrUrl) return null;
  try {
    return new URL(pathOrUrl, origin).toString();
  } catch {
    return null;
  }
}

function pickUsageAction(actions, preferredUseCase) {
  const list = Array.isArray(actions) ? actions : [];
  if (!list.length) return null;

  const byUseCase = {
    booking: ['booking', 'reserve', 'book', 'createBooking', 'schedule'],
    messaging: ['message', 'messaging', 'sendMessage', 'contact'],
    payment: ['payment', 'checkout', 'purchase', 'pay'],
    checkout: ['checkout', 'purchase', 'pay', 'order'],
    search: ['search', 'find', 'lookup'],
    'content-reading': ['read', 'readContent', 'extract', 'extractData'],
    'general-automation': ['click', 'navigate', 'scroll', 'readContent']
  };

  const preferred = byUseCase[preferredUseCase] || [];
  for (const keyword of preferred) {
    const hit = list.find((a) => String(a.name || '').toLowerCase().includes(keyword.toLowerCase()));
    if (hit) return hit;
  }

  const safeFallbackOrder = ['search', 'readContent', 'read', 'click', 'scroll', 'navigate', 'fillForms'];
  for (const name of safeFallbackOrder) {
    const hit = list.find((a) => String(a.name || '') === name);
    if (hit) return hit;
  }

  return list[0] || null;
}

function buildActionParams(actionName, useCase) {
  const n = String(actionName || '').toLowerCase();
  const uc = String(useCase || '').toLowerCase();

  if (uc === 'booking' || n.includes('book') || n.includes('reserve')) {
    return {
      check_in: '2026-06-20',
      check_out: '2026-06-22',
      guests: 2,
      city: 'Riyadh'
    };
  }
  if (uc === 'messaging' || n.includes('message') || n.includes('contact')) {
    return {
      channel: 'support',
      message: 'Hello from WAB Usage Proof test.',
      subject: 'Usage proof check'
    };
  }
  if (uc === 'payment' || uc === 'checkout' || n.includes('checkout') || n.includes('pay') || n.includes('purchase')) {
    return {
      amount: 10,
      currency: 'USD',
      reference: 'usage-proof-demo'
    };
  }

  if (n === 'search') return { q: 'sample query' };
  if (n === 'readcontent' || n === 'read') return { selector: 'body' };
  if (n === 'navigate') return { url: '/' };
  if (n === 'scroll') return { amount: 1 };
  if (n === 'fillforms') return { fields: { email: 'usage-proof@wab.test' } };
  if (n === 'click') return { selector: 'button, a' };
  return { sample: true };
}

function storeUsageProofRun(domain, proof) {
  try {
    db.prepare(`
      INSERT INTO discovery_usage_runs (
        domain, mode, preferred_use_case, selected_action,
        readiness_ok, execution_attempted, execution_succeeded,
        value_score, end_to_end_ms, detail
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      domain,
      (proof.intent && proof.intent.mode) || 'readiness',
      (proof.intent && proof.intent.preferred_use_case) || null,
      (proof.usage_proof && proof.usage_proof.selected_action) || null,
      proof.usage_proof && proof.usage_proof.readiness_ok ? 1 : 0,
      proof.usage_proof && proof.usage_proof.execution_attempted ? 1 : 0,
      proof.usage_proof && proof.usage_proof.execution_succeeded ? 1 : 0,
      (proof.kpi && Number(proof.kpi.value_score)) || 0,
      (proof.kpi && Number(proof.kpi.end_to_end_ms)) || null,
      (proof.usage_proof && proof.usage_proof.detail) || null
    );
  } catch (_) {
    // History storage is non-blocking for proof flow.
  }
}

async function parseJsonSafe(res) {
  return res.json().catch(() => ({}));
}

async function buildUsageProof(domain, opts = {}) {
  const apiKey = (opts.apiKey || '').trim();
  const preferredUseCase = (opts.preferredUseCase || '').trim().toLowerCase();
  const startedAt = Date.now();

  const out = {
    wab_version: WAB_VERSION,
    checked_at: new Date().toISOString(),
    domain,
    intent: {
      mode: apiKey ? 'execute' : 'readiness',
      preferred_use_case: preferredUseCase || null,
    },
    kpi: {
      end_to_end_ms: null,
      discovery_ms: null,
      auth_ms: null,
      execution_ms: null,
      discovered_actions_count: 0,
      business_commands_count: 0,
      value_score: 0,
    },
    usage_proof: {
      ok: false,
      readiness_ok: false,
      execution_attempted: false,
      execution_succeeded: false,
      selected_action: null,
      use_case: null,
      detail: null,
      steps: [
        { key: 'verify_core', ok: false, detail: null },
        { key: 'discover_actions', ok: false, detail: null },
        { key: 'authenticate_agent', ok: false, detail: null },
        { key: 'execute_real_action', ok: false, detail: null },
      ],
    },
    baseline: null,
  };

  const discoveryStart = Date.now();
  const baseline = await buildProof(domain, { includeAgentRun: true });
  out.baseline = baseline;
  out.kpi.discovery_ms = Date.now() - discoveryStart;

  const coreOk = !!(baseline && baseline.dns && baseline.dns.ok && baseline.wab_json && baseline.wab_json.ok);
  out.usage_proof.steps[0].ok = coreOk;
  out.usage_proof.steps[0].detail = coreOk ? 'DNS + wab.json verified' : 'core verification failed';
  out.usage_proof.use_case = baseline && baseline.wab_json ? baseline.wab_json.use_case : null;

  if (!coreOk) {
    out.usage_proof.detail = 'usage proof blocked: core verification failed';
    out.kpi.end_to_end_ms = Date.now() - startedAt;
    return out;
  }

  let wabUrl;
  try {
    wabUrl = new URL(baseline.wab_json.url);
  } catch {
    out.usage_proof.detail = 'usage proof blocked: invalid wab.json URL';
    out.kpi.end_to_end_ms = Date.now() - startedAt;
    return out;
  }
  const origin = wabUrl.origin;

  const discoverUrl = origin + '/api/wab/discover';
  const fallbackDiscoverUrl = origin + '/agent-bridge.json';
  let discoverDoc = null;
  try {
    const discoverRes = await safeFetch(discoverUrl, {
      method: 'GET',
      headers: { accept: 'application/json' },
    }, {
      requireHttps: true,
      allowList: hostAllowList(domain, wabUrl.hostname),
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json'],
    });
    const discoverBody = await parseJsonSafe(discoverRes);
    if (discoverRes.ok) {
      discoverDoc = discoverBody && (discoverBody.result || discoverBody);
    } else {
      const fallbackRes = await safeFetch(fallbackDiscoverUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, wabUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 1024 * 1024,
        allowedContentTypes: ['application/json'],
      });
      const fallbackBody = await parseJsonSafe(fallbackRes);
      if (fallbackRes.ok) discoverDoc = fallbackBody && (fallbackBody.result || fallbackBody);
    }
  } catch (_) {
    discoverDoc = null;
  }

  const actionsEndpoint = resolveAbsoluteUrl(origin,
    discoverDoc && discoverDoc.endpoints && discoverDoc.endpoints.actions
      ? discoverDoc.endpoints.actions
      : '/api/wab/actions'
  );

  let actions = [];
  if (actionsEndpoint) {
    try {
      const actionsRes = await safeFetch(actionsEndpoint, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, wabUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 1024 * 1024,
        allowedContentTypes: ['application/json'],
      });
      const actionsBody = await parseJsonSafe(actionsRes);
      if (actionsRes.ok) {
        const payload = actionsBody && (actionsBody.result || actionsBody);
        actions = Array.isArray(payload && payload.actions) ? payload.actions : [];
      }
    } catch (_) {
      actions = [];
    }
  }

  out.kpi.discovered_actions_count = actions.length;
  const commandSet = new Set((baseline.wab_json && baseline.wab_json.commands) || []);
  const discoveredCommandCount = commandSet.size;
  const businessHints = ['booking', 'checkout', 'payment', 'message', 'messaging', 'purchase'];
  out.kpi.business_commands_count = businessHints.filter((k) => commandSet.has(k)).length;

  out.usage_proof.steps[1].ok = actions.length > 0 || discoveredCommandCount > 0;
  out.usage_proof.steps[1].detail = actions.length > 0
    ? `discovered ${actions.length} executable actions`
    : (discoveredCommandCount > 0
      ? `discovered ${discoveredCommandCount} commands in wab.json (actions endpoint not publicly listable)`
      : 'no commands or executable actions discovered');
  out.usage_proof.readiness_ok = out.usage_proof.steps[1].ok;

  const effectiveUseCase = preferredUseCase || out.usage_proof.use_case || 'general-automation';
  const picked = pickUsageAction(actions, effectiveUseCase);
  out.usage_proof.selected_action = picked ? picked.name : null;

  if (!apiKey) {
    out.usage_proof.detail = out.usage_proof.readiness_ok
      ? 'readiness proof complete; provide api_key to run real execution proof'
      : 'readiness is incomplete; provide api_key and verify commands/actions availability';
    out.kpi.value_score = Math.max(0,
      Math.min(100,
        (out.usage_proof.readiness_ok ? 45 : 0) +
        Math.min(out.kpi.discovered_actions_count * 5, 30) +
        Math.min(discoveredCommandCount * 3, 20) +
        Math.min(out.kpi.business_commands_count * 10, 25)
      )
    );
    out.kpi.end_to_end_ms = Date.now() - startedAt;
    return out;
  }

  if (!picked) {
    out.usage_proof.detail = 'execution proof blocked: no action candidate found';
    out.kpi.value_score = 25;
    out.kpi.end_to_end_ms = Date.now() - startedAt;
    return out;
  }

  out.usage_proof.execution_attempted = true;

  const authUrl = origin + '/api/wab/authenticate';
  const authStart = Date.now();
  let token = null;
  try {
    const authRes = await safeFetch(authUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ apiKey, meta: { name: 'usage-proof-lab' } }),
    }, {
      requireHttps: true,
      allowList: hostAllowList(domain, wabUrl.hostname),
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json'],
    });
    const authBody = await parseJsonSafe(authRes);
    const payload = authBody && (authBody.result || authBody);
    if (authRes.ok && payload && payload.token) {
      token = payload.token;
      out.usage_proof.steps[2].ok = true;
      out.usage_proof.steps[2].detail = 'agent authentication succeeded';
    } else {
      out.usage_proof.steps[2].ok = false;
      out.usage_proof.steps[2].detail = `agent authentication failed (HTTP ${authRes.status})`;
    }
  } catch (err) {
    out.usage_proof.steps[2].ok = false;
    out.usage_proof.steps[2].detail = err && err.message ? err.message : 'auth_request_failed';
  }
  out.kpi.auth_ms = Date.now() - authStart;

  if (!token) {
    out.usage_proof.detail = 'execution proof failed at auth step';
    out.kpi.value_score = Math.max(10, out.usage_proof.readiness_ok ? 40 : 10);
    out.kpi.end_to_end_ms = Date.now() - startedAt;
    return out;
  }

  const execUrl = origin + '/api/wab/actions/' + encodeURIComponent(picked.name);
  const execStart = Date.now();
  try {
    const execRes = await safeFetch(execUrl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        id: 'usage-proof',
        params: buildActionParams(picked.name, effectiveUseCase),
      }),
    }, {
      requireHttps: true,
      allowList: hostAllowList(domain, wabUrl.hostname),
      timeoutMs: 10000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json'],
    });
    const execBody = await parseJsonSafe(execRes);
    if (execRes.ok) {
      out.usage_proof.steps[3].ok = true;
      out.usage_proof.steps[3].detail = 'real action executed successfully';
      out.usage_proof.execution_succeeded = true;
      out.usage_proof.detail = 'usage proof complete: real action execution succeeded';
      out.usage_proof.execution_result = execBody && (execBody.result || execBody);
    } else {
      const errCode = execBody && execBody.error && execBody.error.code;
      if (errCode === 'HUMAN_GATE_REQUIRED' || errCode === 'HUMAN_GATE_PENDING' || errCode === 'INTENT_BLOCKED') {
        out.usage_proof.steps[3].ok = true;
        out.usage_proof.steps[3].detail = `execution reached policy gate (${errCode})`;
        out.usage_proof.execution_succeeded = false;
        out.usage_proof.detail = 'execution reached a real policy gate; operational flow is active';
      } else {
        out.usage_proof.steps[3].ok = false;
        out.usage_proof.steps[3].detail = `execution failed (HTTP ${execRes.status})`;
        out.usage_proof.execution_succeeded = false;
        out.usage_proof.detail = 'execution proof failed';
      }
      out.usage_proof.execution_result = execBody;
    }
  } catch (err) {
    out.usage_proof.steps[3].ok = false;
    out.usage_proof.steps[3].detail = err && err.message ? err.message : 'execution_request_failed';
    out.usage_proof.detail = 'execution request failed';
  }
  out.kpi.execution_ms = Date.now() - execStart;

  out.usage_proof.ok = out.usage_proof.steps[0].ok && out.usage_proof.steps[1].ok && out.usage_proof.steps[2].ok && out.usage_proof.steps[3].ok;
  out.kpi.value_score = Math.max(0,
    Math.min(100,
      (out.usage_proof.steps[0].ok ? 20 : 0) +
      (out.usage_proof.steps[1].ok ? 20 : 0) +
      (out.usage_proof.steps[2].ok ? 20 : 0) +
      (out.usage_proof.steps[3].ok ? 30 : 0) +
      Math.min(out.kpi.business_commands_count * 5, 10)
    )
  );
  out.kpi.end_to_end_ms = Date.now() - startedAt;
  return out;
}

async function buildProof(domain, opts = {}) {
  const includeAgentRun = opts.includeAgentRun === true;
  const out = {
    wab_version: WAB_VERSION,
    checked_at: new Date().toISOString(),
    domain,
    three_steps: [
      'Add TXT record at _wab.<domain>',
      'Serve /.well-known/wab.json',
      'Agent discovers and runs a test call',
    ],
    dns: {
      fqdn: `_wab.${domain}`,
      ok: false,
      ad: false,
      records: [],
      parsed: null,
      error: null,
    },
    wab_json: {
      url: null,
      ok: false,
      http_status: null,
      provider: null,
      commands: [],
      use_case: null,
      error: null,
    },
    execution_proof: {
      attempted: includeAgentRun,
      ok: false,
      steps: [
        { key: 'discover_dns', ok: false, detail: null },
        { key: 'fetch_wab_json', ok: false, detail: null },
        { key: 'agent_discover_call', ok: false, detail: null },
        { key: 'agent_ping_call', ok: false, detail: null },
      ],
      result: null,
      error: null,
    },
    statuses: {
      registered: 'no',
      dns_verified: 'no',
      agent_ready: 'no',
      production: 'no',
    },
  };

  // Internal registration is informative only. DNS + wab.json remain sufficient.
  const internalSite = findSiteByDomain(domain);
  if (internalSite) {
    const cfg = parseSiteConfig(internalSite);
    out.statuses.registered = 'yes';
    out.statuses.production = toBooleanState((cfg.environment || 'production') === 'production');
  }

  const proof = await verify(domain, { timeoutMs: 6000 }).catch((err) => ({
    ok: false,
    records: [{
      type: '_wab',
      ad: false,
      raw: [],
      parsed: null,
      error: err && err.message ? err.message : 'verify_failed',
      code: err && err.code,
    }],
  }));

  const wabRecord = (proof.records || []).find((r) => r.type === '_wab') || {};
  out.dns.ok = !!wabRecord.ok;
  out.dns.ad = !!wabRecord.ad;
  out.dns.records = wabRecord.raw || [];
  out.dns.parsed = wabRecord.parsed || null;
  out.dns.error = wabRecord.error || null;
  out.execution_proof.steps[0].ok = out.dns.ok;
  out.execution_proof.steps[0].detail = out.dns.ok ? 'valid _wab TXT record' : (out.dns.error || 'missing _wab record');
  out.statuses.dns_verified = toBooleanState(out.dns.ok);

  const endpoint = deriveEndpointFromRecord(out.dns.records, out.dns.parsed);
  out.wab_json.url = endpoint;

  if (!endpoint) {
    out.wab_json.error = 'endpoint missing in _wab record';
    out.execution_proof.error = out.wab_json.error;
    return out;
  }

  let endpointUrl;
  try {
    endpointUrl = new URL(endpoint);
  } catch {
    out.wab_json.error = 'invalid endpoint URL';
    out.execution_proof.error = out.wab_json.error;
    return out;
  }

  try {
    const wabRes = await safeFetch(endpointUrl.toString(), {
      method: 'GET',
      headers: { accept: 'application/json' },
    }, {
      requireHttps: true,
      allowList: hostAllowList(domain, endpointUrl.hostname),
      timeoutMs: 8000,
      maxBytes: 1024 * 1024,
      allowedContentTypes: ['application/json', 'application/ld+json', 'text/plain'],
    });
    out.wab_json.http_status = wabRes.status;
    const doc = await wabRes.json();
    out.wab_json.ok = wabRes.ok && doc && typeof doc === 'object';
    out.wab_json.provider = doc && doc.provider ? {
      name: doc.provider.name || null,
      domain: doc.provider.domain || null,
      category: doc.provider.category || null,
    } : null;
    out.wab_json.commands = (doc && doc.capabilities && doc.capabilities.commands) || [];
    out.wab_json.use_case = summarizeUseCase(doc);
    out.execution_proof.steps[1].ok = out.wab_json.ok;
    out.execution_proof.steps[1].detail = out.wab_json.ok ? 'wab.json fetched and parsed' : 'wab.json invalid';
    out.statuses.agent_ready = toBooleanState(out.wab_json.ok && out.wab_json.commands.length > 0);

    if (!includeAgentRun) return out;

    const endpointOrigin = endpointUrl.origin;
    const discoverUrl = endpointOrigin + '/api/wab/discover';
    const fallbackDiscoverUrl = endpointOrigin + '/agent-bridge.json';
    const pingUrl = endpointOrigin + '/api/wab/ping';

    try {
      const discoverRes = await safeFetch(discoverUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, endpointUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 1024 * 1024,
        allowedContentTypes: ['application/json'],
      });
      let discoverBody = await discoverRes.json().catch(() => ({}));
      if (discoverRes.ok) {
        out.execution_proof.steps[2].ok = true;
        out.execution_proof.steps[2].detail = 'GET /api/wab/discover succeeded';
      } else {
        // Fallback: some sites expose discovery via agent-bridge.json only.
        const fallbackRes = await safeFetch(fallbackDiscoverUrl, {
          method: 'GET',
          headers: { accept: 'application/json' },
        }, {
          requireHttps: true,
          allowList: hostAllowList(domain, endpointUrl.hostname),
          timeoutMs: 8000,
          maxBytes: 1024 * 1024,
          allowedContentTypes: ['application/json'],
        });
        const fallbackBody = await fallbackRes.json().catch(() => ({}));
        if (fallbackRes.ok) {
          out.execution_proof.steps[2].ok = true;
          out.execution_proof.steps[2].detail =
            `GET /api/wab/discover returned HTTP ${discoverRes.status}; fallback /agent-bridge.json succeeded`;
          discoverBody = fallbackBody;
        } else {
          out.execution_proof.steps[2].ok = false;
          out.execution_proof.steps[2].detail =
            `discover HTTP ${discoverRes.status}; fallback /agent-bridge.json HTTP ${fallbackRes.status}`;
        }
      }

      const pingRes = await safeFetch(pingUrl, {
        method: 'GET',
        headers: { accept: 'application/json' },
      }, {
        requireHttps: true,
        allowList: hostAllowList(domain, endpointUrl.hostname),
        timeoutMs: 8000,
        maxBytes: 512 * 1024,
        allowedContentTypes: ['application/json'],
      });
      const pingBody = await pingRes.json().catch(() => ({}));
      out.execution_proof.steps[3].ok = !!pingRes.ok;
      out.execution_proof.steps[3].detail = pingRes.ok ? 'GET /api/wab/ping succeeded' : ('HTTP ' + pingRes.status);
      // `agent_discover_call` can fail on sites that expose discovery only via
      // wab.json but not /api/wab/discover. Treat it as best-effort so the
      // core proof remains: DNS -> wab.json -> agent call result.
      out.execution_proof.ok =
        out.execution_proof.steps[0].ok &&
        out.execution_proof.steps[1].ok &&
        out.execution_proof.steps[3].ok;
      out.execution_proof.result = {
        discovered: discoverBody && (discoverBody.result || discoverBody),
        ping: pingBody && (pingBody.result || pingBody),
      };
    } catch (err) {
      out.execution_proof.error = err && err.message ? err.message : 'agent_test_failed';
    }
  } catch (err) {
    out.wab_json.error = err && err.message ? err.message : 'wab_fetch_failed';
    out.execution_proof.error = out.wab_json.error;
  }

  return out;
}

function buildDiscoveryDocument(site) {
  const config = parseSiteConfig(site);
  const perms = config.agentPermissions || {};
  const restrictions = config.restrictions || {};
  const features = config.features || {};

  const enabledActions = Object.entries(perms)
    .filter(([, v]) => v)
    .map(([k]) => k);

  const featureList = ['auto_discovery', 'noscript_fallback'];
  if (features.advancedAnalytics) featureList.push('advanced_analytics');
  if (features.realTimeUpdates) featureList.push('real_time_updates');
  if (perms.apiAccess) featureList.push('api_access');

  const dirEntry = db.prepare('SELECT * FROM wab_directory WHERE site_id = ?').get(site.id);
  const neutralityScore = calculateNeutralityScore(site);

  return {
    wab_version: WAB_VERSION,
    generated_at: new Date().toISOString(),
    provider: {
      name: site.name,
      domain: site.domain,
      category: (dirEntry && dirEntry.category) || config.category || 'general',
      description: site.description || ''
    },
    capabilities: {
      commands: enabledActions,
      permissions: perms,
      tier: site.tier,
      transport: ['js_global', 'http', 'websocket'],
      features: featureList
    },
    agent_access: {
      bridge_script: '/script/ai-agent-bridge.js',
      api_base: '/api/wab',
      websocket: '/ws/analytics',
      noscript: `/api/noscript/bridge/${site.id}`,
      discovery: `/api/discovery/${site.id}`
    },
    fairness: {
      is_independent: dirEntry ? !!dirEntry.is_independent : false,
      commission_rate: dirEntry ? dirEntry.commission_rate : 0,
      direct_benefit: dirEntry ? (dirEntry.direct_benefit || '') : '',
      neutrality_score: neutralityScore
    },
    security: {
      session_required: true,
      origin_validation: true,
      rate_limit: (restrictions.rateLimit && restrictions.rateLimit.maxCallsPerMinute) || 60,
      sandbox: true
    },
    endpoints: {
      authenticate: '/api/wab/authenticate',
      discover: `/api/wab/discover?siteId=${site.id}`,
      actions: `/api/wab/actions?siteId=${site.id}`,
      execute: '/api/wab/actions/{actionName}',
      read: '/api/wab/read',
      page_info: `/api/wab/page-info?siteId=${site.id}`,
      search: '/api/wab/search',
      ping: '/api/wab/ping',
      token_exchange: '/api/license/token',
      bridge_page: `/api/noscript/bridge/${site.id}`
    }
  };
}

// ═════════════════════════════════════════════════════════════════════
// 1. GET /.well-known/wab.json — Standard discovery location
// ═════════════════════════════════════════════════════════════════════

function buildSelfDiscovery() {
  return {
    wab_version: WAB_VERSION,
    protocol: '1.0',
    generated_at: new Date().toISOString(),
    provider: {
      name: 'Web Agent Bridge',
      domain: 'webagentbridge.com',
      category: 'developer-tools',
      description: 'Open protocol and runtime for AI agent ↔ website interaction. The OpenAPI for human-facing web pages.'
    },
    capabilities: {
      commands: ['read', 'navigate', 'search', 'discover'],
      permissions: { readContent: true, navigate: true, apiAccess: true },
      tier: 'platform',
      transport: ['http', 'javascript', 'websocket'],
      features: [
        'discovery_protocol', 'fairness_engine', 'mcp_adapter',
        'noscript_fallback', 'agent_sdk', 'wordpress_plugin',
        'openapi_spec', 'llms_txt', 'atom_feed'
      ]
    },
    agent_access: {
      bridge_script: '/script/ai-agent-bridge.js',
      api_base: '/api/wab',
      websocket: '/ws/analytics',
      discovery: '/agent-bridge.json',
      llms_txt: '/llms.txt',
      llms_full_txt: '/llms-full.txt',
      openapi: '/openapi.json',
      ai_assets: '/.well-known/ai-assets.json',
      atom_feed: '/feed.xml',
      sitemap: '/sitemap.xml'
    },
    fairness: {
      is_independent: true,
      commission_rate: 0,
      direct_benefit: 'Open-source protocol maintainer',
      neutrality_score: 100
    },
    security: {
      session_required: false,
      origin_validation: true,
      rate_limit: 60,
      sandbox: true
    },
    endpoints: {
      discover: '/api/wab/discover',
      actions: '/api/wab/actions',
      execute: '/api/wab/execute',
      ping: '/api/wab/ping',
      search: '/api/wab/search',
      registry: '/api/discovery/registry',
      plans: '/api/plans',
      page_info: '/api/wab/page-info'
    },
    ecosystem: {
      npm: 'https://www.npmjs.com/package/web-agent-bridge',
      github: 'https://github.com/abokenan444/web-agent-bridge',
      security: 'https://socket.dev/npm/package/web-agent-bridge',
      mcp_adapter: 'https://www.npmjs.com/package/wab-mcp-adapter',
      wordpress: 'https://github.com/abokenan444/web-agent-bridge/tree/master/web-agent-bridge-wordpress',
      specification: 'https://github.com/abokenan444/web-agent-bridge/blob/master/docs/SPEC.md'
    }
  };
}

router.get('/.well-known/wab.json', (req, res) => {
  try {
    const domain = getRequestDomain(req);
    const site = findSiteByDomain(domain);

    if (!site) {
      if (domain === 'webagentbridge.com' || domain === 'www.webagentbridge.com' || domain === 'localhost') {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-WAB-Version', WAB_VERSION);
        return res.json(buildSelfDiscovery());
      }
      return res.status(404).json({
        error: 'No WAB-enabled site found for this domain',
        domain,
        hint: 'Register your site at /dashboard to enable WAB discovery'
      });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 2. GET /agent-bridge.json — Alternative discovery location
// ═════════════════════════════════════════════════════════════════════

router.get('/agent-bridge.json', (req, res) => {
  try {
    const domain = getRequestDomain(req);
    const site = findSiteByDomain(domain);

    if (!site) {
      if (domain === 'webagentbridge.com' || domain === 'www.webagentbridge.com' || domain === 'localhost') {
        res.set('Cache-Control', 'public, max-age=300');
        res.set('X-WAB-Version', WAB_VERSION);
        return res.json(buildSelfDiscovery());
      }
      return res.status(404).json({
        error: 'No WAB-enabled site found for this domain',
        domain,
        hint: 'Register your site at /dashboard to enable WAB discovery'
      });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 3. GET /api/discovery/registry — Public registry with fairness scoring
//    (defined BEFORE :siteId to avoid route shadowing)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/registry', (req, res) => {
  try {
    const category = req.query.category || 'all';
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;

    const listings = getDirectoryListings(category, { limit, offset });

    const registry = listings.map(entry => ({
      siteId: entry.id,
      name: entry.name,
      domain: entry.domain,
      description: entry.description || '',
      category: entry.category || 'general',
      tier: entry.tier,
      neutrality_score: entry.neutrality_score || 0,
      is_independent: !!entry.is_independent,
      tags: safeParseTags(entry.tags),
      discovery_url: `/api/discovery/${entry.id}`
    }));

    res.json({
      wab_version: WAB_VERSION,
      total: registry.length,
      category,
      listings: registry
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch registry' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 4. POST /api/discovery/register — Register site in WAB directory
// ═════════════════════════════════════════════════════════════════════

router.post('/api/discovery/register', authenticateToken, (req, res) => {
  try {
    const { siteId, category, tags, is_independent, commission_rate, direct_benefit, trust_signature } = req.body;

    if (!siteId) {
      return res.status(400).json({ error: 'siteId is required' });
    }

    const site = findSiteById.get(siteId);
    if (!site) {
      return res.status(404).json({ error: 'Site not found' });
    }
    if (site.user_id !== req.user.id) {
      return res.status(403).json({ error: 'You do not own this site' });
    }

    const result = registerInDirectory(siteId, {
      category,
      tags,
      is_independent,
      commission_rate,
      direct_benefit,
      trust_signature
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const report = generateFairnessReport(siteId);

    res.status(201).json({
      success: true,
      registration: result,
      fairness_report: report
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to register site' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 5. GET /api/discovery/search — Search WAB sites (fairness-weighted)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/search', (req, res) => {
  try {
    const query = req.query.q || '';
    const category = req.query.category || null;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let sql = `
      SELECT s.*, d.category, d.tags, d.is_independent, d.commission_rate,
             d.direct_benefit, d.neutrality_score, d.trust_signature
      FROM wab_directory d
      JOIN sites s ON d.site_id = s.id AND s.active = 1
      WHERE d.listed = 1
    `;
    const params = [];

    if (category) {
      sql += ' AND d.category = ?';
      params.push(category);
    }

    sql += ' ORDER BY d.neutrality_score DESC LIMIT ?';
    params.push(limit * 3);

    const candidates = db.prepare(sql).all(...params);
    const results = fairnessWeightedSearch(query, candidates).slice(0, limit);

    res.json({
      wab_version: WAB_VERSION,
      query,
      total: results.length,
      results: results.map(r => ({
        siteId: r.id,
        name: r.name,
        domain: r.domain,
        description: r.description || '',
        category: r.category || 'general',
        tier: r.tier,
        neutrality_score: r._neutralityScore,
        is_independent: r._isIndependent,
        relevance_score: r._relevance,
        fairness_boost: r._fairnessBoost,
        final_score: r._finalScore,
        tags: safeParseTags(r.tags),
        discovery_url: `/api/discovery/${r.id}`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'Search failed' });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 6. GET /api/discovery/verify-live?domain=example.com
//    Verifiable proof: DNS TXT + wab.json + explicit status model.
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/verify-live', async (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/verify-live?domain=example.com',
    });
  }
  try {
    const proof = await buildProof(domain, { includeAgentRun: false });
    return res.json(proof);
  } catch (err) {
    return res.status(500).json({ error: 'verify_live_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 7. GET /api/discovery/test-agent?domain=example.com
//    Execution proof: discover → ping (official consumer path).
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/test-agent', async (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/test-agent?domain=example.com',
    });
  }
  try {
    const proof = await buildProof(domain, { includeAgentRun: true });
    if (!proof.execution_proof.ok) {
      return res.status(200).json({
        ...proof,
        warning: 'agent flow did not fully pass; inspect execution_proof.steps',
      });
    }
    return res.json(proof);
  } catch (err) {
    return res.status(500).json({ error: 'agent_test_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 8. GET /api/discovery/provider/manifest
//    Provider-facing protocol contract for one-click DNS toggles.
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/provider/manifest', (_req, res) => {
  return res.json({
    wab_version: WAB_VERSION,
    protocol: 'wab-dns-discovery-v1',
    txt_record: {
      host: '_wab',
      type: 'TXT',
      format: 'v=wab1; endpoint=https://<domain>/.well-known/wab.json',
      required_keys: ['v', 'endpoint'],
      constraints: {
        endpoint_scheme: 'https',
        endpoint_path_recommended: '/.well-known/wab.json',
      }
    },
    toggle_flow: {
      enable: [
        'Create TXT _wab.<domain>',
        'Verify DNS + endpoint',
        'Show DNS verified / Agent-ready status'
      ],
      disable: [
        'Delete TXT _wab.<domain>',
        'Verify disabled state',
        'Show disabled status'
      ]
    },
    verification_endpoints: {
      verify_live: '/api/discovery/verify-live?domain=<domain>',
      test_agent: '/api/discovery/test-agent?domain=<domain>',
      provider_status: '/api/discovery/provider/status?domain=<domain>',
      provider_verify_batch: '/api/discovery/provider/verify-batch',
      provider_record_template: '/api/discovery/provider/record-template?domain=<domain>'
    },
    callback_contract: {
      event: 'provider.verify-batch.completed',
      header_request_id: 'x-wab-request-id',
      header_signature: 'x-wab-signature (optional, sha256 HMAC when callback_secret is provided)',
    },
    examples: {
      txt_value: 'v=wab1; endpoint=https://example.com/.well-known/wab.json',
      status_call: '/api/discovery/provider/status?domain=example.com',
      template_call: '/api/discovery/provider/record-template?domain=example.com',
      batch_body: {
        domains: ['example.com', 'shop.example.com'],
        include_agent_run: false,
        callback_url: 'https://provider.example/webhooks/wab-discovery',
        callback_secret: 'optional-shared-secret'
      }
    }
  });
});

router.get('/api/discovery/provider/record-template', (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  const endpointOverride = String(req.query.endpoint || '').trim();
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/provider/record-template?domain=example.com',
    });
  }

  if (endpointOverride) {
    let parsed;
    try {
      parsed = new URL(endpointOverride);
    } catch {
      return res.status(400).json({ error: 'invalid endpoint URL' });
    }
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'endpoint must use https' });
    }
  }

  const template = buildProviderRecordTemplate(domain, endpointOverride || null);
  return res.json({
    wab_version: WAB_VERSION,
    protocol: 'wab-dns-discovery-v1',
    ...template,
    verify_urls: {
      provider_status: `/api/discovery/provider/status?domain=${encodeURIComponent(domain)}`,
      verify_live: `/api/discovery/verify-live?domain=${encodeURIComponent(domain)}`,
      test_agent: `/api/discovery/test-agent?domain=${encodeURIComponent(domain)}`,
    }
  });
});

router.get('/api/discovery/provider/enable-plan', (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  const action = String(req.query.action || 'enable').toLowerCase();
  const endpointOverride = String(req.query.endpoint || '').trim();

  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/provider/enable-plan?domain=example.com&action=enable',
    });
  }
  if (action !== 'enable' && action !== 'disable') {
    return res.status(400).json({ error: 'action must be enable or disable' });
  }
  if (endpointOverride) {
    let parsed;
    try {
      parsed = new URL(endpointOverride);
    } catch {
      return res.status(400).json({ error: 'invalid endpoint URL' });
    }
    if (parsed.protocol !== 'https:') {
      return res.status(400).json({ error: 'endpoint must use https' });
    }
  }

  const plan = buildProviderEnablePlan(domain, {
    action,
    endpointOverride: endpointOverride || null,
  });

  return res.json({
    wab_version: WAB_VERSION,
    request: {
      domain,
      action,
    },
    plan,
  });
});

// ═════════════════════════════════════════════════════════════════════
// 9. GET /api/discovery/provider/status?domain=example.com
//    Machine-friendly status for registrar/provider toggles.
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/provider/status', async (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use /api/discovery/provider/status?domain=example.com'
    });
  }

  try {
    const proof = await buildProof(domain, { includeAgentRun: false });
    const dnsVerified = !!(proof.dns && proof.dns.ok);
    const endpointReady = !!(proof.wab_json && proof.wab_json.ok);
    const status = dnsVerified && endpointReady ? 'enabled' : (dnsVerified ? 'partial' : 'disabled');

    return res.json({
      wab_version: WAB_VERSION,
      domain,
      status,
      flags: {
        dns_verified: dnsVerified,
        endpoint_ready: endpointReady,
        agent_ready: proof.statuses && proof.statuses.agent_ready === 'yes'
      },
      diagnostics: {
        dns_error: proof.dns && proof.dns.error,
        endpoint_error: proof.wab_json && proof.wab_json.error
      },
      checked_at: proof.checked_at
    });
  } catch (err) {
    return res.status(500).json({ error: 'provider_status_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 10. POST /api/discovery/provider/verify-batch
//     Batch verification for DNS providers and registrars.
// ═════════════════════════════════════════════════════════════════════

router.post('/api/discovery/provider/verify-batch', async (req, res) => {
  const domainsRaw = Array.isArray(req.body && req.body.domains) ? req.body.domains : [];
  const includeAgentRun = !!(req.body && req.body.include_agent_run);
  const callbackUrl = String((req.body && req.body.callback_url) || '').trim();
  const callbackSecret = String((req.body && req.body.callback_secret) || '').trim();
  const domains = domainsRaw.map((d) => sanitizeDomain(d)).filter(Boolean);
  const requestId = `pvb_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

  if (!domains.length) {
    return res.status(400).json({
      error: 'domains[] is required',
      hint: 'Use {"domains":["example.com"],"include_agent_run":false}'
    });
  }
  if (domains.length > 50) {
    return res.status(400).json({ error: 'max 50 domains per request' });
  }

  try {
    const results = [];
    for (const domain of domains) {
      try {
        const proof = await buildProof(domain, { includeAgentRun });
        const dnsVerified = !!(proof.dns && proof.dns.ok);
        const endpointReady = !!(proof.wab_json && proof.wab_json.ok);
        const status = dnsVerified && endpointReady ? 'enabled' : (dnsVerified ? 'partial' : 'disabled');
        results.push({
          domain,
          status,
          dns_verified: dnsVerified,
          endpoint_ready: endpointReady,
          agent_ready: proof.statuses && proof.statuses.agent_ready === 'yes',
          checked_at: proof.checked_at,
          dns_error: proof.dns && proof.dns.error,
          endpoint_error: proof.wab_json && proof.wab_json.error,
        });
      } catch (err) {
        results.push({
          domain,
          status: 'error',
          dns_verified: false,
          endpoint_ready: false,
          agent_ready: false,
          error: err && err.message ? err.message : 'verify_failed',
        });
      }
    }

    const summary = {
      total: results.length,
      enabled: results.filter((r) => r.status === 'enabled').length,
      partial: results.filter((r) => r.status === 'partial').length,
      disabled: results.filter((r) => r.status === 'disabled').length,
      error: results.filter((r) => r.status === 'error').length,
    };

    const payload = {
      wab_version: WAB_VERSION,
      request_id: requestId,
      include_agent_run: includeAgentRun,
      summary,
      results,
    };

    let callback = null;
    if (callbackUrl) {
      try {
        const delivered = await deliverBatchCallback(callbackUrl, callbackSecret || null, payload);
        callback = {
          attempted: true,
          delivered: delivered.ok,
          http_status: delivered.http_status,
          url: callbackUrl,
        };
      } catch (err) {
        callback = {
          attempted: true,
          delivered: false,
          error: err && err.message ? err.message : 'callback_failed',
          url: callbackUrl,
        };
      }
    }

    return res.json({
      ...payload,
      callback,
    });
  } catch (err) {
    return res.status(500).json({ error: 'provider_verify_batch_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 8. POST /api/discovery/usage-proof
//    Real execution proof + KPIs (readiness if no api_key is supplied).
// ═════════════════════════════════════════════════════════════════════

router.post('/api/discovery/usage-proof', async (req, res) => {
  const domain = sanitizeDomain((req.body && req.body.domain) || req.query.domain || '');
  if (!domain) {
    return res.status(400).json({
      error: 'domain is required',
      hint: 'Use POST /api/discovery/usage-proof with {"domain":"example.com"}',
    });
  }

  const apiKey = (req.body && req.body.api_key) || '';
  const preferredUseCase = (req.body && req.body.preferred_use_case) || '';

  try {
    const proof = await buildUsageProof(domain, { apiKey, preferredUseCase });
    storeUsageProofRun(domain, proof);
    return res.json(proof);
  } catch (err) {
    return res.status(500).json({ error: 'usage_proof_failed', details: err.message });
  }
});

router.get('/api/discovery/usage-proof-runs', (req, res) => {
  const domain = sanitizeDomain(req.query.domain || '');
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

  try {
    const rows = domain
      ? db.prepare(`
          SELECT domain, mode, preferred_use_case, selected_action, readiness_ok,
                 execution_attempted, execution_succeeded, value_score, end_to_end_ms,
                 detail, created_at
          FROM discovery_usage_runs
          WHERE domain = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(domain, limit)
      : db.prepare(`
          SELECT domain, mode, preferred_use_case, selected_action, readiness_ok,
                 execution_attempted, execution_succeeded, value_score, end_to_end_ms,
                 detail, created_at
          FROM discovery_usage_runs
          ORDER BY id DESC
          LIMIT ?
        `).all(limit);

    return res.json({
      wab_version: WAB_VERSION,
      domain: domain || null,
      total: rows.length,
      runs: rows.map((r) => ({
        domain: r.domain,
        mode: r.mode,
        preferred_use_case: r.preferred_use_case,
        selected_action: r.selected_action,
        readiness_ok: !!r.readiness_ok,
        execution_attempted: !!r.execution_attempted,
        execution_succeeded: !!r.execution_succeeded,
        value_score: Number(r.value_score || 0),
        end_to_end_ms: r.end_to_end_ms,
        detail: r.detail,
        created_at: r.created_at,
      }))
    });
  } catch (err) {
    return res.status(500).json({ error: 'usage_proof_runs_failed', details: err.message });
  }
});

// ═════════════════════════════════════════════════════════════════════
// 11. GET /api/discovery/:siteId — Discovery doc for a specific site
//    (defined AFTER named routes to prevent shadowing)
// ═════════════════════════════════════════════════════════════════════

router.get('/api/discovery/:siteId', (req, res) => {
  try {
    const site = findSiteById.get(req.params.siteId);
    if (!site || !site.active) {
      return res.status(404).json({ error: 'Site not found' });
    }

    const doc = buildDiscoveryDocument(site);
    res.set('Cache-Control', 'public, max-age=300');
    res.set('X-WAB-Version', WAB_VERSION);
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate discovery document' });
  }
});

// ─── Utility ─────────────────────────────────────────────────────────

function safeParseTags(tags) {
  if (Array.isArray(tags)) return tags;
  try { return JSON.parse(tags || '[]'); } catch (_) { return []; }
}

module.exports = router;
module.exports._internals = {
  sanitizeDomain,
  deriveEndpointFromRecord,
  summarizeUseCase,
  hostAllowList,
  pickUsageAction,
  resolveAbsoluteUrl,
  buildActionParams,
};
