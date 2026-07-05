CREATE DATABASE IF NOT EXISTS shikkhasomoy_schoolbell CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shikkhasomoy_schoolbell;

-- Users (admin + regular users)
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          ENUM('admin','user') DEFAULT 'user',
  school_name   VARCHAR(200) NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Devices (User App devices — one per user)
CREATE TABLE IF NOT EXISTS devices (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  device_id        VARCHAR(200) NOT NULL UNIQUE,
  user_id          INT,
  battery_level    INT DEFAULT 100,
  battery_charging TINYINT DEFAULT 0,
  status           ENUM('online','offline') DEFAULT 'offline',
  last_seen        DATETIME,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Default bell schedules (admin-managed templates — app users import via API)
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

-- Bell Schedules (user-isolated — copied from templates or created in app)
CREATE TABLE IF NOT EXISTS schedules (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  label        VARCHAR(200) NOT NULL,
  hour         INT NOT NULL,
  minute       INT NOT NULL,
  days         INT DEFAULT 62,
  sound_file   VARCHAR(200) DEFAULT 'default_bell.mp3',
  is_enabled   TINYINT DEFAULT 1,
  routine_type VARCHAR(50) DEFAULT 'SCHOOL',
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sounds (admin uploads — bell and azan, shared gallery for all users)
CREATE TABLE IF NOT EXISTS sounds (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  original_name VARCHAR(200) NOT NULL,
  filename      VARCHAR(200) NOT NULL UNIQUE,
  size_bytes    BIGINT DEFAULT 0,
  checksum      VARCHAR(64) DEFAULT '',
  type          ENUM('bell','azan') DEFAULT 'bell',
  user_id       INT DEFAULT NULL,  -- NULL = admin (visible to all), set = user-specific
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Announcements (user-isolated)
-- type=recorded  → play immediately once
-- type=scheduled → weekly repeat (hour + minute + days bitmask) — আগের system
-- type=onetime   → calendar specific date(s), fires once per date — নতুন feature
CREATE TABLE IF NOT EXISTS announcements (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  type         ENUM('recorded','onetime','scheduled') DEFAULT 'recorded',
  title        VARCHAR(300) NOT NULL,
  message      TEXT,
  audio_url    VARCHAR(500),
  priority     INT DEFAULT 0,
  is_active    TINYINT DEFAULT 1,
  scheduled_at TIME DEFAULT NULL,
  hour         TINYINT DEFAULT NULL,
  minute       TINYINT DEFAULT NULL,
  days         INT DEFAULT 62,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS announcement_dates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  announcement_id INT NOT NULL,
  play_date       DATE NOT NULL,
  fired           TINYINT DEFAULT 0,
  fired_at        DATETIME DEFAULT NULL,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ann_play_date (announcement_id, play_date),
  FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE
);

-- Azan Times (user-isolated, one row per prayer per day per user)
-- sound_file: which azan audio to play for this prayer
CREATE TABLE IF NOT EXISTS azan_times (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL,
  prayer_name VARCHAR(20)  NOT NULL,
  hour        TINYINT      NOT NULL,
  minute      TINYINT      NOT NULL,
  date        DATE         NOT NULL,
  is_enabled  TINYINT      DEFAULT 1,
  sound_file  VARCHAR(200) DEFAULT 'azan.mp3',
  created_at  DATETIME     DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_user_prayer_date (user_id, prayer_name, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Default admin user (password: admin123)
INSERT IGNORE INTO users (username, password_hash, role)
VALUES ('admin', '$2a$10$vTblSecPX2ektTd.TNodaOWsLaBIV2piagELVMTb4A8OMOwvjT7pi', 'admin');
