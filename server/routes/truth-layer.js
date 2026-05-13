/**
 * server/routes/truth-layer.js
 * WAB Truth Layer — unified API for 4 features:
 *   1. Semantic Memory Network (anonymized agent observations per intent)
 *   2. Temporal Trust          (time-stability dimension)
 *   3. Intent-to-Action Bridge (Action Graphs)
 *   4. Reality Anchor          (cross-site fact verification)
 *
 * Mounted at /api/truth
 *
 * Endpoints:
 *   --- Semantic Memory ---
 *   POST /api/truth/memory/observe         — agent reports an observation
 *   GET  /api/truth/memory/:domain         — semantic summary for a domain
 *   GET  /api/truth/memory/:domain/:intent — summary for a specific intent
 *
 *   --- Temporal Trust ---
 *   GET  /api/truth/temporal/:domain       — temporal trust profile
 *   POST /api/truth/temporal/snapshot      — record a trust snapshot (internal)
 *
 *   --- Action Graph ---
 *   GET  /api/truth/action/:domain/:intent — get action graph
 *   POST /api/truth/action/register        — site owner registers an action graph
 *   POST /api/truth/action/resolve         — agent: intent → recommended graph
 *
 *   --- Reality Anchor ---
 *   POST /api/truth/reality/submit         — submit observed fact
 *   GET  /api/truth/reality/:fact_key      — verify a fact against the network
 *   POST /api/truth/reality/verify         — bulk verification
 *
 *   --- Unified ---
 *   GET  /api/truth/profile/:domain        — full Truth profile (all 4 in one)
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { db }  = require('../models/db');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const VALID_DOMAIN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const normDomain = (d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
const validDomain = (d) => VALID_DOMAIN.test(d) && d.length <= 253;

const VALID_INTENT_CATEGORIES = ['booking','payment','search','auth','checkout','support','navigation','content','other'];
const VALID_OBSERVATIONS = ['fast','slow','reliable','flaky','success','failure','blocked','rate_limited'];
const VALID_FACT_TYPES = ['price','availability','rating','event','count','status'];

const DAILY_SALT = () =>
  crypto.createHash('sha256').update(new Date().toISOString().slice(0,10) + ':wab-truth').digest('hex');

const anonAgent = (agentId) =>
  crypto.createHash('sha256').update(String(agentId || 'anon') + DAILY_SALT()).digest('hex').slice(0, 16);

// Bootstrap schema (idempotent)
db.exec(`
  CREATE TABLE IF NOT EXISTS semantic_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    intent_category TEXT NOT NULL, observation TEXT NOT NULL,
    latency_ms INTEGER, success INTEGER NOT NULL DEFAULT 1,
    agent_hash TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_sem_mem_domain_intent ON semantic_memory(domain, intent_category, created_at DESC);

  CREATE TABLE IF NOT EXISTS semantic_summary (
    domain TEXT NOT NULL, intent_category TEXT NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0, success_rate REAL NOT NULL DEFAULT 0,
    avg_latency_ms INTEGER, p95_latency_ms INTEGER,
    reliability REAL NOT NULL DEFAULT 0, top_tags TEXT,
    last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (domain, intent_category)
  );

  CREATE TABLE IF NOT EXISTS temporal_trust_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    snapshot_at TEXT NOT NULL DEFAULT (datetime('now')),
    score REAL NOT NULL DEFAULT 0, dns_stable INTEGER NOT NULL DEFAULT 1,
    manifest_hash TEXT, cert_fingerprint TEXT,
    observations INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_temp_trust_domain ON temporal_trust_snapshots(domain, snapshot_at DESC);

  CREATE TABLE IF NOT EXISTS temporal_trust (
    domain TEXT PRIMARY KEY, age_days INTEGER NOT NULL DEFAULT 0,
    stability_score REAL NOT NULL DEFAULT 0, volatility REAL NOT NULL DEFAULT 0,
    manifest_change_count INTEGER NOT NULL DEFAULT 0, dns_failure_count INTEGER NOT NULL DEFAULT 0,
    classification TEXT NOT NULL DEFAULT 'new',
    last_computed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS action_graphs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    intent_key TEXT NOT NULL, graph_json TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1, active INTEGER NOT NULL DEFAULT 1,
    owner_token_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_action_graph_domain ON action_graphs(domain);

  CREATE TABLE IF NOT EXISTS reality_facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fact_key TEXT NOT NULL,
    fact_type TEXT NOT NULL, domain TEXT NOT NULL,
    value_json TEXT NOT NULL, unit TEXT, agent_hash TEXT NOT NULL,
    trust_weight REAL NOT NULL DEFAULT 1.0, expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reality_key ON reality_facts(fact_key, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reality_type ON reality_facts(fact_type, created_at DESC);
`);

// ═════════════════════════════════════════════════════════════════════════════
// 1. SEMANTIC MEMORY NETWORK
// ═════════════════════════════════════════════════════════════════════════════

function refreshSemanticSummary(domain, intentCategory) {
  const rows = db.prepare(
    `SELECT observation, success, latency_ms FROM semantic_memory
     WHERE domain = ? AND intent_category = ?
       AND created_at >= datetime('now','-30 days')`
  ).all(domain, intentCategory);

  if (rows.length === 0) return null;

  const successCount = rows.filter(r => r.success === 1).length;
  const successRate = successCount / rows.length;
  const latencies = rows.map(r => r.latency_ms).filter(x => Number.isFinite(x) && x >= 0).sort((a,b) => a-b);
  const avgLatency = latencies.length ? Math.round(latencies.reduce((a,b) => a+b, 0) / latencies.length) : null;
  const p95Latency = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] || latencies[latencies.length - 1] : null;

  // reliability = 1 - variance of success outcomes
  const mean = successRate;
  const variance = rows.reduce((acc, r) => acc + Math.pow((r.success ? 1 : 0) - mean, 2), 0) / rows.length;
  const reliability = Math.max(0, Math.min(1, 1 - variance * 4));

  const tagCounts = {};
  for (const r of rows) tagCounts[r.observation] = (tagCounts[r.observation] || 0) + 1;
  const topTags = Object.entries(tagCounts).sort((a,b) => b[1] - a[1]).slice(0, 5).map(([tag, count]) => ({ tag, count }));

  db.prepare(`
    INSERT INTO semantic_summary (domain, intent_category, sample_count, success_rate, avg_latency_ms, p95_latency_ms, reliability, top_tags, last_updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(domain, intent_category) DO UPDATE SET
      sample_count = excluded.sample_count, success_rate = excluded.success_rate,
      avg_latency_ms = excluded.avg_latency_ms, p95_latency_ms = excluded.p95_latency_ms,
      reliability = excluded.reliability, top_tags = excluded.top_tags,
      last_updated_at = datetime('now')
  `).run(domain, intentCategory, rows.length, successRate, avgLatency, p95Latency, reliability, JSON.stringify(topTags));

  return { sample_count: rows.length, success_rate: successRate, avg_latency_ms: avgLatency, p95_latency_ms: p95Latency, reliability, top_tags: topTags };
}

// POST /api/truth/memory/observe — agent submits an anonymized observation
router.post('/memory/observe', express.json({ limit: '4kb' }), (req, res) => {
  const { domain, intent_category, observation, latency_ms, success = true, agent_id } = req.body || {};
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  if (!VALID_INTENT_CATEGORIES.includes(intent_category)) return res.status(400).json({ error: 'invalid_intent_category', allowed: VALID_INTENT_CATEGORIES });
  if (!VALID_OBSERVATIONS.includes(observation)) return res.status(400).json({ error: 'invalid_observation', allowed: VALID_OBSERVATIONS });

  const lat = Number.isFinite(Number(latency_ms)) ? Math.max(0, Math.min(60000, Number(latency_ms))) : null;
  const succ = success ? 1 : 0;
  const hash = anonAgent(agent_id);

  db.prepare(
    `INSERT INTO semantic_memory (domain, intent_category, observation, latency_ms, success, agent_hash) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(d, intent_category, observation, lat, succ, hash);

  // Lazy refresh (only every ~10 inserts to avoid contention)
  if (Math.random() < 0.1) refreshSemanticSummary(d, intent_category);

  return res.json({ ok: true, domain: d, intent: intent_category, anonymized: true });
});

// GET /api/truth/memory/:domain — overall semantic summary
router.get('/memory/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  // Refresh stale categories
  const categories = db.prepare(
    `SELECT DISTINCT intent_category FROM semantic_memory WHERE domain = ?`
  ).all(domain).map(r => r.intent_category);

  for (const cat of categories) refreshSemanticSummary(domain, cat);

  const summaries = db.prepare(
    `SELECT intent_category, sample_count, success_rate, avg_latency_ms, p95_latency_ms, reliability, top_tags, last_updated_at
     FROM semantic_summary WHERE domain = ? ORDER BY sample_count DESC`
  ).all(domain).map(r => ({ ...r, top_tags: r.top_tags ? JSON.parse(r.top_tags) : [] }));

  const overall = summaries.reduce((acc, s) => {
    acc.total_samples += s.sample_count;
    acc.weighted_success += s.success_rate * s.sample_count;
    return acc;
  }, { total_samples: 0, weighted_success: 0 });

  return res.json({
    domain,
    summaries,
    overall: {
      total_samples: overall.total_samples,
      avg_success_rate: overall.total_samples ? overall.weighted_success / overall.total_samples : null,
      categories_tracked: summaries.length,
    },
    generated_at: new Date().toISOString(),
  });
});

// GET /api/truth/memory/:domain/:intent — specific intent summary
router.get('/memory/:domain/:intent', (req, res) => {
  const domain = normDomain(req.params.domain);
  const intent = req.params.intent;
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  if (!VALID_INTENT_CATEGORIES.includes(intent)) return res.status(400).json({ error: 'invalid_intent_category' });

  const fresh = refreshSemanticSummary(domain, intent);
  const row = db.prepare(
    `SELECT * FROM semantic_summary WHERE domain = ? AND intent_category = ?`
  ).get(domain, intent);

  if (!row) return res.status(404).json({ error: 'no_data', domain, intent });

  return res.json({
    domain,
    intent_category: intent,
    ...row,
    top_tags: row.top_tags ? JSON.parse(row.top_tags) : [],
    generated_at: new Date().toISOString(),
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. TEMPORAL TRUST
// ═════════════════════════════════════════════════════════════════════════════

function computeTemporalTrust(domain) {
  const snapshots = db.prepare(
    `SELECT score, dns_stable, manifest_hash, cert_fingerprint, snapshot_at
     FROM temporal_trust_snapshots WHERE domain = ? ORDER BY snapshot_at ASC`
  ).all(domain);

  // First-seen from reputation_events if available, else from snapshots
  const firstSeen = (() => {
    try {
      const r = db.prepare(`SELECT first_seen_at FROM wab_rep_scores WHERE domain = ?`).get(domain);
      if (r && r.first_seen_at) return new Date(r.first_seen_at);
    } catch { /* table may not exist */ }
    if (snapshots.length) return new Date(snapshots[0].snapshot_at);
    return new Date();
  })();

  const ageDays = Math.max(0, Math.floor((Date.now() - firstSeen.getTime()) / 86400000));

  let dnsFailures = 0;
  let manifestChanges = 0;
  let prevManifest = null;
  let prevCert = null;
  let certChanges = 0;
  for (const s of snapshots) {
    if (!s.dns_stable) dnsFailures++;
    if (prevManifest && s.manifest_hash && s.manifest_hash !== prevManifest) manifestChanges++;
    if (prevCert && s.cert_fingerprint && s.cert_fingerprint !== prevCert) certChanges++;
    prevManifest = s.manifest_hash || prevManifest;
    prevCert = s.cert_fingerprint || prevCert;
  }

  // Score variance → volatility
  const scores = snapshots.map(s => s.score).filter(Number.isFinite);
  let volatility = 0;
  if (scores.length >= 3) {
    const mean = scores.reduce((a,b) => a+b, 0) / scores.length;
    const variance = scores.reduce((acc, x) => acc + Math.pow(x - mean, 2), 0) / scores.length;
    volatility = Math.min(1, Math.sqrt(variance) / 50); // normalize
  }

  // Stability score: rewards age + low volatility + few sudden changes
  const ageFactor   = Math.min(40, ageDays * 0.5);                   // up to 40pts (80 days = max)
  const stableFactor = Math.max(0, 30 - manifestChanges * 5 - certChanges * 3); // up to 30pts
  const dnsFactor   = Math.max(0, 20 - dnsFailures * 4);             // up to 20pts
  const volFactor   = Math.max(0, 10 - volatility * 10);             // up to 10pts
  const stabilityScore = Math.round(ageFactor + stableFactor + dnsFactor + volFactor);

  // Classification
  let classification = 'new';
  if (ageDays < 7) classification = 'new';
  else if (ageDays < 30 && stabilityScore >= 40) classification = 'emerging';
  else if (ageDays >= 30 && stabilityScore >= 70) classification = 'established';
  else if (ageDays >= 90 && stabilityScore >= 85 && volatility < 0.2) classification = 'flagship';
  else if (manifestChanges >= 5 || volatility > 0.6 || dnsFailures >= 5) classification = 'suspect';

  db.prepare(`
    INSERT INTO temporal_trust (domain, age_days, stability_score, volatility, manifest_change_count, dns_failure_count, classification, last_computed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(domain) DO UPDATE SET
      age_days = excluded.age_days, stability_score = excluded.stability_score,
      volatility = excluded.volatility, manifest_change_count = excluded.manifest_change_count,
      dns_failure_count = excluded.dns_failure_count, classification = excluded.classification,
      last_computed_at = datetime('now')
  `).run(domain, ageDays, stabilityScore, volatility, manifestChanges, dnsFailures, classification);

  return { domain, age_days: ageDays, stability_score: stabilityScore, volatility: +volatility.toFixed(3),
           manifest_change_count: manifestChanges, dns_failure_count: dnsFailures, classification,
           snapshots_count: snapshots.length };
}

// GET /api/truth/temporal/:domain
router.get('/temporal/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  const result = computeTemporalTrust(domain);

  // 30-day score timeline
  const timeline = db.prepare(
    `SELECT DATE(snapshot_at) as date, AVG(score) as avg_score, COUNT(*) as samples
     FROM temporal_trust_snapshots WHERE domain = ? AND snapshot_at >= datetime('now','-30 days')
     GROUP BY DATE(snapshot_at) ORDER BY date ASC`
  ).all(domain);

  return res.json({
    ...result,
    timeline,
    badge: {
      label: result.classification,
      color: classifColor(result.classification),
      icon:  classifIcon(result.classification),
    },
    generated_at: new Date().toISOString(),
  });
});

function classifColor(c) {
  return { new:'#94a3b8', emerging:'#3b82f6', established:'#10b981', flagship:'#8b5cf6', suspect:'#ef4444' }[c] || '#94a3b8';
}
function classifIcon(c) {
  return { new:'🌱', emerging:'📈', established:'🏛️', flagship:'⭐', suspect:'⚠️' }[c] || '•';
}

// POST /api/truth/temporal/snapshot — record a trust snapshot
router.post('/temporal/snapshot', express.json({ limit: '4kb' }), (req, res) => {
  const { domain, score, dns_stable = true, manifest_hash, cert_fingerprint, observations = 0 } = req.body || {};
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  const s = Math.max(0, Math.min(100, Number(score) || 0));

  db.prepare(
    `INSERT INTO temporal_trust_snapshots (domain, score, dns_stable, manifest_hash, cert_fingerprint, observations)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(d, s, dns_stable ? 1 : 0,
        manifest_hash ? String(manifest_hash).slice(0, 128) : null,
        cert_fingerprint ? String(cert_fingerprint).slice(0, 128) : null,
        Number(observations) || 0);

  return res.json({ ok: true, domain: d });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. INTENT-TO-ACTION BRIDGE (Action Graphs)
// ═════════════════════════════════════════════════════════════════════════════

function validateActionGraph(g) {
  if (!g || typeof g !== 'object') return 'graph_required';
  if (!Array.isArray(g.nodes) || g.nodes.length === 0) return 'nodes_required';
  if (!Array.isArray(g.edges)) return 'edges_required';
  for (const n of g.nodes) {
    if (!n || typeof n !== 'object' || !n.id || !n.type) return 'invalid_node';
    if (!['action','requirement','choice','outcome','start'].includes(n.type)) return 'bad_node_type';
  }
  const ids = new Set(g.nodes.map(n => n.id));
  for (const e of g.edges) {
    if (!e || !ids.has(e.from) || !ids.has(e.to)) return 'invalid_edge';
  }
  return null;
}

// POST /api/truth/action/register
router.post('/action/register', express.json({ limit: '64kb' }), (req, res) => {
  const { domain, intent_key, graph, owner_token } = req.body || {};
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  if (!intent_key || typeof intent_key !== 'string' || intent_key.length > 64)
    return res.status(400).json({ error: 'invalid_intent_key' });

  const err = validateActionGraph(graph);
  if (err) return res.status(400).json({ error: err });

  const ownerHash = owner_token ? crypto.createHash('sha256').update(String(owner_token)).digest('hex') : null;

  // Deactivate previous active version
  db.prepare(`UPDATE action_graphs SET active = 0 WHERE domain = ? AND intent_key = ? AND active = 1`)
    .run(d, intent_key);

  const maxVer = db.prepare(`SELECT COALESCE(MAX(version),0) AS v FROM action_graphs WHERE domain = ? AND intent_key = ?`)
    .get(d, intent_key).v;

  const info = db.prepare(
    `INSERT INTO action_graphs (domain, intent_key, graph_json, version, active, owner_token_hash)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(d, intent_key, JSON.stringify(graph), maxVer + 1, ownerHash);

  return res.json({ ok: true, domain: d, intent_key, version: maxVer + 1, id: info.lastInsertRowid });
});

// GET /api/truth/action/:domain/:intent
router.get('/action/:domain/:intent', (req, res) => {
  const domain = normDomain(req.params.domain);
  const intent = req.params.intent;
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  const row = db.prepare(
    `SELECT graph_json, version, updated_at FROM action_graphs
     WHERE domain = ? AND intent_key = ? AND active = 1 ORDER BY version DESC LIMIT 1`
  ).get(domain, intent);

  if (!row) return res.status(404).json({ error: 'no_graph', domain, intent_key: intent });

  let graph;
  try { graph = JSON.parse(row.graph_json); }
  catch { return res.status(500).json({ error: 'corrupt_graph' }); }

  return res.json({ domain, intent_key: intent, version: row.version, graph, updated_at: row.updated_at });
});

// POST /api/truth/action/resolve — agent sends intent string, gets best matching graph
router.post('/action/resolve', express.json({ limit: '8kb' }), (req, res) => {
  const { domain, intent_text, hints } = req.body || {};
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  if (!intent_text || typeof intent_text !== 'string') return res.status(400).json({ error: 'invalid_intent_text' });

  const text = intent_text.toLowerCase();
  const graphs = db.prepare(
    `SELECT intent_key, graph_json, version FROM action_graphs WHERE domain = ? AND active = 1`
  ).all(d);

  if (graphs.length === 0) return res.status(404).json({ error: 'no_graphs_for_domain', domain: d });

  // Simple scoring: keyword & label overlap
  let best = null;
  for (const g of graphs) {
    let parsed; try { parsed = JSON.parse(g.graph_json); } catch { continue; }
    let score = 0;
    const key = g.intent_key.toLowerCase();
    if (text.includes(key.replace(/_/g, ' '))) score += 60;
    const labels = (parsed.nodes || []).map(n => String(n.label || '').toLowerCase());
    for (const lbl of labels) if (lbl && text.includes(lbl)) score += 8;
    const kws = parsed.keywords || [];
    for (const kw of kws) if (text.includes(String(kw).toLowerCase())) score += 15;
    if (Array.isArray(hints)) for (const h of hints) if (key.includes(String(h).toLowerCase())) score += 5;
    if (!best || score > best.score) best = { intent_key: g.intent_key, score, graph: parsed, version: g.version };
  }

  if (!best || best.score === 0) return res.status(404).json({ error: 'no_match', domain: d });

  // Log resolution (anonymized)
  try {
    db.prepare(
      `INSERT INTO intent_resolutions (domain, intent_key, matched_action, confidence, context_keys) VALUES (?, ?, ?, ?, ?)`
    ).run(d, best.intent_key, 'action_graph', best.score / 100, null);
  } catch { /* table may not exist */ }

  return res.json({ domain: d, matched_intent: best.intent_key, confidence: Math.min(1, best.score / 100),
                    version: best.version, graph: best.graph });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. REALITY ANCHOR
// ═════════════════════════════════════════════════════════════════════════════

function getDomainTrustWeight(domain) {
  try {
    const r = db.prepare(`SELECT score FROM wab_rep_scores WHERE domain = ?`).get(domain);
    if (r && Number.isFinite(r.score)) return Math.max(0.1, Math.min(1.5, r.score / 100));
  } catch { /* fallback */ }
  return 1.0;
}

// POST /api/truth/reality/submit
router.post('/reality/submit', express.json({ limit: '8kb' }), (req, res) => {
  const { fact_key, fact_type, domain, value, unit, agent_id, ttl_hours = 24 } = req.body || {};
  if (!fact_key || typeof fact_key !== 'string' || fact_key.length > 200)
    return res.status(400).json({ error: 'invalid_fact_key' });
  if (!VALID_FACT_TYPES.includes(fact_type)) return res.status(400).json({ error: 'invalid_fact_type', allowed: VALID_FACT_TYPES });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  if (value === undefined || value === null) return res.status(400).json({ error: 'value_required' });

  const hash = anonAgent(agent_id);
  const weight = getDomainTrustWeight(d);
  const ttl = Math.max(1, Math.min(720, Number(ttl_hours) || 24));
  const expiresAt = new Date(Date.now() + ttl * 3600000).toISOString().replace('T',' ').slice(0,19);

  db.prepare(
    `INSERT INTO reality_facts (fact_key, fact_type, domain, value_json, unit, agent_hash, trust_weight, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(fact_key.slice(0, 200), fact_type, d, JSON.stringify(value),
        unit ? String(unit).slice(0, 16) : null, hash, weight, expiresAt);

  return res.json({ ok: true, fact_key, anonymized: true, trust_weight: weight, expires_at: expiresAt });
});

// GET /api/truth/reality/:fact_key — verify against the network
router.get('/reality/:fact_key', (req, res) => {
  const factKey = String(req.params.fact_key).slice(0, 200);

  const rows = db.prepare(
    `SELECT fact_type, domain, value_json, unit, trust_weight, agent_hash, created_at
     FROM reality_facts
     WHERE fact_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
     ORDER BY created_at DESC LIMIT 500`
  ).all(factKey);

  if (rows.length === 0) return res.status(404).json({ error: 'no_observations', fact_key: factKey });

  const factType = rows[0].fact_type;
  const observations = rows.map(r => ({ ...r, value: safeParse(r.value_json) }));

  // Numeric consensus
  let consensus = null;
  const numeric = observations
    .map(o => ({ v: extractNumeric(o.value), w: o.trust_weight }))
    .filter(x => Number.isFinite(x.v));

  if (numeric.length >= 2) {
    const totalW = numeric.reduce((a,b) => a + b.w, 0);
    const weightedMean = numeric.reduce((a,b) => a + b.v * b.w, 0) / totalW;
    const variance = numeric.reduce((a,b) => a + Math.pow(b.v - weightedMean, 2) * b.w, 0) / totalW;
    const stddev = Math.sqrt(variance);
    const sorted = numeric.map(x => x.v).sort((a,b) => a-b);
    consensus = {
      type: 'numeric',
      weighted_mean: +weightedMean.toFixed(4),
      median: sorted[Math.floor(sorted.length / 2)],
      min: sorted[0],
      max: sorted[sorted.length - 1],
      stddev: +stddev.toFixed(4),
      confidence: Math.max(0, Math.min(1, 1 - (stddev / Math.max(1, Math.abs(weightedMean))))),
    };
  } else {
    // Categorical consensus (vote)
    const tally = {};
    for (const o of observations) {
      const k = JSON.stringify(o.value);
      tally[k] = (tally[k] || 0) + o.trust_weight;
    }
    const sorted = Object.entries(tally).sort((a,b) => b[1] - a[1]);
    const top = sorted[0];
    const totalW = sorted.reduce((a,b) => a + b[1], 0);
    consensus = {
      type: 'categorical',
      top_value: safeParse(top[0]),
      agreement: +(top[1] / totalW).toFixed(3),
      distinct_values: sorted.length,
    };
  }

  const uniqueAgents = new Set(observations.map(o => o.agent_hash)).size;
  const uniqueDomains = new Set(observations.map(o => o.domain)).size;

  return res.json({
    fact_key: factKey,
    fact_type: factType,
    unit: rows[0].unit,
    observations_count: observations.length,
    unique_agents: uniqueAgents,
    unique_domains: uniqueDomains,
    consensus,
    sources: observations.slice(0, 20).map(o => ({
      domain: o.domain, value: o.value, trust_weight: o.trust_weight, at: o.created_at,
    })),
    generated_at: new Date().toISOString(),
  });
});

function safeParse(s) { try { return JSON.parse(s); } catch { return s; } }
function extractNumeric(v) {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object' && Number.isFinite(v.amount)) return v.amount;
  if (v && typeof v === 'object' && Number.isFinite(v.value))  return v.value;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// POST /api/truth/reality/verify — bulk
router.post('/reality/verify', express.json({ limit: '8kb' }), (req, res) => {
  const { fact_keys } = req.body || {};
  if (!Array.isArray(fact_keys) || fact_keys.length === 0) return res.status(400).json({ error: 'fact_keys_required' });
  if (fact_keys.length > 50) return res.status(400).json({ error: 'too_many', max: 50 });

  const out = {};
  for (const k of fact_keys) {
    const key = String(k).slice(0, 200);
    const rows = db.prepare(
      `SELECT value_json, trust_weight FROM reality_facts
       WHERE fact_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
       ORDER BY created_at DESC LIMIT 100`
    ).all(key);
    if (rows.length === 0) { out[key] = { found: false }; continue; }
    const nums = rows.map(r => ({ v: extractNumeric(safeParse(r.value_json)), w: r.trust_weight }))
                    .filter(x => Number.isFinite(x.v));
    if (nums.length) {
      const totalW = nums.reduce((a,b) => a + b.w, 0);
      const mean = nums.reduce((a,b) => a + b.v * b.w, 0) / totalW;
      out[key] = { found: true, type: 'numeric', value: +mean.toFixed(4), samples: rows.length };
    } else {
      out[key] = { found: true, type: 'categorical', samples: rows.length };
    }
  }

  return res.json({ results: out, generated_at: new Date().toISOString() });
});

// ═════════════════════════════════════════════════════════════════════════════
// UNIFIED TRUTH PROFILE
// ═════════════════════════════════════════════════════════════════════════════

// GET /api/truth/profile/:domain — full Truth Layer profile for a domain
router.get('/profile/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  // Semantic
  const categories = db.prepare(
    `SELECT DISTINCT intent_category FROM semantic_memory WHERE domain = ?`
  ).all(domain).map(r => r.intent_category);
  for (const cat of categories) refreshSemanticSummary(domain, cat);
  const semantic = db.prepare(
    `SELECT intent_category, sample_count, success_rate, avg_latency_ms, reliability
     FROM semantic_summary WHERE domain = ? ORDER BY sample_count DESC LIMIT 10`
  ).all(domain);

  // Temporal
  const temporal = computeTemporalTrust(domain);

  // Action graphs
  const graphs = db.prepare(
    `SELECT intent_key, version, updated_at FROM action_graphs WHERE domain = ? AND active = 1`
  ).all(domain);

  // Reality facts originating from this domain
  const factsFromDomain = db.prepare(
    `SELECT fact_type, COUNT(*) as count FROM reality_facts
     WHERE domain = ? AND (expires_at IS NULL OR expires_at > datetime('now'))
     GROUP BY fact_type`
  ).all(domain);

  // Reputation (if available)
  let reputation = null;
  try {
    const r = db.prepare(`SELECT score, label, trend FROM wab_rep_scores WHERE domain = ?`).get(domain);
    if (r) reputation = r;
  } catch { /* no-op */ }

  return res.json({
    domain,
    truth_layer_version: '1.0',
    reputation,
    semantic: { categories: semantic, total_categories: semantic.length },
    temporal,
    action_graphs: { count: graphs.length, intents: graphs },
    reality_anchor: { facts_published: factsFromDomain },
    generated_at: new Date().toISOString(),
  });
});

module.exports = { truthRouter: router };
