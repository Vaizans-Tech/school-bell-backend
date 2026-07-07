const PREFIX = '[live]';

function log(event, details = {}) {
  const payload = Object.keys(details).length
    ? ` ${JSON.stringify({ ts: new Date().toISOString(), ...details })}`
    : ` ${JSON.stringify({ ts: new Date().toISOString() })}`;
  console.log(`${PREFIX} ${event}${payload}`);
}

function logError(event, err, details = {}) {
  const msg = err?.message || String(err);
  console.error(`${PREFIX} ${event}: ${msg}`, { ts: new Date().toISOString(), ...details });
}

function logTransition(sessionId, from, to, extra = {}) {
  log('state_transition', { session_id: sessionId, from, to, ...extra });
}

function logTiming(sessionId, stage, ms, extra = {}) {
  log('timing', { session_id: sessionId, stage, ms, ...extra });
}

function logAuth(role, success, details = {}) {
  log(success ? `${role}_auth_success` : `${role}_auth_failed`, details);
}

function summarizeIceServers(iceServers = []) {
  return {
    count: iceServers.length,
    urls: iceServers.map((s) => s.urls),
    has_turn: iceServers.some((s) => String(s.urls || '').startsWith('turn:')),
    turn_username: iceServers.find((s) => String(s.urls || '').startsWith('turn:'))?.username || null,
    turn_credential_set: iceServers.some(
      (s) => String(s.urls || '').startsWith('turn:') && Boolean(s.credential)
    ),
    turn_credential_length: iceServers.find((s) => String(s.urls || '').startsWith('turn:'))
      ?.credential?.length || 0,
  };
}

function summarizeSdp(sdp) {
  if (!sdp || typeof sdp !== 'object') return null;
  const text = String(sdp.sdp || '');
  return {
    type: sdp.type || null,
    sdp_length: text.length,
    embedded_candidates: (text.match(/^a=candidate:/gm) || []).length,
    preview: text.slice(0, 100).replace(/\r?\n/g, '\\n'),
  };
}

function summarizeIceCandidate(candidate) {
  if (!candidate) return null;
  const text = typeof candidate === 'string' ? candidate : candidate.candidate;
  if (!text) return null;
  const typ = text.match(/ typ (\w+)/)?.[1] || 'unknown';
  return {
    typ,
    is_relay: typ === 'relay',
    is_srflx: typ === 'srflx',
    is_host: typ === 'host',
    sdpMid: candidate.sdpMid ?? null,
    sdpMLineIndex: candidate.sdpMLineIndex ?? null,
    preview: String(text).slice(0, 120),
  };
}

function candidateKey(candidate) {
  const text = typeof candidate === 'string' ? candidate : candidate.candidate;
  const mid = candidate.sdpMid ?? '';
  const idx = candidate.sdpMLineIndex ?? '';
  return `${text}|${mid}|${idx}`;
}

module.exports = {
  log,
  logError,
  logTransition,
  logTiming,
  logAuth,
  summarizeIceServers,
  summarizeSdp,
  summarizeIceCandidate,
  candidateKey,
};
