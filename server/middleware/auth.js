const { signUserToken, verifyUserToken } = require('../config/secrets');
const { isJWTRevoked } = require('../services/security');

function generateToken(user) {
  return signUserToken(
    { id: user.id, email: user.email, name: user.name },
    { expiresIn: '24h' }
  );
}

function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Check revocation list
    if (isJWTRevoked(token)) {
      return res.status(403).json({ error: 'Token has been revoked' });
    }
    const decoded = verifyUserToken(token);
    req.user = decoded;
    req._rawToken = token;
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
      if (!isJWTRevoked(token)) {
        req.user = verifyUserToken(token);
        req._rawToken = token;
      }
    } catch (e) {
      // ignore invalid tokens for optional auth
    }
  }
  next();
}

module.exports = { generateToken, authenticateToken, optionalAuth };
