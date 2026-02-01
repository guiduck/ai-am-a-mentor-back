-- Email notifications preference
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_notifications_enabled INTEGER NOT NULL DEFAULT 1;
