CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  artist TEXT NOT NULL DEFAULT '',
  object_key TEXT NOT NULL,
  edit_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  print_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS artworks_created_at ON artworks(created_at DESC);
CREATE TABLE IF NOT EXISTS limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
