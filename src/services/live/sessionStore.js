/** @type {((session: object) => void) | null} */
let onSessionEnded = null;

function setOnSessionEnded(handler) {
  onSessionEnded = handler;
}

function emitSessionEnded(session) {
  if (onSessionEnded && session) onSessionEnded(session);
}

const { v4: uuidv4 } = require('uuid');
const { log } = require('../../lib/liveLogger');

const SIGNALING_TIMEOUT_MS = parseInt(process.env.LIVE_SIGNALING_TIMEOUT_MS || '300000', 10);
const SESSION_MAX_MS = parseInt(process.env.LIVE_SESSION_MAX_MS || '7200000', 10);

/** @type {Map<string, object>} sessionId -> session */
const sessions = new Map();
/** @type {Map<number, string>} userId -> active sessionId */
const activeByUser = new Map();

function normalizeRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'controller') return 'controller';
  if (r === 'player' || r === 'user') return 'player';
  return null;
}

function publicSession(session, forRole) {
  const base = {
    session_id: session.id,
    status: session.status,
    created_at: session.createdAt,
    connected_at: session.connectedAt,
  };

  if (forRole === 'controller') {
    return {
      ...base,
      answer: session.answer,
      player_device_id: session.playerDeviceId,
    };
  }

  return {
    ...base,
    offer: session.offer,
    controller_device_id: session.controllerDeviceId,
  };
}

function createSession(userId, controllerDeviceId = null) {
  endSessionsForUser(userId, 'replaced');

  const id = uuidv4();
  const now = Date.now();
  const session = {
    id,
    userId,
    status: 'waiting_player',
    controllerDeviceId,
    playerDeviceId: null,
    offer: null,
    answer: null,
    controllerCandidates: [],
    playerCandidates: [],
    createdAt: now,
    updatedAt: now,
    connectedAt: null,
    endedAt: null,
    endReason: null,
  };

  sessions.set(id, session);
  activeByUser.set(userId, id);
  log('session_created', { session_id: id, user_id: userId });
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function getActiveSessionForUser(userId) {
  const id = activeByUser.get(userId);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.status === 'ended') {
    activeByUser.delete(userId);
    return null;
  }
  return session;
}

function assertSessionAccess(session, userId) {
  if (!session) return { ok: false, error: 'Session not found', status: 404 };
  if (session.userId !== userId) return { ok: false, error: 'Not your session', status: 403 };
  if (session.status === 'ended') return { ok: false, error: 'Session already ended', status: 410 };
  return { ok: true };
}

function setOffer(sessionId, userId, offer) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  session.offer = offer;
  session.status = 'offer_sent';
  session.updatedAt = Date.now();
  log('offer_received', { session_id: sessionId, user_id: userId });
  return { ok: true, session };
}

function setAnswer(sessionId, userId, answer, playerDeviceId = null) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  if (!session.offer) {
    return { ok: false, error: 'Offer not ready yet', status: 409 };
  }

  session.answer = answer;
  session.playerDeviceId = playerDeviceId || session.playerDeviceId;
  session.status = 'connected';
  session.connectedAt = Date.now();
  session.updatedAt = Date.now();
  log('session_connected', { session_id: sessionId, user_id: userId });
  return { ok: true, session };
}

function addIceCandidate(sessionId, userId, role, candidate) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  const normalized = normalizeRole(role);
  if (!normalized) return { ok: false, error: 'role must be controller or player', status: 400 };

  const list = normalized === 'controller' ? session.controllerCandidates : session.playerCandidates;
  list.push({ ...candidate, at: Date.now() });
  session.updatedAt = Date.now();
  return { ok: true, session, role: normalized };
}

function drainIceCandidates(sessionId, userId, myRole) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  const normalized = normalizeRole(myRole);
  if (!normalized) return { ok: false, error: 'role must be controller or player', status: 400 };

  const peerList = normalized === 'controller' ? session.playerCandidates : session.controllerCandidates;
  const out = peerList.splice(0, peerList.length);
  return { ok: true, candidates: out };
}

function registerPlayer(sessionId, userId, playerDeviceId = null) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  session.playerDeviceId = playerDeviceId || session.playerDeviceId;
  if (session.status === 'waiting_player') {
    session.status = 'player_joined';
  }
  session.updatedAt = Date.now();
  return { ok: true, session };
}

function endSession(sessionId, userId, reason = 'ended') {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };
  if (session.userId !== userId) return { ok: false, error: 'Not your session', status: 403 };
  if (session.status === 'ended') return { ok: true, session, alreadyEnded: true };

  session.status = 'ended';
  session.endedAt = Date.now();
  session.endReason = reason;
  session.updatedAt = Date.now();
  activeByUser.delete(session.userId);
  log('session_ended', { session_id: sessionId, user_id: userId, reason });
  emitSessionEnded(session);
  return { ok: true, session };
}

function endSessionsForUser(userId, reason = 'replaced') {
  const id = activeByUser.get(userId);
  if (!id) return null;
  const session = sessions.get(id);
  if (session && session.status !== 'ended') {
    session.status = 'ended';
    session.endedAt = Date.now();
    session.endReason = reason;
    log('session_ended', { session_id: id, user_id: userId, reason });
    emitSessionEnded(session);
  }
  activeByUser.delete(userId);
  return session;
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.status === 'ended') {
      if (now - session.endedAt > 600000) sessions.delete(id);
      continue;
    }

    const age = now - session.createdAt;
    const signalingExpired = !session.connectedAt && age > SIGNALING_TIMEOUT_MS;
    const maxExpired = session.connectedAt && now - session.connectedAt > SESSION_MAX_MS;
    const staleWaiting = session.status === 'waiting_player' && age > SIGNALING_TIMEOUT_MS;

    if (signalingExpired || maxExpired || staleWaiting) {
      session.status = 'ended';
      session.endedAt = now;
      session.endReason = 'timeout';
      activeByUser.delete(session.userId);
      log('session_ended', { session_id: id, user_id: session.userId, reason: 'timeout' });
      emitSessionEnded(session);
    }
  }
}

setInterval(cleanupExpiredSessions, 60000);

module.exports = {
  normalizeRole,
  publicSession,
  createSession,
  getSession,
  getActiveSessionForUser,
  setOffer,
  setAnswer,
  addIceCandidate,
  drainIceCandidates,
  registerPlayer,
  endSession,
  endSessionsForUser,
  setOnSessionEnded,
};
