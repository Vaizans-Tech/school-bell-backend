/** Live WebRTC session states (production state machine). */
const SESSION_STATUS = {
  CREATED: 'created',
  PLAYER_WAITING: 'player_waiting',
  PLAYER_READY: 'player_ready',
  OFFER_SENT: 'offer_sent',
  ANSWER_RECEIVED: 'answer_received',
  ICE_CHECKING: 'ice_checking',
  CONNECTED: 'connected',
  STREAMING: 'streaming',
  ENDED: 'ended',
};

/** Specific failure reasons — no generic "connection failed". */
const FAILURE_REASON = {
  AUTHENTICATION_FAILED: 'authentication_failed',
  PLAYER_OFFLINE: 'player_offline',
  OFFER_TIMEOUT: 'offer_timeout',
  ANSWER_TIMEOUT: 'answer_timeout',
  ICE_FAILED: 'ice_failed',
  TURN_FAILED: 'turn_failed',
  STUN_FAILED: 'stun_failed',
  PEER_CLOSED: 'peer_closed',
  SIGNALING_LOST: 'signaling_lost',
  NETWORK_CHANGED: 'network_changed',
  CONNECTION_TIMEOUT: 'connection_timeout',
  REPLACED: 'replaced',
  ENDED: 'ended',
};

const OFFER_TIMEOUT_MS = parseInt(process.env.LIVE_OFFER_TIMEOUT_MS || '15000', 10);
const ANSWER_TIMEOUT_MS = parseInt(process.env.LIVE_ANSWER_TIMEOUT_MS || '15000', 10);
const ICE_TIMEOUT_MS = parseInt(process.env.LIVE_ICE_TIMEOUT_MS || '20000', 10);
const CONNECTION_TIMEOUT_MS = parseInt(process.env.LIVE_CONNECTION_TIMEOUT_MS || '30000', 10);
const SESSION_MAX_MS = parseInt(process.env.LIVE_SESSION_MAX_MS || '7200000', 10);
const ENDED_RETENTION_MS = parseInt(process.env.LIVE_ENDED_RETENTION_MS || '600000', 10);
const ICE_RETRY_INTERVAL_MS = parseInt(process.env.LIVE_ICE_RETRY_MS || '2000', 10);
const ICE_RETRY_MAX = parseInt(process.env.LIVE_ICE_RETRY_MAX || '5', 10);
const CLEANUP_INTERVAL_MS = parseInt(process.env.LIVE_CLEANUP_INTERVAL_MS || '5000', 10);

const CLIENT_EVENTS = new Set([
  'ice_connected',
  'ice_failed',
  'peer_connected',
  'peer_closed',
  'turn_used',
  'stun_used',
  'relay_used',
  'network_changed',
]);

module.exports = {
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
};
