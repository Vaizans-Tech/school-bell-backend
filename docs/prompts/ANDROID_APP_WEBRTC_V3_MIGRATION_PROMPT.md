# Android App — WebRTC v3 Migration Prompt
## Smart School Bell — Controller + Player App Update

**Backend v3.0 deployed.** Copy the **"CURSOR PROMPT"** section below into Cursor inside your **Controller** or **Player** Android repository.

---

# ═══════════════════════════════════════════════════════════════
# CURSOR PROMPT — COPY FROM HERE ↓
# ═══════════════════════════════════════════════════════════════

```
Upgrade this Android app's Live Announcement WebRTC implementation to match
the production backend v3.0 signaling API.

═══════════════════════════════════════════════════════════════
CONTEXT — READ FIRST
═══════════════════════════════════════════════════════════════

Backend base URL: https://api.shikkhasomoy.com
Auth: JWT Bearer token (existing login flow)
Swagger: https://api.shikkhasomoy.com/api-docs → Live tag

Architecture (UNCHANGED):
  Controller ←→ WebRTC P2P Audio ←→ Player
  Backend = signaling ONLY (no media relay)

Backend v3.0 CHANGES (you MUST adapt to these):
  1. GET /api/live/ice REMOVED — returns 410 Gone
  2. ICE candidates pushed IMMEDIATELY via WebSocket (full payload)
  3. New POST /api/live/event for diagnostics
  4. Stricter session state machine + 15–30s timeouts
  5. Offer rejected (409) if player not ready yet
  6. Specific failure_reason codes (no generic "connection failed")
  7. WS reconnect triggers automatic signaling resync

TURN server (verified working on production):
  turn:194.233.86.3:3478
  username: schoolbell
  credential: StrongPassword123

═══════════════════════════════════════════════════════════════
STEP 0 — DETECT WHICH APP THIS IS
═══════════════════════════════════════════════════════════════

Search the codebase and determine:
  - Controller App (sends mic, starts live session) → implement LiveWebRtcController
  - Player App (receives audio on speaker) → implement LiveWebRtcPlayer

Apply the correct flow section below. Shared code (API, DTOs, ICE helpers)
should be identical in both apps.

═══════════════════════════════════════════════════════════════
STEP 1 — CODEBASE AUDIT (do this first)
═══════════════════════════════════════════════════════════════

Search entire project for:
  PeerConnection, WebRtc, IceCandidate, ice_servers, stun.l.google.com,
  live_session, live_offer, live_answer, live_ice, live_end,
  /api/live/ice, getIceCandidates, pollIce, binary audio WebSocket

List every file involved. Then fix ALL issues in this prompt.
Do NOT modify unrelated features: bell schedules, azan, recorded/instant
announcements, login/auth, dashboard, device heartbeat.

REMOVE completely:
  - Any GET /api/live/ice polling loops (Timer, coroutine poll, etc.)
  - Any old WebSocket binary PCM/mic audio relay for live announcement
  - Any hardcoded STUN-only IceServer lists

═══════════════════════════════════════════════════════════════
STEP 2 — RETROFIT API (LiveApiService.kt)
═══════════════════════════════════════════════════════════════

Create or update LiveApiService with ALL endpoints:

| Method | Path | Who |
|--------|------|-----|
| GET    | /api/live/config | Both |
| POST   | /api/live/session | Controller |
| GET    | /api/live/session | Both |
| POST   | /api/live/offer | Controller |
| POST   | /api/live/answer | Player |
| POST   | /api/live/ice | Both |
| POST   | /api/live/event | Both |
| POST   | /api/live/end | Both |
| GET    | /api/live/diagnostics/{session_id} | Both (debug) |

DO NOT add GET /api/live/ice — it is removed.

All requests: Authorization: Bearer <token>

═══════════════════════════════════════════════════════════════
STEP 3 — GSON DTOs (CRITICAL — wrong field = TURN auth fails)
═══════════════════════════════════════════════════════════════

```kotlin
data class IceServerDto(
    @SerializedName("urls") val urls: String,
    @SerializedName("username") val username: String? = null,
    @SerializedName("credential") val credential: String? = null  // NOT "password"!
)

data class LiveSessionCreateResponse(
    @SerializedName("session_id") val sessionId: String,
    @SerializedName("status") val status: String,
    @SerializedName("ice_servers") val iceServers: List<IceServerDto>,
    @SerializedName("timing_ms") val timingMs: Long? = null
)

data class LiveConfigResponse(
    @SerializedName("ice_servers") val iceServers: List<IceServerDto>
)

data class SdpDto(
    @SerializedName("sdp") val sdp: String,
    @SerializedName("type") val type: String
)

data class LiveSessionState(
    @SerializedName("session_id") val sessionId: String,
    @SerializedName("status") val status: String,
    @SerializedName("offer") val offer: SdpDto? = null,
    @SerializedName("answer") val answer: SdpDto? = null,
    @SerializedName("player_ready") val playerReady: Boolean? = null,
    @SerializedName("failure_reason") val failureReason: String? = null,
    @SerializedName("created_at") val createdAt: Long? = null,
    @SerializedName("connected_at") val connectedAt: Long? = null
)

data class LiveSessionPollResponse(
    @SerializedName("session") val session: LiveSessionState?,
    @SerializedName("ice_servers") val iceServers: List<IceServerDto>
)

data class IceCandidateDto(
    @SerializedName("candidate") val candidate: String,
    @SerializedName("sdpMid") val sdpMid: String? = null,
    @SerializedName("sdpMLineIndex") val sdpMLineIndex: Int? = null
)

data class LiveEventRequest(
    @SerializedName("session_id") val sessionId: String,
    @SerializedName("role") val role: String,
    @SerializedName("event") val event: String,
    @SerializedName("details") val details: Map<String, Any>? = null
)

data class ApiErrorResponse(
    @SerializedName("error") val error: String?,
    @SerializedName("failure_reason") val failureReason: String?
)
```

═══════════════════════════════════════════════════════════════
STEP 4 — ICE SERVERS → PeerConnection (NEVER hardcode STUN)
═══════════════════════════════════════════════════════════════

```kotlin
object LiveIceServerFactory {

    fun fromApi(servers: List<IceServerDto>): List<PeerConnection.IceServer> {
        require(servers.isNotEmpty()) { "ice_servers empty — fetch from API first" }
        Log.d(TAG, "ice_servers count=${servers.size}: $servers")

        val hasTurn = servers.any { it.urls.startsWith("turn:") }
        check(hasTurn) { "TURN missing in ice_servers — live will fail on mobile networks" }

        return servers.map { s ->
            val builder = PeerConnection.IceServer.builder(s.urls)
            s.username?.takeIf { it.isNotEmpty() }?.let { builder.setUsername(it) }
            s.credential?.takeIf { it.isNotEmpty() }?.let { builder.setPassword(it) }
            builder.createIceServer()
        }
    }

    private const val TAG = "LiveWebRTC"
}
```

Where to get ice_servers:
  | App | Primary source | Fallback |
  |-----|----------------|----------|
  | Controller | POST /api/live/session response | GET /api/live/config |
  | Player | WS live_session event (STORE IT!) | GET /api/live/config |

NEVER create PeerConnection before ice_servers is available.

═══════════════════════════════════════════════════════════════
STEP 5 — WEBSOCKET (signaling notifications ONLY)
═══════════════════════════════════════════════════════════════

Connection URLs:
  Controller: wss://api.shikkhasomoy.com/ws/announce?token={JWT}&role=controller
  Player:     wss://api.shikkhasomoy.com/ws/announce?token={JWT}&role=user

Keep WebSocket alive (foreground service on Player especially).
Reconnect automatically on disconnect — backend resyncs pending signaling on reconnect.

Handle these JSON message types:

┌─────────────────┬──────────┬──────────────────────────────────────────────┐
│ type            │ Receiver │ Payload + Action                             │
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ live_session    │ Player   │ { session_id, ice_servers }                  │
│                 │          │ → store sessionId + iceServers               │
│                 │          │ → call GET /session?role=player to register  │
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ live_offer      │ Player   │ { session_id, offer: { sdp, type } }         │
│                 │          │ → handleOffer() — see Player flow            │
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ live_answer     │ Controller│ { session_id, answer: { sdp, type } }       │
│                 │          │ → setRemoteDescription(answer)               │
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ live_ice        │ Both     │ { session_id, from_role, candidate: {...} }  │
│                 │          │ → addRemoteIceCandidate() IMMEDIATELY        │
│                 │          │ *** NO MORE POLLING — full candidate in WS ***│
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ live_end        │ Both     │ { session_id, reason, failure_reason }       │
│                 │          │ → teardown PeerConnection, update UI         │
├─────────────────┼──────────┼──────────────────────────────────────────────┤
│ new_announcement│ Player   │ (existing scheduled announcement — keep)     │
└─────────────────┴──────────┴──────────────────────────────────────────────┘

WebSocket live_ice example (NEW v3 format):
```json
{
  "type": "live_ice",
  "session_id": "uuid",
  "from_role": "controller",
  "candidate": {
    "candidate": "candidate:842163049 1 udp 2122260223 192.168.1.5 54321 typ host",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

═══════════════════════════════════════════════════════════════
STEP 6 — ICE CANDIDATE HANDLING (v3 — NO POLLING)
═══════════════════════════════════════════════════════════════

### 6A. Send local candidates (both apps)

On PeerConnection.Observer.onIceCandidate:
```kotlin
override fun onIceCandidate(candidate: IceCandidate) {
    Log.d(TAG, "ICE local: ${candidate.sdpMid} ${candidate.sdp.take(80)}")
    val typ = when {
        candidate.sdp.contains("typ relay") -> "relay"
        candidate.sdp.contains("typ srflx") -> "srflx"
        else -> "host"
    }
    Log.d(TAG, "ICE local type=$typ")

    // Report TURN/STUN/relay usage to backend
    when (typ) {
        "relay" -> reportEvent("relay_used", mapOf("candidate" to candidate.sdp.take(120)))
        "srflx" -> reportEvent("stun_used", mapOf("candidate" to candidate.sdp.take(120)))
    }

    api.postIce(IcePostRequest(
        sessionId = sessionId,
        role = myRole,  // "controller" or "player"
        candidate = candidate.sdp,
        sdpMid = candidate.sdpMid,
        sdpMLineIndex = candidate.sdpMLineIndex
    ))
    Log.d(TAG, "ICE POST sent")
}
```

### 6B. Receive remote candidates (both apps) — WebSocket ONLY

```kotlin
// In WebSocket handler:
"live_ice" -> {
    val sessionId = json.getString("session_id")
    val fromRole = json.getString("from_role")
    val c = json.getJSONObject("candidate")
    val iceCandidate = IceCandidate(
        c.optString("sdpMid", null),
        c.optInt("sdpMLineIndex", 0),
        c.getString("candidate")
    )
    Log.d(TAG, "ICE WS received from $fromRole: ${iceCandidate.sdp.take(80)}")
    addRemoteIceCandidate(iceCandidate)  // queue if remote SDP not set yet
}
```

### 6C. Candidate queue (race condition fix)

```kotlin
private val pendingRemoteCandidates = mutableListOf<IceCandidate>()
private var remoteDescriptionSet = false

fun addRemoteIceCandidate(candidate: IceCandidate) {
    if (!remoteDescriptionSet || peerConnection == null) {
        Log.d(TAG, "ICE queued (remote SDP not ready)")
        pendingRemoteCandidates.add(candidate)
        return
    }
    peerConnection?.addIceCandidate(candidate)
    Log.d(TAG, "ICE addIceCandidate OK")
}

private fun flushPendingCandidates() {
    Log.d(TAG, "ICE flushing ${pendingRemoteCandidates.size} queued candidates")
    pendingRemoteCandidates.forEach { peerConnection?.addIceCandidate(it) }
    pendingRemoteCandidates.clear()
}

// Call flushPendingCandidates() after setRemoteDescription succeeds
```

### 6D. DELETE all old polling code

Remove ANY of these patterns:
```kotlin
// ❌ DELETE — backend returns 410
api.getIceCandidates(sessionId, role)
while (true) { pollIce(); delay(500) }
Timer().scheduleAtFixedRate { fetchPeerCandidates() }
```

═══════════════════════════════════════════════════════════════
STEP 7 — PEERCONNECTION CONFIG
═══════════════════════════════════════════════════════════════

```kotlin
val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
    sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
    continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
    iceTransportsType = PeerConnection.IceTransportsType.ALL
    bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
    rtcpMuxPolicy = PeerConnection.RtcpMuxPolicy.REQUIRE
}
```

Permissions (AndroidManifest):
  RECORD_AUDIO, INTERNET, ACCESS_NETWORK_STATE, MODIFY_AUDIO_SETTINGS

Audio: Opus codec, echo cancellation, noise suppression, AGC enabled.

═══════════════════════════════════════════════════════════════
STEP 8 — CONTROLLER APP FLOW (LiveWebRtcController.kt)
═══════════════════════════════════════════════════════════════

```
User taps "Start Live"
    │
    ▼
1. POST /api/live/session  { role: "controller", device_id }
   → session_id + ice_servers
   → Log ice_servers (must include turn:194.233.86.3:3478)
    │
    ▼
2. Connect WS (role=controller) if not already connected
    │
    ▼
3. WAIT for player ready (IMPORTANT — offer rejected otherwise):
   Poll GET /api/live/session?role=controller&session_id={id}
   every 500ms for max 15s until session.player_ready == true
   OR session.status == "player_ready"
   If timeout → show "Player offline" (failure_reason: player_offline)
    │
    ▼
4. Create PeerConnection(ice_servers from step 1)
   Add local audio track (mic)
    │
    ▼
5. createOffer() → setLocalDescription()
   POST /api/live/offer  { session_id, role: "controller", offer: { sdp, type } }
    │
    ▼
6. On each onIceCandidate → POST /api/live/ice (see Step 6A)
    │
    ▼
7. On WS live_answer (or poll GET /session as fallback):
   setRemoteDescription(answer) → remoteDescriptionSet = true → flushPendingCandidates()
    │
    ▼
8. On WS live_ice from player → addRemoteIceCandidate() (see Step 6B)
    │
    ▼
9. On IceConnectionState.CONNECTED:
   reportEvent("ice_connected")
   reportEvent("peer_connected", mapOf("streaming" to true))
   UI → "Live" / green indicator
    │
    ▼
10. On IceConnectionState.FAILED:
    reportEvent("ice_failed", mapOf("state" to "failed"))
    UI → show specific failure (not generic)
    │
    ▼
User taps "Stop Live"
    → stop mic, close PeerConnection
    → POST /api/live/end { session_id, reason: "ended" }
```

═══════════════════════════════════════════════════════════════
STEP 9 — PLAYER APP FLOW (LiveWebRtcPlayer.kt)
═══════════════════════════════════════════════════════════════

```
App running — WS always connected (foreground service):
  wss://.../ws/announce?token=JWT&role=user
    │
    ▼
On WS live_session { session_id, ice_servers }:
  1. STORE sessionId + iceServers in memory
  2. GET /api/live/session?role=player&session_id={id}&device_id={id}
     → registers player as ready (backend status → player_ready)
  3. Log: "Player ready, ice_servers has TURN: ..."
    │
    ▼
On WS live_offer { session_id, offer }:
  1. Create PeerConnection(iceServers from live_session — NOT hardcoded!)
  2. setRemoteDescription(offer) → remoteDescriptionSet = true
  3. flushPendingCandidates()
  4. createAnswer() → setLocalDescription()
  5. POST /api/live/answer { session_id, role: "player", answer, device_id }
    │
    ▼
On each onIceCandidate → POST /api/live/ice (see Step 6A)
    │
    ▼
On WS live_ice from controller → addRemoteIceCandidate() (see Step 6B)
    │
    ▼
On onTrack (remote audio):
  Attach to AudioTrack → speaker ON, volume max, start playback
  reportEvent("peer_connected", mapOf("streaming" to true))
  UI → show "Live announcement active"
    │
    ▼
On IceConnectionState.CONNECTED → reportEvent("ice_connected")
On IceConnectionState.FAILED → reportEvent("ice_failed")
    │
    ▼
On WS live_end → teardown, speaker off, UI reset
```

═══════════════════════════════════════════════════════════════
STEP 10 — POST /api/live/event (diagnostics — BOTH apps)
═══════════════════════════════════════════════════════════════

Report these events to backend:

| event | When to send |
|-------|--------------|
| ice_connected | IceConnectionState.CONNECTED |
| ice_failed | IceConnectionState.FAILED |
| peer_connected | onTrack received + audio playing (details: { streaming: true }) |
| peer_closed | PeerConnection closed unexpectedly |
| turn_used | local candidate typ relay detected |
| stun_used | local candidate typ srflx detected |
| relay_used | local or remote relay candidate |
| network_changed | ConnectivityManager detects WiFi ↔ mobile switch |

```kotlin
suspend fun reportEvent(event: String, details: Map<String, Any>? = null) {
    try {
        api.postEvent(LiveEventRequest(sessionId, myRole, event, details))
        Log.d(TAG, "Event reported: $event")
    } catch (e: Exception) {
        Log.w(TAG, "Event report failed: $event", e)
    }
}
```

On network change: report "network_changed", keep WS alive, backend auto-resyncs.
If PeerConnection dies: recreate if session still active (ICE restart).

═══════════════════════════════════════════════════════════════
STEP 11 — FAILURE REASONS → USER-FRIENDLY UI
═══════════════════════════════════════════════════════════════

Backend returns specific failure_reason — map to UI messages:

| failure_reason | User message (Bangla optional) |
|----------------|-------------------------------|
| player_offline | প্লেয়ার ডিভাইস অনলাইন নেই |
| offer_timeout | প্লেয়ার প্রস্তুত হয়নি (১৫ সেকেন্ড) |
| answer_timeout | প্লেয়ার উত্তর দেয়নি (১৫ সেকেন্ড) |
| ice_failed | নেটওয়ার্ক সংযোগ ব্যর্থ — TURN চেক করুন |
| connection_timeout | সংযোগ সময় শেষ (৩০ সেকেন্ড) |
| signaling_lost | সিগন্যালিং সংযোগ বিচ্ছিন্ন |
| turn_failed | TURN সার্ভার সংযোগ ব্যর্থ |
| peer_closed | প্লেয়ার সংযোগ বিচ্ছিন্ন করেছে |
| network_changed | নেটওয়ার্ক পরিবর্তন — পুনরায় সংযোগ... |
| authentication_failed | অথেন্টিকেশন ব্যর্থ |

Never show generic "Connection Failed" — always use failure_reason.

═══════════════════════════════════════════════════════════════
STEP 12 — SESSION STATE MACHINE (for UI/debug)
═══════════════════════════════════════════════════════════════

Backend session.status values:
  created → player_waiting → player_ready → offer_sent →
  answer_received → ice_checking → connected → streaming → ended

Show connection progress in UI (optional but recommended):
  "Waiting for player..." → "Connecting..." → "Live" → "Ended"

═══════════════════════════════════════════════════════════════
STEP 13 — RECONNECT & SLEEP RECOVERY
═══════════════════════════════════════════════════════════════

Player (critical):
  - Foreground service keeps WS alive
  - On WS disconnect: exponential backoff reconnect (1s, 2s, 4s, max 30s)
  - On reconnect: backend auto-resyncs pending ICE/offer via resyncSignalingForPeer
  - Also call GET /api/live/session?role=player to catch missed offer

Controller:
  - Keep WS connected during live session
  - On reconnect during active session: GET /session?role=controller for missed answer
  - Handle duplicate live_ice gracefully (backend deduplicates)

═══════════════════════════════════════════════════════════════
STEP 14 — LOGGING (Logcat tag: LiveWebRTC)
═══════════════════════════════════════════════════════════════

Log EVERY step — required for production debugging:

```
LiveWebRTC: ice_servers count=3 [stun:..., stun:..., turn:194.233.86.3:3478]
LiveWebRTC: session created id=xxx
LiveWebRTC: waiting player_ready...
LiveWebRTC: player_ready=true
LiveWebRTC: PeerConnection created
LiveWebRTC: offer created, POST sent
LiveWebRTC: ICE local type=host
LiveWebRTC: ICE POST sent
LiveWebRTC: ICE local type=srflx
LiveWebRTC: ICE local type=relay        ← TURN working!
LiveWebRTC: WS live_answer received
LiveWebRTC: setRemoteDescription OK
LiveWebRTC: ICE WS received from controller
LiveWebRTC: ICE addIceCandidate OK
LiveWebRTC: ICE connection state: CONNECTED
LiveWebRTC: Event reported: ice_connected
LiveWebRTC: onTrack — audio playback started
```

If coturn shows allocation logs during test → TURN is working end-to-end.

═══════════════════════════════════════════════════════════════
STEP 15 — DELIVERABLES
═══════════════════════════════════════════════════════════════

Implement or update these files:
  - LiveApiService.kt (all /api/live/* endpoints, NO getIce)
  - LiveWebRtcController.kt OR LiveWebRtcPlayer.kt
  - LiveIceServerFactory.kt
  - LiveSignalingWebSocket.kt (or update existing WS handler)
  - LiveEventReporter.kt
  - DTO data classes (Step 3)
  - Remove old binary audio WS live code
  - Remove all GET /api/live/ice polling code

═══════════════════════════════════════════════════════════════
STEP 16 — SUCCESS CRITERIA (verify before finishing)
═══════════════════════════════════════════════════════════════

[ ] No hardcoded stun.l.google.com in PeerConnection creation
[ ] ice_servers from API includes turn:194.233.86.3:3478
[ ] GET /api/live/ice completely removed from app
[ ] WS live_ice handled with full candidate → addIceCandidate()
[ ] POST /api/live/ice sends local candidates
[ ] Candidate queue flushes after setRemoteDescription
[ ] Controller waits for player_ready before offer
[ ] Player calls GET /session after live_session to register ready
[ ] POST /api/live/event reports ice_connected, turn_used, relay_used
[ ] failure_reason shown in UI (not generic error)
[ ] Logcat shows relay candidate (typ relay)
[ ] Controller UI shows "Live", Player hears mic on speaker
[ ] coturn journalctl shows allocation logs during live test

═══════════════════════════════════════════════════════════════
DO NOT CHANGE
═══════════════════════════════════════════════════════════════

  - Login / JWT auth flow
  - Bell schedules CRUD
  - Azan times CRUD
  - Recorded / scheduled / instant announcements (REST)
  - Device heartbeat
  - Dashboard / admin features
  - Database / Room schemas unrelated to live
```

# ═══════════════════════════════════════════════════════════════
# END CURSOR PROMPT
# ═══════════════════════════════════════════════════════════════

---

## কোথায় ব্যবহার করবেন

| Repository | কী করবেন |
|------------|----------|
| **Controller App** | উপরের prompt Cursor-এ paste করুন |
| **Player App** | একই prompt paste করুন — AI নিজে detect করবে |

## Backend deploy আগে বা পরে?

Backend v3 **আগে deploy** করুন, তারপর Android app update করুন।  
পুরানো app + নতুন backend = `GET /ice` 410 error (expected).

## Test করার পর যা দেখবেন

```bash
# Backend logs
docker compose logs -f api | grep '\[live\]'

# coturn (TURN working = allocation logs)
journalctl -u coturn -f

# Android Logcat
adb logcat -s LiveWebRTC
```
