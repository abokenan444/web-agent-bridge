-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 025 — Webhook Subscriptions for Revocations (v3.16.0)
--
-- Lets ecosystem participants (agent frameworks, security tools, allow-list
-- mirrors) subscribe to instant push notifications for revocation events
-- instead of polling /api/trusted-domains.json every hour.
--
-- Delivery is best-effort with retries (3 attempts: t+0, t+30s, t+5m).
-- Every delivery is HMAC-SHA256 signed using the subscription secret.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id            TEXT PRIMARY KEY,                       -- whsub_<ulid>
  user_id       TEXT NOT NULL,
  url           TEXT NOT NULL,                          -- HTTPS endpoint
  secret        TEXT NOT NULL,                          -- shared HMAC secret (base64, 32 bytes)
  events        TEXT NOT NULL DEFAULT 'revocation.opened,revocation.reinstated,revocation.appeal_decided',
  active        INTEGER NOT NULL DEFAULT 1,
  description   TEXT,
  last_success_at TEXT,
  last_error_at TEXT,
  last_error    TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_user
  ON webhook_subscriptions(user_id, active);

CREATE INDEX IF NOT EXISTS idx_webhook_subs_active
  ON webhook_subscriptions(active);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            TEXT PRIMARY KEY,                       -- whd_<ulid>
  subscription_id TEXT NOT NULL,
  event_id      TEXT NOT NULL,                          -- evt_<ulid>
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,                          -- raw JSON body sent
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','success','failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_status_code INTEGER,
  last_error    TEXT,
  next_retry_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  delivered_at  TEXT,
  FOREIGN KEY (subscription_id) REFERENCES webhook_subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_sub
  ON webhook_deliveries(subscription_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status
  ON webhook_deliveries(status, next_retry_at);
