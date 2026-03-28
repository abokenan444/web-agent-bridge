/**
 * Central JWT and startup secret checks.
 * User tokens and admin tokens use different secrets and audiences in production.
 */

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const JWT_ISSUER = 'wab';
const JWT_AUD_USER = 'wab:user';
const JWT_AUD_ADMIN = 'wab:admin';

const jwtVerifyUser = { issuer: JWT_ISSUER, audience: JWT_AUD_USER };
const jwtVerifyAdmin = { issuer: JWT_ISSUER, audience: JWT_AUD_ADMIN };

let _autoUserSecret = null;
let _autoAdminSecret = null;

function generateAutoSecret(label) {
  const secret = crypto.randomBytes(48).toString('base64url');
  console.warn(`[WAB] WARNING: ${label} not set — generated ephemeral secret. Tokens will not survive restarts. Set ${label} env var for persistent sessions.`);
  return secret;
}

function isTest() {
  return process.env.NODE_ENV === 'test';
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function assertSecretsAtStartup() {
  if (isTest()) return;
  if (isProd() && !process.env.JWT_SECRET) {
    _autoUserSecret = generateAutoSecret('JWT_SECRET');
  }
  if (isProd() && !process.env.JWT_SECRET_ADMIN) {
    _autoAdminSecret = generateAutoSecret('JWT_SECRET_ADMIN');
  }
}

function getJwtUserSecret() {
  if (isTest()) {
    return process.env.JWT_SECRET || 'test-secret-key-for-testing';
  }
  return process.env.JWT_SECRET || _autoUserSecret || 'dev-user-secret-change-in-development';
}

function getJwtAdminSecret() {
  if (isTest()) {
    return process.env.JWT_SECRET_ADMIN || process.env.JWT_SECRET || 'test-secret-key-for-testing-admin';
  }
  return process.env.JWT_SECRET_ADMIN || process.env.JWT_SECRET || _autoAdminSecret || _autoUserSecret || 'dev-admin-secret-change-in-development';
}

function signUserToken(payload, options = {}) {
  return jwt.sign(
    { ...payload },
    getJwtUserSecret(),
    { expiresIn: options.expiresIn || '7d', issuer: JWT_ISSUER, audience: JWT_AUD_USER }
  );
}

function signAdminToken(payload, options = {}) {
  return jwt.sign(
    { ...payload },
    getJwtAdminSecret(),
    { expiresIn: options.expiresIn || '12h', issuer: JWT_ISSUER, audience: JWT_AUD_ADMIN }
  );
}

function verifyUserToken(token) {
  return jwt.verify(token, getJwtUserSecret(), jwtVerifyUser);
}

function verifyAdminToken(token) {
  return jwt.verify(token, getJwtAdminSecret(), jwtVerifyAdmin);
}

module.exports = {
  assertSecretsAtStartup,
  getJwtUserSecret,
  getJwtAdminSecret,
  signUserToken,
  signAdminToken,
  verifyUserToken,
  verifyAdminToken,
  JWT_ISSUER,
  JWT_AUD_USER,
  JWT_AUD_ADMIN,
  jwtVerifyUser,
  jwtVerifyAdmin
};
