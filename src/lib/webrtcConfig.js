/** STUN/TURN ICE servers for WebRTC clients (signaling only — no media through backend). */
function parseStunServers(raw) {
  const fallback = [
    'stun:stun.l.google.com:19302',
    'stun:stun1.l.google.com:19302',
    'stun:stun.cloudflare.com:3478',
  ];
  if (!raw || !String(raw).trim()) {
    return fallback.map((url) => ({ urls: url }));
  }
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ urls: url }));
}

function getIceServers() {
  const servers = parseStunServers(process.env.STUN_SERVERS);

  const turnUrl = process.env.TURN_URL?.trim();
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_PASSWORD || '',
    });
  }

  return servers;
}

module.exports = { getIceServers };
