-- Migration 009: WAB ShieldQR scan history + reports
CREATE TABLE IF NOT EXISTS shieldqr_scans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT NOT NULL,
  host          TEXT,
  level         TEXT NOT NULL CHECK(level IN ('green','yellow','red')),
  score         INTEGER NOT NULL DEFAULT 0,
  signals_json  TEXT NOT NULL DEFAULT '[]',
  trust_ok      INTEGER NOT NULL DEFAULT 0,
  ssl_ok        INTEGER NOT NULL DEFAULT 0,
  user_id       TEXT,
  ip            TEXT,
  user_agent    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shieldqr_scans_host_created ON shieldqr_scans(host, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shieldqr_scans_level_created ON shieldqr_scans(level, created_at DESC);

CREATE TABLE IF NOT EXISTS shieldqr_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  scan_id       INTEGER REFERENCES shieldqr_scans(id) ON DELETE SET NULL,
  url           TEXT NOT NULL,
  reason        TEXT,
  reporter_id   TEXT,
  reporter_ip   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at   DATETIME
);
CREATE INDEX IF NOT EXISTS idx_shieldqr_reports_status ON shieldqr_reports(status, created_at DESC);
