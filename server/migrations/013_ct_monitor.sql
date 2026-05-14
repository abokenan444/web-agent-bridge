-- Migration 013: Certificate Transparency Monitor
-- Adds CT-log tracking columns to ssl_monitor so the WAB Trust Layer
-- can detect new certificates issued (and re-sign wab.json) automatically.
-- cert_history.source already exists from 010_extended_trust.sql; the
-- 'ct_log' value is added implicitly (column has no CHECK constraint).

ALTER TABLE ssl_monitor ADD COLUMN ct_monitor_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE ssl_monitor ADD COLUMN ct_last_checked    TEXT;
ALTER TABLE ssl_monitor ADD COLUMN ct_pending_resign  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ssl_monitor ADD COLUMN ct_last_thumbprint TEXT;

CREATE INDEX IF NOT EXISTS idx_ssl_monitor_ct_pending
  ON ssl_monitor(ct_pending_resign, ct_last_checked);
