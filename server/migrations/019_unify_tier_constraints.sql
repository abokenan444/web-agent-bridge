-- ─────────────────────────────────────────────────────────────────────
-- Migration 019: Unify tier CHECK constraints with canonical plans table
--
-- Background:
--   plans table (008_plans.sql) seeds: free / pro / business / enterprise
--   Legacy CHECK constraints accepted:  free / starter / pro / enterprise
--   ⇒ Cannot purchase the canonical 'business' tier because the row would
--     violate the CHECK constraint on sites.tier, subscriptions.tier,
--     stripe_subscriptions.tier, free_grants.granted_tier and
--     workspace_subscriptions.plan.
--
-- This migration accepts BOTH 'starter' (legacy / kept for back-compat
-- with any existing rows or external scripts) AND 'business' (canonical
-- new tier name).
--
-- SQLite-recommended pattern: create new table, copy rows, drop old,
-- rename new, recreate indexes. defer_foreign_keys lets us do it inside
-- a single transaction.
-- ─────────────────────────────────────────────────────────────────────

PRAGMA defer_foreign_keys = ON;

-- ── 1) sites ─────────────────────────────────────────────────────────
CREATE TABLE sites_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tier TEXT DEFAULT 'free' CHECK(tier IN ('free','starter','pro','business','enterprise')),
  license_key TEXT UNIQUE NOT NULL,
  api_key TEXT UNIQUE,
  config TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO sites_new SELECT * FROM sites;
DROP TABLE sites;
ALTER TABLE sites_new RENAME TO sites;
CREATE INDEX IF NOT EXISTS idx_sites_domain  ON sites(domain);
CREATE INDEX IF NOT EXISTS idx_sites_license ON sites(license_key);

-- ── 2) subscriptions ────────────────────────────────────────────────
CREATE TABLE subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('free','starter','pro','business','enterprise')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','cancelled','expired','trial')),
  started_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
INSERT INTO subscriptions_new SELECT * FROM subscriptions;
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;

-- ── 3) free_grants ──────────────────────────────────────────────────
CREATE TABLE free_grants_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT,
  granted_tier TEXT NOT NULL CHECK(granted_tier IN ('starter','pro','business','enterprise')),
  reason TEXT,
  granted_by TEXT NOT NULL,
  granted_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  active INTEGER DEFAULT 1,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES admins(id)
);
INSERT INTO free_grants_new SELECT * FROM free_grants;
DROP TABLE free_grants;
ALTER TABLE free_grants_new RENAME TO free_grants;

-- ── 4) stripe_subscriptions ─────────────────────────────────────────
CREATE TABLE stripe_subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  stripe_subscription_id TEXT UNIQUE,
  stripe_price_id TEXT,
  tier TEXT NOT NULL CHECK(tier IN ('starter','pro','business','enterprise')),
  status TEXT DEFAULT 'active' CHECK(status IN ('active','cancelled','past_due','trialing','incomplete')),
  current_period_start TEXT,
  current_period_end TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);
INSERT INTO stripe_subscriptions_new SELECT * FROM stripe_subscriptions;
DROP TABLE stripe_subscriptions;
ALTER TABLE stripe_subscriptions_new RENAME TO stripe_subscriptions;

-- ── 5) workspace_subscriptions (agent-workspace.js dynamic table) ────
-- Created on first import of routes/agent-workspace.js. May not exist
-- in fresh installs that have not loaded that route yet; guard with
-- a defensive recreate.
CREATE TABLE IF NOT EXISTS workspace_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  tasks_today INTEGER DEFAULT 0,
  tasks_total INTEGER DEFAULT 0,
  deals_completed INTEGER DEFAULT 0,
  total_savings REAL DEFAULT 0,
  last_task_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE workspace_subscriptions_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'free' CHECK(plan IN ('free','starter','pro','business','enterprise')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','cancelled','expired','suspended')),
  tasks_today INTEGER DEFAULT 0,
  tasks_total INTEGER DEFAULT 0,
  deals_completed INTEGER DEFAULT 0,
  total_savings REAL DEFAULT 0,
  last_task_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO workspace_subscriptions_new SELECT * FROM workspace_subscriptions;
DROP TABLE workspace_subscriptions;
ALTER TABLE workspace_subscriptions_new RENAME TO workspace_subscriptions;
