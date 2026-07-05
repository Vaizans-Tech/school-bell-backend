require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const cron = require('node-cron');
const swaggerUi = require('swagger-ui-express');
const swaggerSpec = require('./swagger');
const db = require('./db');
const { attachAnnouncementWebSocket, notifyUserReceivers } = require('./ws/announcements');

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
app.use('/api/user',          require('./routes/user'));
app.use('/api/device',        require('./routes/device'));
app.use('/api/schedules',     require('./routes/schedules'));
app.use('/api/sounds',        require('./routes/sounds'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/azan',          require('./routes/azan'));
app.use('/api/live',          require('./routes/live'));

app.get('/', (req, res) => res.json({
  status: 'School Bell Server Running',
  version: '2.0.0',
  docs: '/api-docs',
  live: 'WebRTC signaling at /api/live/* — audio is peer-to-peer, not relayed',
}));

// ── WebSocket — scheduled announcement push only (no live audio relay) ─────────
attachAnnouncementWebSocket(server);

const { isDayEnabled } = require('./lib/announcementHelpers');

// ── Cron — announcements (weekly repeat + calendar onetime) ─────────────────
cron.schedule('* * * * *', async () => {
  const now = new Date();
  const hh = now.getHours();
  const mm = now.getMinutes();
  const today = now.toISOString().slice(0, 10);
  const timeStr = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;

  try {
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
    const msg = {
      type: 'new_announcement',
      id: row.id,
      title: row.title,
      ...(playDate ? { play_date: playDate } : {}),
    };
    notifyUserReceivers(row.user_id, msg);
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const HOST = process.env.HOST || '0.0.0.0';
server.listen(PORT, HOST, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`WebRTC live signaling: http://localhost:${PORT}/api/live/*`);
  console.log(`WebSocket notify: ws://localhost:${PORT}/ws/announce?role=user|controller`);
});
