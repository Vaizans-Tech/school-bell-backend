const { log } = require('../../lib/liveLogger');

/** @type {Map<string, object[]>} */
const timelines = new Map();

/** @type {Map<string, object>} */
const iceStats = new Map();

/** @type {Map<number, object[]>} */
const wsEvents = new Map();

function emptyIceRoleStats() {
  return {
    received: 0,
    forwarded: 0,
    delivered: 0,
    queued: 0,
    duplicate: 0,
    dropped: 0,
    by_type: { host: 0, srflx: 0, relay: 0, unknown: 0 },
  };
}

function emptyIceStats() {
  return {
    controller: emptyIceRoleStats(),
    player: emptyIceRoleStats(),
    total_received: 0,
    total_forwarded: 0,
    total_delivered: 0,
    total_queued: 0,
    total_duplicate: 0,
    total_dropped: 0,
  };
}

function ensureSession(sessionId) {
  if (!timelines.has(sessionId)) timelines.set(sessionId, []);
  if (!iceStats.has(sessionId)) iceStats.set(sessionId, emptyIceStats());
}

function now() {
  return { ts: Date.now(), iso: new Date().toISOString() };
}

function append(sessionId, category, event, details = {}) {
  if (!sessionId) return;
  ensureSession(sessionId);
  const entry = { ...now(), category, event, ...details };
  timelines.get(sessionId).push(entry);
  log('timeline', { session_id: sessionId, category, event, ...details });
}

function appendWs(userId, event, details = {}) {
  if (!wsEvents.has(userId)) wsEvents.set(userId, []);
  const entry = { ...now(), event, ...details };
  wsEvents.get(userId).push(entry);
  log('ws_event', { user_id: userId, event, ...details });
}

function candidateTyp(candidate) {
  const text = typeof candidate === 'string' ? candidate : candidate?.candidate || '';
  return text.match(/ typ (\w+)/)?.[1] || 'unknown';
}

function recordIceReceived(sessionId, role, candidate, extra = {}) {
  ensureSession(sessionId);
  const stats = iceStats.get(sessionId);
  const bucket = role === 'controller' ? stats.controller : stats.player;
  bucket.received += 1;
  stats.total_received += 1;
  const typ = candidateTyp(candidate);
  bucket.by_type[typ] = (bucket.by_type[typ] || 0) + 1;

  append(sessionId, 'ice', 'candidate_received', {
    role,
    typ,
    count: bucket.received,
    total: stats.total_received,
    candidate_index: bucket.received,
    ...extra,
  });
}

function recordIceForwarded(sessionId, fromRole, toRole, candidate, sent, extra = {}) {
  ensureSession(sessionId);
  const stats = iceStats.get(sessionId);
  const bucket = fromRole === 'controller' ? stats.controller : stats.player;
  bucket.forwarded += 1;
  stats.total_forwarded += 1;

  const event = sent > 0 ? 'candidate_delivered' : 'candidate_queued';
  if (sent > 0) {
    bucket.delivered += 1;
    stats.total_delivered += 1;
  } else {
    bucket.queued += 1;
    stats.total_queued += 1;
  }

  append(sessionId, 'ice', event, {
    from_role: fromRole,
    to_role: toRole,
    sent,
    typ: candidateTyp(candidate),
    forwarded_count: bucket.forwarded,
    delivered_count: bucket.delivered,
    queued_count: bucket.queued,
    ...extra,
  });
}

function recordIceDuplicate(sessionId, role, candidate) {
  ensureSession(sessionId);
  const stats = iceStats.get(sessionId);
  const bucket = role === 'controller' ? stats.controller : stats.player;
  bucket.duplicate += 1;
  stats.total_duplicate += 1;
  append(sessionId, 'ice', 'candidate_duplicate', {
    role,
    typ: candidateTyp(candidate),
    duplicate_count: bucket.duplicate,
  });
}

function recordIceDropped(sessionId, fromRole, toRole, reason) {
  ensureSession(sessionId);
  const stats = iceStats.get(sessionId);
  const bucket = fromRole === 'controller' ? stats.controller : stats.player;
  bucket.dropped += 1;
  stats.total_dropped += 1;
  append(sessionId, 'ice', 'candidate_dropped', {
    from_role: fromRole,
    to_role: toRole,
    reason,
    dropped_count: bucket.dropped,
  });
}

function recordRace(sessionId, event, details = {}) {
  append(sessionId, 'race', event, details);
}

function recordTimeout(sessionId, event, details = {}) {
  append(sessionId, 'timeout', event, details);
}

function recordSignaling(sessionId, event, details = {}) {
  append(sessionId, 'signaling', event, details);
}

function recordSession(sessionId, event, details = {}) {
  append(sessionId, 'session', event, details);
}

function recordAuth(sessionId, event, details = {}) {
  append(sessionId, 'auth', event, details);
}

function recordConfig(sessionId, event, details = {}) {
  append(sessionId, 'config', event, details);
}

function getTimeline(sessionId) {
  return timelines.get(sessionId) || [];
}

function getIceStats(sessionId) {
  return iceStats.get(sessionId) || emptyIceStats();
}

function getWsEvents(userId) {
  return wsEvents.get(userId) || [];
}

function buildReport(session) {
  if (!session) return null;
  const timeline = getTimeline(session.id);
  const ice = getIceStats(session.id);
  const ws = getWsEvents(session.userId);

  const signaling = timeline.filter((e) => e.category === 'signaling');
  const iceEvents = timeline.filter((e) => e.category === 'ice');
  const timeouts = timeline.filter((e) => e.category === 'timeout');
  const races = timeline.filter((e) => e.category === 'race');
  const sessionEvents = timeline.filter((e) => e.category === 'session');
  const authEvents = timeline.filter((e) => e.category === 'auth');
  const configEvents = timeline.filter((e) => e.category === 'config');
  const wsTimeline = timeline.filter((e) => e.category === 'websocket');

  const offerTimeline = signaling.filter((e) => e.event.includes('offer'));
  const answerTimeline = signaling.filter((e) => e.event.includes('answer'));

  const durationMs = session.endedAt
    ? session.endedAt - session.createdAt
    : Date.now() - session.createdAt;

  let rootCause = session.failureReason || session.endReason || null;
  if (!rootCause && session.status !== 'ended') rootCause = 'in_progress';

  if (races.length) {
    rootCause = rootCause || `race_condition:${races[races.length - 1].event}`;
  }
  if (timeouts.length && !session.failureReason) {
    rootCause = timeouts[timeouts.length - 1].event;
  }
  if (ice.total_queued > 0 && ice.total_delivered < ice.total_received) {
    rootCause = rootCause || 'ice_candidates_queued_not_delivered';
  }

  return {
    session_id: session.id,
    user_id: session.userId,
    controller_device_id: session.controllerDeviceId,
    player_device_id: session.playerDeviceId,
    status: session.status,
    failure_reason: session.failureReason || session.endReason || null,
    root_cause_analysis: rootCause,
    session_duration_ms: durationMs,
    diagnostics: session.diagnostics,
    session_timeline: sessionEvents,
    auth_timeline: authEvents,
    config_timeline: configEvents,
    websocket_timeline: wsTimeline,
    signaling_timeline: signaling,
    sdp_offer_timeline: offerTimeline,
    sdp_answer_timeline: answerTimeline,
    ice_timeline: iceEvents,
    ice_candidate_counts: ice,
    timeout_events: timeouts,
    race_condition_events: races,
    websocket_events: ws,
    disconnect_reason: session.endReason || session.failureReason || null,
    pending_retries: session.pendingRetries?.length || 0,
  };
}

function purge(sessionId) {
  timelines.delete(sessionId);
  iceStats.delete(sessionId);
}

module.exports = {
  append,
  appendWs,
  recordIceReceived,
  recordIceForwarded,
  recordIceDuplicate,
  recordIceDropped,
  recordRace,
  recordTimeout,
  recordSignaling,
  recordSession,
  recordAuth,
  recordConfig,
  getTimeline,
  getIceStats,
  getWsEvents,
  buildReport,
  purge,
};
