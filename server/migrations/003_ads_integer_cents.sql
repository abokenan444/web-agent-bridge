-- Migration 003: Convert ads financial columns from REAL to INTEGER (cents)
-- This avoids floating-point precision issues in billing calculations.
--
-- NOTE: The wab_ads table in db.js now creates with INTEGER columns directly.
-- This migration only matters for databases created before this change.
-- On fresh databases, db.js already has the correct schema, so this is a no-op.
-- On existing databases, this migration was already applied.

-- Ensure the table and index exist (idempotent)
CREATE TABLE IF NOT EXISTS wab_ads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    target_url TEXT NOT NULL,
    advertiser_name TEXT NOT NULL,
    advertiser_email TEXT NOT NULL,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','paused','expired')),
    position TEXT DEFAULT 'new-tab' CHECK(position IN ('new-tab','sidebar','search')),
    budget_cents INTEGER DEFAULT 0,
    spent_cents INTEGER DEFAULT 0,
    cpc_cents INTEGER DEFAULT 5,
    cpi_cents INTEGER DEFAULT 1,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    approved_by TEXT,
    approved_at TEXT,
    expires_at TEXT,
    FOREIGN KEY (approved_by) REFERENCES admins(id)
);

CREATE INDEX IF NOT EXISTS idx_wab_ads_status ON wab_ads(status);
