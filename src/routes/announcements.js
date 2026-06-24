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
  parsePlayDates,
  normalizeType,
  mapAnnouncement,
  validateAudioFile,
  validateOnetimeDates,
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

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('audio/') || file.mimetype === 'application/octet-stream') {
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
    return url.startsWith('http') ? url.split('/').pop() : url;
  }
  return existing;
}

async function fetchPlayDates(announcementId) {
  const [rows] = await db.query(
    'SELECT play_date, fired, fired_at FROM announcement_dates WHERE announcement_id = ? ORDER BY play_date',
    [announcementId]
  );
  return rows;
}

async function replacePlayDates(announcementId, dates) {
  await db.query('DELETE FROM announcement_dates WHERE announcement_id = ?', [announcementId]);
  for (const d of dates) {
    await db.query(
      'INSERT INTO announcement_dates (announcement_id, play_date) VALUES (?, ?)',
      [announcementId, d]
    );
  }
}

async function fetchAnnouncementFull(id, userId) {
  const [rows] = await db.query(
    'SELECT * FROM announcements WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  if (!rows.length) return null;
  const playDates = await fetchPlayDates(id);
  return { row: rows[0], playDates };
}

async function respondAnnouncement(req, res, id, status = 200) {
  const data = await fetchAnnouncementFull(id, req.user.id);
  if (!data) return res.status(404).json({ error: 'Not found' });
  const body = mapAnnouncement(data.row, req, data.playDates);
  return status === 201 ? res.status(201).json(body) : res.json(body);
}

async function insertAnnouncement(req, res) {
  const { title, message, type: rawType, priority } = req.body;
  const type = normalizeType(rawType);
  if (!title) return res.status(400).json({ error: 'title is required' });
  if (!type) return res.status(400).json({ error: 'type must be recorded, onetime, or scheduled (live uses WebSocket)' });

  let audioUrl = null;
  try {
    audioUrl = audioFilenameFromRequest(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const { hour, minute, scheduled_at } = resolveHourMinute(req.body);
  const playDates = parsePlayDates(req.body);
  const days = parseIntField(req.body.days, type === 'scheduled' ? 62 : null);

  if (type === 'recorded') {
    if (!audioUrl) return res.status(400).json({ error: 'audio file is required for recorded announcements' });
  } else if (type === 'scheduled') {
    // Weekly repeat — hour + minute + days bitmask (আগের system)
    if (hour == null || minute == null) {
      return res.status(400).json({ error: 'hour and minute are required for scheduled (weekly repeat)' });
    }
    if (!audioUrl) return res.status(400).json({ error: 'audio file is required' });
    if (days == null) return res.status(400).json({ error: 'days bitmask is required for scheduled (e.g. 62 = Mon-Fri)' });
  } else if (type === 'onetime') {
    // Calendar one-time — 1 or multiple specific dates (নতুন feature)
    const dateErr = validateOnetimeDates(type, playDates);
    if (dateErr) return res.status(400).json({ error: dateErr });
    if (hour == null || minute == null) {
      return res.status(400).json({ error: 'hour and minute are required for onetime' });
    }
    if (!audioUrl) return res.status(400).json({ error: 'audio file is required' });
  }

  const isActive = type === 'recorded' ? 1 : 0;

  const [result] = await db.query(
    `INSERT INTO announcements
     (user_id, type, title, message, audio_url, scheduled_at, hour, minute, days, is_active, priority)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id, type, title, message || '', audioUrl, scheduled_at,
      hour, minute, days, isActive, parseIntField(priority, 0),
    ]
  );

  if (type === 'onetime' && playDates.length) {
    await replacePlayDates(result.insertId, playDates);
  }

  return respondAnnouncement(req, res, result.insertId, 201);
}

async function updateAnnouncement(req, res) {
  const existing = await fetchAnnouncementFull(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Not found' });

  const row = existing.row;
  const title = req.body.title ?? row.title;
  const message = req.body.message ?? row.message ?? '';
  const type = normalizeType(req.body.type ?? row.type) || row.type;
  const { hour, minute, scheduled_at } = resolveHourMinute(req.body, row);

  let audioUrl = row.audio_url;
  try {
    const nextAudio = audioFilenameFromRequest(req, row.audio_url);
    if (nextAudio) audioUrl = nextAudio;
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let days = row.days;
  if (req.body.days !== undefined) days = parseIntField(req.body.days, row.days ?? 62);

  let playDates = existing.playDates.map(d => String(d.play_date).slice(0, 10));
  if (req.body.dates || req.body.play_dates || req.body.play_date) {
    playDates = parsePlayDates(req.body);
  }

  if (type === 'scheduled' && (hour == null || minute == null)) {
    return res.status(400).json({ error: 'hour and minute are required for scheduled' });
  }
  if (type === 'onetime') {
    const dateErr = validateOnetimeDates(type, playDates);
    if (dateErr) return res.status(400).json({ error: dateErr });
    if (hour == null || minute == null) {
      return res.status(400).json({ error: 'hour and minute are required for onetime' });
    }
  }

  const isActive = req.body.is_active !== undefined
    ? parseBoolField(req.body.is_active, row.is_active)
    : row.is_active;
  const priority = req.body.priority !== undefined
    ? parseIntField(req.body.priority, row.priority)
    : row.priority;

  await db.query(
    `UPDATE announcements
     SET type=?, title=?, message=?, audio_url=?, scheduled_at=?, hour=?, minute=?, days=?, is_active=?, priority=?
     WHERE id=? AND user_id=?`,
    [type, title, message, audioUrl, scheduled_at, hour, minute, days, isActive ? 1 : 0, priority, req.params.id, req.user.id]
  );

  if (type === 'onetime' && playDates.length) {
    await replacePlayDates(req.params.id, playDates);
  }
  if (type === 'scheduled') {
    await db.query('DELETE FROM announcement_dates WHERE announcement_id = ?', [req.params.id]);
  }

  return respondAnnouncement(req, res, req.params.id);
}

router.get('/', authMiddleware, async (req, res) => {
  const limit = Math.min(parseIntField(req.query.limit, 50), 200);
  const all = req.query.all === '1' || req.query.all === 'true';
  const typeFilter = req.query.type;

  try {
    let sql = 'SELECT * FROM announcements WHERE user_id = ?';
    const params = [req.user.id];
    if (!all) sql += ' AND is_active = 1';
    if (typeFilter) { sql += ' AND type = ?'; params.push(typeFilter); }
    sql += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const [rows] = await db.query(sql, params);
    const out = [];
    for (const r of rows) {
      const playDates = r.type === 'onetime' ? await fetchPlayDates(r.id) : [];
      out.push(mapAnnouncement(r, req, playDates));
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.json(null);
    const playDates = rows[0].type === 'onetime' ? await fetchPlayDates(rows[0].id) : [];
    res.json(mapAnnouncement(rows[0], req, playDates));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Weekly repeat list (আগের scheduled system) */
router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements WHERE user_id = ? AND type = 'scheduled'
       ORDER BY hour, minute`,
      [req.user.id]
    );
    res.json(rows.map(r => mapAnnouncement(r, req, [])));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Calendar one-time list (নতুন feature) */
router.get('/onetime', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements WHERE user_id = ? AND type = 'onetime'
       ORDER BY created_at DESC`,
      [req.user.id]
    );
    const out = [];
    for (const r of rows) {
      out.push(mapAnnouncement(r, req, await fetchPlayDates(r.id)));
    }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', authMiddleware, multerSingle('audio'), insertAnnouncement);

router.post('/recorded', authMiddleware, multerSingle('audio'), (req, res) => {
  req.body.type = 'recorded';
  return insertAnnouncement(req, res);
});

router.post('/scheduled', authMiddleware, multerSingle('audio'), (req, res) => {
  req.body.type = 'scheduled';
  if (!req.body.days) req.body.days = 62;
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
    return respondAnnouncement(req, res, req.params.id);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', authMiddleware, multerSingle('audio'), updateAnnouncement);

router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const data = await fetchAnnouncementFull(req.params.id, req.user.id);
    if (!data) return res.status(404).json({ error: 'Not found' });
    const row = data.row;
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
