CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  recipient_email TEXT,
  strip_key TEXT,
  strip_url TEXT,
  photo_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  metadata_json TEXT
);
