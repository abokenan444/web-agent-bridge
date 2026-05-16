-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 021 — Visitor analytics (page_visits)
--
-- Captures every public page request (registered or anonymous) so the admin
-- panel can show real traffic data. IPs are hashed for privacy.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS page_visits (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  path            TEXT    NOT NULL,
  query_string    TEXT,
  referrer        TEXT,
  host            TEXT,
  user_agent      TEXT,
  ip_hash         TEXT,         -- sha256(ip + salt), first 32 chars
  country         TEXT,         -- best-effort from Cloudflare/CF-IPCountry; nullable
  device          TEXT,         -- desktop | mobile | tablet | bot
  is_bot          INTEGER NOT NULL DEFAULT 0,
  session_id      TEXT,         -- random per-visitor cookie or derived from ip_hash+UA
  user_id         TEXT,         -- nullable; populated if request carried an auth cookie/token
  status_code     INTEGER,      -- HTTP status that was returned
  duration_ms     INTEGER,      -- server-side handler time
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pv_created       ON page_visits(created_at);
CREATE INDEX IF NOT EXISTS idx_pv_path          ON page_visits(path);
CREATE INDEX IF NOT EXISTS idx_pv_ip            ON page_visits(ip_hash);
CREATE INDEX IF NOT EXISTS idx_pv_session       ON page_visits(session_id);
CREATE INDEX IF NOT EXISTS idx_pv_is_bot        ON page_visits(is_bot);
CREATE INDEX IF NOT EXISTS idx_pv_user          ON page_visits(user_id);
