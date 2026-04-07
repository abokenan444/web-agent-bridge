const WebSocket = require('ws');
const { verifyUserToken, verifyAdminToken } = require('./config/secrets');
const { findSiteById } = require('./models/db');
const { isJWTRevoked, auditLog } = require('./services/security');

// Map of siteId → Set of WebSocket clients
const siteClients = new Map();
// Per-IP connection tracking
const ipConnections = new Map();
const MAX_CONNECTIONS_PER_IP = 10;
const AUTH_TIMEOUT_MS = 10_000;
const MAX_MESSAGE_SIZE = 4096;
const MSG_RATE_WINDOW = 60_000;
const MSG_RATE_MAX = 30;

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws/analytics', maxPayload: MAX_MESSAGE_SIZE });

  wss.on('connection', (ws, req) => {
    let authenticatedSiteId = null;
    const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown';

    // ── Per-IP connection limit ──
    const currentCount = ipConnections.get(clientIP) || 0;
    if (currentCount >= MAX_CONNECTIONS_PER_IP) {
      ws.close(1013, 'Too many connections');
      return;
    }
    ipConnections.set(clientIP, currentCount + 1);

    // ── Auth timeout — close if not authenticated within 10s ──
    const authTimer = setTimeout(() => {
      if (!authenticatedSiteId) {
        ws.close(4001, 'Authentication timeout');
      }
    }, AUTH_TIMEOUT_MS);

    // ── Message rate limiter ──
    const msgTimestamps = [];

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      // Rate limit messages
      const now = Date.now();
      msgTimestamps.push(now);
      while (msgTimestamps.length > 0 && msgTimestamps[0] < now - MSG_RATE_WINDOW) {
        msgTimestamps.shift();
      }
      if (msgTimestamps.length > MSG_RATE_MAX) {
        ws.close(4008, 'Message rate limit exceeded');
        return;
      }

      try {
        const msg = JSON.parse(data);

        if (msg.type === 'auth') {
          if (!msg.token || !msg.siteId) {
            ws.send(JSON.stringify({ type: 'error', message: 'token and siteId required' }));
            return;
          }

          // Check JWT revocation before verifying
          if (isJWTRevoked(msg.token)) {
            ws.send(JSON.stringify({ type: 'error', message: 'Token has been revoked' }));
            ws.close(4003, 'Token revoked');
            return;
          }

          let decoded;
          let isAdmin = false;
          try {
            decoded = verifyUserToken(msg.token);
          } catch {
            try {
              decoded = verifyAdminToken(msg.token);
              isAdmin = decoded.isAdmin === true;
            } catch {
              ws.send(JSON.stringify({ type: 'error', message: 'Invalid message or auth failed' }));
              auditLog({ actorType: 'system', action: 'ws_auth_failed', ip: clientIP, outcome: 'denied', severity: 'warning' });
              return;
            }
          }

          if (!isAdmin) {
            const site = findSiteById.get(msg.siteId);
            if (!site || site.user_id !== decoded.id) {
              ws.send(JSON.stringify({ type: 'error', message: 'Forbidden: not your site' }));
              return;
            }
          }

          clearTimeout(authTimer);
          authenticatedSiteId = msg.siteId;
          if (!siteClients.has(msg.siteId)) {
            siteClients.set(msg.siteId, new Set());
          }
          siteClients.get(msg.siteId).add(ws);
          ws.send(JSON.stringify({ type: 'auth:success', siteId: msg.siteId }));
        } else if (!authenticatedSiteId) {
          // Reject all non-auth messages before authentication
          ws.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message or auth failed' }));
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      // Decrement IP connection count
      const count = ipConnections.get(clientIP) || 1;
      if (count <= 1) ipConnections.delete(clientIP);
      else ipConnections.set(clientIP, count - 1);

      if (authenticatedSiteId && siteClients.has(authenticatedSiteId)) {
        siteClients.get(authenticatedSiteId).delete(ws);
        if (siteClients.get(authenticatedSiteId).size === 0) {
          siteClients.delete(authenticatedSiteId);
        }
      }
    });

    ws.on('error', () => {
      clearTimeout(authTimer);
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => clearInterval(interval));

  return wss;
}

function broadcastAnalytic(siteId, eventData) {
  const clients = siteClients.get(siteId);
  if (!clients || clients.size === 0) return;

  const message = JSON.stringify({
    type: 'analytic',
    timestamp: new Date().toISOString(),
    ...eventData
  });

  clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

module.exports = { setupWebSocket, broadcastAnalytic };
