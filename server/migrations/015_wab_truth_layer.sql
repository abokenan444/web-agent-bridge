-- ═══════════════════════════════════════════════════════════════════
-- WAB Truth Layer v1.0
-- Unifies 4 ideas into one coherent layer:
--   1. Semantic Memory Network — anonymized agent observations per intent
--   2. Temporal Trust          — time-stability dimension on reputation
--   3. Intent-to-Action Bridge — Action Graphs per intent
--   4. Reality Anchor          — cross-site fact verification
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. Semantic Memory Network ─────────────────────────────────────
-- Anonymized observations agents leave about sites, scoped to intent category.
-- No PII. agent_hash rotates daily (sha256(agent_id + daily_salt)).
CREATE TABLE IF NOT EXISTS semantic_memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  domain        TEXT    NOT NULL,
  intent_category TEXT  NOT NULL,        -- 'booking' | 'payment' | 'search' | 'auth' | 'checkout' | 'support' | 'other'
  observation   TEXT    NOT NULL,        -- 'fast' | 'slow' | 'reliable' | 'flaky' | 'success' | 'failure' | 'blocked' | 'rate_limited'
  latency_ms    INTEGER,                 -- optional measured latency
  success       INTEGER NOT NULL DEFAULT 1,  -- 0|1
  agent_hash    TEXT    NOT NULL,        -- daily-rotating anonymized agent id
  weight        REAL    NOT NULL DEFAULT 1.0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sem_mem_domain_intent ON semantic_memory(domain, intent_category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sem_mem_recent ON semantic_memory(created_at DESC);

-- Aggregated semantic summary (refreshed periodically)
CREATE TABLE IF NOT EXISTS semantic_summary (
  domain          TEXT NOT NULL,
  intent_category TEXT NOT NULL,
  sample_count    INTEGER NOT NULL DEFAULT 0,
  success_rate    REAL NOT NULL DEFAULT 0,    -- 0..1
  avg_latency_ms  INTEGER,
  p95_latency_ms  INTEGER,
  reliability     REAL NOT NULL DEFAULT 0,    -- 0..1 (stability of outcomes)
  top_tags        TEXT,                       -- JSON array of common observations
  last_updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (domain, intent_category)
);

-- ─── 2. Temporal Trust ──────────────────────────────────────────────
-- Time-series of trust signals so we can measure stability over time.
CREATE TABLE IF NOT EXISTS temporal_trust_snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  domain           TEXT    NOT NULL,
  snapshot_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  score            REAL    NOT NULL DEFAULT 0,
  dns_stable       INTEGER NOT NULL DEFAULT 1,   -- 0|1 whether DNS discovery resolved consistently
  manifest_hash    TEXT,                          -- to detect sudden structural changes
  cert_fingerprint TEXT,
  observations     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_temp_trust_domain ON temporal_trust_snapshots(domain, snapshot_at DESC);

-- Computed temporal trust per domain
CREATE TABLE IF NOT EXISTS temporal_trust (
  domain               TEXT PRIMARY KEY,
  age_days             INTEGER NOT NULL DEFAULT 0,   -- days since first_seen
  stability_score      REAL    NOT NULL DEFAULT 0,   -- 0..100 long-term stability
  volatility           REAL    NOT NULL DEFAULT 0,   -- 0..1 (higher = more sudden changes)
  manifest_change_count INTEGER NOT NULL DEFAULT 0,  -- structural changes detected
  dns_failure_count    INTEGER NOT NULL DEFAULT 0,
  classification       TEXT    NOT NULL DEFAULT 'new', -- 'new' | 'emerging' | 'established' | 'flagship' | 'suspect'
  last_computed_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ─── 3. Intent-to-Action Bridge (Action Graphs) ─────────────────────
-- Action graphs are per-intent flowcharts describing how to complete the intent
-- on a given domain (steps, requirements, alternatives).
CREATE TABLE IF NOT EXISTS action_graphs (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT    NOT NULL,
  intent_key      TEXT    NOT NULL,           -- e.g. 'book_flight', 'checkout', 'search_product'
  graph_json      TEXT    NOT NULL,           -- ActionGraph JSON (nodes/edges/requirements)
  version         INTEGER NOT NULL DEFAULT 1,
  active          INTEGER NOT NULL DEFAULT 1,
  owner_token_hash TEXT,
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_action_graph_uniq ON action_graphs(domain, intent_key) WHERE active = 1;
CREATE INDEX IF NOT EXISTS idx_action_graph_domain ON action_graphs(domain);

-- ─── 4. Reality Anchor ──────────────────────────────────────────────
-- Cross-site facts agents submit so other agents can verify reality.
-- e.g. fact_key='flight_DXB_2026-06-01', fact_type='price', value_json={"amount":420,"currency":"USD"}
CREATE TABLE IF NOT EXISTS reality_facts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fact_key     TEXT    NOT NULL,              -- canonical, hashable identifier
  fact_type    TEXT    NOT NULL,              -- 'price' | 'availability' | 'rating' | 'event' | 'count' | 'status'
  domain       TEXT    NOT NULL,              -- source domain
  value_json   TEXT    NOT NULL,              -- the observed value (JSON)
  unit         TEXT,                          -- 'USD' | 'count' | etc
  agent_hash   TEXT    NOT NULL,              -- daily-rotating
  trust_weight REAL    NOT NULL DEFAULT 1.0,  -- copied from domain reputation at submit time
  expires_at   TEXT,
  created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_reality_key ON reality_facts(fact_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reality_type ON reality_facts(fact_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reality_domain ON reality_facts(domain);
