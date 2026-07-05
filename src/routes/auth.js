const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');

// Device login
router.post('/login', async (req, res) => {
  const { username, password, device_id } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing credentials' });

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    // Update device record if device_id provided (User App login)
    if (device_id) {
      await db.query(
        `INSERT INTO devices (device_id, user_id, last_seen, status)
         VALUES (?, ?, NOW(), 'online')
         ON DUPLICATE KEY UPDATE user_id=?, last_seen=NOW(), status='online'`,
        [device_id, user.id, user.id]
      );
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({ token, id: user.id, username: user.username, role: user.role, message: 'Login successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET available users list (no auth — used by app register screen to show existing usernames)
router.get('/users/list', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT username FROM users WHERE role='user' ORDER BY username");
    res.json(rows.map(r => r.username));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// User registration — creates a new 'user' role account
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE username = ?', [username]);
    if (existing.length > 0) return res.status(409).json({ error: 'Username already taken' });

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      "INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'user')",
      [username, hash]
    );

    const token = jwt.sign(
      { id: result.insertId, username, role: 'user' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(201).json({ token, id: result.insertId, username, role: 'user', message: 'Registration successful' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin login
router.post('/admin/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query("SELECT * FROM users WHERE username = ? AND role = 'admin'", [username]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({ token, id: user.id, username: user.username, role: user.role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
