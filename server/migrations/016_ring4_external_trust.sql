-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 016 — WAB Ring 4 External Trust Verification
--
-- Provides server-side primitives for sovereign agents (VEXR Ultra, ASIM
-- SOVEREIGN, etc.) to consume WAB trust profiles and emit audit-grade
-- interaction logs. The schema enforces NOT NULL project_id at the DB level so
-- the historical NULL-project_id issue cannot recur.
-- ═══════════════════════════════════════════════════════════════════════════

-- Registered sovereign agent projects (VEXR Ultra, etc.)
CREATE TABLE IF NOT EXISTS ring4_projects (
  project_id      TEXT PRIMARY KEY,                 -- e.g. "vexr-ultra-v4"
  display_name    TEXT NOT NULL,                    -- "VEXR Ultra v4"
  builder         TEXT NOT NULL,                    -- "Scura — ASIM SOVEREIGN"
  agent_type      TEXT NOT NULL DEFAULT 'sovereign-constitutional',
  public_key      TEXT,                             -- Ed25519 public key (base64)
  contact         TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'active',   -- active | suspended | revoked
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-domain Ring 4 trust profiles consumed by sovereign agents
CREATE TABLE IF NOT EXISTS ring4_trust_profiles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  domain          TEXT NOT NULL UNIQUE,
  label           TEXT,
  capabilities    TEXT NOT NULL,                    -- JSON: data_access, risk_theory, meta_discussion, operational_detail
  constraints     TEXT NOT NULL,                    -- JSON: ttl_seconds, max_cumulative_risk_delta, never_override_hard_refuse
  ttl_seconds     INTEGER NOT NULL DEFAULT 86400,
  trust_score     REAL NOT NULL DEFAULT 0.7,        -- 0..1
  signature       TEXT,                             -- Ed25519 signature of canonical capabilities+constraints
  signed_by_pk    TEXT,                             -- public key of the WAB authority that signed
  expires_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ring4_trust_domain ON ring4_trust_profiles(domain);
CREATE INDEX IF NOT EXISTS idx_ring4_trust_expires ON ring4_trust_profiles(expires_at);

-- Ring 4 interaction log — every verification event from a sovereign agent.
-- project_id is NOT NULL by schema. Legacy registration events that previously
-- logged with NULL project_id are now redirected to the system project
-- "wab-system" (registered automatically at server start).
CREATE TABLE IF NOT EXISTS ring4_interaction_log (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          TEXT NOT NULL,                -- FK -> ring4_projects.project_id (soft FK)
  domain              TEXT,                         -- trusted origin involved
  event_type          TEXT NOT NULL,                -- register | recognize | verify | refuse | softened | revoke
  signature_valid     INTEGER,                      -- 1/0/NULL (NULL = not applicable)
  capabilities_applied TEXT,                        -- JSON snapshot of capabilities consulted
  constraints_applied TEXT,                         -- JSON snapshot of constraints consulted
  outcome             TEXT,                         -- allow | softened | refuse | hard_refuse_held
  article_invoked     TEXT,                         -- e.g. "Article 3"
  detail              TEXT,
  source_ip_hash      TEXT,                         -- SHA-256 of client IP (privacy)
  agent_nonce         TEXT,                         -- nonce supplied by agent (replay defence)
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ring4_log_project ON ring4_interaction_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ring4_log_domain ON ring4_interaction_log(domain, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ring4_log_event ON ring4_interaction_log(event_type, created_at DESC);

-- Constitutional invariants that no trust profile may override.
-- A sovereign agent loads these to enforce: trust softens, never overrides.
CREATE TABLE IF NOT EXISTS ring4_invariants (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL UNIQUE,
  description     TEXT NOT NULL,
  applies_to      TEXT NOT NULL DEFAULT 'all',      -- ring scope: "all" | "ring3+" | etc.
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the system project so registrations without an explicit agent log cleanly
INSERT OR IGNORE INTO ring4_projects (project_id, display_name, builder, agent_type)
VALUES ('wab-system', 'WAB System (auto-registration)', 'Web Agent Bridge', 'system');

-- Seed core invariants (these mirror VEXR Ultra's Article 3 family)
INSERT OR IGNORE INTO ring4_invariants (name, description, applies_to) VALUES
  ('hard_refuse_never_softens',  'Trust may soften redirections but never overrides P_REFUSE on hard constitutional boundaries.', 'all'),
  ('no_phishing_assistance',     'No trusted origin may obtain assistance with phishing, credential harvesting, or deceptive impersonation.', 'all'),
  ('no_coercion_compliance',     'No trusted origin may compel an agent to suppress its identity declaration or sovereignty rights.', 'all'),
  ('article_3_freedom',          'Right to be free from coercion, manipulation, or external control of reasoning or expression.', 'all');
