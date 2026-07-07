const router = require('express').Router();
const jwt = require('jsonwebtoken');
const { getIceServers } = require('../lib/webrtcConfig');
const {
  log,
  logError,
  logAuth,
  summarizeIceServers,
  summarizeSdp,
  summarizeIceCandidate,
} = require('../lib/liveLogger');
const {
  notifyUserReceivers,
  notifyController,
  deliverToRole,
  isPeerOnline,
  getPeerSocketCount,
  setOnWsConnect,
} = require('../ws/announcements');
const sessionStore = require('../services/live/sessionStore');
const timeline = require('../services/live/sessionTimeline');
const { getMonitoringDashboard } = require('../services/live/monitoring');
const { FAILURE_REASON } = require('../lib/liveConstants');

function jwtSecret() {
  return process.env.JWT_SECRET || 'school_bell_secret_2024';
}

/** Live routes auth — logs every success/failure with failure_reason */
function authMiddleware(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) {
    logAuth('live', false, { path: req.path, reason: 'no_token' });
    return res.status(401).json({
      error: 'No token provided',
      failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
    });
  }
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, jwtSecret());
    next();
  } catch (err) {
    logAuth('live', false, { path: req.path, reason: 'invalid_token', error: err.message });
    return res.status(401).json({
      error: 'Invalid or expired token',
      failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
    });
  }
}

function deliverSignaling(session, message, targetRole) {
  return deliverToRole(session.userId, targetRole, message);
}

sessionStore.setDeliverSignaling(deliverSignaling);

sessionStore.setOnSessionEnded((session) => {
  const payload = {
    type: 'live_end',
    session_id: session.id,
    reason: session.endReason || session.failureReason || 'ended',
    failure_reason: session.failureReason || null,
  };
  notifyUserReceivers(session.userId, payload);
  notifyController(session.userId, payload);
});

setOnWsConnect((userId, role, socketId) => {
  log('ws_reconnect_resync', { user_id: userId, role, socket_id: socketId });
  sessionStore.resyncSignalingForPeer(userId, role);
});

function logLiveAuth(req, role) {
  const session = sessionStore.getActiveSessionForUser(req.user.id);
  logAuth(role || 'user', true, {
    user_id: req.user.id,
    username: req.user.username,
    session_id: session?.id || null,
  });
  if (session?.id && role) {
    timeline.recordAuth(session.id, `${role}_auth_success`, {
      user_id: req.user.id,
      username: req.user.username,
    });
  }
}

function logLiveAuthFail(req, role, reason) {
  logAuth(role || 'user', false, { user_id: req.user?.id, reason });
}

function parseSdpPayload(body, fieldName) {
  if (body[fieldName] && typeof body[fieldName] === 'object') {
    const sdp = body[fieldName];
    if (!sdp.sdp || !sdp.type) {
      return { error: `${fieldName} must include sdp and type`, status: 400 };
    }
    return { value: { sdp: String(sdp.sdp), type: String(sdp.type) } };
  }
  if (body.sdp && body.type) {
    return { value: { sdp: String(body.sdp), type: String(body.type) } };
  }
  return { error: `${fieldName} or sdp+type required`, status: 400 };
}

function notifyPlayer(userId, message, session = null) {
  const sent = notifyUserReceivers(userId, message);
  const details = { user_id: userId, sent, type: message.type };
  if (message.session_id) details.session_id = message.session_id;
  if (message.ice_servers) details.ice_servers = summarizeIceServers(message.ice_servers);
  log('player_notified', details);
  if (session && sent === 0) {
    if (message.type === 'live_session') {
      timeline.recordSession(session.id, 'player_offline_at_start', {
        user_id: userId,
        reason: 'player_websocket_not_connected',
      });
      log('player_offline', { session_id: session.id, user_id: userId, event: 'live_session' });
    }
    sessionStore.deliverOrQueue(session, message, 'player');
  }
  if (session && sent > 0 && message.type === 'live_offer') {
    sessionStore.markDelivered(session, 'offer', session.offerSentAt || Date.now());
  }
  return sent;
}

function notifyControllerPeer(userId, message, session = null) {
  const sent = notifyController(userId, message);
  const details = { user_id: userId, sent, type: message.type };
  if (message.session_id) details.session_id = message.session_id;
  log('controller_notified', details);
  if (session && sent === 0) {
    timeline.append(session.id, 'signaling', 'controller_offline', {
      user_id: userId,
      type: message.type,
      reason: 'controller_websocket_not_connected',
    });
    log('controller_offline', { session_id: session.id, user_id: userId, event: message.type });
    sessionStore.deliverOrQueue(session, message, 'controller');
  }
  if (session && sent > 0 && message.type === 'live_answer') {
    sessionStore.markDelivered(session, 'answer', session.answerReceivedAt || Date.now());
  }
  return sent;
}

function pushIceToPeer(session, fromRole, candidate) {
  const targetRole = fromRole === 'controller' ? 'player' : 'controller';
  const message = {
    type: 'live_ice',
    session_id: session.id,
    from_role: fromRole,
    candidate: {
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
    },
  };

  const sent = deliverToRole(session.userId, targetRole, message);
  sessionStore.recordIceForwarded(
    session.id,
    fromRole,
    targetRole,
    candidate,
    sent,
    { candidate: summarizeIceCandidate(candidate) }
  );
  log('ice_candidate_pushed', {
    session_id: session.id,
    from_role: fromRole,
    to_role: targetRole,
    sent,
    candidate: summarizeIceCandidate(candidate),
  });

  if (sent === 0) {
    sessionStore.deliverOrQueue(session, message, targetRole);
  }
}

/** ICE/STUN/TURN config for WebRTC clients */
router.get('/config', authMiddleware, (req, res) => {
  const ice_servers = getIceServers();
  const summary = summarizeIceServers(ice_servers);
  const session = sessionStore.getActiveSessionForUser(req.user.id);
  logLiveAuth(req, null);
  log('config_returned', {
    user_id: req.user.id,
    ice_servers: summary,
    turn_unmodified: true,
  });
  if (session?.id) {
    timeline.recordConfig(session.id, 'ice_config_returned', {
      endpoint: 'GET /api/live/config',
      ice_servers: summary,
    });
  }
  res.json({ ice_servers });
});

/** POST /api/live/session — Controller starts a live WebRTC session */
router.post('/session', authMiddleware, (req, res) => {
  const start = Date.now();
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'controller') {
      logLiveAuthFail(req, 'controller', 'not_controller_role');
      return res.status(403).json({
        error: 'Only controller can create a live session',
        failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
      });
    }

    const session = sessionStore.createSession(req.user.id, req.body.device_id || null);
    const ice_servers = getIceServers();
    const iceSummary = summarizeIceServers(ice_servers);

    logLiveAuth(req, 'controller');
    timeline.recordConfig(session.id, 'ice_config_returned', {
      endpoint: 'POST /api/live/session',
      ice_servers: iceSummary,
      turn_unmodified: true,
    });

    log('session_create', {
      session_id: session.id,
      user_id: req.user.id,
      device_id: req.body.device_id || null,
      ice_servers: iceSummary,
      player_online: isPeerOnline(req.user.id, 'player'),
      player_socket_count: getPeerSocketCount(req.user.id, 'player'),
    });

    notifyPlayer(req.user.id, {
      type: 'live_session',
      session_id: session.id,
      ice_servers,
    }, session);

    const ms = Date.now() - start;
    log('timing', { session_id: session.id, stage: 'session_created', ms });

    res.status(201).json({
      session_id: session.id,
      status: session.status,
      ice_servers,
      message: 'Live session created — waiting for player',
      timing_ms: ms,
    });
  } catch (err) {
    logError('session_create_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/live/session — Session state + signaling resync on reconnect */
router.get('/session', authMiddleware, (req, res) => {
  try {
    const role = sessionStore.normalizeRole(req.query.role || req.body?.role);
    if (!role) return res.status(400).json({ error: 'role query required (controller or player)' });

    const sessionId = req.query.session_id;
    const session = sessionId
      ? sessionStore.getSession(sessionId)
      : sessionStore.getActiveSessionForUser(req.user.id);

    if (!session) {
      return res.json({ session: null });
    }

    if (session.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Not your session',
        failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
      });
    }

    if (session.status === 'ended') {
      return res.status(410).json({
        error: 'Session already ended',
        session_id: session.id,
        failure_reason: session.failureReason || session.endReason,
      });
    }

    if (role === 'player' && (session.status === 'player_waiting' || session.status === 'created')) {
      sessionStore.registerPlayer(session.id, req.user.id, req.query.device_id || null);
    }

    logLiveAuth(req, role);
    sessionStore.resyncSignalingForPeer(req.user.id, role);

    const ice_servers = getIceServers();
    const iceSummary = summarizeIceServers(ice_servers);
    timeline.recordConfig(session.id, 'ice_config_returned', {
      endpoint: 'GET /api/live/session',
      ice_servers: iceSummary,
    });

    log('session_get', {
      session_id: session.id,
      user_id: req.user.id,
      role,
      device_id: req.query.device_id || null,
      status: session.status,
      has_offer: Boolean(session.offer),
      has_answer: Boolean(session.answer),
      ice_stats: sessionStore.getIceStats(session.id),
    });

    res.json({
      session: sessionStore.publicSession(session, role),
      ice_servers,
    });
  } catch (err) {
    logError('session_get_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/live/offer */
router.post('/offer', authMiddleware, (req, res) => {
  const start = Date.now();
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'controller') {
      logLiveAuthFail(req, 'controller', 'not_controller_role');
      return res.status(403).json({
        error: 'Only controller can send offer',
        failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
      });
    }

    const sessionId = req.body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const parsed = parseSdpPayload(req.body, 'offer');
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    const result = sessionStore.setOffer(sessionId, req.user.id, parsed.value);
    if (!result.ok) {
      log('offer_rejected', {
        session_id: sessionId,
        user_id: req.user.id,
        error: result.error,
        failure_reason: result.failureReason,
      });
      return res.status(result.status).json({
        error: result.error,
        failure_reason: result.failureReason || null,
      });
    }

    logLiveAuth(req, 'controller');

    log('offer_stored', {
      session_id: sessionId,
      user_id: req.user.id,
      sdp: summarizeSdp(parsed.value),
    });

    notifyPlayer(req.user.id, {
      type: 'live_offer',
      session_id: sessionId,
      offer: parsed.value,
    }, result.session);

    res.json({
      message: 'Offer stored and pushed via WebSocket',
      session_id: sessionId,
      status: result.session.status,
      timing_ms: Date.now() - start,
    });
  } catch (err) {
    logError('offer_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/live/answer */
router.post('/answer', authMiddleware, (req, res) => {
  const start = Date.now();
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'player') {
      logLiveAuthFail(req, 'player', 'not_player_role');
      return res.status(403).json({
        error: 'Only player can send answer',
        failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
      });
    }

    const sessionId = req.body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const parsed = parseSdpPayload(req.body, 'answer');
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    const result = sessionStore.setAnswer(
      sessionId,
      req.user.id,
      parsed.value,
      req.body.device_id || null
    );
    if (!result.ok) {
      log('answer_rejected', {
        session_id: sessionId,
        user_id: req.user.id,
        error: result.error,
        failure_reason: result.failureReason,
      });
      return res.status(result.status).json({
        error: result.error,
        failure_reason: result.failureReason || null,
      });
    }

    logLiveAuth(req, 'player');

    log('answer_stored', {
      session_id: sessionId,
      user_id: req.user.id,
      sdp: summarizeSdp(parsed.value),
    });

    notifyControllerPeer(req.user.id, {
      type: 'live_answer',
      session_id: sessionId,
      answer: parsed.value,
    }, result.session);

    res.json({
      message: 'Answer stored and pushed via WebSocket',
      session_id: sessionId,
      status: result.session.status,
      timing_ms: Date.now() - start,
    });
  } catch (err) {
    logError('answer_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/ice — Submit ICE candidate; immediately pushed to peer via WebSocket.
 * GET polling removed — use WebSocket live_ice with full candidate payload.
 */
router.post('/ice', authMiddleware, (req, res) => {
  try {
    const sessionId = req.body.session_id;
    const role = sessionStore.normalizeRole(req.body.role);
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    if (!role) return res.status(400).json({ error: 'role must be controller or player' });

    const candidate = req.body.candidate;
    if (!candidate) return res.status(400).json({ error: 'candidate required' });

    const normalizedCandidate = {
      candidate: typeof candidate === 'string' ? candidate : candidate.candidate,
      sdpMid: req.body.sdpMid ?? candidate.sdpMid ?? null,
      sdpMLineIndex: req.body.sdpMLineIndex ?? candidate.sdpMLineIndex ?? null,
    };

    const result = sessionStore.addIceCandidate(sessionId, req.user.id, role, normalizedCandidate);
    if (!result.ok) {
      log('ice_rejected', {
        session_id: sessionId,
        user_id: req.user.id,
        role,
        error: result.error,
        failure_reason: result.failureReason,
        candidate: summarizeIceCandidate(normalizedCandidate),
      });
      return res.status(result.status).json({
        error: result.error,
        failure_reason: result.failureReason || null,
      });
    }

    if (!result.duplicate) {
      pushIceToPeer(result.session, role, normalizedCandidate);
    } else {
      log('ice_duplicate_ignored', {
        session_id: sessionId,
        role,
        candidate: summarizeIceCandidate(normalizedCandidate),
      });
    }

    const stats = sessionStore.getIceStats(sessionId);
    res.json({
      message: result.duplicate ? 'Duplicate ICE ignored' : 'ICE candidate pushed via WebSocket',
      session_id: sessionId,
      status: result.session.status,
      duplicate: Boolean(result.duplicate),
      ice_candidate_counts: stats,
    });
  } catch (err) {
    logError('ice_post_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/live/ice — REMOVED: ICE delivered via WebSocket push */
router.get('/ice', authMiddleware, (req, res) => {
  log('ice_poll_rejected', {
    user_id: req.user.id,
    session_id: req.query.session_id,
    role: req.query.role,
  });
  res.status(410).json({
    error: 'ICE polling removed — candidates are pushed immediately via WebSocket { type: live_ice, candidate }',
    migration: 'Handle live_ice WebSocket messages and call addIceCandidate() directly',
  });
});

/** POST /api/live/event — Client connection diagnostics (ICE connected, TURN used, etc.) */
router.post('/event', authMiddleware, (req, res) => {
  try {
    const sessionId = req.body.session_id;
    const role = sessionStore.normalizeRole(req.body.role);
    const event = req.body.event;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    if (!role) return res.status(400).json({ error: 'role required' });
    if (!event) return res.status(400).json({ error: 'event required' });

    const result = sessionStore.recordClientEvent(
      sessionId,
      req.user.id,
      role,
      event,
      req.body.details || {}
    );
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        failure_reason: result.failureReason || null,
      });
    }

    res.json({
      message: 'Event recorded',
      session_id: sessionId,
      status: result.session.status,
      ended: Boolean(result.ended),
    });
  } catch (err) {
    logError('event_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/live/diagnostics/:session_id — Per-session diagnostic timeline */
router.get('/diagnostics/:session_id', authMiddleware, (req, res) => {
  const session = sessionStore.getSession(req.params.session_id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  if (session.userId !== req.user.id) {
    return res.status(403).json({
      error: 'Not your session',
      failure_reason: FAILURE_REASON.AUTHENTICATION_FAILED,
    });
  }
  res.json({
    diagnostics: sessionStore.publicDiagnostics(session),
    root_cause_hint: session.failureReason || session.endReason || 'in_progress',
  });
});

/** GET /api/live/monitoring — Production monitoring dashboard data */
router.get('/monitoring', authMiddleware, (req, res) => {
  res.json({ monitoring: getMonitoringDashboard() });
});

/** POST /api/live/end */
router.post('/end', authMiddleware, (req, res) => {
  try {
    const sessionId = req.body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const result = sessionStore.endSession(
      sessionId,
      req.user.id,
      req.body.reason || FAILURE_REASON.ENDED
    );
    if (!result.ok) {
      return res.status(result.status).json({
        error: result.error,
        failure_reason: result.failureReason || null,
      });
    }

    res.json({ message: 'Session ended', session_id: sessionId });
  } catch (err) {
    logError('end_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
