-- Growth Suite v2.5 — Tables for Bounty, Score, Data Marketplace,
-- Email Protection, Affiliate Intelligence, Trust Layer

-- ═══ Bounty Network ═══
CREATE TABLE IF NOT EXISTS bounty_reporters (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  token TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  credits INTEGER DEFAULT 0,
  total_reports INTEGER DEFAULT 0,
  verified_reports INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_bounty_reporters_token ON bounty_reporters(token);
CREATE INDEX IF NOT EXISTS idx_bounty_reporters_user ON bounty_reporters(user_id);

CREATE TABLE IF NOT EXISTS bounties (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  url TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  category TEXT DEFAULT 'phishing',
  description TEXT,
  evidence TEXT,
  status TEXT DEFAULT 'PENDING' CHECK(status IN ('PENDING','VERIFIED','REJECTED','DUPLICATE')),
  reward_tier TEXT,
  credits_awarded INTEGER DEFAULT 0,
  scan_result TEXT,
  submitted_at TEXT DEFAULT (datetime('now')),
  verified_at TEXT,
  FOREIGN KEY (reporter_id) REFERENCES bounty_reporters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_bounties_fingerprint ON bounties(fingerprint);
CREATE INDEX IF NOT EXISTS idx_bounties_reporter ON bounties(reporter_id);
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);

-- ═══ WAB Score Cache ═══
CREATE TABLE IF NOT EXISTS wab_scores (
  domain TEXT PRIMARY KEY,
  overall_score INTEGER DEFAULT 0,
  fairness_score INTEGER DEFAULT 0,
  security_score INTEGER DEFAULT 0,
  grade TEXT,
  grade_label TEXT,
  details TEXT DEFAULT '{}',
  computed_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_wab_scores_grade ON wab_scores(grade);

-- ═══ Trust Layer ═══
CREATE TABLE IF NOT EXISTS trust_manifests (
  domain TEXT PRIMARY KEY,
  manifest TEXT NOT NULL,
  verified INTEGER DEFAULT 0,
  verification_result TEXT DEFAULT '{}',
  last_verified_at TEXT,
  registered_at TEXT DEFAULT (datetime('now'))
);

-- ═══ Data Marketplace ═══
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  record_count INTEGER DEFAULT 0,
  format TEXT DEFAULT 'json',
  price_base REAL DEFAULT 0,
  sample_data TEXT,
  metadata TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_datasets_category ON datasets(category);

CREATE TABLE IF NOT EXISTS dataset_purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  dataset_id TEXT NOT NULL,
  license_type TEXT DEFAULT 'RESEARCH',
  price_paid REAL DEFAULT 0,
  status TEXT DEFAULT 'completed',
  purchased_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (dataset_id) REFERENCES datasets(id) ON DELETE CASCADE
);

-- ═══ Email Scan Log ═══
CREATE TABLE IF NOT EXISTS email_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_domain TEXT,
  urls_found INTEGER DEFAULT 0,
  critical_count INTEGER DEFAULT 0,
  warning_count INTEGER DEFAULT 0,
  overall_risk TEXT DEFAULT 'SAFE',
  risk_score INTEGER DEFAULT 0,
  scanned_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_scans_risk ON email_scans(overall_risk);

-- ═══ Affiliate Intelligence ═══
CREATE TABLE IF NOT EXISTS affiliate_reports (
  id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  risk_level TEXT DEFAULT 'LOW',
  fraud_types TEXT DEFAULT '[]',
  trust_score INTEGER DEFAULT 100,
  details TEXT DEFAULT '{}',
  analyzed_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_affiliate_reports_network ON affiliate_reports(network_id);

-- ═══ Seed: Default Datasets ═══
INSERT OR IGNORE INTO datasets (id, category, title, description, record_count, format, price_base, sample_data)
VALUES
  ('ds-threat-intel', 'THREAT_INTEL', 'Real-Time Threat Intelligence Feed',
   'Live phishing, malware, and scam URL data aggregated from 47 threat databases. Updated continuously with sub-minute latency.',
   2847000, 'jsonl', 49.99,
   '[{"url":"http://paypa1-login.xyz","risk":98,"type":"phishing","detected":"2026-04-19"},{"url":"http://free-prize-claim.com","risk":87,"type":"scam","detected":"2026-04-19"}]'),
  ('ds-platform-fair', 'PLATFORM_FAIR', 'Platform Fairness Scores',
   'Quarterly transparency scores for 500+ e-commerce marketplaces covering hidden fees, return policies, dark patterns, and seller fairness.',
   523, 'json', 29.99,
   '[{"domain":"amazon.com","score":86,"grade":"A-","hidden_fees":false,"dark_patterns":2},{"domain":"aliexpress.com","score":68,"grade":"C+","hidden_fees":true,"dark_patterns":7}]'),
  ('ds-affiliate-intel', 'AFFILIATE_INTEL', 'Affiliate Intelligence Report',
   'Commission benchmarks, fraud pattern analysis, and network reliability scores across all major affiliate platforms.',
   856, 'json', 39.99,
   '[{"network":"amazon_associates","trust":82,"shaving_risk":"LOW","avg_payout_days":28},{"network":"clickbank","trust":61,"shaving_risk":"MEDIUM","avg_payout_days":45}]'),
  ('ds-email-threats', 'EMAIL_THREATS', 'Email Phishing Signatures',
   'Curated database of phishing email patterns, sender reputation data, and URL fingerprints for email security.',
   1250000, 'jsonl', 59.99,
   '[{"pattern":"account.*verif","risk":92,"type":"credential_phishing"},{"pattern":"prize.*claim.*now","risk":88,"type":"advance_fee_scam"}]'),
  ('ds-price-history', 'PRICE_HISTORY', 'E-Commerce Price Trends',
   'Historical price tracking data for Amazon, eBay, and Alibaba. Ideal for price comparison and deal-finding AI agents.',
   5400000, 'csv', 79.99,
   '[{"product":"Sony WH-1000XM5","amazon_price":298,"ebay_price":275,"trend":"dropping"},{"product":"iPad Air M2","amazon_price":599,"ebay_price":569,"trend":"stable"}]');
