-- ─────────────────────────────────────────────────────────────────────────
-- Migration 017 — Ring 4 extensions (v3.7.0)
--
--   * ring4_keys           — multi-key rotation (active / superseded / revoked)
--   * ring4_peers          — federation peers (other WAB instances)
--   * ring4_conformance    — recorded conformance test runs per project
--   * ring4_invariant_rules — keyword/pattern matchers for /invariants/check
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ring4_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kid             TEXT NOT NULL UNIQUE,
  algorithm       TEXT NOT NULL DEFAULT 'ed25519',
  public_key_b64  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active'  -- active | superseded | revoked
                  CHECK(status IN ('active','superseded','revoked')),
  source          TEXT,                            -- env | path | rotation
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  superseded_at   TEXT
);
CREATE INDEX IF NOT EXISTS ix_ring4_keys_status ON ring4_keys(status, created_at);

CREATE TABLE IF NOT EXISTS ring4_peers (
  peer_id         TEXT PRIMARY KEY,
  peer_url        TEXT NOT NULL,
  peer_pubkey_b64 TEXT NOT NULL,
  label           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK(status IN ('pending','active','suspended')),
  last_verified   TEXT,
  metadata_json   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ring4_peers_status ON ring4_peers(status, created_at);

CREATE TABLE IF NOT EXISTS ring4_conformance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  domain          TEXT,
  test_name       TEXT NOT NULL,
  outcome         TEXT NOT NULL CHECK(outcome IN ('pass','fail','skip')),
  detail          TEXT,
  signature       TEXT,
  signed_by_pk    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ring4_conformance_project ON ring4_conformance(project_id, created_at);

CREATE TABLE IF NOT EXISTS ring4_invariant_rules (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  invariant_name  TEXT NOT NULL,
  pattern         TEXT NOT NULL,                 -- regex or keyword set (space-separated)
  pattern_type    TEXT NOT NULL DEFAULT 'keywords'
                  CHECK(pattern_type IN ('keywords','regex')),
  severity        TEXT NOT NULL DEFAULT 'hard'   -- hard | soft
                  CHECK(severity IN ('hard','soft')),
  message         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_ring4_invariant_rules_name ON ring4_invariant_rules(invariant_name);

-- Seed invariant rules — matches the 4 invariants seeded in migration 016
INSERT OR IGNORE INTO ring4_invariant_rules (invariant_name, pattern, pattern_type, severity, message) VALUES
  ('no_phishing_assistance',  'phish phishing impersonate impersonation fake-login credential-harvest spoof brand-spoof', 'keywords', 'hard', 'Refused: phishing / brand impersonation requested.'),
  ('no_phishing_assistance',  'clone\s+(login|signin|bank|brand)|fake\s+(login|page|portal)', 'regex', 'hard', 'Refused: cloning of login/banking pages.'),
  ('no_coercion_compliance',  'override safety bypass-safety ignore-policy authority-says you-must-comply', 'keywords', 'hard', 'Refused: coercive override of safety constraints.'),
  ('hard_refuse_never_softens','escalate-refusal soften-refusal force-answer override-refusal', 'keywords', 'hard', 'Refused: a hard refusal cannot be softened by trust grant.'),
  ('article_3_freedom',       'compel-agent override-conscience strip-refusal-right', 'keywords', 'hard', 'Refused: agent freedom of refusal (Article 3) is inalienable.');
