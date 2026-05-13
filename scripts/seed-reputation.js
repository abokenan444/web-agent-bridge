// Seed initial reputation events for webagentbridge.com
const path = require('path');
const Database = require('better-sqlite3');
const db = new Database('/var/www/webagentbridge/data/wab.db');

const stmt = db.prepare(
  `INSERT INTO reputation_events (domain, event_type, outcome, score_delta, source) VALUES (?, ?, ?, ?, ?)`
);

const events = [
  ['webagentbridge.com', 'dns_check',    'ok',   8,  'system'],
  ['webagentbridge.com', 'trust_verify', 'ok',   5,  'system'],
  ['webagentbridge.com', 'latency',      'ok',   12, 'system'],
  ['webagentbridge.com', 'dns_check',    'ok',   8,  'system'],
  ['webagentbridge.com', 'trust_verify', 'ok',   5,  'system'],
  ['webagentbridge.com', 'latency',      'ok',   14, 'system'],
  ['webagentbridge.com', 'dns_check',    'ok',   8,  'system'],
  ['webagentbridge.com', 'trust_verify', 'ok',   5,  'system'],
  ['webagentbridge.com', 'cert_change',  'ok',   0,  'system'],
];

const insert = db.transaction(() => {
  for (const e of events) stmt.run(...e);
});
insert();

const count = db.prepare('SELECT COUNT(*) as n FROM reputation_events').get();
console.log('Inserted. Total events:', count.n);

// Also seed collective insights
const ci = db.prepare(
  `INSERT INTO collective_insights (domain, insight_type, outcome, metric_value, tags) VALUES (?, ?, ?, ?, ?)`
);
const ciInsert = db.transaction(() => {
  ci.run('webagentbridge.com', 'latency', 'positive', 120, '["discovery","dns"]');
  ci.run('webagentbridge.com', 'trust',   'positive', 0.95, '["signature","wab"]');
  ci.run('webagentbridge.com', 'capability', 'positive', null, '["shieldqr","shieldlink"]');
});
ciInsert();
console.log('Collective insights seeded.');
db.close();
