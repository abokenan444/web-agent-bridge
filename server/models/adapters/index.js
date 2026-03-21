/**
 * Database Adapter Interface
 *
 * WAB supports multiple database backends via adapters.
 * Set DB_ADAPTER environment variable to choose: sqlite (default), postgresql, mysql
 *
 * For PostgreSQL:
 *   npm install pg
 *   DB_ADAPTER=postgresql DATABASE_URL=postgres://user:pass@host:5432/wab
 *
 * For MySQL:
 *   npm install mysql2
 *   DB_ADAPTER=mysql DATABASE_URL=mysql://user:pass@host:3306/wab
 */

const adapter = process.env.DB_ADAPTER || 'sqlite';

let db;
switch (adapter) {
  case 'postgresql':
  case 'postgres':
    db = require('./postgresql');
    break;
  case 'mysql':
    db = require('./mysql');
    break;
  case 'sqlite':
  default:
    db = require('./sqlite');
    break;
}

module.exports = db;
