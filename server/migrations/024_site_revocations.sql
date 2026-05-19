-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 024 — Site Revocations & Appeals (v3.11.0)
--
-- A transparent, appealable revocation framework for WAB-registered domains.
--
-- Three authority tiers:
--   • owner_disable  — site owner self-pauses (instant, no appeal needed)
--   • suspended      — platform / community suspension (temporary, appealable)
--   • revoked        — permanent revocation (after failed appeal or hard breach)
--
-- Status state machine for `site_revocations.status`:
--   pending_appeal  → opened, within 7-day window
--   appealed        → owner submitted a formal appeal
--   overturned      → appeal upheld → site reinstated
--   final           → appeal rejected OR window expired → revocation permanent
--   reinstated      → manually lifted by an admin (e.g. governance review)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS site_revocations (
  id                TEXT PRIMARY KEY,                       -- rev_<ulid>
  site_id           TEXT NOT NULL,
  domain            TEXT NOT NULL,                          -- denormalised for fast lookup
  type              TEXT NOT NULL
                    CHECK (type IN ('owner_disable','suspended','revoked')),
  reason_code       TEXT NOT NULL,                          -- e.g. 'fraud','abuse','policy_breach','owner_request'
  reason_text       TEXT NOT NULL,                          -- human explanation (public)
  evidence_url      TEXT,                                   -- optional public evidence link
  decided_by        TEXT NOT NULL,                          -- admin id or 'owner:<user_id>' or 'system:<rule>'
  decided_at        TEXT NOT NULL DEFAULT (datetime('now')),
  appeal_deadline   TEXT,                                   -- ISO ts; NULL means no appeal allowed (owner_disable)
  status            TEXT NOT NULL DEFAULT 'pending_appeal'
                    CHECK (status IN ('pending_appeal','appealed','overturned','final','reinstated')),
  finalized_at      TEXT,
  reinstated_at     TEXT,
  reinstated_by     TEXT,
  signature         TEXT,                                   -- Ed25519 over canonical JSON (operator signature)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_site_revocations_site
  ON site_revocations(site_id, decided_at DESC);

CREATE INDEX IF NOT EXISTS idx_site_revocations_domain
  ON site_revocations(domain, status);

CREATE INDEX IF NOT EXISTS idx_site_revocations_status
  ON site_revocations(status, appeal_deadline);

-- Owner appeals against a revocation. One revocation may receive at most one
-- accepted appeal — repeated submissions overwrite the open one.
CREATE TABLE IF NOT EXISTS revocation_appeals (
  id                TEXT PRIMARY KEY,                       -- app_<ulid>
  revocation_id     TEXT NOT NULL UNIQUE,
  owner_user_id     TEXT NOT NULL,
  statement         TEXT NOT NULL,                          -- owner's argument
  remediation_proof TEXT,                                   -- optional URLs / hashes
  submitted_at      TEXT NOT NULL DEFAULT (datetime('now')),
  decision          TEXT
                    CHECK (decision IN ('upheld','rejected') OR decision IS NULL),
  decision_reason   TEXT,
  decided_by        TEXT,                                   -- admin id
  decided_at        TEXT,
  FOREIGN KEY (revocation_id) REFERENCES site_revocations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_revocation_appeals_owner
  ON revocation_appeals(owner_user_id, submitted_at DESC);
