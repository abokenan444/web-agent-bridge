-- Agent OS persistence layer
-- Stores agents, tasks, deployments, registry data, and audit logs

-- Agent identities
CREATE TABLE IF NOT EXISTS os_agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'autonomous',
  status TEXT NOT NULL DEFAULT 'active',
  capabilities TEXT DEFAULT '[]',
  api_key_hash TEXT,
  public_key TEXT,
  metadata TEXT DEFAULT '{}',
  ip_allowlist TEXT DEFAULT '[]',
  command_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);

-- Agent sessions
CREATE TABLE IF NOT EXISTS os_sessions (
  token TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  ip TEXT,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES os_agents(id) ON DELETE CASCADE
);

-- Tasks
CREATE TABLE IF NOT EXISTS os_tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  priority INTEGER DEFAULT 5,
  agent_id TEXT,
  params TEXT DEFAULT '{}',
  result TEXT,
  error TEXT,
  retry_count INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  depends_on TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  timeout INTEGER DEFAULT 30000
);

CREATE INDEX IF NOT EXISTS idx_os_tasks_state ON os_tasks(state);
CREATE INDEX IF NOT EXISTS idx_os_tasks_agent ON os_tasks(agent_id);

-- Deployments
CREATE TABLE IF NOT EXISTS os_deployments (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  config TEXT DEFAULT '{}',
  sites TEXT DEFAULT '[]',
  health_status TEXT DEFAULT 'unknown',
  last_health_check INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES os_agents(id) ON DELETE CASCADE
);

-- Registry: commands
CREATE TABLE IF NOT EXISTS os_registry_commands (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  version TEXT DEFAULT '1.0.0',
  input_schema TEXT DEFAULT '{}',
  output_schema TEXT DEFAULT '{}',
  capabilities TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  usage_count INTEGER DEFAULT 0,
  last_used INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_os_reg_cmd_site ON os_registry_commands(site_id);
CREATE INDEX IF NOT EXISTS idx_os_reg_cmd_cat ON os_registry_commands(category);

-- Registry: sites
CREATE TABLE IF NOT EXISTS os_registry_sites (
  domain TEXT PRIMARY KEY,
  name TEXT,
  description TEXT DEFAULT '',
  tier TEXT DEFAULT 'free',
  protocol_version TEXT DEFAULT '1.0.0',
  capabilities TEXT DEFAULT '[]',
  endpoints TEXT DEFAULT '{}',
  verified INTEGER DEFAULT 0,
  agent_visits INTEGER DEFAULT 0,
  last_seen INTEGER,
  created_at INTEGER NOT NULL
);

-- Registry: templates
CREATE TABLE IF NOT EXISTS os_registry_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT 'general',
  author TEXT DEFAULT 'system',
  version TEXT DEFAULT '1.0.0',
  steps TEXT DEFAULT '[]',
  variables TEXT DEFAULT '{}',
  required_capabilities TEXT DEFAULT '[]',
  tags TEXT DEFAULT '[]',
  downloads INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Audit log (immutable append-only)
CREATE TABLE IF NOT EXISTS os_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  agent_id TEXT,
  action TEXT NOT NULL,
  resource TEXT,
  resource_id TEXT,
  details TEXT DEFAULT '{}',
  ip TEXT,
  outcome TEXT DEFAULT 'success'
);

CREATE INDEX IF NOT EXISTS idx_os_audit_ts ON os_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_os_audit_agent ON os_audit_log(agent_id);

-- Capability grants
CREATE TABLE IF NOT EXISTS os_capability_grants (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  capability TEXT NOT NULL,
  site_id TEXT DEFAULT '*',
  max_calls INTEGER,
  used_calls INTEGER DEFAULT 0,
  rate_limit TEXT,
  expires_at INTEGER,
  status TEXT DEFAULT 'active',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES os_agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_os_cap_agent ON os_capability_grants(agent_id);

-- Policies
CREATE TABLE IF NOT EXISTS os_policies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  priority INTEGER DEFAULT 0,
  rules TEXT DEFAULT '[]',
  entity_bindings TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL
);
