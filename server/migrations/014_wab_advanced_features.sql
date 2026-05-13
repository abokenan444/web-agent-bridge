-- ═══════════════════════════════════════════════════════════════════
-- WAB Advanced Features v1.0
-- 1. Reputation Score    — domain reputation (0-100), multi-factor
-- 2. Memory Cache        — versioned manifest cache with ETags
-- 3. Intent-Aware Routing— intent schema registry per domain
-- 4. Privacy Budget      — data access budgets declared per domain
-- 5. Collective Intel    — anonymized agent insight aggregation
-- 6. Offline Sync        — offline-capable manifest version tracking
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Reputation ──────────────────────────────────────────────────
-- Immutable event log; reputation score computed from rolling window.
CREATE TABLE IF NOT EXISTS reputation_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT    NOT NULL,
  event_type  TEXT    NOT NULL,   -- 'dns_check' | 'agent_report' | 'latency' | 'cert_change' | 'trust_verify'
  outcome     TEXT    NOT NULL,   -- 'ok' | 'warn' | 'fail'
  score_delta REAL    NOT NULL DEFAULT 0,
  detail      TEXT,               -- JSON, no PII
  source      TEXT    DEFAULT 'system', -- 'system' | 'agent' (anon)
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rep_events_domain_time ON reputation_events(domain, created_at DESC);

-- Cached computed score (refreshed max every 5 min).
-- Named wab_rep_scores to avoid collision with older reputation_scores table.
CREATE TABLE IF NOT EXISTS wab_rep_scores (
  domain          TEXT  PRIMARY KEY,
  score           REAL  NOT NULL DEFAULT 0,
  label           TEXT  NOT NULL DEFAULT 'unrated',
  dns_score       REAL  DEFAULT 0,
  trust_score     REAL  DEFAULT 0,
  latency_score   REAL  DEFAULT 0,
  reports_score   REAL  DEFAULT 0,
  consistency     REAL  DEFAULT 0,
  event_count     INTEGER DEFAULT 0,
  first_seen_at   TEXT,
  last_computed_at TEXT DEFAULT (datetime('now')),
  trend           TEXT  DEFAULT 'stable'   -- 'rising' | 'falling' | 'stable'
);

-- ─── 2. Memory Cache / Offline Sync ─────────────────────────────────
-- Versioned manifest cache. Each new signature creates a new version row.
CREATE TABLE IF NOT EXISTS manifest_versions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT    NOT NULL,
  etag         TEXT    NOT NULL,    -- sha256(canonical manifest) hex
  manifest_json TEXT   NOT NULL,
  content_hash TEXT    NOT NULL,    -- sha256 of manifest_json
  key_id       TEXT,                -- from signature.key_id
  issued_at    TEXT,
  expires_at   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_manifest_ver_domain ON manifest_versions(domain, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_manifest_ver_etag ON manifest_versions(domain, etag);

-- ─── 3. Intent-Aware Routing ────────────────────────────────────────
-- Domain owners register intent schemas. Agents query them.
CREATE TABLE IF NOT EXISTS intent_schemas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  domain      TEXT    NOT NULL,
  schema_json TEXT    NOT NULL,      -- JSON: { intents: { "book": {...}, "buy": {...} } }
  version     INTEGER NOT NULL DEFAULT 1,
  active      INTEGER NOT NULL DEFAULT 1,
  owner_token_hash TEXT,              -- sha256 of owner's token to allow updates
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_intent_domain ON intent_schemas(domain);

-- Log of intent resolution requests (no PII, domain + intent_key + matched action only).
CREATE TABLE IF NOT EXISTS intent_resolutions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT    NOT NULL,
  intent_key      TEXT    NOT NULL,
  matched_action  TEXT,
  confidence      REAL,
  context_keys    TEXT,              -- JSON array of supplied context keys (no values)
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_intent_res_domain ON intent_resolutions(domain, created_at DESC);

-- ─── 4. Privacy Budget ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS privacy_budgets (
  domain           TEXT  PRIMARY KEY,
  budget_json      TEXT  NOT NULL,   -- full PrivacyBudget object
  gdpr_compliant   INTEGER DEFAULT 0,
  ccpa_compliant   INTEGER DEFAULT 0,
  lgpd_compliant   INTEGER DEFAULT 0,
  data_residency   TEXT,             -- 'EU' | 'US' | 'GLOBAL' | custom
  max_fields_per_session INTEGER DEFAULT 5,
  owner_token_hash TEXT,
  version          INTEGER DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ─── 5. Collective Intelligence ─────────────────────────────────────
-- Anonymized agent insight submissions.
-- Privacy invariant: no IP, no user-id, no session-id stored.
-- Only domain + structured insight type + outcome + numeric metrics.
CREATE TABLE IF NOT EXISTS collective_insights (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT    NOT NULL,
  insight_type TEXT    NOT NULL,   -- 'latency' | 'action_success' | 'action_fail' | 'capability' | 'trust'
  outcome      TEXT    NOT NULL,   -- 'positive' | 'neutral' | 'negative'
  metric_value REAL,               -- e.g. latency ms, success rate 0-1
  tags         TEXT,               -- JSON array of capability tags: ["booking","search"]
  agent_hash   TEXT,               -- sha256(agent_id + daily_salt) — NOT reversible
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collective_domain ON collective_insights(domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_collective_type ON collective_insights(insight_type, outcome);

-- Aggregated daily summaries (materialized by background job).
CREATE TABLE IF NOT EXISTS collective_daily (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  domain       TEXT    NOT NULL,
  date         TEXT    NOT NULL,   -- YYYY-MM-DD
  insight_type TEXT    NOT NULL,
  positive_count INTEGER DEFAULT 0,
  neutral_count  INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  avg_metric   REAL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collective_daily_key ON collective_daily(domain, date, insight_type);
