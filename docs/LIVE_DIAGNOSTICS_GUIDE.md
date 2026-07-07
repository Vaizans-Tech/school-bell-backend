# Live WebRTC — Backend Diagnostics Guide

## Quick commands (production)

```bash
# All live logs with timestamps
pm2 logs | grep '\[live\]'

# Only failures
pm2 logs | grep '\[live\].*failed\|timeout\|offline\|dropped\|race'

# Get full session report after a failed test
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://api.shikkhasomoy.com/api/live/diagnostics/SESSION_ID" | python3 -m json.tool
```

## What gets logged

| Category | Key events |
|----------|------------|
| session | `session_created`, `player_ready`, `player_offline_at_start`, `session_closed`, `session_failed`, `session_expired` |
| auth | `controller_auth_success`, `player_auth_success`, `auth_failed`, `live_auth_failed` |
| signaling | `offer_created/received/delivered`, `answer_created/received/delivered`, `message_queued`, `reconnect_resync` |
| ice | `candidate_received`, `candidate_delivered`, `candidate_queued`, `candidate_duplicate`, `candidate_dropped` |
| timeout | `player_offline`, `offer_timeout`, `answer_timeout`, `ice_failed`, `connection_timeout` |
| race | `offer_before_player_ready`, `ice_before_remote_sdp`, `duplicate_session_replaced` |
| websocket | `controller/player_socket_connected/disconnected`, `message_sent` |
| config | `ice_config_returned` (TURN verified, never stripped) |

## Root cause mapping

| `root_cause_analysis` | Meaning | Fix |
|-----------------------|---------|-----|
| `player_offline` | Player WS not connected within 15s | Keep Player foreground service alive |
| `player_offline_at_start` | `live_session` WS notify sent=0 | Player app offline at session start |
| `offer_before_player_ready` | Controller sent offer too early | Wait for `player_ready: true` |
| `ice_candidates_queued_not_delivered` | ICE stuck in retry queue | Peer WS offline during ICE exchange |
| `answer_timeout` | No answer within 15s | Player didn't process `live_offer` |
| `ice_failed` | ICE not connected within 20s | Check TURN usage in app (relay candidates) |
| `connection_timeout` | Overall 30s limit | Full signaling chain too slow |

## ICE candidate audit

Check `ice_candidate_counts` in diagnostics:

```json
{
  "controller": { "received": 5, "delivered": 3, "queued": 2, "by_type": { "relay": 1 } },
  "player": { "received": 4, "delivered": 4, "by_type": { "relay": 0 } }
}
```

- `queued > 0` and `delivered < received` → candidates lost (peer offline)
- `by_type.relay = 0` on both sides → TURN not used by Android app
- `dropped > 0` → retry exhausted (5 attempts failed)

## Reproduce checklist

1. Start `pm2 logs | grep '\[live\]'`
2. Run live test until failure
3. Copy `session_id` from logs
4. Call `GET /api/live/diagnostics/:session_id`
5. Read `root_cause_analysis` + `ice_timeline` + `race_condition_events`
