-- Migration 005: Marketplace & Usage Metering tables

-- Marketplace listings
CREATE TABLE IF NOT EXISTS marketplace_listings (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  type TEXT NOT NULL,
  category TEXT DEFAULT 'automation',
  seller_id TEXT NOT NULL,
  seller_name TEXT DEFAULT 'Anonymous',
  price REAL DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  version TEXT DEFAULT '1.0.0',
  tags TEXT DEFAULT '[]',
  icon TEXT,
  readme TEXT DEFAULT '',
  install_command TEXT,
  config_schema TEXT DEFAULT '{}',
  entry_point TEXT,
  installs INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  rating REAL DEFAULT 0,
  review_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending_review',
  rejection_reason TEXT,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mkt_listings_status ON marketplace_listings(status);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_category ON marketplace_listings(category);
CREATE INDEX IF NOT EXISTS idx_mkt_listings_seller ON marketplace_listings(seller_id);

-- Marketplace purchases
CREATE TABLE IF NOT EXISTS marketplace_purchases (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  listing_name TEXT,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  price REAL DEFAULT 0,
  commission REAL DEFAULT 0,
  seller_earning REAL DEFAULT 0,
  currency TEXT DEFAULT 'usd',
  status TEXT DEFAULT 'pending_payment',
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id)
);

CREATE INDEX IF NOT EXISTS idx_mkt_purchases_buyer ON marketplace_purchases(buyer_id);
CREATE INDEX IF NOT EXISTS idx_mkt_purchases_seller ON marketplace_purchases(seller_id);

-- Marketplace reviews
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  rating INTEGER NOT NULL,
  comment TEXT DEFAULT '',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (listing_id) REFERENCES marketplace_listings(id)
);

-- Seller earnings
CREATE TABLE IF NOT EXISTS marketplace_earnings (
  seller_id TEXT PRIMARY KEY,
  total REAL DEFAULT 0,
  pending REAL DEFAULT 0,
  paid REAL DEFAULT 0,
  last_payout INTEGER
);

-- Usage metering daily records
CREATE TABLE IF NOT EXISTS usage_metering (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id TEXT NOT NULL,
  metric TEXT NOT NULL,
  date TEXT NOT NULL,
  count INTEGER DEFAULT 0,
  overage INTEGER DEFAULT 0,
  overage_cost REAL DEFAULT 0,
  UNIQUE(entity_id, metric, date)
);

CREATE INDEX IF NOT EXISTS idx_usage_entity ON usage_metering(entity_id);
CREATE INDEX IF NOT EXISTS idx_usage_date ON usage_metering(date);

-- Hosted runtime instances
CREATE TABLE IF NOT EXISTS hosted_instances (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  tier TEXT DEFAULT 'starter',
  region TEXT DEFAULT 'auto',
  cpu TEXT DEFAULT '0.5',
  memory TEXT DEFAULT '512',
  status TEXT DEFAULT 'starting',
  execution_count INTEGER DEFAULT 0,
  compute_minutes REAL DEFAULT 0,
  errors INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  last_activity INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hosted_agent ON hosted_instances(agent_id);
CREATE INDEX IF NOT EXISTS idx_hosted_status ON hosted_instances(status);

-- Hosted executions
CREATE TABLE IF NOT EXISTS hosted_executions (
  id TEXT PRIMARY KEY,
  instance_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  task_type TEXT,
  task_action TEXT,
  status TEXT DEFAULT 'running',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  compute_ms INTEGER DEFAULT 0,
  error TEXT,
  FOREIGN KEY (instance_id) REFERENCES hosted_instances(id)
);

CREATE INDEX IF NOT EXISTS idx_hexe_instance ON hosted_executions(instance_id);
