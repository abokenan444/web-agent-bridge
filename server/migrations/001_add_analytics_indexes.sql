-- Migration 001: Add composite indexes for analytics performance
-- Created: 2024-12-01

CREATE INDEX IF NOT EXISTS idx_analytics_site_action ON analytics(site_id, action_name);
CREATE INDEX IF NOT EXISTS idx_analytics_site_created ON analytics(site_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
