-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 020 — Agent Transaction Primitive (ATP) — v3.9.0
--
-- Promotes WAB from "discover + execute" to "trust + transaction" by
-- introducing intents, transactions, steps and signed receipts as
-- first-class primitives.
--
--   * atp_intents       — signed human → agent authorization contracts
--   * atp_transactions  — executions performed under an intent
--   * atp_steps         — per-step ledger inside a transaction (retry/comp)
--   * atp_receipts      — cryptographically signed proofs of outcome
--   * atp_nonces        — single-use nonces to prevent replay
--
-- All state machines enforced by CHECK constraints so the DB itself
-- refuses illegal transitions.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1) Intents (the human → agent contract) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS atp_intents (
  id              TEXT PRIMARY KEY,                     -- atp_int_<ulid>
  user_id         TEXT NOT NULL,                        -- principal (the human)
  site_id         TEXT,                                 -- optional binding
  agent_id        TEXT,                                 -- optional binding (the delegate)
  purpose         TEXT NOT NULL,                        -- short human-readable purpose
  scope           TEXT NOT NULL,                        -- JSON: { actions:[], domains:[], constraints:{} }
  spend_cap_cents INTEGER NOT NULL DEFAULT 0,           -- 0 = no cap (must be explicit)
  spend_currency  TEXT NOT NULL DEFAULT 'EUR',
  spent_cents     INTEGER NOT NULL DEFAULT 0,           -- running total against the cap
  max_executions  INTEGER NOT NULL DEFAULT 1,           -- how many transactions allowed
  used_executions INTEGER NOT NULL DEFAULT 0,
  expires_at      TEXT NOT NULL,                        -- ISO-8601, hard cutoff
  nonce           TEXT NOT NULL UNIQUE,                 -- prevents replay across intents
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','authorized','consumed','revoked','expired')),
  authorized_at   TEXT,
  authorized_by   TEXT,                                 -- user_id of the approver
  user_signature  TEXT,                                 -- base64 Ed25519 sig of canonical body
  revoked_at      TEXT,
  revoked_reason  TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',           -- JSON
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_atp_intents_user   ON atp_intents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atp_intents_status ON atp_intents(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_atp_intents_site   ON atp_intents(site_id);

-- ── 2) Transactions (executions under an intent) ─────────────────────────────
CREATE TABLE IF NOT EXISTS atp_transactions (
  id               TEXT PRIMARY KEY,                    -- atp_tx_<ulid>
  intent_id        TEXT NOT NULL,
  site_id          TEXT,
  agent_id         TEXT,
  idempotency_key  TEXT NOT NULL,                       -- caller-supplied, unique per intent
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','executing','executed','settled','failed','compensated')),
  amount_cents     INTEGER NOT NULL DEFAULT 0,          -- net effect against intent.spend_cap
  currency         TEXT NOT NULL DEFAULT 'EUR',
  summary          TEXT,                                -- one-line outcome summary
  error            TEXT,                                -- failure reason if status='failed'
  started_at       TEXT,
  completed_at     TEXT,
  settled_at       TEXT,
  compensated_at   TEXT,
  metadata         TEXT NOT NULL DEFAULT '{}',
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (intent_id) REFERENCES atp_intents(id) ON DELETE CASCADE,
  UNIQUE (intent_id, idempotency_key)                   -- the core safety guarantee
);
CREATE INDEX IF NOT EXISTS idx_atp_tx_intent ON atp_transactions(intent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atp_tx_status ON atp_transactions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_atp_tx_site   ON atp_transactions(site_id, created_at DESC);

-- ── 3) Steps (granular ledger for retry / compensation) ──────────────────────
CREATE TABLE IF NOT EXISTS atp_steps (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaction_id  TEXT NOT NULL,
  seq             INTEGER NOT NULL,                     -- step order, 1..N
  action          TEXT NOT NULL,                        -- WAB action name (e.g. "checkout.confirm")
  state           TEXT NOT NULL DEFAULT 'pending'
                  CHECK (state IN ('pending','running','succeeded','failed','skipped','compensated')),
  before_snapshot TEXT,                                 -- JSON: site state before step (optional)
  after_snapshot  TEXT,                                 -- JSON: site state after step
  evidence        TEXT,                                 -- JSON: arbitrary proof (DOM hash, http trace, …)
  compensation    TEXT,                                 -- JSON: rollback action descriptor
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES atp_transactions(id) ON DELETE CASCADE,
  UNIQUE (transaction_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_atp_steps_tx ON atp_steps(transaction_id, seq);

-- ── 4) Receipts (signed proofs of outcome) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS atp_receipts (
  id              TEXT PRIMARY KEY,                     -- atp_rcpt_<ulid>
  transaction_id  TEXT NOT NULL UNIQUE,
  site_id         TEXT,                                 -- the signing party (if any)
  algorithm       TEXT NOT NULL DEFAULT 'ed25519',
  key_id          TEXT,                                 -- fingerprint of signing key
  canonical_body  TEXT NOT NULL,                        -- the canonicalized JSON that was signed
  signature       TEXT NOT NULL,                        -- base64 Ed25519 signature
  public_key      TEXT,                                 -- embedded pub key for offline verification
  issued_at       TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES atp_transactions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_atp_receipts_site ON atp_receipts(site_id, issued_at DESC);

-- ── 5) Nonces (single-use, replay protection) ────────────────────────────────
CREATE TABLE IF NOT EXISTS atp_nonces (
  nonce       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  consumed_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_atp_nonces_user ON atp_nonces(user_id, consumed_at DESC);
