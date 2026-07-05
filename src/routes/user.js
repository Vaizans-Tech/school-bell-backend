const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

function withDeviceStatus(rows) {
  const now = Date.now();
  return rows.map(d => ({
    ...d,
    status: d.last_seen && (now - new Date(d.last_seen).getTime()) < 10 * 60 * 1000 ? 'online' : 'offline',
  }));
}

// GET /api/user/:userId — admin: any user; user: own profile only
router.get('/:userId', authMiddleware, async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return res.status(400).json({ error: 'Invalid user id' });
  }

  if (req.user.role !== 'admin' && req.user.id !== userId) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const [users] = await db.query(
      'SELECT id, username, role, school_name, created_at FROM users WHERE id=?',
      [userId]
    );
    if (!users.length) return res.status(404).json({ error: 'User not found' });

    const [devices] = await db.query(
      `SELECT id, device_id, user_id, battery_level, battery_charging, status, last_seen, created_at
       FROM devices WHERE user_id=? ORDER BY last_seen DESC`,
      [userId]
    );

    res.json({ ...users[0], devices: withDeviceStatus(devices) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
