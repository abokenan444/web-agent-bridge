const express = require('express');
const router = express.Router();
const { registerUser, loginUser, findUserById } = require('../models/db');
const { generateToken, authenticateToken } = require('../middleware/auth');
const { authLimiter, registerLimiter } = require('../middleware/rateLimits');
const { validateEmail, sanitizeInput, auditLog, revokeJWT } = require('../services/security');

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
    res.status(201).json({ user, token });
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
  res.json({ user });
});

module.exports = router;
