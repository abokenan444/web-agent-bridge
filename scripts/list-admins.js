#!/usr/bin/env node
/**
 * List admin emails (no passwords). Run on the server host.
 * Usage: node scripts/list-admins.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}

const { db } = require('../server/models/db');

const rows = db.prepare(`SELECT email, name, role, created_at FROM admins ORDER BY created_at`).all();
if (!rows.length) {
  console.log('No admin accounts. Use BOOTSTRAP_ADMIN_* or: node scripts/create-admin.js <email> <password>');
  process.exit(0);
}
console.table(rows);
