/**
 * Database Migration Runner
 * Tracks and applies SQL migrations from server/migrations/ in order.
 * Uses a `_migrations` table to record applied migrations.
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.NODE_ENV === 'test'
  ? path.join(__dirname, '..', '..', 'data-test')
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = process.env.NODE_ENV === 'test' ? 'wab-test.db' : 'wab.db';
const db = new Database(path.join(DATA_DIR, dbFile));

// Ensure migrations tracking table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  );
`);

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

function getAppliedMigrations() {
  return new Set(
    db.prepare('SELECT name FROM _migrations ORDER BY id').all().map(r => r.name)
  );
}

function runMigrations() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('No migrations directory found.');
    return;
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = getAppliedMigrations();
  let count = 0;

  const applyMigration = db.transaction((name, sql) => {
    db.exec(sql);
    db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
  });

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      applyMigration(file, sql);
      console.log(`  ✅ Migration applied: ${file}`);
      count++;
    } catch (err) {
      console.error(`  ❌ Migration failed: ${file} — ${err.message}`);
      process.exit(1);
    }
  }

  if (count === 0) {
    console.log('  All migrations up to date.');
  } else {
    console.log(`  ${count} migration(s) applied.`);
  }
}

// Run when called directly: node server/utils/migrate.js
if (require.main === module) {
  console.log('Running database migrations...');
  runMigrations();
  db.close();
}

module.exports = { runMigrations };
