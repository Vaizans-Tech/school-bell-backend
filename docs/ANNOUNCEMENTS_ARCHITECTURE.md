# Announcement System — Calendar Architecture

Production API: `https://api.shikkhasomoy.com`

## 3 announcement types

| Type | Meaning | Calendar | Time | Fires |
|------|---------|----------|------|-------|
| **recorded** | Play now (one-time immediate) | No | No | Immediately (`is_active=1`) |
| **onetime** | Single future date from calendar | Exactly **1** date | hour + minute | Once on that date |
| **scheduled** | Multiple dates from calendar | **1 or more** dates | same hour + minute | Once per selected date |
| **live** | Real-time mic stream | N/A | N/A | WebSocket only (not REST) |

**Not weekly recurring.** No `days` bitmask. User picks concrete dates (today, tomorrow, any future day).

---

## Database

```
announcements
├── id, user_id, type, title, message, audio_url
├── hour, minute, scheduled_at (display HH:MM)
├── is_active, priority, created_at
└── (legacy `days` column unused for new calendar flow)

announcement_dates          ← NEW
├── announcement_id → announcements.id
├── play_date DATE          ← calendar selection
├── fired (0/1)
└── fired_at
```

---

## Flow diagram

```
Controller App                         Backend                         Play App (device)
─────────────────────────────────────────────────────────────────────────────────────
1. recorded:
   POST /api/announcements              Save row is_active=1
   type=recorded + audio                ──────────────────────►  GET /announcements
                                                                  plays immediately

2. onetime / scheduled:
   POST /api/announcements              Save row is_active=0
   type=onetime|scheduled               + announcement_dates rows
   dates=["2026-06-01","2026-06-05"]    (pending)
   hour, minute, audio

   Cron every minute:
   if today in announcement_dates
   AND hour:minute match
   → fired=1, is_active=1
   → WebSocket notify ───────────────────────────────────────►  GET /announcements
                                                                  or WS push → play audio

3. live:
   WebSocket wss://.../ws/announce?role=controller ──stream──►   role=user receives PCM
```

---

## API contract

### Create (multipart)
```
POST /api/announcements
Authorization: Bearer <JWT>
Content-Type: multipart/form-data

title*          string
message         string
type*           recorded | onetime | scheduled
audio*          file (required except JSON with audio_url)
hour*           int (required for onetime/scheduled)
minute*         int (required for onetime/scheduled)
dates*          JSON string: ["2026-06-01","2026-06-05"]  (calendar picks)
priority        int
```

### Response
```json
{
  "id": 12,
  "type": "scheduled",
  "title": "Assembly",
  "audio_url": "https://api.shikkhasomoy.com/uploads/ann_xxx.m4a",
  "hour": 8,
  "minute": 30,
  "scheduled_at": "08:30",
  "play_dates": ["2026-06-01", "2026-06-05"],
  "pending_dates": ["2026-06-01", "2026-06-05"],
  "next_play_date": "2026-06-01",
  "dates": [
    { "date": "2026-06-01", "fired": false, "fired_at": null }
  ],
  "is_active": 0,
  "priority": 0,
  "created_at": "..."
}
```

### List (controller)
```
GET /api/announcements?all=1&limit=50
```

### List (calendar pending)
```
GET /api/announcements/scheduled
```
Returns `onetime` + `scheduled` with `play_dates`.

### Play app (device)
```
GET /api/announcements/latest
GET /api/announcements          (active only)
PATCH /api/announcements/:id/deactivate   (after played)
```

---

## Migration

Run on production:
1. `migrations/002_announcements_hour_minute_days.sql` (if not done)
2. `migrations/003_announcement_calendar_dates.sql`

Then `pm2 restart all`.

---

## App prompts (copy-paste for dev teams)

### PROMPT — Controller App (Android)

```
Integrate Smart School Bell announcement API at https://api.shikkhasomoy.com

Auth: JWT from POST /api/auth/login → Authorization: Bearer <token>

Three announcement types (NOT daily recurring):

1. recorded — play immediately
   POST /api/announcements (multipart)
   Fields: title, message, type=recorded, audio=<file.m4a>
   No calendar dates.

2. onetime — exactly ONE calendar date + time
   POST /api/announcements (multipart)
   Fields: title, message, type=onetime, hour, minute,
           dates=["YYYY-MM-DD"]  (JSON array string, single date),
           audio=<file>

3. scheduled — MULTIPLE calendar dates + same time
   POST /api/announcements (multipart)
   Fields: title, message, type=scheduled, hour, minute,
           dates=["2026-06-01","2026-06-05",...]  (from multi-select calendar),
           audio=<file>

Use Content-Type: multipart/form-data. Field name for file: audio.

List all (including pending): GET /api/announcements?all=1
Calendar list: GET /api/announcements/scheduled
Edit: PUT /api/announcements/{id} (same multipart fields)
Delete: DELETE /api/announcements/{id}

Live announcement: WebSocket wss://api.shikkhasomoy.com/ws/announce?token=JWT&role=controller
(not REST)

UI: Calendar date picker → build dates JSON array. Time picker → hour/minute.
Do NOT send days bitmask for announcements (that is for bell schedules only).
```

### PROMPT — Play App (School Device)

```
Integrate Smart School Bell play-side announcements at https://api.shikkhasomoy.com

Auth: JWT from device login POST /api/auth/login with device_id.

Polling / playback:

1. Recorded + fired calendar announcements:
   GET /api/announcements/latest  — newest active
   GET /api/announcements       — active list (is_active=1)
   Each item has: id, title, type, audio_url (HTTPS), hour, minute, play_dates

2. When announcement plays, mark seen:
   PATCH /api/announcements/{id}/deactivate

3. WebSocket for instant push (optional):
   wss://api.shikkhasomoy.com/ws/announce?token=JWT&role=user
   On message { type: "new_announcement", id, title, play_date }:
   → refresh GET /api/announcements and play matching audio_url

4. Live stream:
   Same WebSocket — receive raw audio chunks when controller is live.

Download audio from audio_url before play. Poll every 30-60s or use WebSocket.

Calendar types (onetime/scheduled) only become active on their play_date at hour:minute
(server cron). Device does not schedule locally — trust server is_active flag.
```
