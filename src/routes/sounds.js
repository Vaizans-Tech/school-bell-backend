const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

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

// GET /api/sounds/version — device sync: returns all bell sounds
router.get('/version', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM sounds WHERE type='bell' ORDER BY created_at DESC"
    );
    const version = rows.length > 0 ? Math.max(...rows.map(r => r.id)) : 0;
    const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
    res.json({
      version,
      files: rows.map(r => ({
        name: r.filename,
        url: baseUrl + r.filename,
        checksum: r.checksum || '',
        size_bytes: r.size_bytes || 0
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sounds?type=bell|azan
// Returns admin-uploaded sounds (user_id IS NULL) + this user's own uploads
router.get('/', authMiddleware, async (req, res) => {
  try {
    const type = req.query.type || 'bell';
    const userId = req.user.id;
    const [rows] = await db.query(
      'SELECT * FROM sounds WHERE type=? AND (user_id IS NULL OR user_id=?) ORDER BY created_at DESC',
      [type, userId]
    );
    const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
    res.json(rows.map(r => ({
      id: r.id,
      name: r.original_name,
      filename: r.filename,
      url: baseUrl + r.filename,
      size_bytes: r.size_bytes || 0,
      type: r.type,
      created_at: r.created_at
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sounds/upload — any authenticated user
// Admin uploads: user_id NULL (visible to all)
// Controller uploads: user_id set (visible only to that user's devices)
router.post('/upload', authMiddleware, upload.single('sound'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const type = req.body.type || req.query.type || 'bell';
  if (!['bell', 'azan'].includes(type)) {
    return res.status(400).json({ error: 'type must be bell or azan' });
  }
  try {
    const { originalname, filename, size } = req.file;
    const userId = req.user.role === 'admin' ? null : req.user.id;
    await db.query(
      'INSERT INTO sounds (original_name, filename, size_bytes, type, user_id) VALUES (?,?,?,?,?)',
      [originalname, filename, size, type, userId]
    );
    const baseUrl = `${req.protocol}://${req.get('host')}/uploads/`;
    res.json({ message: 'Sound uploaded', filename, url: baseUrl + filename, type });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const [rows] = await db.query('SELECT filename FROM sounds WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const filepath = path.join(uploadsDir, rows[0].filename);
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    await db.query('DELETE FROM sounds WHERE id=?', [req.params.id]);
    res.json({ message: 'Sound deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
