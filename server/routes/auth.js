const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const {
  registerUser, loginUser, findUserById, findUserByEmail,
  createPasswordResetToken, consumePasswordResetToken, updateUserPassword,
  createEmailVerificationToken, consumeEmailVerificationToken, isEmailVerified
} = require('../models/db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimits');
const { validateEmail, sanitizeInput, auditLog, revokeJWT } = require('../services/security');
const { sendEmail } = require('../services/email');

const BASE_URL = process.env.BASE_URL || 'https://webagentbridge.com';

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function fireAndForget(promise, label) {
  Promise.resolve(promise).catch((e) => {
    console.error(`[email] ${label} failed (non-fatal):`, e && e.message);
  });
}

router.post('/register', registerLimiter, (req, res) => {
  const { email, password, name, company } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }

  if (!validateEmail(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  if (password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  }

  const cleanName = sanitizeInput(name, 100);
  const cleanCompany = company ? sanitizeInput(company, 100) : undefined;

  try {
    const user = registerUser({ email: email.toLowerCase().trim(), password, name: cleanName, company: cleanCompany });
    const token = generateToken(user);
    auditLog({ actorType: 'user', actorId: String(user.id), action: 'register', ip: req.ip });

    // Generate email-verification token and send it (best-effort, non-blocking)
    try {
      const verifyToken = crypto.randomBytes(32).toString('hex');
      createEmailVerificationToken({ userId: user.id, tokenHash: hashToken(verifyToken) });
      const verifyUrl = `${BASE_URL}/verify-email.html?token=${verifyToken}`;
      fireAndForget(
        sendEmail({ to: user.email, template: 'email_verification', data: { name: user.name, verifyUrl }, userId: user.id }),
        'verification email'
      );
      fireAndForget(
        sendEmail({ to: user.email, template: 'welcome', data: { name: user.name, dashboardUrl: `${BASE_URL}/dashboard` }, userId: user.id }),
        'welcome email'
      );
    } catch (e) {
      console.error('[register] verification setup failed:', e.message);
    }

    res.status(201).json({ user: { ...user, email_verified: 0 }, token });
  } catch (err) {
    if (err.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = loginUser({ email: email.toLowerCase().trim(), password });
  if (!user) {
    auditLog({ actorType: 'user', action: 'login_failed', details: { email: email.toLowerCase().trim() }, ip: req.ip, outcome: 'denied', severity: 'warning' });
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  auditLog({ actorType: 'user', actorId: String(user.id), action: 'login', ip: req.ip });
  res.json({ user, token });
});

router.post('/logout', authenticateToken, (req, res) => {
  if (req._rawToken) {
    revokeJWT(req._rawToken, 'user_logout');
    auditLog({ actorType: 'user', actorId: String(req.user.id), action: 'logout', ip: req.ip });
  }
  res.json({ success: true });
});

router.get('/me', authenticateToken, (req, res) => {
  const user = findUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user: { ...user, email_verified: isEmailVerified(req.user.id) ? 1 : 0 } });
});

// ─── Password Reset ────────────────────────────────────────────────────
// Always returns success to avoid leaking which emails exist.
router.post('/forgot-password', authLimiter, (req, res) => {
  const { email } = req.body || {};
  if (!email || !validateEmail(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }
  try {
    const user = findUserByEmail.get(email.toLowerCase().trim());
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      createPasswordResetToken({ userId: user.id, tokenHash: hashToken(token), ttlMinutes: 60 });
      const resetUrl = `${BASE_URL}/reset-password.html?token=${token}`;
      fireAndForget(
        sendEmail({ to: user.email, template: 'password_reset', data: { name: user.name, resetUrl }, userId: user.id }),
        'password_reset email'
      );
      auditLog({ actorType: 'user', actorId: String(user.id), action: 'password_reset_requested', ip: req.ip });
    }
  } catch (e) {
    console.error('[forgot-password]', e.message);
  }
  res.json({ success: true, message: 'If that email is registered, a reset link has been sent.' });
});

router.post('/reset-password', authLimiter, (req, res) => {
  const { token, password } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token required' });
  if (!password || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be between 8 and 128 characters' });
  }
  const userId = consumePasswordResetToken(hashToken(token));
  if (!userId) {
    return res.status(400).json({ error: 'Invalid or expired token' });
  }
  updateUserPassword(userId, password);
  auditLog({ actorType: 'user', actorId: String(userId), action: 'password_reset_completed', ip: req.ip });
  res.json({ success: true });
});

// ─── Email Verification ────────────────────────────────────────────────
router.post('/verify-email', (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Token required' });
  const userId = consumeEmailVerificationToken(hashToken(token));
  if (!userId) return res.status(400).json({ error: 'Invalid or expired token' });
  auditLog({ actorType: 'user', actorId: String(userId), action: 'email_verified', ip: req.ip });
  res.json({ success: true });
});

router.post('/resend-verification', authenticateToken, (req, res) => {
  const user = findUserById.get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (isEmailVerified(req.user.id)) {
    return res.json({ success: true, alreadyVerified: true });
  }
  const token = crypto.randomBytes(32).toString('hex');
  createEmailVerificationToken({ userId: user.id, tokenHash: hashToken(token) });
  const verifyUrl = `${BASE_URL}/verify-email.html?token=${token}`;
  fireAndForget(
    sendEmail({ to: user.email, template: 'email_verification', data: { name: user.name, verifyUrl }, userId: user.id }),
    'resend verification'
  );
  auditLog({ actorType: 'user', actorId: String(req.user.id), action: 'verification_resent', ip: req.ip });
  res.json({ success: true });
});

module.exports = router;
