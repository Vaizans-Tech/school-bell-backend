const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { log } = require('../lib/liveLogger');
const timeline = require('../services/live/sessionTimeline');

/** @type {Map<number, Set<WebSocket>>} */
const receivers = new Map();
/** @type {Map<number, Set<WebSocket>>} */
const controllers = new Map();

/** @type {((userId: number, role: string, socketId: string) => void) | null} */
let onWsConnect = null;

let socketCounter = 0;

function jwtSecret() {
  return process.env.JWT_SECRET || 'school_bell_secret_2024';
}

function setOnWsConnect(handler) {
  onWsConnect = handler;
}

function assignSocketId(ws) {
  socketCounter += 1;
  const socketId = `ws_${socketCounter}_${Date.now()}`;
  ws._liveSocketId = socketId;
  return socketId;
}

function getActiveSessionIdForUser(userId) {
  try {
    const sessionStore = require('../services/live/sessionStore');
    const session = sessionStore.getActiveSessionForUser(userId);
    return session?.id || null;
  } catch {
    return null;
  }
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

function getPeerSocketCount(userId, role) {
  const map = role === 'controller' ? controllers : receivers;
  return map.get(userId)?.size || 0;
}

function notifyUserReceivers(userId, message) {
  return sendToMap(receivers, userId, message, 'player');
}

function notifyController(userId, message) {
  return sendToMap(controllers, userId, message, 'controller');
}

function deliverToRole(userId, role, message) {
  if (role === 'controller') return notifyController(userId, message);
  return notifyUserReceivers(userId, message);
}

function sendToMap(map, userId, message, roleLabel) {
  const set = map.get(userId);
  if (!set) return 0;
  const payload = typeof message === 'string' ? message : JSON.stringify(message);
  let sent = 0;
  const socketIds = [];
  set.forEach((ws) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
      sent++;
      socketIds.push(ws._liveSocketId || 'unknown');
    }
  });
  if (message?.session_id) {
    timeline.append(message.session_id, 'websocket', 'message_sent', {
      role: roleLabel,
      type: message.type,
      sent,
      socket_ids: socketIds,
      user_id: userId,
    });
  }
  return sent;
}

function attachAnnouncementWebSocket(server) {
  const wss = new WebSocketServer({ server, path: '/ws/announce' });

  wss.on('connection', (ws, req) => {
    const params = new URL(req.url, 'http://x').searchParams;
    const token = params.get('token');
    const role = params.get('role');
    const socketId = assignSocketId(ws);

    let userId = null;
    try {
      const payload = jwt.verify(token, jwtSecret());
      userId = payload.id;
    } catch (err) {
      log('ws_auth_failed', { role, socket_id: socketId, error: err.message });
      ws.close(4001, 'Unauthorized');
      return;
    }

    const sessionId = getActiveSessionIdForUser(userId);

    if (role === 'controller') {
      if (!controllers.has(userId)) controllers.set(userId, new Set());
      controllers.get(userId).add(ws);
      timeline.appendWs(userId, 'controller_socket_connected', {
        socket_id: socketId,
        session_id: sessionId,
        open_sockets: getPeerSocketCount(userId, 'controller'),
      });
      if (sessionId) {
        timeline.append(sessionId, 'websocket', 'controller_socket_connected', {
          socket_id: socketId,
          user_id: userId,
        });
      }
      log('controller_socket_connected', {
        user_id: userId,
        socket_id: socketId,
        session_id: sessionId,
      });
      ws.on('close', () => {
        const set = controllers.get(userId);
        if (set) {
          set.delete(ws);
          if (set.size === 0) controllers.delete(userId);
        }
        timeline.appendWs(userId, 'controller_socket_disconnected', {
          socket_id: socketId,
          session_id: getActiveSessionIdForUser(userId),
          open_sockets: getPeerSocketCount(userId, 'controller'),
        });
        const sid = getActiveSessionIdForUser(userId);
        if (sid) {
          timeline.append(sid, 'websocket', 'controller_socket_disconnected', {
            socket_id: socketId,
            user_id: userId,
          });
        }
        log('controller_socket_disconnected', { user_id: userId, socket_id: socketId, session_id: sid });
      });
      if (onWsConnect) onWsConnect(userId, 'controller', socketId);
      return;
    }

    if (role !== 'user' && role !== 'player') {
      ws.close(4002, 'Use role=controller|user|player. Live audio uses WebRTC /api/live/*.');
      return;
    }

    if (!receivers.has(userId)) receivers.set(userId, new Set());
    receivers.get(userId).add(ws);

    timeline.appendWs(userId, 'player_socket_connected', {
      socket_id: socketId,
      session_id: sessionId,
      open_sockets: getPeerSocketCount(userId, 'player'),
    });
    if (sessionId) {
      timeline.append(sessionId, 'websocket', 'player_socket_connected', {
        socket_id: socketId,
        user_id: userId,
      });
    }
    log('player_socket_connected', {
      user_id: userId,
      socket_id: socketId,
      session_id: sessionId,
    });

    ws.on('close', () => {
      const set = receivers.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) receivers.delete(userId);
      }
      timeline.appendWs(userId, 'player_socket_disconnected', {
        socket_id: socketId,
        session_id: getActiveSessionIdForUser(userId),
        open_sockets: getPeerSocketCount(userId, 'player'),
      });
      const sid = getActiveSessionIdForUser(userId);
      if (sid) {
        timeline.append(sid, 'websocket', 'player_socket_disconnected', {
          socket_id: socketId,
          user_id: userId,
        });
      }
      log('player_socket_disconnected', { user_id: userId, socket_id: socketId, session_id: sid });
    });

    if (onWsConnect) onWsConnect(userId, 'player', socketId);
  });

  return wss;
}

module.exports = {
  attachAnnouncementWebSocket,
  notifyUserReceivers,
  notifyController,
  deliverToRole,
  isPeerOnline,
  getPeerSocketCount,
  setOnWsConnect,
};
