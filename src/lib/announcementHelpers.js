const { getPublicBaseUrl } = require('./publicUrl');

/** Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32, Sun=64 (same as schedules.days) */
function todayDayBit(date = new Date()) {
  const jsDay = date.getDay(); // 0=Sun .. 6=Sat
  const bitIndex = jsDay === 0 ? 6 : jsDay - 1;
  return 1 << bitIndex;
}

function isDayEnabled(daysMask, date = new Date()) {
  const mask = daysMask == null ? 127 : parseInt(daysMask, 10);
  return (mask & todayDayBit(date)) !== 0;
}

function parseIntField(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : n;
}

function parseBoolField(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1' || value === 1) return 1;
  if (value === false || value === 'false' || value === '0' || value === 0) return 0;
  return fallback;
}

function formatScheduledAt(hour, minute) {
  if (hour == null || minute == null) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
}

function formatScheduledAtDisplay(row) {
  if (row.hour != null && row.minute != null) {
    return `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`;
  }
  if (!row.scheduled_at) return null;
  const t = String(row.scheduled_at);
  return t.length >= 5 ? t.slice(0, 5) : t;
}

function resolveHourMinute(body, existing = null) {
  const hour = parseIntField(body.hour, existing?.hour ?? null);
  const minute = parseIntField(body.minute, existing?.minute ?? null);
  if (hour != null && minute != null) {
    return { hour, minute, scheduled_at: formatScheduledAt(hour, minute) };
  }
  if (body.scheduled_at) {
    const parts = String(body.scheduled_at).split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1], 10);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      return { hour: h, minute: m, scheduled_at: formatScheduledAt(h, m) };
    }
  }
  if (existing?.scheduled_at) {
    return {
      hour: existing.hour ?? null,
      minute: existing.minute ?? null,
      scheduled_at: existing.scheduled_at,
    };
  }
  return { hour: null, minute: null, scheduled_at: null };
}

function mapAnnouncement(row, req) {
  const baseUrl = getPublicBaseUrl(req);
  const audioFilename = row.audio_url && !String(row.audio_url).startsWith('http')
    ? row.audio_url
    : null;

  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    message: row.message || '',
    type: row.type,
    audio_url: row.audio_url
      ? (String(row.audio_url).startsWith('http') ? row.audio_url : `${baseUrl}/uploads/${row.audio_url}`)
      : null,
    hour: row.hour != null ? row.hour : null,
    minute: row.minute != null ? row.minute : null,
    days: row.days != null ? row.days : 62,
    scheduled_at: formatScheduledAtDisplay(row),
    is_active: row.is_active ? 1 : 0,
    priority: row.priority || 0,
    created_at: row.created_at,
    ...(audioFilename ? { audio_filename: audioFilename } : {}),
  };
}

function validateAudioFile(file) {
  if (!file) return null;
  if (!file.size || file.size <= 0) {
    return 'Audio file is empty (0 bytes)';
  }
  return null;
}

module.exports = {
  todayDayBit,
  isDayEnabled,
  parseIntField,
  parseBoolField,
  resolveHourMinute,
  mapAnnouncement,
  validateAudioFile,
  formatScheduledAt,
};
