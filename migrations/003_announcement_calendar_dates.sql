-- Adds calendar dates for type=onetime only.
-- type=scheduled keeps weekly days bitmask (unchanged).
USE shikkhasomoy_schoolbell;

ALTER TABLE announcements
  MODIFY COLUMN type ENUM('recorded', 'onetime', 'scheduled') DEFAULT 'recorded';

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
