/**
 * server/routes/reputation.js
 * WAB Reputation Score + Collective Intelligence
 *
 * Mounted at /api/reputation and /api/collective
 *
 * Endpoints:
 *   GET  /api/reputation/:domain              — Get score + full breakdown
 *   POST /api/reputation/event                — System records a scored event (internal)
 *   GET  /api/reputation/leaderboard          — Top domains by score
 *   GET  /api/reputation/trend/:domain        — 30-day score history
 *
 *   POST /api/collective/report               — Agent submits anonymized insight
 *   GET  /api/collective/insights/:domain     — Aggregated public insights
 *   GET  /api/collective/graph                — Network graph (top 100 domains)
 *   POST /api/collective/daily-aggregate      — Internal: compute daily summaries
 */

'use strict';

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const { db }  = require('../models/db');

// ─── Schema bootstrap ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS reputation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL,
    event_type TEXT NOT NULL, outcome TEXT NOT NULL, score_delta REAL NOT NULL DEFAULT 0,
    detail TEXT, source TEXT DEFAULT 'system', created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rep_events_domain_time ON reputation_events(domain, created_at DESC);

  CREATE TABLE IF NOT EXISTS wab_rep_scores (
    domain TEXT PRIMARY KEY, score REAL NOT NULL DEFAULT 0, label TEXT NOT NULL DEFAULT 'unrated',
    dns_score REAL DEFAULT 0, trust_score REAL DEFAULT 0, latency_score REAL DEFAULT 0,
    reports_score REAL DEFAULT 0, consistency REAL DEFAULT 0, event_count INTEGER DEFAULT 0,
    first_seen_at TEXT, last_computed_at TEXT DEFAULT (datetime('now')), trend TEXT DEFAULT 'stable'
  );

  CREATE TABLE IF NOT EXISTS collective_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, insight_type TEXT NOT NULL,
    outcome TEXT NOT NULL, metric_value REAL, tags TEXT, agent_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_collective_domain ON collective_insights(domain, created_at DESC);

  CREATE TABLE IF NOT EXISTS collective_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT, domain TEXT NOT NULL, date TEXT NOT NULL,
    insight_type TEXT NOT NULL, positive_count INTEGER DEFAULT 0,
    neutral_count INTEGER DEFAULT 0, negative_count INTEGER DEFAULT 0,
    avg_metric REAL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_collective_daily_key ON collective_daily(domain, date, insight_type);
`);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const DAILY_SALT = crypto.createHash('sha256').update(new Date().toISOString().slice(0, 10)).digest('hex');

function normDomain(d) {
  return String(d || '').toLowerCase().trim()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '');
}

function validDomain(d) {
  return /^[a-z0-9.-]{3,253}$/.test(d) && d.includes('.');
}

function scoreLabel(s) {
  if (s >= 90) return 'excellent';
  if (s >= 75) return 'trusted';
  if (s >= 55) return 'good';
  if (s >= 35) return 'fair';
  if (s >= 15) return 'poor';
  return 'unrated';
}

function scoreLabelColor(label) {
  return { excellent: '#10b981', trusted: '#22c55e', good: '#84cc16', fair: '#f59e0b', poor: '#ef4444', unrated: '#64748b' }[label] || '#64748b';
}

/**
 * Compute reputation score from raw event log (last 90 days).
 * Component weights:
 *   DNS stability   40 pts — ratio of ok dns_check events in last 30 days
 *   Trust history   25 pts — ratio of ok trust_verify events + consistency
 *   Latency         15 pts — average latency_score delta normalised
 *   Agent reports   20 pts — weighted positive/negative collective insight ratio
 */
function computeScore(domain) {
  const cutoff90 = new Date(Date.now() - 90 * 86400e3).toISOString();
  const cutoff30 = new Date(Date.now() - 30 * 86400e3).toISOString();

  const rows = db.prepare(
    `SELECT event_type, outcome, score_delta, created_at FROM reputation_events
     WHERE domain = ? AND created_at > ? ORDER BY created_at DESC`
  ).all(domain, cutoff90);

  if (!rows.length) return null;

  // DNS stability (40 pts)
  const dns30 = rows.filter(r => r.event_type === 'dns_check' && r.created_at > cutoff30);
  const dnsOk = dns30.filter(r => r.outcome === 'ok').length;
  const dnsTotal = dns30.length;
  const dnsScore = dnsTotal ? Math.round(40 * (dnsOk / dnsTotal)) : 0;

  // Trust history (25 pts)
  const trust = rows.filter(r => r.event_type === 'trust_verify');
  const trustOk = trust.filter(r => r.outcome === 'ok').length;
  const trustTotal = trust.length;
  const trustScore = trustTotal ? Math.round(25 * (trustOk / trustTotal)) : 0;

  // Latency (15 pts) — average score_delta from latency events (already 0-15 range)
  const latRows = rows.filter(r => r.event_type === 'latency');
  const latScore = latRows.length
    ? Math.round(Math.min(15, latRows.reduce((s, r) => s + Math.max(0, r.score_delta), 0) / latRows.length))
    : 7; // neutral default

  // Agent reports (20 pts) from collective_insights
  const insights = db.prepare(
    `SELECT outcome FROM collective_insights WHERE domain = ? AND created_at > ?`
  ).all(domain, cutoff30);
  const iTotal = insights.length;
  const iPos = insights.filter(r => r.outcome === 'positive').length;
  const iNeg = insights.filter(r => r.outcome === 'negative').length;
  const reportsScore = iTotal
    ? Math.round(20 * Math.max(0, (iPos - iNeg) / iTotal + 0.5) )
    : 10; // neutral default

  // Consistency (bonus/penalty ±5): detect cert changes or repeated failures
  const certChanges = rows.filter(r => r.event_type === 'cert_change').length;
  const warnCount   = rows.filter(r => r.outcome === 'warn' || r.outcome === 'fail').length;
  const consistency = Math.max(0, 5 - Math.min(5, certChanges + Math.floor(warnCount / 5)));

  const score = Math.min(100, dnsScore + trustScore + latScore + reportsScore + consistency);
  const firstSeen = rows[rows.length - 1]?.created_at;

  // Trend: compare last-7-day avg score_delta vs prev-7-day
  const now = Date.now();
  const cut7a = new Date(now - 7 * 86400e3).toISOString();
  const cut7b = new Date(now - 14 * 86400e3).toISOString();
  const recent7 = rows.filter(r => r.created_at > cut7a).reduce((s, r) => s + r.score_delta, 0);
  const prior7  = rows.filter(r => r.created_at > cut7b && r.created_at <= cut7a).reduce((s, r) => s + r.score_delta, 0);
  const trend = recent7 > prior7 + 2 ? 'rising' : recent7 < prior7 - 2 ? 'falling' : 'stable';

  return { score, label: scoreLabel(score), dnsScore, trustScore, latScore, reportsScore, consistency, trend, firstSeen, eventCount: rows.length };
}

function upsertScore(domain, computed) {
  db.prepare(`
    INSERT INTO wab_rep_scores (domain, score, label, dns_score, trust_score, latency_score,
      reports_score, consistency, event_count, first_seen_at, last_computed_at, trend)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(domain) DO UPDATE SET
      score=excluded.score, label=excluded.label, dns_score=excluded.dns_score,
      trust_score=excluded.trust_score, latency_score=excluded.latency_score,
      reports_score=excluded.reports_score, consistency=excluded.consistency,
      event_count=excluded.event_count, first_seen_at=COALESCE(first_seen_at, excluded.first_seen_at),
      last_computed_at=datetime('now'), trend=excluded.trend
  `).run(domain, computed.score, computed.label, computed.dnsScore, computed.trustScore,
    computed.latScore, computed.reportsScore, computed.consistency, computed.eventCount,
    computed.firstSeen, computed.trend);
}

// Refresh if older than 5 minutes
function getOrComputeScore(domain) {
  const cached = db.prepare(`SELECT *, last_computed_at FROM wab_rep_scores WHERE domain = ?`).get(domain);
  const stale = !cached || (Date.now() - new Date(cached.last_computed_at).getTime() > 5 * 60 * 1000);
  if (stale) {
    const computed = computeScore(domain);
    if (computed) {
      upsertScore(domain, computed);
      return { ...computed, domain, generated_at: new Date().toISOString(), cached: false };
    }
    // No events: return zero score
    return { domain, score: 0, label: 'unrated', trend: 'stable', eventCount: 0, generated_at: new Date().toISOString(), cached: false };
  }
  return { domain, ...cached, cached: true };
}

// GET /api/reputation/leaderboard  — must be BEFORE /:domain to avoid param capture
router.get('/leaderboard', (req, res) => {
  const limit = Math.min(50, parseInt(req.query.limit) || 20);
  const rows = db.prepare(
    `SELECT domain, score, label, trend, event_count, last_computed_at
     FROM wab_rep_scores WHERE score > 0 ORDER BY score DESC LIMIT ?`
  ).all(limit);
  return res.json({ leaderboard: rows, generated_at: new Date().toISOString() });
});

// GET /api/reputation/:domain
router.get('/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  const result = getOrComputeScore(domain);

  // Recent events (last 10, no PII)
  const events = db.prepare(
    `SELECT event_type, outcome, score_delta, detail, source, created_at
     FROM reputation_events WHERE domain = ? ORDER BY created_at DESC LIMIT 10`
  ).all(domain);

  // Collective insight summary
  const insightSummary = db.prepare(
    `SELECT insight_type, outcome, COUNT(*) as count, AVG(metric_value) as avg_metric
     FROM collective_insights WHERE domain = ?
     GROUP BY insight_type, outcome ORDER BY count DESC LIMIT 20`
  ).all(domain);

  return res.json({
    domain,
    score: result.score,
    label: result.label,
    color: scoreLabelColor(result.label),
    trend: result.trend,
    components: {
      dns_stability: result.dnsScore ?? result.dns_score,
      trust_history: result.trustScore ?? result.trust_score,
      response_speed: result.latScore ?? result.latency_score,
      agent_reports: result.reportsScore ?? result.reports_score,
      consistency: result.consistency,
    },
    event_count: result.eventCount ?? result.event_count,
    first_seen_at: result.firstSeen ?? result.first_seen_at,
    generated_at: result.generated_at || result.last_computed_at,
    cached: result.cached,
    recent_events: events,
    insights: insightSummary,
  });
});

// POST /api/reputation/event — internal system call (no auth, rate-limited externally)
router.post('/event', express.json({ limit: '8kb' }), (req, res) => {
  const { domain, event_type, outcome, score_delta = 0, detail, source = 'system' } = req.body || {};
  if (!domain || !event_type || !outcome) return res.status(400).json({ error: 'missing_fields' });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });
  const VALID_TYPES = ['dns_check', 'agent_report', 'latency', 'cert_change', 'trust_verify'];
  const VALID_OUTCOMES = ['ok', 'warn', 'fail'];
  if (!VALID_TYPES.includes(event_type)) return res.status(400).json({ error: 'invalid_event_type' });
  if (!VALID_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'invalid_outcome' });

  const delta = Math.max(-20, Math.min(20, Number(score_delta) || 0));
  db.prepare(
    `INSERT INTO reputation_events (domain, event_type, outcome, score_delta, detail, source) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(d, event_type, outcome, delta, typeof detail === 'object' ? JSON.stringify(detail) : (detail || null), source);

  return res.json({ ok: true, domain: d });
});

// GET /api/reputation/trend/:domain — 30-day daily summary
router.get('/trend/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });
  const rows = db.prepare(
    `SELECT DATE(created_at) as date,
       SUM(CASE WHEN outcome='ok' THEN 1 ELSE 0 END) as ok_count,
       SUM(CASE WHEN outcome='fail' THEN 1 ELSE 0 END) as fail_count,
       AVG(score_delta) as avg_delta
     FROM reputation_events
     WHERE domain = ? AND created_at > datetime('now', '-30 days')
     GROUP BY DATE(created_at) ORDER BY date`
  ).all(domain);
  return res.json({ domain, trend: rows });
});

// ─── Collective Intelligence endpoints ────────────────────────────────────────

const collectiveRouter = express.Router();

// POST /api/collective/report
collectiveRouter.post('/report', express.json({ limit: '4kb' }), (req, res) => {
  const { domain, insight_type, outcome, metric_value, tags, agent_id } = req.body || {};
  if (!domain || !insight_type || !outcome) return res.status(400).json({ error: 'missing_fields' });
  const d = normDomain(domain);
  if (!validDomain(d)) return res.status(400).json({ error: 'invalid_domain' });

  const VALID_INSIGHT_TYPES = ['latency', 'action_success', 'action_fail', 'capability', 'trust'];
  const VALID_OUTCOMES = ['positive', 'neutral', 'negative'];
  if (!VALID_INSIGHT_TYPES.includes(insight_type)) return res.status(400).json({ error: 'invalid_insight_type' });
  if (!VALID_OUTCOMES.includes(outcome)) return res.status(400).json({ error: 'invalid_outcome' });

  // Anonymize agent identity: sha256(agent_id + daily_salt) — not reversible after daily rotation
  const agentHash = agent_id
    ? crypto.createHash('sha256').update(String(agent_id) + DAILY_SALT).digest('hex').slice(0, 16)
    : null;

  const tagsJson = Array.isArray(tags) ? JSON.stringify(tags.slice(0, 10).map(t => String(t).slice(0, 32))) : null;
  const metricVal = (typeof metric_value === 'number' && isFinite(metric_value)) ? metric_value : null;

  db.prepare(
    `INSERT INTO collective_insights (domain, insight_type, outcome, metric_value, tags, agent_hash) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(d, insight_type, outcome, metricVal, tagsJson, agentHash);

  // Also feed into reputation
  const delta = outcome === 'positive' ? 2 : outcome === 'negative' ? -2 : 0;
  if (delta !== 0) {
    db.prepare(`INSERT INTO reputation_events (domain, event_type, outcome, score_delta, source) VALUES (?, 'agent_report', ?, ?, 'agent')`).run(d, outcome === 'positive' ? 'ok' : 'fail', delta);
  }

  return res.json({ ok: true, message: 'Insight recorded anonymously.' });
});

// GET /api/collective/insights/:domain
collectiveRouter.get('/insights/:domain', (req, res) => {
  const domain = normDomain(req.params.domain);
  if (!validDomain(domain)) return res.status(400).json({ error: 'invalid_domain' });

  const summary = db.prepare(
    `SELECT insight_type, outcome, COUNT(*) as count, AVG(metric_value) as avg_metric
     FROM collective_insights WHERE domain = ? AND created_at > datetime('now', '-30 days')
     GROUP BY insight_type, outcome ORDER BY insight_type, count DESC`
  ).all(domain);

  const total = db.prepare(`SELECT COUNT(*) as n FROM collective_insights WHERE domain = ?`).get(domain);

  // Popular tags (unnormalized — done in JS to avoid JSON function dependency)
  const recentRows = db.prepare(
    `SELECT tags FROM collective_insights WHERE domain = ? AND tags IS NOT NULL ORDER BY created_at DESC LIMIT 200`
  ).all(domain);
  const tagCounts = {};
  for (const row of recentRows) {
    try { JSON.parse(row.tags).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }); } catch (_) {}
  }
  const topTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag, count]) => ({ tag, count }));

  return res.json({ domain, summary, total_reports: total?.n || 0, top_tags: topTags, window: '30d', generated_at: new Date().toISOString() });
});

// GET /api/collective/graph — top 100 domains + their scores for a network graph
collectiveRouter.get('/graph', (req, res) => {
  const nodes = db.prepare(
    `SELECT r.domain, r.score, r.label, r.trend,
       COUNT(c.id) as insight_count
     FROM wab_rep_scores r
     LEFT JOIN collective_insights c ON c.domain = r.domain AND c.created_at > datetime('now', '-7 days')
     WHERE r.score > 0
     GROUP BY r.domain ORDER BY r.score DESC LIMIT 100`
  ).all();

  // Edges: domains that share common capability tags in collective_insights
  const edges = [];
  // Lightweight: pairs where both domains appear in the same daily collective summary
  const dailyDomains = db.prepare(
    `SELECT domain, date FROM collective_daily WHERE date > date('now', '-7 days')`
  ).all();
  const byDate = {};
  for (const r of dailyDomains) {
    (byDate[r.date] = byDate[r.date] || []).push(r.domain);
  }
  const pairCounts = {};
  for (const date of Object.keys(byDate)) {
    const ds = byDate[date].slice(0, 20);
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const key = [ds[i], ds[j]].sort().join('||');
        pairCounts[key] = (pairCounts[key] || 0) + 1;
      }
    }
  }
  for (const [key, weight] of Object.entries(pairCounts)) {
    if (weight >= 2) {
      const [source, target] = key.split('||');
      edges.push({ source, target, weight });
    }
  }

  return res.json({ nodes, edges: edges.slice(0, 200), generated_at: new Date().toISOString() });
});

// POST /api/collective/daily-aggregate — internal cron-style endpoint
collectiveRouter.post('/daily-aggregate', (req, res) => {
  const today = new Date().toISOString().slice(0, 10);
  const domains = db.prepare(`SELECT DISTINCT domain FROM collective_insights WHERE DATE(created_at) = ?`).all(today);

  let processed = 0;
  for (const { domain } of domains) {
    const rows = db.prepare(
      `SELECT insight_type, outcome, COUNT(*) as cnt, AVG(metric_value) as avg_m
       FROM collective_insights WHERE domain = ? AND DATE(created_at) = ?
       GROUP BY insight_type, outcome`
    ).all(domain, today);

    const byType = {};
    for (const r of rows) {
      if (!byType[r.insight_type]) byType[r.insight_type] = { pos: 0, neu: 0, neg: 0, metrics: [] };
      if (r.outcome === 'positive') byType[r.insight_type].pos += r.cnt;
      else if (r.outcome === 'neutral') byType[r.insight_type].neu += r.cnt;
      else byType[r.insight_type].neg += r.cnt;
      if (r.avg_m != null) byType[r.insight_type].metrics.push(r.avg_m);
    }

    for (const [type, data] of Object.entries(byType)) {
      const avg = data.metrics.length ? data.metrics.reduce((a, b) => a + b, 0) / data.metrics.length : null;
      db.prepare(`
        INSERT INTO collective_daily (domain, date, insight_type, positive_count, neutral_count, negative_count, avg_metric)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(domain, date, insight_type) DO UPDATE SET
          positive_count=excluded.positive_count, neutral_count=excluded.neutral_count,
          negative_count=excluded.negative_count, avg_metric=excluded.avg_metric
      `).run(domain, today, type, data.pos, data.neu, data.neg, avg);
    }
    processed++;
  }

  return res.json({ ok: true, processed, date: today });
});

module.exports = { reputationRouter: router, collectiveRouter };
