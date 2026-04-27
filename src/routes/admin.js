const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db');
const { adminMiddleware } = require('../middleware/auth');

// GET all devices
router.get('/devices', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT d.*, u.username
      FROM devices d
      LEFT JOIN users u ON d.user_id = u.id
      ORDER BY d.last_seen DESC
    `);
    const now = Date.now();
    const devices = rows.map(d => ({
      ...d,
      status: d.last_seen && (now - new Date(d.last_seen).getTime()) < 10 * 60 * 1000 ? 'online' : 'offline'
    }));
    res.json(devices);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET dashboard stats
router.get('/stats', adminMiddleware, async (req, res) => {
  try {
    const [[{ total_devices }]]  = await db.query("SELECT COUNT(*) as total_devices FROM devices");
    const [[{ total_users }]]    = await db.query("SELECT COUNT(*) as total_users FROM users WHERE role='user'");
    const [[{ total_sounds }]]   = await db.query("SELECT COUNT(*) as total_sounds FROM sounds");
    const [[{ online_devices }]] = await db.query(
      "SELECT COUNT(*) as online_devices FROM devices WHERE last_seen > DATE_SUB(NOW(), INTERVAL 10 MINUTE)"
    );
    res.json({ total_devices, total_users, online_devices, total_sounds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all users
router.get('/users', adminMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, role, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create user
router.post('/users', adminMiddleware, async (req, res) => {
  const { username, password, role } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?,?,?)",
      [username, hash, role || 'user']
    );
    res.json({ id: result.insertId, message: 'User created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: err.message });
  }
});

// PUT update user
router.put('/users/:id', adminMiddleware, async (req, res) => {
  const { role, password } = req.body;
  try {
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await db.query('UPDATE users SET role=?, password_hash=? WHERE id=?', [role, hash, req.params.id]);
    } else {
      await db.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
    }
    res.json({ message: 'User updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE user
router.delete('/users/:id', adminMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ message: 'User deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
