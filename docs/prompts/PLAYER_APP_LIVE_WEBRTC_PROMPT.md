# Prompt 2 — Player App (Kotlin/Android)
## Smart School Bell — Live Announcement WebRTC Upgrade

**Use this prompt in Cursor inside your Player / Device App repository.**

---

## Task

Upgrade Live Announcement to WebRTC (Player / Device App).

---

## Context

This is the **Player App** (Android device/speaker) for Smart School Bell System. Backend upgraded from WebSocket PCM relay to **WebRTC P2P** live announcement.

- **Backend:** `https://api.shikkhasomoy.com`
- **Auth:** JWT from login (`Authorization: Bearer <token>`)
- **Swagger:** `https://api.shikkhasomoy.com/api-docs` → Live tag

**IMPORTANT:** Live audio is received via WebRTC directly from Controller. Server only does signaling — no audio through REST or WebSocket.

---

## What to REMOVE (old system)

Find and remove:

- WebSocket binary PCM receive + play logic for live mic
- `AudioTrack` / buffer playback from WebSocket chunks for live announcement
- Old handler for `live_start` that expects binary audio stream from WS
- Any code that plays live audio from WebSocket binary messages

**Do NOT remove or break:**

- Bell schedule sync (`GET /api/schedules`)
- Azan sync (`GET /api/azan`)
- Sounds download (`GET /api/sounds/bell`, `/azan`)
- Recorded/scheduled announcements (`GET /api/announcements/*`)
- Device heartbeat (`POST /api/device/heartbeat`)
- WebSocket handler for `new_announcement` (scheduled push) — **KEEP**
- Login, foreground service, existing alarm logic

---

## What to ADD

### 1. Dependencies (build.gradle)

```gradle
implementation 'io.getstream:stream-webrtc-android:1.1.3'
// OR: org.webrtc:google-webrtc
```

**Permissions:**

- `INTERNET`
- `MODIFY_AUDIO_SETTINGS`
- `WAKE_LOCK` (if already used)

---

### 2. Retrofit API — LiveApiService.kt

| Method | Path | Body |
|--------|------|------|
| GET | `/api/live/config` | — |
| GET | `/api/live/session?role=player&session_id={id}` | — |
| POST | `/api/live/answer` | `{ "session_id", "role": "player", "answer": { "sdp", "type": "answer" }, "device_id" }` |
| POST | `/api/live/ice` | `{ "session_id", "role": "player", "candidate", "sdpMid", "sdpMLineIndex" }` |
| GET | `/api/live/ice?session_id={id}&role=player` | — |
| POST | `/api/live/end` | `{ "session_id" }` |

**Player does NOT call POST `/api/live/session`** (controller only).

---

### 3. WebSocket — notifications only (NO binary audio)

```
wss://api.shikkhasomoy.com/ws/announce?token={JWT}&role=user
```

(`role=player` also works)

**JSON messages:**

| type | Action |
|------|--------|
| `new_announcement` | **KEEP** — existing scheduled announcement logic |
| `live_session` | `{ session_id, ice_servers }` → prepare WebRTC receiver |
| `live_offer` | `{ session_id, offer: { sdp, type } }` → create answer, start P2P |
| `live_ice` | `{ session_id }` → poll GET `/api/live/ice?role=player` |
| `live_end` | `{ session_id, reason }` → teardown, hide live indicator |

**Do NOT expect binary audio on WebSocket.**

---

### 4. WebRTC Receiver — LiveWebRtcPlayer.kt

**Auto-receive flow (when `live_offer` received):**

1. Get `ice_servers` from `live_session` or GET `/api/live/config`
2. Create `PeerConnection` with ICE servers
3. `setRemoteDescription(offer)` from `live_offer`
4. `createAnswer()` → `POST /api/live/answer`
5. On local ICE candidate → `POST /api/live/ice`
6. On `live_ice` WS or poll → GET `/api/live/ice?role=player` → `addIceCandidate()`
7. On remote audio track → route to **speaker** (speakerphone ON)
8. Auto-play — no user tap needed

**Audio output:**

- Use WebRTC remote audio track (not manual PCM buffer)
- `AudioManager.requestAudioFocus()` before play
- Speaker volume max for school PA use

**On `live_end`:**

- Close PeerConnection
- Release audio focus
- Hide live indicator

**Auto reconnect:**

- If DISCONNECTED/FAILED → poll GET `/api/live/session?role=player` for 30s
- If new session → rejoin; else idle

---

### 5. Background Service

If app uses `AnnouncementService` / foreground service:

- Integrate `LiveWebRtcPlayer` into existing service
- Keep WebSocket alive in service
- WebRTC runs inside foreground service (Android 9+)
- Do not break bell/azan alarm scheduling

---

### 6. UI (minimal)

- Overlay or notification: "Live Announcement" when connected
- Status: Receiving / Connected / Reconnecting
- No user interaction needed (auto-play)

---

### 7. Flow Diagram

```
[Background] WebSocket connected role=user
  ↓
WS: live_session { session_id, ice_servers }
  ↓
WS: live_offer { session_id, offer }
  ↓
WebRTC: setRemoteDescription(offer) → createAnswer()
  ↓
POST /api/live/answer
  ↓
ICE exchange (POST + GET /api/live/ice)
  ↓
Remote audio track → Speaker (auto play)
  ↓
WS: live_end → teardown
```

---

## Rules

- Match existing project patterns (Retrofit, service, WS client)
- Reuse existing JWT + device_id from login/heartbeat
- Keep `new_announcement` WebSocket handler unchanged
- Bell, azan, recorded announcement must still work
- Test on real Android device with speaker

---

## Deliverables

1. `LiveApiService.kt`
2. `LiveWebRtcPlayer.kt` (WebRTC receiver)
3. Updated WebSocket message handler (JSON only for live)
4. Updated AnnouncementService (if exists)
5. Remove all old PCM WebSocket playback code

---

## First Step for Cursor

Search codebase for existing live/WebSocket/PCM/audio playback code and list files to change. Then implement step by step without breaking bell/azan/announcements.

---

*School Bell Backend v2.0 — WebRTC Signaling API*
