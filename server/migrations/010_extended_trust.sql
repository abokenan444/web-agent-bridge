-- Migration 010: WAB Extended Trust — Certificate Companion & SSL Health Monitoring
-- Per-domain SSL certificate history (Certificate Transparency log) +
-- live SSL monitoring state for the trust dashboard.

CREATE TABLE IF NOT EXISTS cert_history (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  host              TEXT NOT NULL,
  fingerprint_sha256 TEXT NOT NULL,
  issuer            TEXT,
  subject           TEXT,
  serial            TEXT,
  valid_from        TEXT,
  valid_to          TEXT,
  observed_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  source            TEXT DEFAULT 'monitor'  -- 'monitor' | 'shieldqr' | 'sign'
);
CREATE INDEX IF NOT EXISTS idx_cert_history_host_observed ON cert_history(host, observed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_history_host_fp ON cert_history(host, fingerprint_sha256);

CREATE TABLE IF NOT EXISTS ssl_monitor (
  host              TEXT PRIMARY KEY,
  fingerprint_sha256 TEXT,
  issuer            TEXT,
  valid_to          TEXT,
  days_until_expiry INTEGER,
  status            TEXT,                  -- 'active' | 'expiring' | 'expired' | 'error'
  error             TEXT,
  last_checked_at   DATETIME,
  last_alert_at     DATETIME,
  enabled           INTEGER NOT NULL DEFAULT 1,
  owner_user_id     TEXT
);
CREATE INDEX IF NOT EXISTS idx_ssl_monitor_status ON ssl_monitor(status, valid_to);
