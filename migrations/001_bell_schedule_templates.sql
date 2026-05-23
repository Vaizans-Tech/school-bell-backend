-- Run once on existing production DB (phpMyAdmin / mysql CLI)
USE shikkhasomoy_schoolbell;

CREATE TABLE IF NOT EXISTS bell_schedule_templates (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  label        VARCHAR(200) NOT NULL,
  hour         INT NOT NULL,
  minute       INT NOT NULL,
  days         INT DEFAULT 62,
  sound_file   VARCHAR(200) DEFAULT 'default_bell.mp3',
  is_enabled   TINYINT DEFAULT 1,
  routine_type VARCHAR(50) DEFAULT 'SCHOOL',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
