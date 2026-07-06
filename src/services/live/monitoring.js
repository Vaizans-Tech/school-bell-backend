const { FAILURE_REASON } = require('../../lib/liveConstants');

const stats = {
  total_sessions: 0,
  successful_calls: 0,
  failed_calls: 0,
  active_sessions: 0,
  connection_times_ms: [],
  ice_times_ms: [],
  session_durations_ms: [],
  turn_usage_count: 0,
  stun_usage_count: 0,
  relay_usage_count: 0,
  failure_reasons: {},
};

const MAX_SAMPLES = 500;

function pushSample(arr, value) {
  arr.push(value);
  if (arr.length > MAX_SAMPLES) arr.shift();
}

function avg(arr) {
  if (!arr.length) return 0;
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length);
}

function pct(count, total) {
  if (!total) return 0;
  return Math.round((count / total) * 1000) / 10;
}

function recordSessionCreated() {
  stats.total_sessions += 1;
  stats.active_sessions += 1;
}

function recordFailureReason(reason) {
  const key = reason || FAILURE_REASON.CONNECTION_TIMEOUT;
  stats.failure_reasons[key] = (stats.failure_reasons[key] || 0) + 1;
}

function recordClientEvent(event) {
  if (event === 'turn_used') stats.turn_usage_count += 1;
  if (event === 'stun_used') stats.stun_usage_count += 1;
  if (event === 'relay_used') stats.relay_usage_count += 1;
}

function recordSessionEnded(session) {
  if (stats.active_sessions > 0) stats.active_sessions -= 1;

  const diag = session.diagnostics || {};
  const failed = session.status === 'ended' && session.endReason !== FAILURE_REASON.ENDED
    && session.endReason !== FAILURE_REASON.REPLACED;

  if (failed) {
    stats.failed_calls += 1;
    recordFailureReason(session.endReason || session.failureReason);
  } else if (diag.peer_connected_at || session.status === 'streaming' || session.status === 'connected') {
    stats.successful_calls += 1;
  }

  if (diag.session_created_at && diag.peer_connected_at) {
    pushSample(stats.connection_times_ms, diag.peer_connected_at - diag.session_created_at);
  }
  if (diag.ice_start_at && diag.ice_connected_at) {
    pushSample(stats.ice_times_ms, diag.ice_connected_at - diag.ice_start_at);
  }
  if (diag.peer_connected_at && session.endedAt) {
    pushSample(stats.session_durations_ms, session.endedAt - diag.peer_connected_at);
  }
}

function getMonitoringDashboard() {
  const completed = stats.successful_calls + stats.failed_calls;
  return {
    successful_calls: stats.successful_calls,
    failed_calls: stats.failed_calls,
    total_sessions: stats.total_sessions,
    active_sessions: stats.active_sessions,
    average_connection_time_ms: avg(stats.connection_times_ms),
    average_ice_time_ms: avg(stats.ice_times_ms),
    average_session_duration_ms: avg(stats.session_durations_ms),
    connection_success_rate_pct: pct(stats.successful_calls, completed),
    turn_usage_pct: pct(stats.turn_usage_count, stats.total_sessions),
    stun_usage_pct: pct(stats.stun_usage_count, stats.total_sessions),
    relay_usage_pct: pct(stats.relay_usage_count, stats.total_sessions),
    average_failure_rate_pct: pct(stats.failed_calls, completed),
    failure_reasons: { ...stats.failure_reasons },
    samples: {
      connection_times: stats.connection_times_ms.length,
      ice_times: stats.ice_times_ms.length,
    },
  };
}

module.exports = {
  recordSessionCreated,
  recordSessionEnded,
  recordClientEvent,
  recordFailureReason,
  getMonitoringDashboard,
};
