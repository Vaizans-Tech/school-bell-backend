const router = require('express').Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// ── Multer setup ─────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `ann_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const AUDIO_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/aac',
                     'audio/mp4', 'audio/x-m4a', 'audio/opus', 'audio/webm'];

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (AUDIO_TYPES.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed'));
    }
  },
});

// ── GET /api/announcements — active announcements for this user ───────────────
router.get('/', authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  console.log(`[announcements] GET / user_id=${req.user.id} username=${req.user.username}`);
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements
       WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT ?`,
      [req.user.id, limit]
    );
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(rows.map(r => ({
      ...r,
      audio_url: r.audio_url
        ? (r.audio_url.startsWith('http') ? r.audio_url : `${baseUrl}/uploads/${r.audio_url}`)
        : null,
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/announcements/latest — newest active for this user ───────────────
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements
       WHERE user_id = ? AND is_active = 1
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.id]
    );
    if (!rows.length) return res.json(null);
    const r = rows[0];
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      ...r,
      audio_url: r.audio_url
        ? (r.audio_url.startsWith('http') ? r.audio_url : `${baseUrl}/uploads/${r.audio_url}`)
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/announcements/scheduled — controller's scheduled list ────────────
router.get('/scheduled', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM announcements
       WHERE user_id = ? AND type = 'scheduled'
       ORDER BY scheduled_at ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/announcements/recorded — upload + save recorded announcement ────
router.post('/recorded', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const { title, message } = req.body;
    if (!title) return res.status(400).json({ error: 'title is required' });
    const audioUrl = req.file ? req.file.filename : null;
    const [result] = await db.query(
      `INSERT INTO announcements (user_id, type, title, message, audio_url, is_active)
       VALUES (?, 'recorded', ?, ?, ?, 1)`,
      [req.user.id, title, message || '', audioUrl]
    );
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({
      id: result.insertId,
      title,
      message: message || '',
      audio_url: audioUrl ? `${baseUrl}/uploads/${audioUrl}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/announcements/scheduled — create a scheduled announcement ───────
// Body: { title, message, scheduled_at:"HH:MM", audio_url?(optional filename) }
router.post('/scheduled', authMiddleware, upload.single('audio'), async (req, res) => {
  try {
    const { title, message, scheduled_at } = req.body;
    if (!title || !scheduled_at) {
      return res.status(400).json({ error: 'title and scheduled_at are required' });
    }
    const audioUrl = req.file ? req.file.filename : (req.body.audio_url || null);
    const [result] = await db.query(
      `INSERT INTO announcements (user_id, type, title, message, audio_url, scheduled_at, is_active)
       VALUES (?, 'scheduled', ?, ?, ?, ?, 0)`,
      [req.user.id, title, message || '', audioUrl, scheduled_at]
    );
    res.json({ id: result.insertId, message: 'Scheduled announcement saved' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/announcements/:id — delete an announcement ───────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM announcements WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });

    if (rows[0].audio_url && !rows[0].audio_url.startsWith('http')) {
      const filePath = path.join(uploadsDir, rows[0].audio_url);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    await db.query('DELETE FROM announcements WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/announcements/:id/deactivate — user app marks as seen ──────────
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

module.exports = router;
