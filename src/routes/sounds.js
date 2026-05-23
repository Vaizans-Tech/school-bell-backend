const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const SOUND_TYPES = ['bell', 'azan'];
const uploadsDir = path.join(__dirname, '..', '..', process.env.UPLOAD_DIR || 'uploads');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.mp3', '.wav', '.ogg'];
    cb(null, allowed.includes(path.extname(file.originalname).toLowerCase()));
  },
  limits: { fileSize: 20 * 1024 * 1024 }
});

function parseType(value, fallback = null) {
  const type = (value || fallback || '').toLowerCase();
  return SOUND_TYPES.includes(type) ? type : null;
}

function uploadsBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}/uploads/`;
}

function mapSoundRows(rows, baseUrl) {
  return rows.map(r => ({
    id: r.id,
    name: r.original_name,
    filename: r.filename,
    url: baseUrl + r.filename,
    size_bytes: r.size_bytes || 0,
    type: r.type,
    created_at: r.created_at
  }));
}

async function listSounds(req, res, type) {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const [rows] = isAdmin
      ? await db.query(
          'SELECT * FROM sounds WHERE type=? ORDER BY created_at DESC',
          [type]
        )
      : await db.query(
          'SELECT * FROM sounds WHERE type=? AND (user_id IS NULL OR user_id=?) ORDER BY created_at DESC',
          [type, userId]
        );
    res.json(mapSoundRows(rows, uploadsBaseUrl(req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function soundVersion(req, res, type) {
  try {
    const userId = req.user.id;
    const isAdmin = req.user.role === 'admin';
    const [rows] = isAdmin
      ? await db.query('SELECT * FROM sounds WHERE type=? ORDER BY created_at DESC', [type])
      : await db.query(
          'SELECT * FROM sounds WHERE type=? AND (user_id IS NULL OR user_id=?) ORDER BY created_at DESC',
          [type, userId]
        );
    const version = rows.length > 0 ? Math.max(...rows.map(r => r.id)) : 0;
    const baseUrl = uploadsBaseUrl(req);
    res.json({
      type,
      version,
      files: rows.map(r => ({
        name: r.filename,
        url: baseUrl + r.filename,
        checksum: r.checksum || '',
        size_bytes: r.size_bytes || 0,
        type: r.type
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function uploadSound(req, res, type) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const { originalname, filename, size } = req.file;
    const userId = req.user.role === 'admin' ? null : req.user.id;
    await db.query(
      'INSERT INTO sounds (original_name, filename, size_bytes, type, user_id) VALUES (?,?,?,?,?)',
      [originalname, filename, size, type, userId]
    );
    const baseUrl = uploadsBaseUrl(req);
    res.json({
      message: `${type} sound uploaded`,
      filename,
      url: baseUrl + filename,
      type
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// ── Bell (school alarm) ───────────────────────────────────────────────────────
router.get('/bell/version', authMiddleware, (req, res) => soundVersion(req, res, 'bell'));
router.get('/bell', authMiddleware, (req, res) => listSounds(req, res, 'bell'));
router.post('/bell/upload', authMiddleware, upload.single('sound'), (req, res) => uploadSound(req, res, 'bell'));

// ── Azan (prayer audio) ───────────────────────────────────────────────────────
router.get('/azan/version', authMiddleware, (req, res) => soundVersion(req, res, 'azan'));
router.get('/azan', authMiddleware, (req, res) => listSounds(req, res, 'azan'));
router.post('/azan/upload', authMiddleware, upload.single('sound'), (req, res) => uploadSound(req, res, 'azan'));

// ── Legacy / generic (type query or body) ─────────────────────────────────────
router.get('/version', authMiddleware, (req, res) => {
  const type = parseType(req.query.type, 'bell');
  if (!type) return res.status(400).json({ error: 'type must be bell or azan' });
  return soundVersion(req, res, type);
});

router.get('/', authMiddleware, (req, res) => {
  const type = parseType(req.query.type);
  if (!type) {
    return res.status(400).json({
      error: 'type query required',
      hint: 'Use ?type=bell or ?type=azan, or GET /api/sounds/bell | /api/sounds/azan'
    });
  }
  return listSounds(req, res, type);
});

router.post('/upload', authMiddleware, upload.single('sound'), (req, res) => {
  const type = parseType(req.body.type || req.query.type, 'bell');
  if (!type) return res.status(400).json({ error: 'type must be bell or azan' });
  return uploadSound(req, res, type);
});

// PUT /api/sounds/:id — admin only, rename display name
router.put('/:id', adminMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    await db.query('UPDATE sounds SET original_name=? WHERE id=?', [name, req.params.id]);
    res.json({ message: 'Sound updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/sounds/:id — admin only
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT filename, type FROM sounds WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const filepath = path.join(uploadsDir, rows[0].filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    await db.query('DELETE FROM sounds WHERE id=?', [req.params.id]);
    res.json({ message: `${rows[0].type} sound deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
