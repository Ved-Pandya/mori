PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS manga_aliases (
  alias_id TEXT PRIMARY KEY,
  canonical_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (canonical_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_manga_aliases_canonical ON manga_aliases(canonical_id);
