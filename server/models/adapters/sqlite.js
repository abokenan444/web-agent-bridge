/**
 * SQLite Adapter — Default database backend
 *
 * Re-exports the existing db.js module as an adapter.
 */
const db = require('../db');
module.exports = db;
