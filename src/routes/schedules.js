const router = require('express').Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

function mapTemplate(r) {
  return {
    id: r.id,
    label: r.label,
    hour: r.hour,
    minute: r.minute,
    days: r.days,
    sound_file: r.sound_file,
    is_enabled: !!r.is_enabled,
    routine_type: r.routine_type,
  };
}

// GET /api/schedules/version — lightweight change-detection: returns count + max updated_at
// User App polls this every minute to decide if a full refresh is needed
router.get('/version', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      'SELECT COUNT(*) AS cnt, UNIX_TIMESTAMP(COALESCE(MAX(updated_at), MAX(created_at), NOW())) AS ts FROM schedules WHERE user_id = ?',
      [userId]
    );
    // version token: changes on insert, delete (count), or update (ts)
    const version = `${rows[0].cnt}_${rows[0].ts}`;
    res.json({ version });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET schedules for the logged-in user (user app + controller app)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      'SELECT * FROM schedules WHERE user_id = ? AND is_enabled = 1 ORDER BY hour, minute',
      [userId]
    );
    res.json(rows.map(r => ({
      id: r.id, label: r.label, hour: r.hour, minute: r.minute,
      days: r.days, sound_file: r.sound_file, is_enabled: !!r.is_enabled,
      routine_type: r.routine_type
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all schedules for logged-in user (controller app — includes disabled)
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.query(
      'SELECT * FROM schedules WHERE user_id = ? ORDER BY hour, minute',
      [userId]
    );
    res.json(rows.map(r => ({
      id: r.id, label: r.label, hour: r.hour, minute: r.minute,
      days: r.days, sound_file: r.sound_file, is_enabled: !!r.is_enabled,
      routine_type: r.routine_type
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Default bell schedule templates (admin CRUD, app users read / import) ─────

router.get('/templates', authMiddleware, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM bell_schedule_templates ORDER BY hour, minute'
    );
    res.json(rows.map(mapTemplate));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/templates', adminMiddleware, async (req, res) => {
  const { label, hour, minute, days, sound_file, is_enabled, routine_type } = req.body;
  if (!label || hour == null || minute == null) {
    return res.status(400).json({ error: 'label, hour, minute required' });
  }
  try {
    const [result] = await db.query(
      `INSERT INTO bell_schedule_templates (label, hour, minute, days, sound_file, is_enabled, routine_type)
       VALUES (?,?,?,?,?,?,?)`,
      [label, hour, minute, days ?? 62, sound_file || 'default_bell.mp3', is_enabled ?? 1, routine_type || 'SCHOOL']
    );
    res.json({ id: result.insertId, message: 'Template created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/templates/:id', adminMiddleware, async (req, res) => {
  const { label, hour, minute, days, sound_file, is_enabled, routine_type } = req.body;
  try {
    await db.query(
      `UPDATE bell_schedule_templates
       SET label=?, hour=?, minute=?, days=?, sound_file=?, is_enabled=?, routine_type=?
       WHERE id=?`,
      [label, hour, minute, days, sound_file, is_enabled ? 1 : 0, routine_type, req.params.id]
    );
    res.json({ message: 'Template updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/templates/:id', adminMiddleware, async (req, res) => {
  try {
    await db.query('DELETE FROM bell_schedule_templates WHERE id=?', [req.params.id]);
    res.json({ message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Copy enabled templates into the logged-in user's schedules (mobile app)
router.post('/import-templates', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const [templates] = await db.query(
      'SELECT * FROM bell_schedule_templates WHERE is_enabled = 1 ORDER BY hour, minute'
    );
    let imported = 0;
    for (const t of templates) {
      const [existing] = await db.query(
        'SELECT id FROM schedules WHERE user_id=? AND label=? AND hour=? AND minute=?',
        [userId, t.label, t.hour, t.minute]
      );
      if (existing.length) continue;
      await db.query(
        `INSERT INTO schedules (user_id, label, hour, minute, days, sound_file, is_enabled, routine_type)
         VALUES (?,?,?,?,?,?,?,?)`,
        [userId, t.label, t.hour, t.minute, t.days, t.sound_file, t.is_enabled, t.routine_type]
      );
      imported++;
    }
    res.json({ message: `${imported} schedule(s) imported`, imported, total: templates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET all schedules — admin view (all users, optional ?user_id= filter)
router.get('/admin/all', adminMiddleware, async (req, res) => {
  try {
    const userId = req.query.user_id;
    const [rows] = userId
      ? await db.query('SELECT s.*, u.username FROM schedules s JOIN users u ON s.user_id=u.id WHERE s.user_id=? ORDER BY s.hour, s.minute', [userId])
      : await db.query('SELECT s.*, u.username FROM schedules s JOIN users u ON s.user_id=u.id ORDER BY s.hour, s.minute');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST create schedule — controller app only (own user_id)
router.post('/', authMiddleware, async (req, res) => {
  const { label, hour, minute, days, sound_file, is_enabled, routine_type } = req.body;
  const userId = req.user.id;
  if (!label || hour == null || minute == null) {
    return res.status(400).json({ error: 'label, hour, minute required' });
  }
  try {
    const [result] = await db.query(
      'INSERT INTO schedules (user_id, label, hour, minute, days, sound_file, is_enabled, routine_type) VALUES (?,?,?,?,?,?,?,?)',
      [userId, label, hour, minute, days ?? 62, sound_file || 'default_bell.mp3', is_enabled ?? 1, routine_type || 'SCHOOL']
    );
    res.json({ id: result.insertId, message: 'Schedule created' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT update schedule — only own schedule
router.put('/:id', authMiddleware, async (req, res) => {
  const { label, hour, minute, days, sound_file, is_enabled, routine_type } = req.body;
  const userId = req.user.id;
  try {
    const [rows] = await db.query('SELECT user_id FROM schedules WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your schedule' });
    }
    await db.query(
      'UPDATE schedules SET label=?, hour=?, minute=?, days=?, sound_file=?, is_enabled=?, routine_type=? WHERE id=?',
      [label, hour, minute, days, sound_file, is_enabled ? 1 : 0, routine_type, req.params.id]
    );
    res.json({ message: 'Schedule updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE schedule — only own schedule
router.delete('/:id', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  try {
    const [rows] = await db.query('SELECT user_id FROM schedules WHERE id=?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    if (rows[0].user_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Not your schedule' });
    }
    await db.query('DELETE FROM schedules WHERE id=?', [req.params.id]);
    res.json({ message: 'Schedule deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
