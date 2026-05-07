-- Outreach Agent — site analysis + email queue + suppression list
-- Strict human-in-the-loop: drafts default to 'pending' and require admin approval.

CREATE TABLE IF NOT EXISTS outreach_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_url TEXT NOT NULL,
  host TEXT NOT NULL,
  contact_email TEXT,
  detected_lang TEXT,
  site_kind TEXT,
  signals_json TEXT,
  suggested_features_json TEXT,
  draft_subject TEXT,
  draft_body_html TEXT,
  draft_body_text TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  -- pending | approved | sending | sent | failed | suppressed | skipped
  unsubscribe_token TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_outreach_status ON outreach_targets(status);
CREATE INDEX IF NOT EXISTS idx_outreach_host ON outreach_targets(host);
CREATE INDEX IF NOT EXISTS idx_outreach_email ON outreach_targets(contact_email);

CREATE TABLE IF NOT EXISTS outreach_suppression (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_or_host TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS outreach_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER,
  event TEXT NOT NULL,
  -- scanned | drafted | approved | sent | failed | bounced | unsubscribed | opened
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (target_id) REFERENCES outreach_targets(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_target ON outreach_log(target_id);
CREATE INDEX IF NOT EXISTS idx_outreach_log_event ON outreach_log(event);
