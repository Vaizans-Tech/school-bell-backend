const router = require('express').Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Heartbeat from Android device
router.post('/heartbeat', authMiddleware, async (req, res) => {
  const { device_id, battery_level, battery_charging } = req.body;
  if (!device_id) return res.status(400).json({ error: 'device_id required' });
  try {
    await db.query(
      `INSERT INTO devices (device_id, user_id, battery_level, battery_charging, status, last_seen)
       VALUES (?, ?, ?, ?, 'online', NOW())
       ON DUPLICATE KEY UPDATE
         user_id=VALUES(user_id),
         battery_level=VALUES(battery_level),
         battery_charging=VALUES(battery_charging),
         status='online',
         last_seen=NOW()`,
      [device_id, req.user.id, battery_level ?? 100, battery_charging ? 1 : 0]
    );
    res.json({ success: true, message: 'Heartbeat received' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
