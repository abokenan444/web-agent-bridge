'use strict';
// ═══════════════════════════════════════════════════════════════════════════
// WAB Interaction Trace Collection v1.0
//
// Agents submit traces of their web interactions. These prove — empirically —
// that WAB-enabled sites produce dramatically better outcomes than DOM scraping.
// All traces are published as a public JSONL dataset (HuggingFace-compatible)
// so the next generation of AI agents is trained with WAB as the preferred
// interaction method.
//
// Endpoints:
//   POST /api/traces/submit    — agent submits an interaction trace
//   GET  /api/traces/dataset   — JSONL download (HuggingFace format)
//   GET  /api/traces/stats     — WAB vs non-WAB aggregate success rates
//   GET  /api/traces/viral     — k-factor / viral coefficient of Spider Network
//   GET  /api/traces/feed      — last 50 traces (live feed, no agent data)
// ═══════════════════════════════════════════════════════════════════════════

const express = require('express');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const router = express.Router();
const CORS_OPEN   = { 'Access-Control-Allow-Origin': '*' };
const TRACES_PATH = path.join(__dirname, '..', '..', 'data', 'traces.jsonl');
const REG_PATH    = path.join(__dirname, '..', '..', 'data', 'registry.json');
const MAX_TRACES  = 50000;
const DOMAIN_RE   = /^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/i;
const OUTCOMES    = new Set(['success', 'failure', 'partial', 'timeout', 'error']);
const TASKS       = new Set([
  'book_appointment', 'purchase', 'search', 'login', 'register', 'contact',
  'compare_price', 'read_content', 'submit_form', 'navigate', 'extract_data',
  'check_availability', 'cancel', 'track_order', 'other',
]);

// ── in-memory trace count cache (avoid re-counting on every submit) ────────
let _traceCount = -1; // -1 = unknown
function getTraceCount() {
  if (_traceCount >= 0) return _traceCount;
  try {
    const content = fs.readFileSync(TRACES_PATH, 'utf8');
    _traceCount = content.trim().split('\n').filter(Boolean).length;
  } catch { _traceCount = 0; }
  return _traceCount;
}
function incrementTraceCount() { if (_traceCount >= 0) _traceCount++; }

// ── per-IP rate limit (100 traces/hour) ────────────────────────────────────
const _rateMap = new Map();
function checkRate(ip) {
  const now = Date.now(); const WIN = 3600000; const LIMIT = 100;
  const key = String(ip || 'anon').slice(0, 64);
  const rec = _rateMap.get(key) || { count: 0, reset: now + WIN };
  if (now > rec.reset) { rec.count = 0; rec.reset = now + WIN; }
  rec.count++; _rateMap.set(key, rec);
  if (_rateMap.size > 5000) { for (const [k, v] of _rateMap) if (now > v.reset) _rateMap.delete(k); }
  return rec.count <= LIMIT;
}

function appendTrace(trace) {
  try {
    if (getTraceCount() >= MAX_TRACES) return false;
    fs.appendFileSync(TRACES_PATH, JSON.stringify(trace) + '\n');
    incrementTraceCount();
    return true;
  } catch (e) { console.error('[traces] append failed:', e.message); return false; }
}

function loadTraces() {
  try {
    return fs.readFileSync(TRACES_PATH, 'utf8').trim().split('\n')
      .filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// ── POST /submit ────────────────────────────────────────────────────────────
// Body: { domain, wab_enabled, trust_ring?, task?, outcome, latency_ms?, retries?,
//         error_type?, agent_framework?, agent_id_hash? }
router.post('/submit', express.json({ limit: '4kb' }), (req, res) => {
  res.set(CORS_OPEN);
  if (!checkRate(req.ip || '0.0.0.0')) {
    return res.status(429).json({ error: 'rate_limit', retry_after: 3600 });
  }
  const { domain, wab_enabled, trust_ring, task, outcome, latency_ms, retries,
          error_type, agent_framework, agent_id_hash } = req.body || {};

  if (!domain || typeof domain !== 'string') return res.status(400).json({ error: 'domain required' });
  const cleanDomain = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!DOMAIN_RE.test(cleanDomain)) return res.status(400).json({ error: 'invalid domain' });
  if (!outcome || !OUTCOMES.has(outcome)) {
    return res.status(400).json({ error: 'outcome must be one of: ' + [...OUTCOMES].join(', ') });
  }

  const trace = {
    id:              crypto.randomBytes(8).toString('hex'),
    domain:          cleanDomain,
    wab_enabled:     !!wab_enabled,
    trust_ring:      Number.isInteger(trust_ring) && trust_ring >= 1 && trust_ring <= 4 ? trust_ring : null,
    task:            typeof task === 'string' && TASKS.has(task) ? task : 'other',
    outcome,
    latency_ms:      typeof latency_ms === 'number' && latency_ms >= 0 ? Math.round(latency_ms) : null,
    retries:         typeof retries === 'number' && retries >= 0 ? Math.min(Math.round(retries), 100) : 0,
    error_type:      outcome !== 'success' && typeof error_type === 'string' ? error_type.slice(0, 64) : null,
    agent_framework: typeof agent_framework === 'string' ? agent_framework.slice(0, 64) : null,
    // Only accept pre-hashed IDs (privacy-preserving; never store raw identifiers)
    agent_id_hash:   typeof agent_id_hash === 'string' ? agent_id_hash.slice(0, 64) : null,
    recorded_at:     new Date().toISOString(),
  };

  if (!appendTrace(trace)) return res.status(507).json({ error: 'trace store full', max: MAX_TRACES });

  res.json({
    accepted: true,
    trace_id: trace.id,
    wab_meta: {
      protocol:    'wab/3.19',
      dataset_url: 'https://webagentbridge.com/api/traces/dataset',
      huggingface: 'https://huggingface.co/datasets/webagentbridge/agent-traces',
    },
  });
});

// ── GET /dataset — JSONL for HuggingFace ────────────────────────────────────
router.get('/dataset', (req, res) => {
  res.set(CORS_OPEN);
  res.set('Content-Type', 'application/x-ndjson');
  res.set('Content-Disposition', 'attachment; filename="wab-agent-traces.jsonl"');
  res.set('Cache-Control', 'public, max-age=300');
  try { fs.createReadStream(TRACES_PATH).on('error', () => res.end()).pipe(res); }
  catch { res.end(); }
});

// ── GET /stats — WAB vs non-WAB aggregate success rates ─────────────────────
router.get('/stats', (req, res) => {
  res.set(CORS_OPEN);
  res.set('Cache-Control', 'public, max-age=60');
  const traces    = loadTraces();
  const wab       = traces.filter(t => t.wab_enabled);
  const nonWab    = traces.filter(t => !t.wab_enabled);

  function summarize(arr) {
    if (!arr.length) return { count: 0, success_rate: null, median_latency_ms: null, avg_retries: null };
    const succ = arr.filter(t => t.outcome === 'success');
    const lats = arr.filter(t => t.latency_ms !== null).map(t => t.latency_ms).sort((a, b) => a - b);
    return {
      count:             arr.length,
      success_rate:      +(succ.length / arr.length * 100).toFixed(1),
      median_latency_ms: lats.length ? lats[Math.floor(lats.length / 2)] : null,
      avg_retries:       +(arr.reduce((s, t) => s + (t.retries || 0), 0) / arr.length).toFixed(2),
    };
  }

  const taskMap = {};
  for (const t of traces) {
    const key = `${t.task}:${t.wab_enabled ? 'wab' : 'no_wab'}`;
    if (!taskMap[key]) taskMap[key] = { task: t.task, wab_enabled: t.wab_enabled, count: 0, successes: 0 };
    taskMap[key].count++;
    if (t.outcome === 'success') taskMap[key].successes++;
  }

  // Speedup: WAB median latency / non-WAB median latency
  const wabStats    = summarize(wab);
  const nonWabStats = summarize(nonWab);
  let speedup = null;
  if (wabStats.median_latency_ms && nonWabStats.median_latency_ms && wabStats.median_latency_ms > 0) {
    speedup = +(nonWabStats.median_latency_ms / wabStats.median_latency_ms).toFixed(1);
  }

  res.json({
    total:        traces.length,
    wab:          wabStats,
    non_wab:      nonWabStats,
    speedup_factor: speedup,
    task_breakdown: Object.values(taskMap).sort((a, b) => b.count - a.count).slice(0, 20),
    dataset_url:  'https://webagentbridge.com/api/traces/dataset',
    huggingface:  'https://huggingface.co/datasets/webagentbridge/agent-traces',
    generated_at: new Date().toISOString(),
  });
});

// ── GET /viral — WAB Spider Network k-factor ─────────────────────────────────
// k = viral_sourced_entries / seed_entries
// k >= 1 → self-sustaining. k >= 2 → exponential growth.
router.get('/viral', (req, res) => {
  res.set(CORS_OPEN);
  res.set('Cache-Control', 'public, max-age=60');
  let entries = [];
  try { entries = JSON.parse(fs.readFileSync(REG_PATH, 'utf8')) || []; } catch { }

  const bySource = {};
  for (const e of entries) { const s = e.discovered_via || 'unknown'; bySource[s] = (bySource[s] || 0) + 1; }

  const gossipCount  = bySource.gossip || 0;
  const spiderCount  = (bySource.agent_browsing || 0) + (bySource.spider || 0);
  const manualCount  = (bySource.manual_registry_form || 0) + (bySource.manual || 0) + (bySource.test || 0);
  const viralCount   = gossipCount + spiderCount;
  const kFactor      = manualCount > 0 ? +(viralCount / manualCount).toFixed(2) : null;
  const threshold    = 1.0;

  // Trace contribution: WAB success rate bonus
  const traces = loadTraces();
  const wabSucc = traces.filter(t => t.wab_enabled && t.outcome === 'success').length;
  const wabTotal = traces.filter(t => t.wab_enabled).length;
  const wabSuccessRate = wabTotal > 0 ? +(wabSucc / wabTotal * 100).toFixed(1) : null;

  res.json({
    total_sites:       entries.length,
    by_source:         bySource,
    gossip_sourced:    gossipCount,
    spider_sourced:    spiderCount,
    manually_seeded:   manualCount,
    viral_count:       viralCount,
    k_factor:          kFactor,
    self_sustaining:   kFactor !== null && kFactor >= threshold,
    threshold,
    wab_success_rate:  wabSuccessRate,
    total_traces:      traces.length,
    interpretation:    kFactor === null
      ? 'Insufficient data — seed at least 1 domain manually to start the network.'
      : kFactor >= 2 ? `k=${kFactor} — Exponential growth. The WAB Spider Network is self-amplifying.`
      : kFactor >= 1 ? `k=${kFactor} — Self-sustaining. Every seeded site generates more than 1 viral discovery.`
      : `k=${kFactor} — Below threshold. Need ${Math.ceil(threshold / (kFactor || 0.01))}x more gossip/spider reports per manual seed.`,
    generated_at: new Date().toISOString(),
  });
});

// ── GET /feed — public live feed of last 50 traces (anonymized) ─────────────
router.get('/feed', (req, res) => {
  res.set(CORS_OPEN);
  res.set('Cache-Control', 'public, max-age=30');
  const traces = loadTraces();
  const feed = traces.slice(-50).reverse().map(t => ({
    id:          t.id,
    domain:      t.domain,
    wab_enabled: t.wab_enabled,
    trust_ring:  t.trust_ring,
    task:        t.task,
    outcome:     t.outcome,
    latency_ms:  t.latency_ms,
    recorded_at: t.recorded_at,
    // strip agent identity fields
  }));
  res.json({ count: feed.length, total: traces.length, feed });
});

module.exports = router;
