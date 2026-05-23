# Schedule Templates API (Default Bell Gallery)

Production: `https://api.shikkhasomoy.com`

## Purpose

| Layer | Table | Who manages | Who consumes |
|-------|--------|-------------|--------------|
| **Templates (gallery)** | `bell_schedule_templates` | Admin | All users (read + import) |
| **User schedules** | `schedules` (`user_id` required) | User app / import | Device plays bells |

Flow (old system restored):

1. Admin creates rows in **templates** (default school bell times).
2. App user calls **import-templates** → copies enabled templates into their `schedules` rows.
3. Device uses `GET /api/schedules` (per-user, enabled only).

There is **no** `school_name` on schedules. Users are identified by `user_id` only.

---

## Endpoints

### Templates (gallery)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/schedules/templates` | JWT | List all templates `ORDER BY hour, minute` |
| POST | `/api/schedules/templates` | Admin | Create template |
| PUT | `/api/schedules/templates/:id` | Admin | Update template |
| DELETE | `/api/schedules/templates/:id` | Admin | Delete template |

**Template JSON:**
```json
{
  "id": 1,
  "label": "Morning Bell",
  "hour": 8,
  "minute": 0,
  "days": 62,
  "sound_file": "default_bell.mp3",
  "is_enabled": true,
  "routine_type": "SCHOOL"
}
```

**POST body:** `label`, `hour`, `minute` required; optional `days`, `sound_file`, `is_enabled`, `routine_type`.

### Import into user account (mobile app)

```
POST /api/schedules/import-templates
Authorization: Bearer <user or admin token>
```

- Reads templates where `is_enabled = 1`.
- Inserts into `schedules` for `req.user.id`.
- **Skips** if same `user_id + label + hour + minute` already exists.

**Response:**
```json
{
  "message": "3 schedule(s) imported",
  "imported": 3,
  "total": 5
}
```

### Per-user schedules (unchanged)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/schedules` | Enabled schedules for logged-in user |
| GET | `/api/schedules/all` | All schedules (incl. disabled) |
| GET | `/api/schedules/version` | Change-detection token |
| POST | `/api/schedules` | Create one schedule |
| PUT | `/api/schedules/:id` | Update own (or admin) |
| DELETE | `/api/schedules/:id` | Delete own (or admin) |
| GET | `/api/schedules/admin/all` | Admin: all users' schedules |

---

## Database migration

File: `migrations/001_bell_schedule_templates.sql`

Run on production MySQL database `shikkhasomoy_schoolbell` before using template APIs.

---

## cURL

```bash
TOKEN=$(curl -s -X POST https://api.shikkhasomoy.com/api/auth/admin/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | jq -r .token)

curl -s https://api.shikkhasomoy.com/api/schedules/templates \
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST https://api.shikkhasomoy.com/api/schedules/templates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Period 1","hour":9,"minute":0,"sound_file":"bell.mp3"}'

# As app user — copy gallery to my schedules
curl -s -X POST https://api.shikkhasomoy.com/api/schedules/import-templates \
  -H "Authorization: Bearer USER_TOKEN"
```

---

## Related: sounds

Bell templates reference `sound_file` (filename). Upload bells via:

- `GET/POST /api/sounds/bell`

Azan audio is separate (`/api/sounds/azan`) and used with `/api/azan` prayer times, not schedule templates.
