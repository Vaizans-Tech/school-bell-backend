const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const {
  parseIntField,
  parseBoolField,
  resolveHourMinute,
  mapAnnouncement,
  validateAudioFile,
} = require('../lib/announcementHelpers');

const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.m4a';
    cb(null, `ann_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const AUDIO_TYPES = [
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac',
  'audio/mp4', 'audio/x-m4a', 'audio/opus', 'audio/webm',
  'application/octet-stream',
];

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (AUDIO_TYPES.includes(file.mimetype) || file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

function multerSingle(field) {
  return (req, res, next) => {
    upload.single(field)(req, res, err => {
      if (err) return res.status(400).json({ error: err.message });
      next();
    });
  };
}

function audioFilenameFromRequest(req, existing = null) {
  if (req.file) {
    const err = validateAudioFile(req.file);
    if (err) throw new Error(err);
    return req.file.filename;
  }
  if (req.body.audio_url) {
    const url = String(req.body.audio_url);
    if (url.startsWith('http')) {
      const parts = url.split('/');
      return parts[parts.length - 1];
    }
    return url;
  }
  return existing;
}

function normalizeType(type) {
  const t = (type || 'recorded').toLowerCase();
  if (t === 'live') return null;
  if (t === 'recorded' || t === 'scheduled') return t;
  return null;
}

async function fetchAnnouncement(id, userId) {
  const [rows] = await db.query(
    'SELECT * FROM announcements WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return rows[0] || null;
}

async function insertAnnouncement(req, res) {
  const { title, message, type: rawType, priority } = req.body;
  const type = normalizeType(rawType);
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!type) return res.status(400).json({ error: 'type must be recorded or scheduled (live uses WebSocket)' });

  let audioUrl = null;
  try {
    audioUrl = audioFilenameFromRequest(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const days = parseIntField(req.body.days, 62);
  const { hour, minute, scheduled_at } = resolveHourMinute(req.body);

  if (type === 'scheduled') {
    if (hour == null || minute == null) {
      return res.status(400).json({ error: 'hour and minute are required for scheduled announcements' });
    }
    if (!audioUrl) {
      return res.status(400).json({ error: 'audio file is required for scheduled announcements' });
    }
  }

  if (type === 'recorded' && !audioUrl) {
    return res.status(400).json({ error: 'audio file is required for recorded announcements' });
  }

  const isActive = type === 'recorded'
    ? parseBoolField(req.body.is_active, 1)
    : 0;

  const [result] = await db.query(
    `INSERT INTO announcements
     (user_id, type, title, message, audio_url, scheduled_at, hour, minute, days, is_active, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, type, title, message || '', audioUrl, scheduled_at,
      hour, minute, days, isActive, parseIntField(priority, 0),
    ]
  );

  const row = await fetchAnnouncement(result.insertId, req.user.id);
  res.status(201).json(mapAnnouncement(row, req));
}

async function updateAnnouncement(req, res) {
  const existing = await fetchAnnouncement(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const title = req.body.title ?? existing.title;
  const message = req.body.message ?? existing.message ?? '';
  const type = normalizeType(req.body.type ?? existing.type) || existing.type;
  const days = parseIntField(req.body.days, existing.days ?? 62);
  const { hour, minute, scheduled_at } = resolveHourMinute(req.body, existing);

  let audioUrl = existing.audio_url;
  try {
    const nextAudio = audioFilenameFromRequest(req, existing.audio_url);
    if (nextAudio) audioUrl = nextAudio;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  if (type === 'scheduled' && (hour == null || minute == null)) {
    return res.status(400).json({ error: 'hour and minute are required for scheduled announcements' });
  }

  const isActive = req.body.is_active !== undefined
    ? parseBoolField(req.body.is_active, existing.is_active)
    : existing.is_active;

  const priority = req.body.priority !== undefined
    ? parseIntField(req.body.priority, existing.priority)
    : existing.priority;

  await db.query(
    `UPDATE announcements
     SET type=?, title=?, message=?, audio_url=?, scheduled_at=?, hour=?, minute=?, days=?, is_active=?, priority=?
     WHERE id=? AND user_id=?`,
    [type, title, message, audioUrl, scheduled_at, hour, minute, days, isActive ? 1 : 0, priority, req.params.id, req.user.id]
  );

  const row = await fetchAnnouncement(req.params.id, req.user.id);
  res.json(mapAnnouncement(row, req));
}

// ── GET /api/announcements — list (device: active only; controller: ?all=1) ───
router.get('/', authMiddleware, async (req, res) => {
  const limit = Math.min(parseIntField(req.query.limit, 50), 200);
  const all = req.query.all === '1' || req.query.all === 'true';
  const typeFilter = req.query.type;

  try {
    let sql = 'SELECT * FROM announcements WHERE user_id = ?';
    const params = [req.user.id];

    if (!all) sql += ' AND is_active = 1';
    if (typeFilter) {
      sql += ' AND type = ?';
      params.push(typeFilter);
    }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const [rows] = await db.query(sql, params);
    res.json(rows.map(r => mapAnnouncement(r, req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements
       WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.json(null);
    res.json(mapAnnouncement(rows[0], req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements
       WHERE user_id = ? AND type = 'scheduled'
       ORDER BY hour, minute`,
      [req.user.id]
    );
    res.json(rows.map(r => mapAnnouncement(r, req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Unified CRUD (controller app) ─────────────────────────────────────────────
router.post('/', authMiddleware, multerSingle('audio'), insertAnnouncement);

// ── Legacy aliases ────────────────────────────────────────────────────────────
router.post('/recorded', authMiddleware, multerSingle('audio'), async (req, res) => {
  req.body.type = 'recorded';
  return insertAnnouncement(req, res);
});

router.post('/scheduled', authMiddleware, multerSingle('audio'), async (req, res) => {
  req.body.type = 'scheduled';
  if (!req.body.hour && !req.body.minute && req.body.scheduled_at) {
    const parts = String(req.body.scheduled_at).split(':');
    req.body.hour = parts[0];
    req.body.minute = parts[1];
  }
  return insertAnnouncement(req, res);
});

router.patch('/:id/deactivate', authMiddleware, async (req, res) => {
  try {
    await db.query(
      'UPDATE announcements SET is_active = 0 WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    res.json({ message: 'Deactivated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await fetchAnnouncement(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json(mapAnnouncement(row, req));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, multerSingle('audio'), updateAnnouncement);

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const row = await fetchAnnouncement(req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Not found' });

    if (row.audio_url && !String(row.audio_url).startsWith('http')) {
      const filePath = path.join(uploadsDir, row.audio_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
