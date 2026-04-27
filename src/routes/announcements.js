const router = require('express').Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET latest announcement (no school filter — admin manages all)
router.get('/latest', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM announcements WHERE is_active=1 ORDER BY created_at DESC LIMIT 1'
    );
    res.json(rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET announcements for devices (no school filter — admin manages all)
router.get('/', authMiddleware, async (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  try {
    const [rows] = await db.query(
      'SELECT * FROM announcements WHERE is_active=1 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all announcements — admin can pass ?school=Name
router.get('/admin/all', adminMiddleware, async (req, res) => {
  try {
    const schoolName = req.query.school || req.user.school_name || '';
    const [rows] = await db.query(
      'SELECT * FROM announcements WHERE school_name=? ORDER BY created_at DESC',
      [schoolName]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create announcement — body may include school_name override
router.post('/', adminMiddleware, async (req, res) => {
  const { title, message, audio_url, priority, school_name } = req.body;
  const schoolName = school_name || req.user.school_name || '';
  try {
    const [result] = await db.query(
      'INSERT INTO announcements (school_name, title, message, audio_url, priority, is_active) VALUES (?,?,?,?,?,1)',
      [schoolName, title, message || '', audio_url || null, priority || 0]
    );
    res.json({ id: result.insertId, message: 'Announcement created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE announcement
router.delete('/:id', adminMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
