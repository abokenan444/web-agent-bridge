/**
 * Central JWT and startup secret checks.
 * User tokens and admin tokens use different secrets and audiences in production.
 */

const jwt = require('jsonwebtoken');

const JWT_ISSUER = 'wab';
const JWT_AUD_USER = 'wab:user';
const JWT_AUD_ADMIN = 'wab:admin';

const jwtVerifyUser = { issuer: JWT_ISSUER, audience: JWT_AUD_USER };
const jwtVerifyAdmin = { issuer: JWT_ISSUER, audience: JWT_AUD_ADMIN };

function isTest() {
  return process.env.NODE_ENV === 'test';
}

function isProd() {
  return process.env.NODE_ENV === 'production';
}

function assertSecretsAtStartup() {
  if (isTest()) return;
  if (isProd()) {
    if (!process.env.JWT_SECRET) {
      throw new Error('FATAL: JWT_SECRET is required in production');
    }
    if (!process.env.JWT_SECRET_ADMIN) {
      throw new Error('FATAL: JWT_SECRET_ADMIN is required in production');
    }
  }
}

function getJwtUserSecret() {
  if (isTest()) {
    return process.env.JWT_SECRET || 'test-secret-key-for-testing';
  }
  if (isProd()) {
    return process.env.JWT_SECRET;
  }
  return process.env.JWT_SECRET || 'dev-user-secret-change-in-development';
}

function getJwtAdminSecret() {
  if (isTest()) {
    return process.env.JWT_SECRET_ADMIN || process.env.JWT_SECRET || 'test-secret-key-for-testing-admin';
  }
  if (isProd()) {
    return process.env.JWT_SECRET_ADMIN;
  }
  return process.env.JWT_SECRET_ADMIN || process.env.JWT_SECRET || 'dev-admin-secret-change-in-development';
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
