const router = require('express').Router();
const { authMiddleware } = require('../middleware/auth');
const { getIceServers } = require('../lib/webrtcConfig');
const { log, logError } = require('../lib/liveLogger');
const { notifyUserReceivers, notifyController } = require('../ws/announcements');
const sessionStore = require('../services/live/sessionStore');

sessionStore.setOnSessionEnded((session) => {
  const payload = {
    type: 'live_end',
    session_id: session.id,
    reason: session.endReason || 'ended',
  };
  notifyUserReceivers(session.userId, payload);
  notifyController(session.userId, payload);
});

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

function notifyPlayer(userId, message) {
  const sent = notifyUserReceivers(userId, message);
  log('player_notified', { user_id: userId, sent, type: message.type });
  return sent;
}

/** ICE/STUN/TURN config for WebRTC clients */
router.get('/config', authMiddleware, (req, res) => {
  res.json({ ice_servers: getIceServers() });
});

/**
 * POST /api/live/session — Controller starts a live WebRTC session.
 * Body: { role: "controller", device_id? }
 */
router.post('/session', authMiddleware, (req, res) => {
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'controller') {
      return res.status(403).json({ error: 'Only controller can create a live session' });
    }

    const session = sessionStore.createSession(req.user.id, req.body.device_id || null);
    const ice_servers = getIceServers();

    notifyPlayer(req.user.id, {
      type: 'live_session',
      session_id: session.id,
      ice_servers,
    });

    res.status(201).json({
      session_id: session.id,
      status: session.status,
      ice_servers,
      message: 'Live session created — waiting for player',
    });
  } catch (err) {
    logError('session_create_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/live/session — Session state (controller polls answer, player polls offer).
 * Query: session_id?, role=controller|player
 */
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
      return res.status(403).json({ error: 'Not your session' });
    }

    if (session.status === 'ended') {
      return res.status(410).json({ error: 'Session already ended', session_id: session.id });
    }

    if (role === 'player' && session.status === 'waiting_player') {
      sessionStore.registerPlayer(session.id, req.user.id, req.query.device_id || null);
    }

    res.json({
      session: sessionStore.publicSession(session, role),
      ice_servers: getIceServers(),
    });
  } catch (err) {
    logError('session_get_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/offer — Controller sends SDP offer (no media through API).
 */
router.post('/offer', authMiddleware, (req, res) => {
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'controller') {
      return res.status(403).json({ error: 'Only controller can send offer' });
    }

    const sessionId = req.body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const parsed = parseSdpPayload(req.body, 'offer');
    if (parsed.error) return res.status(parsed.status).json({ error: parsed.error });

    const result = sessionStore.setOffer(sessionId, req.user.id, parsed.value);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    notifyPlayer(req.user.id, {
      type: 'live_offer',
      session_id: sessionId,
      offer: parsed.value,
    });

    res.json({ message: 'Offer stored', session_id: sessionId, status: result.session.status });
  } catch (err) {
    logError('offer_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/answer — Player sends SDP answer.
 */
router.post('/answer', authMiddleware, (req, res) => {
  try {
    const role = sessionStore.normalizeRole(req.body.role);
    if (role !== 'player') {
      return res.status(403).json({ error: 'Only player can send answer' });
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
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    notifyController(req.user.id, {
      type: 'live_answer',
      session_id: sessionId,
      answer: parsed.value,
    });

    res.json({
      message: 'Answer stored — controller notified via WebSocket or poll GET /api/live/session',
      session_id: sessionId,
      status: result.session.status,
    });
  } catch (err) {
    logError('answer_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/ice — Exchange ICE candidates (peer polls via GET /api/live/ice).
 */
router.post('/ice', authMiddleware, (req, res) => {
  try {
    const sessionId = req.body.session_id;
    const role = sessionStore.normalizeRole(req.body.role);
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    if (!role) return res.status(400).json({ error: 'role must be controller or player' });

    const candidate = req.body.candidate;
    if (!candidate) return res.status(400).json({ error: 'candidate required' });

    const result = sessionStore.addIceCandidate(sessionId, req.user.id, role, {
      candidate: typeof candidate === 'string' ? candidate : candidate.candidate,
      sdpMid: req.body.sdpMid ?? candidate.sdpMid ?? null,
      sdpMLineIndex: req.body.sdpMLineIndex ?? candidate.sdpMLineIndex ?? null,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    if (role === 'player') {
      notifyController(req.user.id, { type: 'live_ice', session_id: sessionId });
    } else {
      notifyPlayer(req.user.id, { type: 'live_ice', session_id: sessionId });
    }

    res.json({ message: 'ICE candidate queued', session_id: sessionId });
  } catch (err) {
    logError('ice_post_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/live/ice — Poll ICE candidates from the peer.
 */
router.get('/ice', authMiddleware, (req, res) => {
  try {
    const sessionId = req.query.session_id;
    const role = sessionStore.normalizeRole(req.query.role);
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });
    if (!role) return res.status(400).json({ error: 'role query required' });

    const result = sessionStore.drainIceCandidates(sessionId, req.user.id, role);
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    res.json({ session_id: sessionId, candidates: result.candidates });
  } catch (err) {
    logError('ice_get_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/live/end — End live session (controller or player).
 */
router.post('/end', authMiddleware, (req, res) => {
  try {
    const sessionId = req.body.session_id;
    if (!sessionId) return res.status(400).json({ error: 'session_id required' });

    const result = sessionStore.endSession(sessionId, req.user.id, req.body.reason || 'ended');
    if (!result.ok) return res.status(result.status).json({ error: result.error });

    res.json({ message: 'Session ended', session_id: sessionId });
  } catch (err) {
    logError('end_failed', err, { user_id: req.user.id });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
