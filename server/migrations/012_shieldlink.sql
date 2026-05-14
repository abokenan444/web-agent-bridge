-- Migration 012: WAB ShieldLink (Verified Links / Anti-Phishing for premium customers)
--
-- Tables:
--   shieldlink_brands       — verified brand identities (one row per verified site)
--   shieldlink_keys         — per-site Ed25519 signing keys (private key encrypted at rest)
--   shieldlink_links        — issued signed links (sessions / payment / invoice)
--   shieldlink_link_events  — open / scan / report events for issued links
--   shieldlink_reports      — phishing reports submitted by anyone
--   shieldlink_name_holds   — reserved/blocked brand display names

CREATE TABLE IF NOT EXISTS shieldlink_brands (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id        TEXT NOT NULL,                                                 -- FK -> sites.id
  domain         TEXT NOT NULL UNIQUE,
  display_name   TEXT NOT NULL,
  display_name_normalized TEXT NOT NULL,
  category       TEXT,                                                          -- 'bank' | 'payments' | 'gov' | 'ecommerce' | 'other'
  country        TEXT,
  logo_url       TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','rejected','suspended')),
  verified_badge INTEGER NOT NULL DEFAULT 0,
  reputation     INTEGER NOT NULL DEFAULT 100,
  notes          TEXT,
  reviewed_by    TEXT,
  reviewed_at    DATETIME,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shieldlink_brands_status ON shieldlink_brands(status);
CREATE INDEX IF NOT EXISTS idx_shieldlink_brands_normalized ON shieldlink_brands(display_name_normalized);

CREATE TABLE IF NOT EXISTS shieldlink_keys (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id        INTEGER NOT NULL REFERENCES shieldlink_brands(id) ON DELETE CASCADE,
  public_key      TEXT NOT NULL,                                                 -- base64 raw 32-byte
  private_key_enc TEXT NOT NULL,                                                 -- base64(AES-256-GCM(priv))
  fingerprint     TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  rotated_at      DATETIME
);
CREATE INDEX IF NOT EXISTS idx_shieldlink_keys_brand ON shieldlink_keys(brand_id, active);

CREATE TABLE IF NOT EXISTS shieldlink_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  token         TEXT NOT NULL UNIQUE,                                           -- short opaque public id
  brand_id      INTEGER NOT NULL REFERENCES shieldlink_brands(id) ON DELETE CASCADE,
  site_id       TEXT NOT NULL,
  target_url    TEXT NOT NULL,                                                  -- the actual URL we redirect to after preview
  purpose       TEXT NOT NULL CHECK(purpose IN ('payment','invoice','login','generic')),
  amount_cents  INTEGER,
  currency      TEXT,
  payee_name    TEXT,
  reference     TEXT,                                                           -- merchant invoice/session id
  signature     TEXT NOT NULL,                                                  -- base64 ed25519 signature over canonical payload
  key_id        TEXT NOT NULL,                                                  -- fingerprint of the signing key
  payload_json  TEXT NOT NULL,                                                  -- canonical signed payload, for verifier to re-check
  status        TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  expires_at    DATETIME NOT NULL,
  created_by    TEXT,                                                           -- user_id who issued
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  revoked_at    DATETIME,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_shieldlink_links_brand ON shieldlink_links(brand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shieldlink_links_status ON shieldlink_links(status, expires_at);

CREATE TABLE IF NOT EXISTS shieldlink_link_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id     INTEGER NOT NULL REFERENCES shieldlink_links(id) ON DELETE CASCADE,
  event       TEXT NOT NULL CHECK(event IN ('open','confirm','cancel','flag','verify_fail')),
  ip          TEXT,
  user_agent  TEXT,
  ref         TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shieldlink_link_events_link ON shieldlink_link_events(link_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shieldlink_reports (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  link_id       INTEGER REFERENCES shieldlink_links(id) ON DELETE SET NULL,
  url           TEXT NOT NULL,
  reason        TEXT,
  reporter_ip   TEXT,
  reporter_id   TEXT,
  status        TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','reviewing','resolved','rejected')),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at   DATETIME
);
CREATE INDEX IF NOT EXISTS idx_shieldlink_reports_status ON shieldlink_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS shieldlink_name_holds (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern       TEXT NOT NULL,                                                  -- normalized name or regex
  pattern_kind  TEXT NOT NULL DEFAULT 'literal' CHECK(pattern_kind IN ('literal','regex')),
  reason        TEXT,
  created_by    TEXT,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shieldlink_name_holds ON shieldlink_name_holds(pattern, pattern_kind);

-- Seed common impersonation targets (Saudi banks + payment networks).
-- Brands themselves can register and claim these names by proving DNS ownership.
INSERT OR IGNORE INTO shieldlink_name_holds (pattern, pattern_kind, reason)
VALUES
  ('stcpay', 'literal', 'High-value impersonation target'),
  ('stc-pay', 'literal', 'High-value impersonation target'),
  ('alrajhi', 'literal', 'High-value impersonation target'),
  ('alrajhibank', 'literal', 'High-value impersonation target'),
  ('snb', 'literal', 'High-value impersonation target'),
  ('riyadbank', 'literal', 'High-value impersonation target'),
  ('mada', 'literal', 'High-value impersonation target'),
  ('sarie', 'literal', 'High-value impersonation target'),
  ('paypal', 'literal', 'High-value impersonation target'),
  ('visa', 'literal', 'High-value impersonation target'),
  ('mastercard', 'literal', 'High-value impersonation target');
