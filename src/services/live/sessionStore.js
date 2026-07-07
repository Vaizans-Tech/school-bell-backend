/** @type {((session: object) => void) | null} */
let onSessionEnded = null;
/** @type {((session: object, message: object, targetRole: string) => number) | null} */
let deliverSignaling = null;

function setOnSessionEnded(handler) {
  onSessionEnded = handler;
}

function setDeliverSignaling(handler) {
  deliverSignaling = handler;
}

function emitSessionEnded(session) {
  if (onSessionEnded && session) onSessionEnded(session);
}

const { v4: uuidv4 } = require('uuid');
const {
  log,
  logTransition,
  logTiming,
  candidateKey,
} = require('../../lib/liveLogger');
const {
  SESSION_STATUS,
  FAILURE_REASON,
  OFFER_TIMEOUT_MS,
  ANSWER_TIMEOUT_MS,
  ICE_TIMEOUT_MS,
  CONNECTION_TIMEOUT_MS,
  SESSION_MAX_MS,
  ENDED_RETENTION_MS,
  ICE_RETRY_INTERVAL_MS,
  ICE_RETRY_MAX,
  CLEANUP_INTERVAL_MS,
  CLIENT_EVENTS,
} = require('../../lib/liveConstants');
const monitoring = require('./monitoring');
const timeline = require('./sessionTimeline');

/** @type {Map<string, object>} */
const sessions = new Map();
/** @type {Map<number, string>} */
const activeByUser = new Map();

function createDiagnostics(now) {
  return {
    session_created_at: now,
    player_ready_at: null,
    offer_created_at: null,
    offer_delivered_at: null,
    answer_created_at: null,
    answer_delivered_at: null,
    ice_start_at: null,
    ice_connected_at: null,
    ice_failed_at: null,
    peer_connected_at: null,
    peer_closed_at: null,
    streaming_at: null,
    turn_used: false,
    stun_used: false,
    relay_used: false,
    timings: {},
  };
}

function normalizeRole(role) {
  const r = (role || '').toLowerCase();
  if (r === 'controller') return 'controller';
  if (r === 'player' || r === 'user') return 'player';
  return null;
}

function transitionStatus(session, nextStatus, meta = {}) {
  const prev = session.status;
  if (prev === nextStatus) return;
  session.status = nextStatus;
  session.updatedAt = Date.now();
  logTransition(session.id, prev, nextStatus, meta);
}

function failSession(session, reason) {
  session.failureReason = reason;
  const durationMs = Date.now() - session.createdAt;
  timeline.recordTimeout(session.id, reason, {
    session_duration_ms: durationMs,
    status_at_fail: session.status,
    controller_ice: session.controllerCandidates.length,
    player_ice: session.playerCandidates.length,
    pending_retries: session.pendingRetries.length,
  });
  timeline.recordSession(session.id, 'session_failed', { reason, duration_ms: durationMs });
  transitionStatus(session, SESSION_STATUS.ENDED, { reason });
  session.endedAt = Date.now();
  session.endReason = reason;
  activeByUser.delete(session.userId);
  monitoring.recordSessionEnded(session);
  log('session_failed', { session_id: session.id, user_id: session.userId, reason, duration_ms: durationMs });
  emitSessionEnded(session);
  cleanupSessionMemory(session);
}

function publicSession(session, forRole) {
  const base = {
    session_id: session.id,
    status: session.status,
    created_at: session.createdAt,
    connected_at: session.connectedAt,
    failure_reason: session.failureReason || null,
  };

  if (forRole === 'controller') {
    return {
      ...base,
      answer: session.answer,
      player_device_id: session.playerDeviceId,
      player_ready: session.status !== SESSION_STATUS.CREATED
        && session.status !== SESSION_STATUS.PLAYER_WAITING,
    };
  }

  return {
    ...base,
    offer: session.offer,
    controller_device_id: session.controllerDeviceId,
    player_ready: session.status === SESSION_STATUS.PLAYER_READY
      || session.status === SESSION_STATUS.OFFER_SENT
      || session.status === SESSION_STATUS.ANSWER_RECEIVED
      || session.status === SESSION_STATUS.ICE_CHECKING
      || session.status === SESSION_STATUS.CONNECTED
      || session.status === SESSION_STATUS.STREAMING,
  };
}

function publicDiagnostics(session) {
  return timeline.buildReport(session);
}

function createSession(userId, controllerDeviceId = null) {
  const replaced = endSessionsForUser(userId, FAILURE_REASON.REPLACED);

  const id = uuidv4();
  const now = Date.now();
  const session = {
    id,
    userId,
    status: SESSION_STATUS.CREATED,
    controllerDeviceId,
    playerDeviceId: null,
    offer: null,
    answer: null,
    controllerCandidates: [],
    playerCandidates: [],
    controllerCandidateKeys: new Set(),
    playerCandidateKeys: new Set(),
    pendingRetries: [],
    diagnostics: createDiagnostics(now),
    failureReason: null,
    createdAt: now,
    updatedAt: now,
    playerReadyAt: null,
    offerSentAt: null,
    answerReceivedAt: null,
    connectedAt: null,
    endedAt: null,
    endReason: null,
  };

  sessions.set(id, session);
  activeByUser.set(userId, id);
  transitionStatus(session, SESSION_STATUS.PLAYER_WAITING);
  monitoring.recordSessionCreated();
  timeline.recordSession(id, 'session_created', {
    user_id: userId,
    controller_device_id: controllerDeviceId,
    replaced_session_id: replaced?.id || null,
  });
  if (replaced) {
    timeline.recordRace(id, 'duplicate_session_replaced', {
      previous_session_id: replaced.id,
      previous_status: replaced.status,
    });
  }
  log('session_created', { session_id: id, user_id: userId, controller_device_id: controllerDeviceId });
  return session;
}

function getSession(sessionId) {
  return sessions.get(sessionId) || null;
}

function getActiveSessionForUser(userId) {
  const id = activeByUser.get(userId);
  if (!id) return null;
  const session = sessions.get(id);
  if (!session || session.status === SESSION_STATUS.ENDED) {
    activeByUser.delete(userId);
    return null;
  }
  return session;
}

function assertSessionAccess(session, userId) {
  if (!session) return { ok: false, error: 'Session not found', status: 404 };
  if (session.userId !== userId) {
    log('unauthorized_access', { session_id: session.id, user_id: userId });
    timeline.recordAuth(session.id, 'auth_failed', {
      user_id: userId,
      reason: 'not_session_owner',
    });
    return { ok: false, error: 'Not your session', status: 403, failureReason: FAILURE_REASON.AUTHENTICATION_FAILED };
  }
  if (session.status === SESSION_STATUS.ENDED) {
    return { ok: false, error: 'Session already ended', status: 410, failureReason: session.endReason };
  }
  return { ok: true };
}

function recordTiming(session, stage, startMs) {
  const ms = Date.now() - startMs;
  session.diagnostics.timings[stage] = ms;
  logTiming(session.id, stage, ms);
  return ms;
}

function queueRetry(session, message, targetRole) {
  const existing = session.pendingRetries.find(
    (r) => r.message.type === message.type
      && r.message.session_id === message.session_id
      && JSON.stringify(r.message.candidate) === JSON.stringify(message.candidate)
  );
  if (existing) {
    existing.attempts += 1;
    return;
  }
  session.pendingRetries.push({
    message,
    targetRole,
    attempts: 0,
    createdAt: Date.now(),
  });
}

function deliverOrQueue(session, message, targetRole) {
  if (!deliverSignaling) return 0;
  const sent = deliverSignaling(session, message, targetRole);
  if (sent === 0) {
    queueRetry(session, message, targetRole);
    timeline.append(session.id, 'signaling', 'message_queued', {
      type: message.type,
      target: targetRole,
      reason: targetRole === 'player' ? 'player_offline' : 'controller_offline',
    });
    if (targetRole === 'player') {
      session.failureReason = FAILURE_REASON.PLAYER_OFFLINE;
    } else {
      session.failureReason = FAILURE_REASON.SIGNALING_LOST;
    }
  }
  return sent;
}

function flushPendingRetries(session) {
  if (!deliverSignaling || !session.pendingRetries.length) return;
  const remaining = [];
  for (const item of session.pendingRetries) {
    if (item.attempts >= ICE_RETRY_MAX) {
      timeline.recordIceDropped(session.id, item.targetRole === 'player' ? 'controller' : 'player', item.targetRole, 'retry_exhausted');
      log('retry_exhausted', {
        session_id: session.id,
        type: item.message.type,
        target: item.targetRole,
      });
      continue;
    }
    const sent = deliverSignaling(session, item.message, item.targetRole);
    if (sent === 0) {
      item.attempts += 1;
      remaining.push(item);
    } else {
      timeline.append(session.id, 'signaling', 'retry_delivered', {
        type: item.message.type,
        target: item.targetRole,
        attempt: item.attempts + 1,
      });
      log('retry_delivered', {
        session_id: session.id,
        type: item.message.type,
        target: item.targetRole,
        attempt: item.attempts + 1,
      });
    }
  }
  session.pendingRetries = remaining;
}

function pushIceCandidate(session, role, candidate) {
  const sessionId = session.id;
  const normalized = normalizeRole(role);
  const key = candidateKey(candidate);
  const keys = normalized === 'controller' ? session.controllerCandidateKeys : session.playerCandidateKeys;
  const list = normalized === 'controller' ? session.controllerCandidates : session.playerCandidates;

  if (keys.has(key)) {
    timeline.recordIceDuplicate(sessionId, normalized, candidate);
    return { ok: true, session, role: normalized, duplicate: true };
  }
  keys.add(key);
  list.push({ ...candidate, at: Date.now() });
  timeline.recordIceReceived(sessionId, normalized, candidate, {
    total_controller: session.controllerCandidates.length,
    total_player: session.playerCandidates.length,
  });

  if (!session.diagnostics.ice_start_at
    && (session.status === SESSION_STATUS.ANSWER_RECEIVED
      || session.status === SESSION_STATUS.ICE_CHECKING)) {
    session.diagnostics.ice_start_at = Date.now();
  }

  if (session.status === SESSION_STATUS.ANSWER_RECEIVED) {
    transitionStatus(session, SESSION_STATUS.ICE_CHECKING);
  }

  session.updatedAt = Date.now();
  return { ok: true, session, role: normalized, duplicate: false };
}

function setOffer(sessionId, userId, offer) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  const allowed = [
    SESSION_STATUS.PLAYER_READY,
    SESSION_STATUS.OFFER_SENT,
    SESSION_STATUS.ANSWER_RECEIVED,
    SESSION_STATUS.ICE_CHECKING,
  ];
  if (!allowed.includes(session.status)) {
    timeline.recordRace(sessionId, 'offer_before_player_ready', {
      current_status: session.status,
      player_ready_at: session.playerReadyAt,
    });
    return {
      ok: false,
      error: 'Player not ready — offer cannot be sent yet',
      status: 409,
      failureReason: FAILURE_REASON.PLAYER_OFFLINE,
    };
  }

  const start = Date.now();
  session.offer = offer;
  session.offerSentAt = Date.now();
  session.diagnostics.offer_created_at = session.offerSentAt;
  transitionStatus(session, SESSION_STATUS.OFFER_SENT);
  recordTiming(session, 'offer_stored', start);
  timeline.recordSignaling(sessionId, 'offer_created', { user_id: userId });
  timeline.recordSignaling(sessionId, 'offer_received', { user_id: userId, sdp_length: offer.sdp?.length });
  log('offer_received', { session_id: sessionId, user_id: userId });
  return { ok: true, session };
}

function setAnswer(sessionId, userId, answer, playerDeviceId = null) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  if (!session.offer) {
    timeline.recordRace(sessionId, 'answer_before_offer', { status: session.status });
    return {
      ok: false,
      error: 'Offer not ready yet',
      status: 409,
      failureReason: FAILURE_REASON.SIGNALING_LOST,
    };
  }

  // Ignore duplicate/late answer if session already past answer stage
  const pastAnswer = [
    SESSION_STATUS.ANSWER_RECEIVED,
    SESSION_STATUS.ICE_CHECKING,
    SESSION_STATUS.CONNECTED,
    SESSION_STATUS.STREAMING,
  ];
  if (pastAnswer.includes(session.status) && session.answer) {
    log('answer_ignored_duplicate', { session_id: sessionId, user_id: userId, status: session.status });
    return { ok: true, session, duplicate: true };
  }

  const start = Date.now();
  session.answer = answer;
  session.playerDeviceId = playerDeviceId || session.playerDeviceId;
  session.answerReceivedAt = Date.now();
  session.diagnostics.answer_created_at = session.answerReceivedAt;
  transitionStatus(session, SESSION_STATUS.ANSWER_RECEIVED);
  recordTiming(session, 'answer_stored', start);
  timeline.recordSignaling(sessionId, 'answer_created', { user_id: userId, player_device_id: playerDeviceId });
  timeline.recordSignaling(sessionId, 'answer_received', { user_id: userId, sdp_length: answer.sdp?.length });
  log('answer_received', { session_id: sessionId, user_id: userId });
  return { ok: true, session };
}

function addIceCandidate(sessionId, userId, role, candidate) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  if (!session.offer) {
    timeline.recordRace(sessionId, 'ice_before_remote_sdp', { role, status: session.status });
    return {
      ok: false,
      error: 'Remote SDP not ready — ICE buffered on client until offer/answer set',
      status: 409,
      failureReason: FAILURE_REASON.SIGNALING_LOST,
    };
  }

  const normalized = normalizeRole(role);
  if (!normalized) {
    return { ok: false, error: 'role must be controller or player', status: 400 };
  }

  return pushIceCandidate(session, normalized, candidate);
}

function registerPlayer(sessionId, userId, playerDeviceId = null) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  session.playerDeviceId = playerDeviceId || session.playerDeviceId;
  session.playerReadyAt = Date.now();
  session.diagnostics.player_ready_at = session.playerReadyAt;

  if (session.status === SESSION_STATUS.PLAYER_WAITING || session.status === SESSION_STATUS.CREATED) {
    transitionStatus(session, SESSION_STATUS.PLAYER_READY);
    timeline.recordSession(sessionId, 'player_ready', {
      user_id: userId,
      player_device_id: playerDeviceId,
      wait_ms: Date.now() - session.createdAt,
    });
  }

  flushPendingRetries(session);
  return { ok: true, session };
}

function recordClientEvent(sessionId, userId, role, event, details = {}) {
  const session = getSession(sessionId);
  const access = assertSessionAccess(session, userId);
  if (!access.ok) return access;

  if (!CLIENT_EVENTS.has(event)) {
    return { ok: false, error: 'Unknown event', status: 400 };
  }

  const now = Date.now();
  const diag = session.diagnostics;

  switch (event) {
    case 'ice_connected':
      diag.ice_connected_at = now;
      session.connectedAt = now;
      transitionStatus(session, SESSION_STATUS.CONNECTED);
      break;
    case 'ice_failed':
      diag.ice_failed_at = now;
      failSession(session, FAILURE_REASON.ICE_FAILED);
      return { ok: true, session, ended: true };
    case 'peer_connected':
      diag.peer_connected_at = now;
      if (!session.connectedAt) session.connectedAt = now;
      if (session.status !== SESSION_STATUS.STREAMING) {
        transitionStatus(session, SESSION_STATUS.CONNECTED);
      }
      break;
    case 'peer_closed':
      diag.peer_closed_at = now;
      failSession(session, FAILURE_REASON.PEER_CLOSED);
      return { ok: true, session, ended: true };
    case 'turn_used':
      diag.turn_used = true;
      break;
    case 'stun_used':
      diag.stun_used = true;
      break;
    case 'relay_used':
      diag.relay_used = true;
      break;
    case 'network_changed':
      session.failureReason = FAILURE_REASON.NETWORK_CHANGED;
      flushPendingRetries(session);
      break;
    default:
      break;
  }

  if (event === 'peer_connected' && details.streaming) {
    diag.streaming_at = now;
    transitionStatus(session, SESSION_STATUS.STREAMING);
  }

  monitoring.recordClientEvent(event);
  log('client_event', { session_id: sessionId, user_id: userId, role, event, details });
  return { ok: true, session };
}

function markDelivered(session, type, startMs) {
  const now = Date.now();
  const ms = now - startMs;
  if (type === 'offer') session.diagnostics.offer_delivered_at = now;
  if (type === 'answer') session.diagnostics.answer_delivered_at = now;
  session.diagnostics.timings[`${type}_delivery`] = ms;
  timeline.recordSignaling(session.id, `${type}_delivered`, { delivery_ms: ms });
  logTiming(session.id, `${type}_delivered`, ms);
}

function resyncSignalingForPeer(userId, role) {
  const session = getActiveSessionForUser(userId);
  if (!session) return null;

  const normalized = normalizeRole(role);
  if (!normalized) return null;

  log('signaling_resync', { session_id: session.id, user_id: userId, role: normalized });
  timeline.append(session.id, 'signaling', 'reconnect_resync', { user_id: userId, role: normalized });
  flushPendingRetries(session);

  if (normalized === 'player') {
    if (session.status === SESSION_STATUS.PLAYER_WAITING) {
      registerPlayer(session.id, userId, session.playerDeviceId);
    }
    for (const c of session.controllerCandidates) {
      const msg = {
        type: 'live_ice',
        session_id: session.id,
        from_role: 'controller',
        candidate: {
          candidate: c.candidate,
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
        },
      };
      const sent = deliverOrQueue(session, msg, 'player');
      recordIceForwarded(session.id, 'controller', 'player', c, sent, { resync: true });
    }
  } else {
    for (const c of session.playerCandidates) {
      const msg = {
        type: 'live_ice',
        session_id: session.id,
        from_role: 'player',
        candidate: {
          candidate: c.candidate,
          sdpMid: c.sdpMid,
          sdpMLineIndex: c.sdpMLineIndex,
        },
      };
      const sent = deliverOrQueue(session, msg, 'controller');
      recordIceForwarded(session.id, 'player', 'controller', c, sent, { resync: true });
    }
  }

  return session;
}

function cleanupSessionMemory(session) {
  session.controllerCandidates = [];
  session.playerCandidates = [];
  session.controllerCandidateKeys.clear();
  session.playerCandidateKeys.clear();
  session.pendingRetries = [];
  session.offer = null;
  session.answer = null;
}

function endSession(sessionId, userId, reason = FAILURE_REASON.ENDED) {
  const session = getSession(sessionId);
  if (!session) return { ok: false, error: 'Session not found', status: 404 };
  if (session.userId !== userId) {
    return { ok: false, error: 'Not your session', status: 403, failureReason: FAILURE_REASON.AUTHENTICATION_FAILED };
  }
  if (session.status === SESSION_STATUS.ENDED) {
    return { ok: true, session, alreadyEnded: true };
  }

  transitionStatus(session, SESSION_STATUS.ENDED, { reason });
  session.endedAt = Date.now();
  session.endReason = reason;
  const durationMs = session.endedAt - session.createdAt;
  timeline.recordSession(sessionId, 'session_closed', { reason, duration_ms: durationMs, user_id: userId });
  activeByUser.delete(session.userId);
  monitoring.recordSessionEnded(session);
  cleanupSessionMemory(session);
  log('session_ended', { session_id: sessionId, user_id: userId, reason, duration_ms: durationMs });
  emitSessionEnded(session);
  return { ok: true, session };
}

function endSessionsForUser(userId, reason = FAILURE_REASON.REPLACED) {
  const id = activeByUser.get(userId);
  if (!id) return null;
  const session = sessions.get(id);
  if (session && session.status !== SESSION_STATUS.ENDED) {
    transitionStatus(session, SESSION_STATUS.ENDED, { reason });
    session.endedAt = Date.now();
    session.endReason = reason;
    timeline.recordSession(id, 'session_closed', {
      reason,
      duration_ms: session.endedAt - session.createdAt,
      user_id: userId,
      replaced: reason === FAILURE_REASON.REPLACED,
    });
    monitoring.recordSessionEnded(session);
    cleanupSessionMemory(session);
    log('session_ended', { session_id: id, user_id: userId, reason });
    emitSessionEnded(session);
  }
  activeByUser.delete(userId);
  return session;
}

function checkTimeouts() {
  const now = Date.now();
  for (const [, session] of sessions.entries()) {
    if (session.status === SESSION_STATUS.ENDED) continue;

    const age = now - session.createdAt;

    if (!session.playerReadyAt
      && (session.status === SESSION_STATUS.PLAYER_WAITING
        || session.status === SESSION_STATUS.CREATED)
      && age > OFFER_TIMEOUT_MS) {
      failSession(session, FAILURE_REASON.PLAYER_OFFLINE);
      continue;
    }

    if (!session.connectedAt && age > CONNECTION_TIMEOUT_MS
      && session.status !== SESSION_STATUS.STREAMING
      && session.status !== SESSION_STATUS.CONNECTED
      && session.status !== SESSION_STATUS.ICE_CHECKING) {
      failSession(session, FAILURE_REASON.CONNECTION_TIMEOUT);
      continue;
    }

    if (session.playerReadyAt && !session.offerSentAt
      && now - session.playerReadyAt > OFFER_TIMEOUT_MS
      && session.status === SESSION_STATUS.PLAYER_READY) {
      failSession(session, FAILURE_REASON.OFFER_TIMEOUT);
      continue;
    }

    if (session.offerSentAt && !session.answerReceivedAt
      && now - session.offerSentAt > ANSWER_TIMEOUT_MS
      && session.status === SESSION_STATUS.OFFER_SENT) {
      failSession(session, FAILURE_REASON.ANSWER_TIMEOUT);
      continue;
    }

    if (session.answerReceivedAt && !session.diagnostics.ice_connected_at
      && now - session.answerReceivedAt > ICE_TIMEOUT_MS
      && (session.status === SESSION_STATUS.ANSWER_RECEIVED
        || session.status === SESSION_STATUS.ICE_CHECKING)) {
      failSession(session, FAILURE_REASON.ICE_FAILED);
      continue;
    }

    if (session.connectedAt && now - session.connectedAt > SESSION_MAX_MS) {
      failSession(session, FAILURE_REASON.PEER_CLOSED);
    }
  }
}

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (session.status === SESSION_STATUS.ENDED) {
      if (session.endedAt && now - session.endedAt > ENDED_RETENTION_MS) {
        timeline.recordSession(id, 'session_expired', {
          retention_ms: ENDED_RETENTION_MS,
          ended_at: session.endedAt,
        });
        timeline.purge(id);
        sessions.delete(id);
      }
    }
  }
}

function runMaintenance() {
  checkTimeouts();
  cleanupExpiredSessions();
  for (const [, session] of sessions.entries()) {
    if (session.status !== SESSION_STATUS.ENDED && session.pendingRetries.length) {
      flushPendingRetries(session);
    }
  }
}

function recordIceForwarded(sessionId, fromRole, toRole, candidate, sent, extra = {}) {
  timeline.recordIceForwarded(sessionId, fromRole, toRole, candidate, sent, extra);
}

setInterval(runMaintenance, CLEANUP_INTERVAL_MS);

module.exports = {
  SESSION_STATUS,
  FAILURE_REASON,
  normalizeRole,
  publicSession,
  publicDiagnostics,
  createSession,
  getSession,
  getActiveSessionForUser,
  setOffer,
  setAnswer,
  addIceCandidate,
  registerPlayer,
  recordClientEvent,
  endSession,
  endSessionsForUser,
  setOnSessionEnded,
  setDeliverSignaling,
  deliverOrQueue,
  markDelivered,
  resyncSignalingForPeer,
  recordIceForwarded,
  flushPendingRetries,
  getTimeline: timeline.getTimeline,
  getIceStats: timeline.getIceStats,
};
