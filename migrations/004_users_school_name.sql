-- Run once on production DB: shikkhasomoy_schoolbell
USE shikkhasomoy_schoolbell;

ALTER TABLE users
  ADD COLUMN school_name VARCHAR(200) NULL AFTER role;
