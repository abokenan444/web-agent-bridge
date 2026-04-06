#!/usr/bin/env node
/**
 * Reset an admin password (run on the server host; not exposed over HTTP).
 * Usage: node scripts/reset-admin-password.js <email> <new-password>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

if (process.env.NODE_ENV === 'test') {
  process.env.NODE_ENV = 'development';
}

const { resetAdminPassword } = require('../server/models/db');

const email = process.argv[2];
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node scripts/reset-admin-password.js <email> <new-password>');
  process.exit(1);
}

try {
  const ok = resetAdminPassword(email, password);
  if (!ok) {
    console.error('No admin found with that email. Create one with: node scripts/create-admin.js <email> <password>');
    process.exit(1);
  }
  console.log('Password updated for:', email);
} catch (e) {
  console.error('Failed:', e.message);
  process.exit(1);
}
