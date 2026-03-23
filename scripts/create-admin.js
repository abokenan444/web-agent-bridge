#!/usr/bin/env node
/**
 * Create an admin account (run on server, not exposed to HTTP).
 * Usage: node scripts/create-admin.js <email> <password> [name]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}

const { createAdmin } = require('../server/models/db');

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] || 'Admin';

if (!email || !password) {
  console.error('Usage: node scripts/create-admin.js <email> <password> [display-name]');
  process.exit(1);
}

try {
  createAdmin({ email, password, name, role: 'superadmin' });
  console.log('Admin created:', email);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
