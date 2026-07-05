# Smart School Bell — Live WebRTC System Overview
## পুরো সিস্টেম কীভাবে কাজ করে (Full Summary)

**Version:** Backend v2.0  
**API Base:** `https://api.shikkhasomoy.com`  
**Swagger:** `https://api.shikkhasomoy.com/api-docs` → Live tag

---

## 1. সংক্ষিপ্ত পরিচয় (One Paragraph)

Live Announcement-এ **মাইকের audio সরাসরি Controller App → Player App**-এ যায় (WebRTC P2P)।  
**Backend server audio relay করে না** — শুধু **signaling** করে (session, offer, answer, ICE candidates)।  
**TURN server (coturn)** NAT/firewall পেরিয়ে connection তৈরিতে সাহায্য করে।  
Backend VPS env থেকে STUN/TURN config app-কে পাঠায়; app-এ আলাদা TURN config লাগে না।

---

## 2. System Components

| Component | Role | Technology |
|-----------|------|------------|
| **Controller App** | Mic capture → WebRTC send | Android + WebRTC |
| **Player App** | WebRTC receive → Speaker | Android + WebRTC |
| **Backend API** | Signaling only (no media) | Node.js + Express |
| **WebSocket** | Real-time notifications | `wss://.../ws/announce` |
| **coturn (TURN)** | NAT traversal relay | VPS port 3478 |
| **STUN** | Public IP discovery | Google STUN (default) |

---

## 3. Architecture Diagram

```
┌─────────────────┐         ┌──────────────────────────┐         ┌─────────────────┐
│  Controller App │         │   Backend (Signaling)    │         │   Player App    │
│  (Mic / Sender) │         │  api.shikkhasomoy.com    │         │ (Speaker/Recv)  │
└────────┬────────┘         └────────────┬─────────────┘         └────────┬────────┘
         │                               │                               │
         │  REST: session/offer/ice       │       REST: answer/ice        │
         │  WS: role=controller           │       WS: role=user|player   │
         │──────────────────────────────►│◄──────────────────────────────│
         │                               │                               │
         │         WebSocket JSON only   │   (live_session, live_offer,  │
         │         (no binary audio!)    │    live_answer, live_ice)      │
         │                               │                               │
         │                                                               │
         │◄════════════ WebRTC Audio (P2P) ═════════════════════════════►│
         │              Direct peer connection                           │
         │                               │                               │
         │                               │  ice_servers config           │
         │◄──────────────────────────────┼──────────────────────────────►│
         │         GET /api/live/config  │                               │
         │                               │                               │
         └───────────────────────────────┼───────────────────────────────┘
                                         │
                              ┌──────────▼──────────┐
                              │  coturn TURN Server │
                              │  194.233.86.3:3478  │
                              │  (NAT relay only)   │
                              └─────────────────────┘
```

**মনে রাখুন:** Audio path = Controller ↔ Player (direct).  
Backend path = signaling messages only.

---

## 4. VPS Environment Variables

Backend `.env` / docker-compose:

```env
STUN_SERVERS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302
TURN_URL=turn:194.233.86.3:3478
TURN_USERNAME=schoolbell
TURN_PASSWORD=StrongPassword123
LIVE_SIGNALING_TIMEOUT_MS=300000
LIVE_SESSION_MAX_MS=7200000
```

coturn `/etc/coturn/turnserver.conf` (match credentials):

```
listening-port=3478
external-ip=194.233.86.3
user=schoolbell:StrongPassword123
realm=shikkhasomoy.com
```

Firewall: **3478 UDP + TCP** open.

---

## 5. Authentication

সব API + WebSocket JWT token দিয়ে:

```
Authorization: Bearer <JWT>
```

WebSocket connect:
```
wss://api.shikkhasomoy.com/ws/announce?token=<JWT>&role=controller
wss://api.shikkhasomoy.com/ws/announce?token=<JWT>&role=user
```

**Same user account** — Controller ও Player একই school/user JWT use করে (same `user_id`).

---

## 6. Complete Live Flow (Step by Step)

### Phase A — Session Start (Controller)

| Step | Who | Action |
|------|-----|--------|
| 1 | Controller | User taps **Start Live** |
| 2 | Controller | `POST /api/live/session` `{ role: "controller" }` |
| 3 | Backend | Creates session, returns `session_id` + `ice_servers` |
| 4 | Backend | WebSocket → Player: `{ type: "live_session", session_id, ice_servers }` |
| 5 | Player | Stores `session_id` + `ice_servers`, prepares WebRTC |

### Phase B — SDP Offer/Answer

| Step | Who | Action |
|------|-----|--------|
| 6 | Controller | Create `PeerConnection` with `ice_servers` from step 3 |
| 7 | Controller | Add mic audio track, `createOffer()` |
| 8 | Controller | `POST /api/live/offer` `{ session_id, role: "controller", offer }` |
| 9 | Backend | WebSocket → Player: `{ type: "live_offer", session_id, offer }` |
| 10 | Player | Create `PeerConnection` with `ice_servers` (from live_session or /config) |
| 11 | Player | `setRemoteDescription(offer)` → `createAnswer()` |
| 12 | Player | `POST /api/live/answer` `{ session_id, role: "player", answer }` |
| 13 | Backend | WebSocket → Controller: `{ type: "live_answer", session_id, answer }` |
| 14 | Controller | `setRemoteDescription(answer)` |

### Phase C — ICE Candidate Exchange (Critical!)

| Step | Who | Action |
|------|-----|--------|
| 15 | Both | On each local ICE candidate → `POST /api/live/ice` |
| 16 | Both | On `live_ice` WS event OR poll → `GET /api/live/ice?role=...` |
| 17 | Both | `addIceCandidate()` for each peer candidate |
| 18 | Both | PeerConnection state → **CONNECTED** |
| 19 | Player | Remote audio track → speaker (auto play) |

### Phase D — Stop

| Step | Who | Action |
|------|-----|--------|
| 20 | Controller | `POST /api/live/end` `{ session_id }` |
| 21 | Backend | WebSocket → both: `{ type: "live_end", session_id, reason }` |
| 22 | Both | Close PeerConnection, release mic/audio |

---

## 7. REST API Reference

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| GET | `/api/live/config` | Both | STUN/TURN ice_servers |
| POST | `/api/live/session` | Controller | Start session |
| GET | `/api/live/session` | Both | Poll session state |
| POST | `/api/live/offer` | Controller | Send SDP offer |
| POST | `/api/live/answer` | Player | Send SDP answer |
| POST | `/api/live/ice` | Both | Submit ICE candidate |
| GET | `/api/live/ice` | Both | Poll peer ICE candidates |
| POST | `/api/live/end` | Both | End session |

### ice_servers Response Example

```json
{
  "ice_servers": [
    { "urls": "stun:stun.l.google.com:19302" },
    { "urls": "stun:stun1.l.google.com:19302" },
    {
      "urls": "turn:194.233.86.3:3478",
      "username": "schoolbell",
      "credential": "StrongPassword123"
    }
  ]
}
```

---

## 8. WebSocket Messages

### Controller connects: `role=controller`
Receives: `live_answer`, `live_ice`, `live_end`

### Player connects: `role=user` or `role=player`
Receives: `live_session`, `live_offer`, `live_ice`, `live_end`, `new_announcement`

| type | Payload | Action |
|------|---------|--------|
| `live_session` | session_id, ice_servers | Prepare receiver |
| `live_offer` | session_id, offer | Create answer |
| `live_answer` | session_id, answer | setRemoteDescription |
| `live_ice` | session_id | Poll GET /api/live/ice |
| `live_end` | session_id, reason | Teardown |

**Important:** WebSocket-এ binary audio পাঠানো যাবে না (পুরনো system remove করা হয়েছে)।

---

## 9. Session States

| Status | Meaning |
|--------|---------|
| `waiting_player` | Session created, player not joined |
| `player_joined` | Player registered |
| `offer_sent` | Controller sent offer |
| `connected` | Player sent answer |
| `ended` | Session finished |

---

## 10. STUN vs TURN — কখন কী লাগে

| Scenario | STUN only | TURN required |
|----------|-----------|---------------|
| Same WiFi / LAN | Usually works | Optional |
| Different network / mobile data | Often fails | **Required** |
| School NAT / firewall | Often fails | **Required** |

Backend TURN env empty → only STUN sent → different network-এ ICE fail likely.

---

## 11. What Backend Does NOT Do

- Does NOT relay audio bytes
- Does NOT process WebRTC media
- Does NOT store SDP long-term (in-memory session store)
- Does NOT require app-side TURN credentials (served via API)

---

## 12. Quick Verification Checklist

| Check | Command / URL |
|-------|---------------|
| API health | `GET https://api.shikkhasomoy.com/` |
| ICE config | `GET /api/live/config` (with JWT) |
| TURN in response | turn: entry with username/credential |
| coturn running | `sudo systemctl status coturn` |
| Port open | `3478/udp` + `3478/tcp` |
| Swagger docs | `https://api.shikkhasomoy.com/api-docs` |

---

## 13. Apps Summary

### Controller App
- Starts live session
- Sends offer + ICE candidates
- Captures mic, sends audio P2P

### Player App
- Always connected WebSocket (background service)
- Receives live_session + live_offer automatically
- Sends answer + ICE candidates
- Plays remote audio on speaker

---

*Smart School Bell — Live WebRTC System Overview*  
*Backend repository: school-bell-backend*
