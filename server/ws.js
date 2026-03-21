const WebSocket = require('ws');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

// Map of siteId → Set of WebSocket clients
const siteClients = new Map();

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server, path: '/ws/analytics' });

  wss.on('connection', (ws, req) => {
    let authenticatedSiteId = null;

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);

        if (msg.type === 'auth') {
          // Authenticate via JWT token and subscribe to a site
          const decoded = jwt.verify(msg.token, JWT_SECRET);
          if (decoded && msg.siteId) {
            authenticatedSiteId = msg.siteId;
            if (!siteClients.has(msg.siteId)) {
              siteClients.set(msg.siteId, new Set());
            }
            siteClients.get(msg.siteId).add(ws);
            ws.send(JSON.stringify({ type: 'auth:success', siteId: msg.siteId }));
          }
        }
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message or auth failed' }));
      }
    });

    ws.on('close', () => {
      if (authenticatedSiteId && siteClients.has(authenticatedSiteId)) {
        siteClients.get(authenticatedSiteId).delete(ws);
        if (siteClients.get(authenticatedSiteId).size === 0) {
          siteClients.delete(authenticatedSiteId);
        }
      }
    });
  });

  // Heartbeat to clean up dead connections
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

// Broadcast an analytics event to all clients watching a specific site
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
