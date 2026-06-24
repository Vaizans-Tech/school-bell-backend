-- Run once on production DB: shikkhasomoy_schoolbell
USE shikkhasomoy_schoolbell;

ALTER TABLE announcements
  ADD COLUMN hour TINYINT NULL AFTER scheduled_at,
  ADD COLUMN minute TINYINT NULL AFTER hour,
  ADD COLUMN days INT DEFAULT 62 AFTER minute;

-- Backfill from existing scheduled_at
UPDATE announcements
SET
  hour = HOUR(scheduled_at),
  minute = MINUTE(scheduled_at),
  days = COALESCE(days, 62)
WHERE scheduled_at IS NOT NULL AND hour IS NULL;
