-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 018 — Commercial foundations (v3.8.0)
--
-- Adds tables backing the four open-core monetization pillars:
--   * wab_partners              — Certified Partner Program (Basic/Verified/Premium)
--   * wab_partner_applications  — self-serve + manual-review queue
--   * wab_api_keys              — Trust Graph tiered access (free/pro/enterprise)
--   * wab_api_usage             — per-key, per-day metering
--   * wab_governance_workspaces — Governance SaaS tenants
--   * wab_governance_members    — per-workspace user grants
--   * wab_governance_events     — append-only audit log
--   * wab_licenses              — Enterprise Mesh license registry (verify-side)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Certified Partner Program ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wab_partners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  partner_id    TEXT NOT NULL UNIQUE,            -- slug, e.g. "stcpay"
  display_name  TEXT NOT NULL,
  domain        TEXT NOT NULL,
  tier          TEXT NOT NULL DEFAULT 'basic'    -- basic | verified | premium
                CHECK (tier IN ('basic','verified','premium')),
  status        TEXT NOT NULL DEFAULT 'active'   -- active | suspended | revoked
                CHECK (status IN ('active','suspended','revoked')),
  contact_email TEXT NOT NULL,
  country       TEXT,
  category      TEXT,                            -- bank|ecommerce|messaging|...
  website       TEXT,
  logo_url      TEXT,
  badge_token   TEXT UNIQUE,                     -- opaque token for embeddable badge
  approved_at   TEXT,
  approved_by   TEXT,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wab_partners_tier   ON wab_partners(tier, status);
CREATE INDEX IF NOT EXISTS idx_wab_partners_domain ON wab_partners(domain);

CREATE TABLE IF NOT EXISTS wab_partner_applications (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  application_id TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  domain        TEXT NOT NULL,
  requested_tier TEXT NOT NULL DEFAULT 'basic'
                CHECK (requested_tier IN ('basic','verified','premium')),
  contact_email TEXT NOT NULL,
  contact_name  TEXT,
  country       TEXT,
  category      TEXT,
  website       TEXT,
  use_case      TEXT,
  ring4_status  TEXT,                            -- snapshot at apply time
  handshake_score INTEGER,                       -- 0..9 from live-handshake
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','withdrawn')),
  decision_notes TEXT,
  decided_at    TEXT,
  decided_by    TEXT,
  ip_hash       TEXT,                            -- privacy-preserving
  user_agent    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_partner_apps_status ON wab_partner_applications(status, requested_tier);

-- ── 2) Trust Graph API — tiered keys ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wab_api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id        TEXT NOT NULL UNIQUE,            -- public id (visible)
  key_hash      TEXT NOT NULL,                   -- sha256 of secret (raw secret never stored)
  owner_email   TEXT NOT NULL,
  owner_name    TEXT,
  tier          TEXT NOT NULL DEFAULT 'free'
                CHECK (tier IN ('free','pro','enterprise')),
  monthly_quota INTEGER NOT NULL DEFAULT 1000,   -- requests per calendar month
  rate_per_min  INTEGER NOT NULL DEFAULT 30,     -- requests per minute
  scopes        TEXT NOT NULL DEFAULT '["trust:read"]', -- JSON array
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','revoked')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at  TEXT,
  revoked_at    TEXT,
  notes         TEXT
);
CREATE INDEX IF NOT EXISTS idx_wab_api_keys_owner ON wab_api_keys(owner_email);
CREATE INDEX IF NOT EXISTS idx_wab_api_keys_hash  ON wab_api_keys(key_hash);

CREATE TABLE IF NOT EXISTS wab_api_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  key_id        TEXT NOT NULL,
  day           TEXT NOT NULL,                   -- YYYY-MM-DD UTC
  endpoint      TEXT NOT NULL,
  count         INTEGER NOT NULL DEFAULT 0,
  bytes_out     INTEGER NOT NULL DEFAULT 0,
  UNIQUE(key_id, day, endpoint)
);
CREATE INDEX IF NOT EXISTS idx_wab_api_usage_key_day ON wab_api_usage(key_id, day);

-- ── 3) Governance SaaS ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wab_governance_workspaces (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL UNIQUE,
  display_name  TEXT NOT NULL,
  plan          TEXT NOT NULL DEFAULT 'team'
                CHECK (plan IN ('team','business','enterprise')),
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','suspended','closed')),
  owner_email   TEXT NOT NULL,
  retention_days INTEGER NOT NULL DEFAULT 90,
  max_members   INTEGER NOT NULL DEFAULT 5,
  max_events_per_month INTEGER NOT NULL DEFAULT 100000,
  api_key_id    TEXT,                            -- write-token reference (FK wab_api_keys.key_id)
  region        TEXT NOT NULL DEFAULT 'eu',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wab_governance_members (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id  TEXT NOT NULL,
  email         TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('owner','admin','reviewer','viewer')),
  invited_at    TEXT NOT NULL DEFAULT (datetime('now')),
  accepted_at   TEXT,
  UNIQUE(workspace_id, email)
);

CREATE TABLE IF NOT EXISTS wab_governance_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id      TEXT NOT NULL UNIQUE,
  workspace_id  TEXT NOT NULL,
  source        TEXT NOT NULL,                   -- agent name / system source
  event_type    TEXT NOT NULL,                   -- refusal|approval|override|policy|...
  severity      TEXT NOT NULL DEFAULT 'info'
                CHECK (severity IN ('info','low','medium','high','critical')),
  subject       TEXT,                            -- domain/project/user-pseudo-id
  article       TEXT,                            -- constitutional article invoked
  outcome       TEXT,                            -- allowed|refused|deferred
  detail        TEXT,                            -- JSON or text (length-capped)
  signature     TEXT,                            -- optional Ed25519 over canonical event
  signed_by_pk  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_gov_events_ws   ON wab_governance_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gov_events_type ON wab_governance_events(workspace_id, event_type);

-- ── 4) Enterprise Mesh — license registry (verify-side only) ─────────────────
CREATE TABLE IF NOT EXISTS wab_licenses (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  license_id    TEXT NOT NULL UNIQUE,
  fingerprint   TEXT NOT NULL,                   -- sha256 of canonical license body
  tier          TEXT NOT NULL DEFAULT 'enterprise'
                CHECK (tier IN ('enterprise','enterprise-airgap')),
  owner_org     TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  seats         INTEGER NOT NULL DEFAULT 1,
  features      TEXT NOT NULL DEFAULT '[]',      -- JSON array
  issued_at     TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','revoked','expired')),
  revoked_at    TEXT,
  revoked_reason TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_wab_licenses_status ON wab_licenses(status, expires_at);
