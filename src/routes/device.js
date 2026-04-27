const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Heartbeat from Android device
router.post('/heartbeat', authMiddleware, async (req, res) => {
  const { device_id, battery_level, battery_charging, status, school_name } = req.body;
  try {
    await db.query(
      `INSERT INTO devices (device_id, user_id, school_name, battery_level, battery_charging, status, last_seen)
       VALUES (?, ?, ?, ?, ?, 'online', NOW())
       ON DUPLICATE KEY UPDATE
         battery_level=VALUES(battery_level),
         battery_charging=VALUES(battery_charging),
         school_name=VALUES(school_name),
         status='online',
         last_seen=NOW()`,
      [device_id, req.user.id, school_name || req.user.school_name, battery_level || 100, battery_charging ? 1 : 0]
    );
    res.json({ success: true, message: 'Heartbeat received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
