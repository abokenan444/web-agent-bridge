const { signAdminToken, verifyAdminToken } = require('../config/secrets');

function generateAdminToken(admin) {
  return signAdminToken(
    { id: admin.id, email: admin.email, name: admin.name, role: admin.role, isAdmin: true },
    { expiresIn: '12h' }
  );
}

function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Admin access token required' });
  }

  try {
    const decoded = verifyAdminToken(token);
    if (!decoded.isAdmin) {
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    req.admin = decoded;
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired admin token' });
  }
}

module.exports = { generateAdminToken, authenticateAdmin };
