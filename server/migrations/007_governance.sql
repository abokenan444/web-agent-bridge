-- ═══════════════════════════════════════════════════════════════════
-- WAB Agent Governance Layer
-- Permission Boundaries · Approval Gates · Tamper-Evident Audit Log
-- Kill Switch · Spend Limits
-- ═══════════════════════════════════════════════════════════════════

-- Agents registered for governance (one row per agent identity).
CREATE TABLE IF NOT EXISTS gov_agents (
  agent_id      TEXT PRIMARY KEY,
  owner_id      TEXT,                       -- user_id of owner (nullable for unauthed)
  display_name  TEXT,
  token_hash    TEXT NOT NULL,              -- sha256(agent_token); used to authenticate the agent
  status        TEXT NOT NULL DEFAULT 'alive' CHECK(status IN ('alive','killed','suspended')),
  killed_at     TEXT,
  killed_reason TEXT,
  metadata      TEXT,                       -- JSON
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Permission policies. One row = one rule. Evaluated allow-list style.
CREATE TABLE IF NOT EXISTS gov_policies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id      TEXT NOT NULL,
  resource      TEXT NOT NULL,              -- e.g. "stripe", "gmail", "clickup", "domain:example.com"
  action        TEXT NOT NULL,              -- "read" | "write" | "execute" | "*"
  scope         TEXT,                       -- optional: e.g. "refunds", "inbox", "tasks/123"
  max_amount    REAL,                       -- monetary cap per single action
  currency      TEXT DEFAULT 'USD',
  daily_cap     REAL,                       -- monetary cap per 24h rolling
  per_call_rate INTEGER,                    -- max calls per minute
  requires_approval INTEGER NOT NULL DEFAULT 0,  -- 1 = always send to human gate
  effect        TEXT NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
  expires_at    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES gov_agents(agent_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gov_policies_agent ON gov_policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_gov_policies_lookup ON gov_policies(agent_id, resource, action);

-- Append-only audit log with HMAC hash chain (tamper-evident).
-- prev_hash → hash chain links every entry; breaking the chain detects tampering.
CREATE TABLE IF NOT EXISTS gov_audit (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  ts           TEXT NOT NULL DEFAULT (datetime('now')),
  event_type   TEXT NOT NULL,               -- 'check' | 'execute' | 'deny' | 'approval_request' | 'approval_decision' | 'kill' | 'policy_change' | 'note'
  resource     TEXT,
  action       TEXT,
  scope        TEXT,
  amount       REAL,
  currency     TEXT,
  decision     TEXT,                        -- 'allow' | 'deny' | 'pending' | 'approved' | 'rejected'
  reason       TEXT,
  params_json  TEXT,                        -- redacted parameter snapshot
  result_json  TEXT,
  prev_hash    TEXT,                        -- prior entry's hash
  hash         TEXT NOT NULL,               -- HMAC(secret, prev_hash || row_payload)
  FOREIGN KEY (agent_id) REFERENCES gov_agents(agent_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gov_audit_agent_ts ON gov_audit(agent_id, ts);
CREATE INDEX IF NOT EXISTS idx_gov_audit_event ON gov_audit(agent_id, event_type);

-- Approval requests. Async — agent requests, human resolves later.
CREATE TABLE IF NOT EXISTS gov_approvals (
  request_id    TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  resource      TEXT NOT NULL,
  action        TEXT NOT NULL,
  scope         TEXT,
  amount        REAL,
  currency      TEXT,
  params_json   TEXT,
  reason        TEXT,                       -- why approval is required
  status        TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','cancelled')),
  decided_by    TEXT,                       -- user_id of approver
  decided_at    TEXT,
  decided_note  TEXT,
  expires_at    TEXT,                       -- auto-expire pending requests
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (agent_id) REFERENCES gov_agents(agent_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gov_approvals_pending ON gov_approvals(agent_id, status);

-- Spend tracker (per agent, per resource, sliding window).
-- Rebuilt rolling-style; we just append on every monetary action.
CREATE TABLE IF NOT EXISTS gov_spend (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id     TEXT NOT NULL,
  resource     TEXT NOT NULL,
  amount       REAL NOT NULL,
  currency     TEXT NOT NULL DEFAULT 'USD',
  ts           TEXT NOT NULL DEFAULT (datetime('now')),
  ref          TEXT,                        -- audit_id or external ref
  FOREIGN KEY (agent_id) REFERENCES gov_agents(agent_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_gov_spend_window ON gov_spend(agent_id, resource, ts);

-- Rate-limit token buckets (lightweight; we keep counters).
CREATE TABLE IF NOT EXISTS gov_rate (
  agent_id     TEXT NOT NULL,
  resource     TEXT NOT NULL,
  window_start TEXT NOT NULL,               -- ISO timestamp (minute-resolution)
  count        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (agent_id, resource, window_start)
);
