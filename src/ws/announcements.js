const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

/** @type {Map<number, Set<WebSocket>>} */
const receivers = new Map();
/** @type {Map<number, Set<WebSocket>>} */
const controllers = new Map();

/** @type {((userId: number, role: string) => void) | null} */
let onWsConnect = null;

function jwtSecret() {
  return process.env.JWT_SECRET || 'school_bell_secret_2024';
}

function setOnWsConnect(handler) {
  onWsConnect = handler;
}

function isPeerOnline(userId, role) {
  const map = role === 'controller' ? controllers : receivers;
  const set = map.get(userId);
  if (!set) return false;
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) return true;
  }
  return false;
}

function notifyUserReceivers(userId, message) {
  return sendToMap(receivers, userId, message);
}

function notifyController(userId, message) {
  return sendToMap(controllers, userId, message);
}

function deliverToRole(userId, role, message) {
  if (role === 'controller') return notifyController(userId, message);
  return notifyUserReceivers(userId, message);
}

function sendToMap(map, userId, message) {
  const set = map.get(userId);
  if (!set) return 0;
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  let sent = 0;
  set.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent++;
    }
  });
  return sent;
}

function attachAnnouncementWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/announce' });

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://x').searchParams;
    const token = params.get('token');
    const role = params.get('role');

    let userId = null;
    try {
      const payload = jwt.verify(token, jwtSecret());
      userId = payload.id;
    } catch {
      ws.close(4001, 'Unauthorized');
      return;
    }

    if (role === 'controller') {
      if (!controllers.has(userId)) controllers.set(userId, new Set());
      controllers.get(userId).add(ws);
      ws.on('close', () => {
        const set = controllers.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) controllers.delete(userId);
        }
      });
      if (onWsConnect) onWsConnect(userId, 'controller');
      return;
    }

    if (role !== 'user' && role !== 'player') {
      ws.close(4002, 'Use role=controller|user|player. Live audio uses WebRTC /api/live/*.');
      return;
    }

    if (!receivers.has(userId)) receivers.set(userId, new Set());
    receivers.get(userId).add(ws);

    ws.on('close', () => {
      const set = receivers.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) receivers.delete(userId);
      }
    });

    if (onWsConnect) onWsConnect(userId, 'player');
  });

  return wss;
}

module.exports = {
  attachAnnouncementWebSocket,
  notifyUserReceivers,
  notifyController,
  deliverToRole,
  isPeerOnline,
  setOnWsConnect,
};
