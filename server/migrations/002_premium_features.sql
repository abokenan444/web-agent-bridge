-- Migration 002: Premium Features Tables
-- Created: 2026-03-24
-- Creates all tables for 12 premium features with proper FKs, indexes, and seed data.

-- ============================================================
-- 1. Agent Traffic Intelligence
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_profiles (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_signature TEXT,
    agent_type TEXT CHECK(agent_type IN ('friendly', 'aggressive', 'suspicious', 'unknown')),
    platform TEXT,
    country TEXT,
    ip_hash TEXT,
    first_seen TEXT DEFAULT (datetime('now')),
    last_seen TEXT,
    total_requests INTEGER DEFAULT 0,
    blocked INTEGER DEFAULT 0,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    alert_type TEXT,
    severity TEXT CHECK(severity IN ('low', 'medium', 'high', 'critical')),
    message TEXT,
    metadata TEXT DEFAULT '{}',
    acknowledged INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 2. Advanced Exploit Shield
-- ============================================================

CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    event_type TEXT,
    severity TEXT,
    agent_signature TEXT,
    ip_hash TEXT,
    details TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocked_agents (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    agent_signature TEXT NOT NULL,
    reason TEXT,
    blocked_at TEXT DEFAULT (datetime('now')),
    expires_at TEXT,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 3. Smart Actions Library
-- ============================================================

CREATE TABLE IF NOT EXISTS action_packs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    platform TEXT,
    description TEXT,
    version TEXT DEFAULT '1.0.0',
    actions_json TEXT NOT NULL,
    tier_required TEXT DEFAULT 'starter',
    icon TEXT DEFAULT '📦',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS installed_packs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    pack_id TEXT NOT NULL,
    installed_at TEXT DEFAULT (datetime('now')),
    config TEXT DEFAULT '{}',
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE,
    FOREIGN KEY (pack_id) REFERENCES action_packs(id) ON DELETE CASCADE
);

-- ============================================================
-- 4. Custom AI Agents
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_agents (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    site_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    steps_json TEXT NOT NULL DEFAULT '[]',
    schedule TEXT,
    last_run TEXT,
    next_run TEXT,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'error')),
    run_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    status TEXT CHECK(status IN ('running', 'success', 'failed', 'cancelled')),
    started_at TEXT DEFAULT (datetime('now')),
    finished_at TEXT,
    result_json TEXT DEFAULT '{}',
    error TEXT,
    FOREIGN KEY (agent_id) REFERENCES custom_agents(id) ON DELETE CASCADE
);

-- ============================================================
-- 5. Webhooks & CRM
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT DEFAULT 'Webhook',
    url TEXT NOT NULL,
    events TEXT DEFAULT '["*"]',
    secret TEXT,
    active INTEGER DEFAULT 1,
    last_triggered TEXT,
    failure_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS webhook_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id TEXT NOT NULL,
    event_type TEXT,
    payload TEXT,
    response_code INTEGER,
    response_body TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (webhook_id) REFERENCES webhook_endpoints(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_integrations (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    config TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    last_sync TEXT,
    events_synced INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 6. Multi-Tenant
-- ============================================================

CREATE TABLE IF NOT EXISTS sub_users (
    id TEXT PRIMARY KEY,
    parent_user_id TEXT NOT NULL,
    email TEXT NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT DEFAULT 'viewer' CHECK(role IN ('viewer', 'editor', 'manager')),
    site_access TEXT DEFAULT '["*"]',
    quota_actions_month INTEGER,
    actions_used_month INTEGER DEFAULT 0,
    invited_at TEXT DEFAULT (datetime('now')),
    accepted_at TEXT,
    active INTEGER DEFAULT 1,
    FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 7. Support Tickets
-- ============================================================

CREATE TABLE IF NOT EXISTS support_tickets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    subject TEXT NOT NULL,
    priority TEXT DEFAULT 'normal' CHECK(priority IN ('low', 'normal', 'high', 'urgent')),
    status TEXT DEFAULT 'open' CHECK(status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed')),
    category TEXT,
    sla_deadline TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id TEXT NOT NULL,
    sender_type TEXT CHECK(sender_type IN ('user', 'admin', 'bot')),
    sender_id TEXT,
    message TEXT NOT NULL,
    attachments TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id) ON DELETE CASCADE
);

-- ============================================================
-- 8. Custom Bridge Script
-- ============================================================

CREATE TABLE IF NOT EXISTS custom_scripts (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    plugins_json TEXT DEFAULT '[]',
    minified INTEGER DEFAULT 1,
    amp_compatible INTEGER DEFAULT 0,
    auto_patch INTEGER DEFAULT 1,
    custom_css TEXT,
    custom_js TEXT,
    last_built TEXT,
    script_hash TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 9. Stealth Profiles
-- ============================================================

CREATE TABLE IF NOT EXISTS stealth_profiles (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT DEFAULT 'Default',
    typing_speed_min INTEGER DEFAULT 30,
    typing_speed_max INTEGER DEFAULT 120,
    mouse_speed TEXT DEFAULT 'natural',
    scroll_behavior TEXT DEFAULT 'eased',
    click_delay_min INTEGER DEFAULT 50,
    click_delay_max INTEGER DEFAULT 400,
    anti_detection_json TEXT DEFAULT '{}',
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 10. CDN
-- ============================================================

CREATE TABLE IF NOT EXISTS cdn_configs (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    custom_domain TEXT,
    ssl_status TEXT DEFAULT 'pending',
    edge_locations TEXT DEFAULT '["us-east","eu-west"]',
    cache_ttl INTEGER DEFAULT 86400,
    bandwidth_used INTEGER DEFAULT 0,
    requests_count INTEGER DEFAULT 0,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cdn_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cdn_id TEXT NOT NULL,
    region TEXT,
    requests INTEGER DEFAULT 0,
    bandwidth INTEGER DEFAULT 0,
    cache_hits INTEGER DEFAULT 0,
    avg_latency_ms REAL DEFAULT 0,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (cdn_id) REFERENCES cdn_configs(id) ON DELETE CASCADE
);

-- ============================================================
-- 11. Audit & Compliance
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id TEXT NOT NULL,
    user_id TEXT,
    action TEXT NOT NULL,
    resource_type TEXT,
    resource_id TEXT,
    details TEXT DEFAULT '{}',
    ip_address TEXT,
    user_agent TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS compliance_settings (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL UNIQUE,
    retention_days INTEGER DEFAULT 90,
    hipaa_mode INTEGER DEFAULT 0,
    gdpr_mode INTEGER DEFAULT 0,
    soc2_mode INTEGER DEFAULT 0,
    auto_purge INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

-- ============================================================
-- 12. Sandbox
-- ============================================================

CREATE TABLE IF NOT EXISTS sandbox_environments (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL,
    name TEXT DEFAULT 'Default Sandbox',
    config_snapshot TEXT,
    status TEXT DEFAULT 'active',
    traffic_generated INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sandbox_benchmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sandbox_id TEXT NOT NULL,
    benchmark_type TEXT,
    before_value REAL,
    after_value REAL,
    recorded_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (sandbox_id) REFERENCES sandbox_environments(id) ON DELETE CASCADE
);

-- ============================================================
-- Indexes: FK columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_agent_profiles_site ON agent_profiles(site_id);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_site ON anomaly_alerts(site_id);
CREATE INDEX IF NOT EXISTS idx_security_events_site ON security_events(site_id);
CREATE INDEX IF NOT EXISTS idx_blocked_agents_site ON blocked_agents(site_id);
CREATE INDEX IF NOT EXISTS idx_installed_packs_site ON installed_packs(site_id);
CREATE INDEX IF NOT EXISTS idx_installed_packs_pack ON installed_packs(pack_id);
CREATE INDEX IF NOT EXISTS idx_custom_agents_user ON custom_agents(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_agents_site ON custom_agents(site_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_site ON webhook_endpoints(site_id);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id);
CREATE INDEX IF NOT EXISTS idx_crm_integrations_site ON crm_integrations(site_id);
CREATE INDEX IF NOT EXISTS idx_sub_users_parent ON sub_users(parent_user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages(ticket_id);
CREATE INDEX IF NOT EXISTS idx_custom_scripts_site ON custom_scripts(site_id);
CREATE INDEX IF NOT EXISTS idx_stealth_profiles_site ON stealth_profiles(site_id);
CREATE INDEX IF NOT EXISTS idx_cdn_configs_site ON cdn_configs(site_id);
CREATE INDEX IF NOT EXISTS idx_cdn_stats_cdn ON cdn_stats(cdn_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_site ON audit_logs(site_id);
CREATE INDEX IF NOT EXISTS idx_compliance_settings_site ON compliance_settings(site_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_environments_site ON sandbox_environments(site_id);
CREATE INDEX IF NOT EXISTS idx_sandbox_benchmarks_sandbox ON sandbox_benchmarks(sandbox_id);

-- ============================================================
-- Indexes: created_at columns
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_agent_profiles_first_seen ON agent_profiles(first_seen);
CREATE INDEX IF NOT EXISTS idx_anomaly_alerts_created ON anomaly_alerts(created_at);
CREATE INDEX IF NOT EXISTS idx_security_events_created ON security_events(created_at);
CREATE INDEX IF NOT EXISTS idx_blocked_agents_blocked_at ON blocked_agents(blocked_at);
CREATE INDEX IF NOT EXISTS idx_action_packs_created ON action_packs(created_at);
CREATE INDEX IF NOT EXISTS idx_installed_packs_installed ON installed_packs(installed_at);
CREATE INDEX IF NOT EXISTS idx_custom_agents_created ON custom_agents(created_at);
CREATE INDEX IF NOT EXISTS idx_agent_runs_started ON agent_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_created ON webhook_endpoints(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_crm_integrations_created ON crm_integrations(created_at);
CREATE INDEX IF NOT EXISTS idx_sub_users_invited ON sub_users(invited_at);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created ON support_tickets(created_at);
CREATE INDEX IF NOT EXISTS idx_ticket_messages_created ON ticket_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_custom_scripts_created ON custom_scripts(created_at);
CREATE INDEX IF NOT EXISTS idx_stealth_profiles_created ON stealth_profiles(created_at);
CREATE INDEX IF NOT EXISTS idx_cdn_configs_created ON cdn_configs(created_at);
CREATE INDEX IF NOT EXISTS idx_cdn_stats_recorded ON cdn_stats(recorded_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_compliance_settings_created ON compliance_settings(created_at);
CREATE INDEX IF NOT EXISTS idx_sandbox_environments_created ON sandbox_environments(created_at);
CREATE INDEX IF NOT EXISTS idx_sandbox_benchmarks_recorded ON sandbox_benchmarks(recorded_at);

-- ============================================================
-- Seed Data: Action Packs
-- ============================================================

INSERT OR IGNORE INTO action_packs (id, name, platform, description, version, actions_json, tier_required, icon) VALUES
('pack_woocommerce', 'WooCommerce Essentials', 'woocommerce', 'Core e-commerce actions for WooCommerce stores including cart management, checkout, and product browsing.', '1.0.0',
 '[{"name":"add_to_cart","description":"Add a product to the shopping cart","selector":".single_add_to_cart_button, .add_to_cart_button","trigger":"click"},{"name":"checkout","description":"Proceed through the checkout flow","selector":".checkout-button, .wc-proceed-to-checkout a","trigger":"click"},{"name":"search_products","description":"Search the product catalog","selector":".woocommerce-product-search input[type=search]","trigger":"fill"},{"name":"view_product","description":"Navigate to a product detail page","selector":".woocommerce-loop-product__link, .product a.woocommerce-LoopProduct-link","trigger":"click"}]',
 'starter', '🛒');

INSERT OR IGNORE INTO action_packs (id, name, platform, description, version, actions_json, tier_required, icon) VALUES
('pack_shopify', 'Shopify Essentials', 'shopify', 'Core actions for Shopify storefronts covering cart operations, checkout, search, and coupon application.', '1.0.0',
 '[{"name":"add_to_cart","description":"Add the current product to cart","selector":"button[name=add], .product-form__submit","trigger":"click"},{"name":"checkout","description":"Start the checkout process","selector":".cart__checkout-button, button[name=checkout]","trigger":"click"},{"name":"search","description":"Search for products in the store","selector":"input[name=q], .search-modal__input","trigger":"fill"},{"name":"apply_coupon","description":"Apply a discount or coupon code","selector":"input[name=discount], #checkout_reduction_code","trigger":"fill"}]',
 'starter', '🟢');

INSERT OR IGNORE INTO action_packs (id, name, platform, description, version, actions_json, tier_required, icon) VALUES
('pack_wordpress', 'WordPress Essentials', 'wordpress', 'Common WordPress interactions including authentication, site search, form submission, and page navigation.', '1.0.0',
 '[{"name":"login","description":"Authenticate with WordPress login form","selector":"#loginform #user_login, #loginform #user_pass","trigger":"fill"},{"name":"search","description":"Search site content via the search form","selector":".search-field, input[name=s]","trigger":"fill"},{"name":"submit_form","description":"Submit a Contact Form 7 or generic form","selector":".wpcf7-submit, form input[type=submit]","trigger":"click"},{"name":"navigate","description":"Navigate to a page via the main menu","selector":".menu-item a, .nav-link","trigger":"click"}]',
 'starter', '📝');

INSERT OR IGNORE INTO action_packs (id, name, platform, description, version, actions_json, tier_required, icon) VALUES
('pack_salesforce', 'Salesforce Essentials', 'salesforce', 'Key CRM actions for Salesforce including lead creation, contact updates, record search, and task management.', '1.0.0',
 '[{"name":"create_lead","description":"Create a new lead record in Salesforce","selector":"button[title=New Lead], .slds-button[data-action=create-lead]","trigger":"click"},{"name":"update_contact","description":"Edit and save an existing contact record","selector":".slds-form-element input, .forceDetailPanelDesktop input","trigger":"fill"},{"name":"search_records","description":"Search across Salesforce records globally","selector":"input[placeholder=Search Salesforce], .search-input","trigger":"fill"},{"name":"create_task","description":"Create a new task linked to a record","selector":"button[title=New Task], .slds-button[data-action=create-task]","trigger":"click"}]',
 'professional', '☁️');

INSERT OR IGNORE INTO action_packs (id, name, platform, description, version, actions_json, tier_required, icon) VALUES
('pack_generic_ecommerce', 'Generic E-Commerce', 'generic', 'Universal e-commerce actions that work across most online stores for browsing, purchasing, and order tracking.', '1.0.0',
 '[{"name":"browse_catalog","description":"Browse product listings or category pages","selector":".product-card a, .catalog-item a, .product-link","trigger":"click"},{"name":"add_to_cart","description":"Add an item to the shopping cart","selector":"button.add-to-cart, [data-action=add-to-cart], .btn-add-cart","trigger":"click"},{"name":"checkout","description":"Proceed to the checkout page","selector":".checkout-btn, a[href*=checkout], button.proceed-checkout","trigger":"click"},{"name":"track_order","description":"Look up order status with a tracking number","selector":"input[name=tracking], input[name=order_id], .track-order-input","trigger":"fill"}]',
 'starter', '🏪');
