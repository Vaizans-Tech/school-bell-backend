# Prompt 1 — Controller App (Kotlin/Android)
## Smart School Bell — Live Announcement WebRTC Upgrade

**Use this prompt in Cursor inside your Controller App repository.**

---

## Task

Upgrade Live Announcement to WebRTC (Controller / Sender App).

---

## Context

This is the **Controller App** for Smart School Bell System. The backend has been upgraded from WebSocket PCM audio relay to **WebRTC peer-to-peer** live announcement.

- **Backend base URL:** `https://api.shikkhasomoy.com` (or local dev URL)
- **Auth:** existing JWT `Authorization: Bearer <token>` from login
- **Swagger:** `https://api.shikkhasomoy.com/api-docs` → Live tag

**IMPORTANT:** Live audio must NOT go through the server. Backend only does **signaling**. Audio goes directly Controller → Player via WebRTC P2P.

---

## What to REMOVE (old system)

Find and remove all old live announcement code that:

- Connects WebSocket `ws://.../ws/announce?role=controller` to send **binary PCM/audio chunks**
- Sends mic audio bytes over WebSocket
- Uses binary message relay for live mic

**Do NOT remove or break:**

- Bell schedules CRUD
- Azan times CRUD
- Recorded/scheduled announcements (REST `/api/announcements/*`)
- Login/auth
- Any other existing features

---

## What to ADD

### 1. Dependencies (build.gradle)

```gradle
implementation 'io.getstream:stream-webrtc-android:1.1.3'
// OR: org.webrtc:google-webrtc (stable version for your minSdk)
```

**Permissions (AndroidManifest):**

- `RECORD_AUDIO`
- `INTERNET`
- `ACCESS_NETWORK_STATE`
- `MODIFY_AUDIO_SETTINGS` (optional)

---

### 2. Retrofit API — LiveApiService.kt

| Method | Path | Body |
|--------|------|------|
| GET | `/api/live/config` | — |
| POST | `/api/live/session` | `{ "role": "controller", "device_id": "..." }` |
| GET | `/api/live/session?role=controller&session_id={id}` | — |
| POST | `/api/live/offer` | `{ "session_id", "role": "controller", "offer": { "sdp", "type": "offer" } }` |
| POST | `/api/live/ice` | `{ "session_id", "role": "controller", "candidate", "sdpMid", "sdpMLineIndex" }` |
| GET | `/api/live/ice?session_id={id}&role=controller` | — |
| POST | `/api/live/end` | `{ "session_id", "reason": "ended" }` |

**POST /api/live/session response:**

```json
{
  "session_id": "uuid",
  "status": "waiting_player",
  "ice_servers": [{ "urls": "stun:stun.l.google.com:19302" }]
}
```

---

### 3. WebSocket — signaling notifications ONLY (no audio)

Connect on login (keep alive):

```
wss://api.shikkhasomoy.com/ws/announce?token={JWT}&role=controller
```

**Listen for JSON:**

| type | Action |
|------|--------|
| `live_answer` | `{ session_id, answer: { sdp, type } }` → setRemoteDescription |
| `live_ice` | `{ session_id }` → poll GET `/api/live/ice?role=controller` |
| `live_end` | `{ session_id, reason }` → teardown WebRTC, update UI |

**Do NOT send binary audio over WebSocket.**

---

### 4. WebRTC Manager — LiveWebRtcController.kt

**On Start Live:**

1. `POST /api/live/session` → get `session_id` + `ice_servers`
2. Create `PeerConnectionFactory` with Opus, echo cancellation, noise suppression, AGC ON
3. Create `PeerConnection` with ICE servers
4. Create `AudioSource` + `LocalAudioTrack` from mic
5. Add local audio track to PeerConnection
6. `createOffer()` → `POST /api/live/offer`
7. On ICE candidate → `POST /api/live/ice`
8. On WS `live_answer` or poll GET `/api/live/session` → `setRemoteDescription(answer)`
9. Poll GET `/api/live/ice` for player candidates → `addIceCandidate()`

**On Stop Live:**

1. Stop local audio track
2. Close PeerConnection
3. `POST /api/live/end`
4. Reset UI

**Mute:** `localAudioTrack.setEnabled(false/true)`

**Connection states:** Connecting / Live / Disconnected / Failed

**Auto reconnect:** on failure, end session and allow restart (max 3 retries with backoff)

---

### 5. UI — Live Announcement Screen

- **Start Live** → runs WebRTC flow
- **Stop Live** → teardown
- **Mute / Unmute**
- Status: "Waiting for player" / "Connecting..." / "Live" / "Disconnected"
- Error toast: 401, 403, 410, ICE failed, no player online

---

### 6. Flow Diagram

```
User taps Start Live
  → POST /api/live/session
  → WebRTC createOffer
  → POST /api/live/offer
  → [Player creates answer]
  → WS live_answer OR poll GET /api/live/session
  → setRemoteDescription(answer)
  → ICE exchange (POST + GET /api/live/ice)
  → PeerConnection CONNECTED → mic audio P2P to Player

User taps Stop Live
  → POST /api/live/end
  → close PeerConnection
```

---

## Rules

- Match existing project code style, package names, Retrofit patterns
- Reuse existing JWT token storage
- Do not change unrelated features
- Handle Android 12+ foreground service if mic runs in background
- Test on real device (emulator WebRTC may be limited)

---

## Deliverables

1. `LiveApiService.kt` (Retrofit interface)
2. `LiveWebRtcController.kt` (WebRTC sender logic)
3. Updated Live Announcement UI screen
4. Updated WebSocket handler (controller = JSON only, no PCM)
5. Remove all old PCM-over-WebSocket live code

---

## First Step for Cursor

Search the codebase for existing live announcement / WebSocket / PCM / mic streaming code and show which files will change. Then implement step by step.

---

*School Bell Backend v2.0 — WebRTC Signaling API*
