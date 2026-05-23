# Sounds API — Bell & Azan (Backend Reference)

Production base URL: `https://api.shikkhasomoy.com`  
Swagger UI: `https://api.shikkhasomoy.com/api-docs`

All sound endpoints live under **`/api/sounds`**.  
Bell (school alarm) and Azan (prayer audio) share the same `sounds` table but are separated by the `type` column: `ENUM('bell','azan')`.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                      sounds table                           │
│  type = 'bell'  →  school bell / alarm audio                │
│  type = 'azan'  →  prayer (azan) audio files                │
└─────────────────────────────────────────────────────────────┘
         │                              │
         ▼                              ▼
  /api/sounds/bell/*            /api/sounds/azan/*
  schedules.sound_file          azan_times.sound_file
  (bell filename)               (azan filename)
```

**Static files:** uploaded to `uploads/` on disk, served at `GET /uploads/{filename}`.

**Database row required:** a file on disk alone is **not** returned by list/version APIs — there must be a row in `sounds`.

---

## Authentication

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <JWT>` |

Obtain token:

| Role | Method | Path | Body |
|------|--------|------|------|
| Admin | POST | `/api/auth/admin/login` | `{ "username", "password" }` |
| User / device | POST | `/api/auth/login` | `{ "username", "password", "device_id?" }` |

| Endpoint group | Auth | Admin-only |
|----------------|------|------------|
| List / upload / version | JWT required | No |
| PUT `/api/sounds/:id` | JWT | Yes |
| DELETE `/api/sounds/:id` | JWT | Yes |

---

## Visibility rules (list & version)

| Caller | Query | Result |
|--------|-------|--------|
| **admin** | `type=bell` or `type=azan` | All rows of that type |
| **user** | `type=bell` or `type=azan` | Rows where `user_id IS NULL` (admin uploads) **OR** `user_id = caller id` |

On upload:

| Uploader role | `user_id` stored | Visible to |
|---------------|------------------|------------|
| admin | `NULL` | All users |
| user | caller's user id | That user only (+ admin sees all) |

---

## Bell Sounds (`type = bell`)

School bell / alarm audio. Used by schedules (`schedules.sound_file` stores `filename`).

### List bell files

```
GET /api/sounds/bell
Authorization: Bearer <token>
```

**200 Response** — array:

```json
[
  {
    "id": 1,
    "name": "Morning Bell",
    "filename": "1779286988946_bell.mp3",
    "url": "https://api.shikkhasomoy.com/uploads/1779286988946_bell.mp3",
    "size_bytes": 30341,
    "type": "bell",
    "created_at": "2026-05-20T10:00:00.000Z"
  }
]
```

### Upload bell file

```
POST /api/sounds/bell/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `sound` | file | Yes | `.mp3`, `.wav`, or `.ogg` — max 20 MB |

**200 Response:**

```json
{
  "message": "bell sound uploaded",
  "filename": "1779294127557_morning_bell.mp3",
  "url": "https://api.shikkhasomoy.com/uploads/1779294127557_morning_bell.mp3",
  "type": "bell"
}
```

### Bell library version (device sync)

```
GET /api/sounds/bell/version
Authorization: Bearer <token>
```

**200 Response:**

```json
{
  "type": "bell",
  "version": 5,
  "files": [
    {
      "name": "1779286988946_bell.mp3",
      "url": "https://api.shikkhasomoy.com/uploads/1779286988946_bell.mp3",
      "checksum": "",
      "size_bytes": 30341,
      "type": "bell"
    }
  ]
}
```

`version` = highest `id` in the filtered bell rows. When a new bell is uploaded, `version` increases — clients poll this to detect changes.

---

## Azan Sounds (`type = azan`)

Prayer audio files. Used by azan schedule (`azan_times.sound_file` stores `filename`).

> **Note:** Prayer **times** (Fajr, Dhuhr, etc.) are a separate API under `/api/azan`. This section is only for **audio file** storage.

### List azan files

```
GET /api/sounds/azan
Authorization: Bearer <token>
```

Same response shape as bell list; each item has `"type": "azan"`.

### Upload azan file

```
POST /api/sounds/azan/upload
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

| Field | Type | Required |
|-------|------|----------|
| `sound` | file | Yes |

**200 Response:**

```json
{
  "message": "azan sound uploaded",
  "filename": "1779294163365_fajr.ogg",
  "url": "https://api.shikkhasomoy.com/uploads/1779294163365_fajr.ogg",
  "type": "azan"
}
```

### Azan library version (device sync)

```
GET /api/sounds/azan/version
Authorization: Bearer <token>
```

Same shape as bell version; `"type": "azan"`.

---

## Shared admin endpoints (both types)

### Rename display name

```
PUT /api/sounds/:id
Authorization: Bearer <admin token>
Content-Type: application/json
```

```json
{ "name": "New display name" }
```

**200:** `{ "message": "Sound updated" }`

### Delete sound (DB row + file on disk)

```
DELETE /api/sounds/:id
Authorization: Bearer <admin token>
```

**200:** `{ "message": "bell sound deleted" }` or `{ "message": "azan sound deleted" }`  
**404:** `{ "error": "Not found" }`

---

## Legacy / generic endpoints

Prefer dedicated `/bell` and `/azan` paths for new integrations.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/sounds?type=bell` | `type` **required** — 400 if missing |
| GET | `/api/sounds?type=azan` | Same as dedicated list |
| GET | `/api/sounds/version?type=bell` | Defaults to `bell` if `type` omitted |
| GET | `/api/sounds/version?type=azan` | |
| POST | `/api/sounds/upload?type=azan` | Or body field `type` — defaults to `bell` |

**400 example (missing type on list):**

```json
{
  "error": "type query required",
  "hint": "Use ?type=bell or ?type=azan, or GET /api/sounds/bell | /api/sounds/azan"
}
```

---

## Static file access

```
GET /uploads/{filename}
```

No auth. Example:

```
https://api.shikkhasomoy.com/uploads/1779294163365_fajr.ogg
```

List/version responses include full `url` — use that directly.

---

## Database schema (`sounds`)

| Column | Type | Description |
|--------|------|-------------|
| `id` | INT | Primary key; used as sync `version` |
| `original_name` | VARCHAR(200) | Display name |
| `filename` | VARCHAR(200) | Stored file name (unique) |
| `size_bytes` | BIGINT | File size |
| `checksum` | VARCHAR(64) | Optional hash (empty by default) |
| `type` | ENUM(`bell`,`azan`) | **Separates bell vs azan** |
| `user_id` | INT NULL | NULL = admin/global; set = user-specific |
| `created_at` | DATETIME | Upload time |

---

## Error responses

| HTTP | Body | Cause |
|------|------|-------|
| 401 | `{ "error": "No token provided" }` | Missing Authorization |
| 401 | `{ "error": "Invalid or expired token" }` | Bad JWT |
| 403 | `{ "error": "Admin only" }` | Non-admin on PUT/DELETE |
| 400 | `{ "error": "No file uploaded" }` | Upload without file |
| 400 | `{ "error": "type must be bell or azan" }` | Invalid type |
| 404 | `{ "error": "Not found" }` | Delete unknown id |
| 500 | `{ "error": "<message>" }` | Server/DB error |

---

## cURL quick reference

```bash
# Login (admin)
TOKEN=$(curl -s -X POST https://api.shikkhasomoy.com/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

# List bell
curl -s https://api.shikkhasomoy.com/api/sounds/bell \
  -H "Authorization: Bearer $TOKEN"

# List azan
curl -s https://api.shikkhasomoy.com/api/sounds/azan \
  -H "Authorization: Bearer $TOKEN"

# Upload azan
curl -s -X POST https://api.shikkhasomoy.com/api/sounds/azan/upload \
  -H "Authorization: Bearer $TOKEN" \
  -F "sound=@./fajr.ogg"

# Bell sync version
curl -s https://api.shikkhasomoy.com/api/sounds/bell/version \
  -H "Authorization: Bearer $TOKEN"

# Delete
curl -s -X DELETE https://api.shikkhasomoy.com/api/sounds/3 \
  -H "Authorization: Bearer $TOKEN"
```

---

## Integration checklist (any client)

1. Base URL: `https://api.shikkhasomoy.com` (not main website domain).
2. Login → store JWT.
3. **Bell section:** `GET/POST /api/sounds/bell`, sync via `/api/sounds/bell/version`.
4. **Azan section:** `GET/POST /api/sounds/azan`, sync via `/api/sounds/azan/version`.
5. Play audio from response `url` or `/uploads/{filename}`.
6. Schedules reference bell `filename`; azan times reference azan `filename`.
7. Poll bell and azan versions **independently** — they do not share a version number.
