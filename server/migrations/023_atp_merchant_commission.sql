-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 023 — ATP Merchant Commission (v3.10.0)
--
-- WAB takes a small platform commission (default 0.1% / 10 bps) on every
-- successful merchant transaction settled through ATP on a paid plan.
-- Free-tier sites and platform self-payments are exempt.
--
-- One row per settled atp_transactions.id. State machine:
--   pending   → newly recorded
--   invoiced  → rolled into a Stripe invoice / payout cycle
--   collected → billed and paid by merchant
--   refunded  → underlying tx was compensated
--   waived   → manually waived by an admin
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS atp_commissions (
  id                  TEXT PRIMARY KEY,                     -- atp_com_<ulid>
  transaction_id      TEXT NOT NULL UNIQUE,                 -- one commission per tx
  intent_id           TEXT NOT NULL,
  merchant_user_id    TEXT NOT NULL,                        -- the site owner
  merchant_site_id    TEXT,
  merchant_tier       TEXT NOT NULL,                        -- snapshot at charge time
  gross_amount_cents  INTEGER NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'EUR',
  commission_bps      INTEGER NOT NULL DEFAULT 10,          -- 10 bps = 0.10%
  commission_cents    INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','invoiced','collected','refunded','waived')),
  external_ref        TEXT,                                 -- payment gateway ref (PI id, etc.)
  notes               TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (transaction_id) REFERENCES atp_transactions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_atp_commissions_merchant
  ON atp_commissions(merchant_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atp_commissions_site
  ON atp_commissions(merchant_site_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_atp_commissions_status
  ON atp_commissions(status, created_at DESC);
