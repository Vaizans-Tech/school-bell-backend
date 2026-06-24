require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const cron = require('node-cron');
const jwt = require('jsonwebtoken');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const db = require('./db');

const app = express();
const server = http.createServer(app);

app.set('trust proxy', 1);

// ── Uploads dir ───────────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, '..', process.env.UPLOAD_DIR || 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

// ── Swagger ───────────────────────────────────────────────────────────────────
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ── REST Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/device',        require('./routes/device'));
app.use('/api/schedules',     require('./routes/schedules'));
app.use('/api/sounds',        require('./routes/sounds'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/azan',          require('./routes/azan'));

app.get('/', (req, res) => res.json({ status: 'School Bell Server Running', version: '1.0.0', docs: '/api-docs' }));

// ── WebSocket — Live Announcement ─────────────────────────────────────────────
// Controller connects as sender: ws://.../ws/announce?token=JWT&role=controller
// User App connects as receiver: ws://.../ws/announce?token=JWT&role=user
const wss = new WebSocketServer({ server, path: '/ws/announce' });

// Map: userId -> Set of receiver WebSockets
const receivers = new Map();
// Map: userId -> sender WebSocket
const senders = new Map();

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const token = params.get('token');
  const role = params.get('role'); // 'controller' | 'user'

  let userId = null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'school_bell_secret_2024');
    userId = payload.id;
  } catch {
    ws.close(4001, 'Unauthorized');
    return;
  }

  if (role === 'controller') {
    senders.set(userId, ws);

    ws.on('message', (data) => {
      // Forward raw PCM/audio chunks to all receivers for this user
      const userReceivers = receivers.get(userId);
      if (userReceivers) {
        userReceivers.forEach(rws => {
          if (rws.readyState === rws.OPEN) rws.send(data);
        });
      }
    });

    ws.on('close', () => {
      senders.delete(userId);
      // Notify receivers that live stream ended
      const userReceivers = receivers.get(userId);
      if (userReceivers) {
        const msg = JSON.stringify({ type: 'live_end' });
        userReceivers.forEach(rws => {
          if (rws.readyState === rws.OPEN) rws.send(msg);
        });
      }
    });

  } else {
    // User App receiver
    if (!receivers.has(userId)) receivers.set(userId, new Set());
    receivers.get(userId).add(ws);

    // Send live_start if controller is already connected
    if (senders.has(userId)) {
      ws.send(JSON.stringify({ type: 'live_start' }));
    }

    ws.on('close', () => {
      const set = receivers.get(userId);
      if (set) { set.delete(ws); if (set.size === 0) receivers.delete(userId); }
    });
  }
});

const { isDayEnabled } = require('./lib/announcementHelpers');

// ── Cron — announcements (weekly repeat + calendar onetime) ─────────────────
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const today = now.toISOString().slice(0, 10);
  const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  try {
    // 1) Weekly repeat — type=scheduled + days bitmask (আগের system)
    const [weekly] = await db.query(
      `SELECT * FROM announcements
       WHERE type = 'scheduled' AND is_active = 0
       AND hour = ? AND minute = ?`,
      [hh, mm]
    );
    const weeklyDue = weekly.filter(r => isDayEnabled(r.days, now));

    for (const row of weeklyDue) {
      await db.query('UPDATE announcements SET is_active = 1 WHERE id = ?', [row.id]);
      notifyReceivers(row);
    }

    // 2) Calendar one-time — type=onetime + specific dates (নতুন feature)
    const [calendar] = await db.query(
      `SELECT ad.id AS date_row_id, ad.play_date, a.*
       FROM announcement_dates ad
       INNER JOIN announcements a ON a.id = ad.announcement_id
       WHERE ad.play_date = ? AND ad.fired = 0
         AND a.type = 'onetime'
         AND a.hour = ? AND a.minute = ?`,
      [today, hh, mm]
    );

    for (const row of calendar) {
      await db.query(
        'UPDATE announcement_dates SET fired = 1, fired_at = NOW() WHERE id = ?',
        [row.date_row_id]
      );
      await db.query('UPDATE announcements SET is_active = 1 WHERE id = ?', [row.id]);
      notifyReceivers(row, String(row.play_date).slice(0, 10));
    }

    // Legacy rows: scheduled_at only (no hour/minute/days columns yet)
    const [legacy] = await db.query(
      `SELECT * FROM announcements
       WHERE type = 'scheduled' AND is_active = 0
       AND hour IS NULL AND scheduled_at IS NOT NULL
       AND TIME_FORMAT(scheduled_at, '%H:%i') = ?`,
      [timeStr]
    );
    for (const row of legacy) {
      await db.query('UPDATE announcements SET is_active = 1 WHERE id = ?', [row.id]);
      notifyReceivers(row);
    }
  } catch (err) {
    console.error('Cron announcement error:', err.message);
  }

  function notifyReceivers(row, playDate = null) {
    const userReceivers = receivers.get(row.user_id);
    if (!userReceivers) return;
    const msg = JSON.stringify({
      type: 'new_announcement',
      id: row.id,
      title: row.title,
      ...(playDate ? { play_date: playDate } : {}),
    });
    userReceivers.forEach(rws => {
      if (rws.readyState === rws.OPEN) rws.send(msg);
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebSocket live: ws://localhost:${PORT}/ws/announce`);
});
