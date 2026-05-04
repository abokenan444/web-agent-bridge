-- Migration 008: Plans Management
-- Database-driven plans + feature catalog so admins can add/edit plans,
-- toggle which features each plan includes, and have changes flow live to
-- the landing page pricing section AND the Stripe checkout flow.
--
-- Backwards-compatible: legacy code paths that look up tiers by slug
-- ('free' | 'starter' | 'pro' | 'enterprise') keep working — those slugs
-- are seeded as plan ids below.

CREATE TABLE IF NOT EXISTS plans (
  id              TEXT PRIMARY KEY,            -- slug, lowercase, e.g. 'free' / 'pro' / 'business' / 'enterprise'
  name            TEXT NOT NULL,
  tagline         TEXT,
  description     TEXT,
  price_cents     INTEGER NOT NULL DEFAULT 0,
  currency        TEXT NOT NULL DEFAULT 'EUR',
  billing_period  TEXT NOT NULL DEFAULT 'month'
                  CHECK(billing_period IN ('month','year','one_time','custom')),
  stripe_price_id TEXT,
  cta_type        TEXT NOT NULL DEFAULT 'checkout'
                  CHECK(cta_type IN ('checkout','register','contact','external')),
  cta_label       TEXT,
  cta_url         TEXT,
  highlight       INTEGER NOT NULL DEFAULT 0,
  is_public       INTEGER NOT NULL DEFAULT 1,
  is_archived     INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  features_json   TEXT NOT NULL DEFAULT '{}',
  limits_json     TEXT NOT NULL DEFAULT '{}',
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_plans_public_archived ON plans(is_public, is_archived, sort_order);

CREATE TABLE IF NOT EXISTS feature_catalog (
  feature_key     TEXT PRIMARY KEY,
  label           TEXT NOT NULL,
  description     TEXT,
  category        TEXT NOT NULL DEFAULT 'general',
  is_open_source  INTEGER NOT NULL DEFAULT 0,
  sort_order      INTEGER NOT NULL DEFAULT 100,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Feature catalog (open-source / always-free first, then paid features)
INSERT OR IGNORE INTO feature_catalog (feature_key, label, description, category, is_open_source, sort_order) VALUES
  -- Always-free / open core
  ('protocol',              'WAP Protocol Core',           'Open Web Agent Protocol — schema, discovery, permissions',  'core',          1, 10),
  ('sdk',                   'SDK & Client Runtime',        'JavaScript SDK and client integrations',                    'core',          1, 20),
  ('browserExecution',      'Browser Execution Layer',     'Basic browser automation primitives',                       'core',          1, 30),
  ('adapters',              'MCP / REST / Browser Adapters','Adapters for MCP, REST APIs, and browser back-ends',       'core',          1, 40),
  ('registryRead',          'Public Registry (read-only)', 'Browse commands, sites and templates',                      'core',          1, 50),
  ('agentRegistration',     'Agent Registration',          'Register agents and obtain credentials',                    'core',          1, 60),
  ('basicAuth',             'Basic Authentication',        'API keys and basic auth flows',                             'core',          1, 70),
  ('discovery',             'DNS / .well-known Discovery', 'Service discovery via DNS TXT and /.well-known/',           'core',          1, 80),
  ('capabilityNegotiation', 'Capability Negotiation',      'Capability handshake between agent and site',               'core',          1, 90),
  ('semanticActions',       'Semantic Actions',            'Built-in semantic actions catalog',                         'core',          1,100),
  ('communityTemplates',    'Community Templates',         'Public template library',                                   'core',          1,110),

  -- Workspace / orchestration
  ('workspace',             'Control Plane / Workspace',   'Web dashboard, monitoring and agent management',            'workspace',     0,200),
  ('advancedOrchestration', 'Advanced Orchestration',      'Scheduling, retries, pipelines, distributed execution',     'workspace',     0,210),
  ('observability',         'Observability',               'Tracing, metrics, logs and performance insights',           'workspace',     0,220),
  ('failureAnalysis',       'Failure Analysis',            'Debugging tools and root-cause reports',                    'workspace',     0,230),
  ('replayEngine',          'Replay Engine',               'Record and replay agent runs',                              'workspace',     0,240),
  ('advancedAnalytics',     'Advanced Analytics',          'Detailed analytics dashboards and exports',                 'workspace',     0,250),
  ('dataExtraction',        'Data Extraction',             'Structured data extraction and export',                     'workspace',     0,260),
  ('agentMemory',           'Agent Memory Engine',         'Persistent context and long-term memory for agents',        'workspace',     0,270),
  ('llmInference',          'LLM Inference',               'Built-in LLM inference via the platform',                   'workspace',     0,280),

  -- Premium / business
  ('hostedRuntime',         'Hosted Runtime (Cloud Exec)', 'Auto-scaling hosted execution environment',                 'premium',       0,300),
  ('marketplace',           'Marketplace (Publish & Sell)','Publish agents and templates on the marketplace',           'premium',       0,310),
  ('certification',         'Agent Certification',         'Verified agent identity badge',                             'premium',       0,320),
  ('trafficIntelligence',   'Traffic Intelligence',        'Agent profiling, anomaly detection and reporting',          'premium',       0,330),
  ('exploitShield',         'Exploit Shield',              'Block malicious agents at the edge',                        'premium',       0,340),
  ('visionAnalysis',        'Vision Analysis',             'Visual page inspection (computer-vision pipeline)',         'premium',       0,350),
  ('swarmExecution',        'Swarm / Multi-Agent',         'Coordinated multi-agent (swarm) execution',                 'premium',       0,360),
  ('auditLog',              'Audit Logs',                  'Tamper-evident HMAC-chained audit history',                 'premium',       0,370),
  ('customDomain',          'Custom Domain / White-label', 'Serve the workspace on your own domain',                    'premium',       0,380),
  ('governanceLayer',       'Agent Governance Layer',      'Policies, approvals, kill switch and spend limits',         'premium',       0,390),

  -- Enterprise
  ('enterpriseSecurity',    'Enterprise Security',         'Request signing, IP allowlists, SSO/SAML',                  'enterprise',    0,400),
  ('prioritySupport',       'Priority Support',            'Dedicated SLA-backed support channel',                      'enterprise',    0,410),
  ('sla',                   'Uptime SLA',                  'Contractual uptime SLA',                                    'enterprise',    0,420),
  ('customDevelopment',     'Custom Development',          'Bespoke engineering and integrations',                      'enterprise',    0,430),
  ('dedicatedInfra',        'Dedicated Infrastructure',    'Isolated single-tenant deployment',                         'enterprise',    0,440);

-- Seed the four canonical plans (admin can edit/add later).
-- features_json keys MUST match feature_catalog.feature_key.
INSERT OR IGNORE INTO plans
  (id, name, tagline, description, price_cents, currency, billing_period, cta_type, cta_label, cta_url, highlight, sort_order, features_json, limits_json)
VALUES
  ('free',
   'Free',
   'Open-source core, forever free',
   'WAP protocol, SDK, discovery and the entire open-source surface — for developers and integrators.',
   0, 'EUR', 'month',
   'register', 'Get started for free', '/register',
   0, 10,
   '{"protocol":true,"sdk":true,"browserExecution":true,"adapters":true,"registryRead":true,"agentRegistration":true,"basicAuth":true,"discovery":true,"capabilityNegotiation":true,"semanticActions":true,"communityTemplates":true}',
   '{"agents":3,"tasksPerDay":50,"executionsPerDay":100,"sessions":5,"maxConcurrency":2,"replayRecordings":10,"computeMinutesPerDay":10,"storageMB":50,"webhooks":1,"customAgents":1,"apiCallsPerMinute":20}'
  ),

  ('pro',
   'Pro',
   'For developers shipping production agents',
   'Everything in Free plus the workspace, observability, replay engine, advanced orchestration and analytics.',
   1000, 'EUR', 'month',
   'checkout', 'Start Pro', NULL,
   1, 20,
   '{"protocol":true,"sdk":true,"browserExecution":true,"adapters":true,"registryRead":true,"agentRegistration":true,"basicAuth":true,"discovery":true,"capabilityNegotiation":true,"semanticActions":true,"communityTemplates":true,"workspace":true,"advancedOrchestration":true,"observability":true,"failureAnalysis":true,"replayEngine":true,"advancedAnalytics":true,"dataExtraction":true,"agentMemory":true,"llmInference":true}',
   '{"agents":25,"tasksPerDay":2000,"executionsPerDay":5000,"sessions":50,"maxConcurrency":10,"replayRecordings":500,"computeMinutesPerDay":180,"storageMB":2000,"webhooks":10,"customAgents":10,"apiCallsPerMinute":120}'
  ),

  ('business',
   'Business',
   'All paid features, ready for scale',
   'Everything in Pro plus hosted runtime, marketplace, vision, swarm, traffic intelligence, exploit shield, audit logs, custom domain and governance.',
   2900, 'EUR', 'month',
   'checkout', 'Start Business', NULL,
   0, 30,
   '{"protocol":true,"sdk":true,"browserExecution":true,"adapters":true,"registryRead":true,"agentRegistration":true,"basicAuth":true,"discovery":true,"capabilityNegotiation":true,"semanticActions":true,"communityTemplates":true,"workspace":true,"advancedOrchestration":true,"observability":true,"failureAnalysis":true,"replayEngine":true,"advancedAnalytics":true,"dataExtraction":true,"agentMemory":true,"llmInference":true,"hostedRuntime":true,"marketplace":true,"certification":true,"trafficIntelligence":true,"exploitShield":true,"visionAnalysis":true,"swarmExecution":true,"auditLog":true,"customDomain":true,"governanceLayer":true}',
   '{"agents":100,"tasksPerDay":20000,"executionsPerDay":50000,"sessions":250,"maxConcurrency":40,"replayRecordings":5000,"computeMinutesPerDay":600,"storageMB":10000,"webhooks":50,"customAgents":50,"apiCallsPerMinute":300}'
  ),

  ('enterprise',
   'Enterprise',
   'Custom-built for organisations',
   'Everything in Business plus enterprise security, dedicated infrastructure, custom development, priority support and a contractual uptime SLA. Pricing is tailored to your scope.',
   0, 'EUR', 'custom',
   'contact', 'Contact sales', 'mailto:sales@webagentbridge.com',
   0, 40,
   '{"protocol":true,"sdk":true,"browserExecution":true,"adapters":true,"registryRead":true,"agentRegistration":true,"basicAuth":true,"discovery":true,"capabilityNegotiation":true,"semanticActions":true,"communityTemplates":true,"workspace":true,"advancedOrchestration":true,"observability":true,"failureAnalysis":true,"replayEngine":true,"advancedAnalytics":true,"dataExtraction":true,"agentMemory":true,"llmInference":true,"hostedRuntime":true,"marketplace":true,"certification":true,"trafficIntelligence":true,"exploitShield":true,"visionAnalysis":true,"swarmExecution":true,"auditLog":true,"customDomain":true,"governanceLayer":true,"enterpriseSecurity":true,"prioritySupport":true,"sla":true,"customDevelopment":true,"dedicatedInfra":true}',
   '{"agents":-1,"tasksPerDay":-1,"executionsPerDay":-1,"sessions":-1,"maxConcurrency":-1,"replayRecordings":-1,"computeMinutesPerDay":-1,"storageMB":-1,"webhooks":-1,"customAgents":-1,"apiCallsPerMinute":-1}'
  );
