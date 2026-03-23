const { signUserToken, verifyUserToken } = require('../config/secrets');

function generateToken(user) {
  return signUserToken(
    { id: user.id, email: user.email, name: user.name },
    { expiresIn: '7d' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = verifyUserToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
}

function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token) {
    try {
      req.user = verifyUserToken(token);
    } catch (e) {
      // ignore invalid tokens for optional auth
    }
  }
  next();
}

module.exports = { generateToken, authenticateToken, optionalAuth };
