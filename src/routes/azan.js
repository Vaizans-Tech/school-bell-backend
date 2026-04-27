const router = require('express').Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// GET /api/azan/version — lightweight change-detection token
router.get('/version', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const [rows] = await db.query(
      `SELECT COUNT(*) AS cnt,
       UNIX_TIMESTAMP(COALESCE(MAX(updated_at), MAX(created_at), NOW())) AS ts,
       COALESCE(SUM(hour * 60 + minute), 0) AS time_sum,
       COALESCE(SUM(is_enabled), 0) AS enabled_sum,
       COALESCE(GROUP_CONCAT(sound_file ORDER BY prayer_name SEPARATOR ','), '') AS sounds
       FROM azan_times WHERE user_id = ? AND date = ?`,
      [userId, today]
    );
    const r = rows[0];
    const hash = `${r.cnt}_${r.ts}_${r.time_sum}_${r.enabled_sum}_${Buffer.from(r.sounds || '').toString('base64').slice(0,8)}`;
    res.json({ version: hash });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/azan?date=YYYY-MM-DD
// Returns azan times for logged-in user for the given date (default: today)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const [rows] = await db.query(
      `SELECT prayer_name, hour, minute, is_enabled, sound_file, date
       FROM azan_times WHERE user_id = ? AND date = ?
       ORDER BY FIELD(prayer_name,'Fajr','Dhuhr','Asr','Maghrib','Isha')`,
      [userId, date]
    );
    res.json(rows.map(r => ({
      prayer_name: r.prayer_name,
      hour: r.hour,
      minute: r.minute,
      is_enabled: !!r.is_enabled,
      sound_file: r.sound_file || 'azan.mp3',
      date
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/azan/range?from=YYYY-MM-DD&to=YYYY-MM-DD
// Returns 30-day range of azan times for logged-in user
router.get('/range', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const from = req.query.from || new Date().toISOString().slice(0, 10);
    const toCal = new Date();
    toCal.setDate(toCal.getDate() + 29);
    const to = req.query.to || toCal.toISOString().slice(0, 10);
    const [rows] = await db.query(
      `SELECT prayer_name, hour, minute, is_enabled, sound_file, date
       FROM azan_times
       WHERE user_id = ? AND date BETWEEN ? AND ?
       ORDER BY date, FIELD(prayer_name,'Fajr','Dhuhr','Asr','Maghrib','Isha')`,
      [userId, from, to]
    );
    res.json(rows.map(r => ({
      prayer_name: r.prayer_name,
      hour: r.hour,
      minute: r.minute,
      is_enabled: !!r.is_enabled,
      sound_file: r.sound_file || 'azan.mp3',
      date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date).slice(0, 10)
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/azan/:prayer_name  (controller app)
// Update a single prayer time + sound for the logged-in user (applies to today and future)
router.put('/:prayer_name', authMiddleware, async (req, res) => {
  const { hour, minute, is_enabled, sound_file, apply_days } = req.body;
  const userId = req.user.id;
  const prayerName = req.params.prayer_name;
  const validPrayers = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  if (!validPrayers.includes(prayerName)) {
    return res.status(400).json({ error: 'Invalid prayer name' });
  }
  if (hour == null || minute == null) {
    return res.status(400).json({ error: 'hour and minute required' });
  }

  try {
    const today = new Date().toISOString().slice(0, 10);
    const days = apply_days || 30;

    // Update all future dates for this user + prayer
    await db.query(
      `UPDATE azan_times SET hour=?, minute=?, is_enabled=?, sound_file=?
       WHERE user_id=? AND prayer_name=? AND date >= ?`,
      [hour, minute, is_enabled ?? 1, sound_file || 'azan.mp3', userId, prayerName, today]
    );

    // If no rows existed yet, insert for next 30 days
    const [existing] = await db.query(
      'SELECT COUNT(*) as cnt FROM azan_times WHERE user_id=? AND prayer_name=? AND date >= ?',
      [userId, prayerName, today]
    );

    if (existing[0].cnt === 0) {
      const inserts = [];
      for (let i = 0; i < days; i++) {
        const d = new Date();
        d.setDate(d.getDate() + i);
        inserts.push([userId, prayerName, hour, minute, d.toISOString().slice(0, 10), is_enabled ?? 1, sound_file || 'azan.mp3']);
      }
      if (inserts.length > 0) {
        await db.query(
          `INSERT INTO azan_times (user_id, prayer_name, hour, minute, date, is_enabled, sound_file) VALUES ?
           ON DUPLICATE KEY UPDATE hour=VALUES(hour), minute=VALUES(minute), is_enabled=VALUES(is_enabled), sound_file=VALUES(sound_file)`,
          [inserts]
        );
      }
    }

    res.json({ message: `${prayerName} updated` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/azan/bulk  (controller app)
// Upsert all 5 prayers for a date for logged-in user
router.post('/bulk', authMiddleware, async (req, res) => {
  const { date, times } = req.body;
  const userId = req.user.id;
  if (!date || !Array.isArray(times) || times.length === 0) {
    return res.status(400).json({ error: 'date and times[] required' });
  }
  try {
    for (const t of times) {
      await db.query(
        `INSERT INTO azan_times (user_id, prayer_name, hour, minute, date, is_enabled, sound_file)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE hour=VALUES(hour), minute=VALUES(minute),
           is_enabled=VALUES(is_enabled), sound_file=VALUES(sound_file)`,
        [userId, t.prayer_name, t.hour, t.minute, date, t.is_enabled ?? 1, t.sound_file || 'azan.mp3']
      );
    }
    res.json({ message: `${times.length} azan times saved for ${date}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/azan?date=YYYY-MM-DD  (controller app — own data only)
router.delete('/', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const date = req.query.date;
  if (!date) return res.status(400).json({ error: 'date query param required' });
  try {
    await db.query('DELETE FROM azan_times WHERE user_id=? AND date=?', [userId, date]);
    res.json({ message: `Azan times deleted for ${date}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
