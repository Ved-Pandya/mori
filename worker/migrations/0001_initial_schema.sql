PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS manga (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_name TEXT NOT NULL,
  source_url TEXT,
  cover_url TEXT,
  status TEXT,
  in_library INTEGER NOT NULL DEFAULT 1,
  added_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS manga_categories (
  manga_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  PRIMARY KEY (manga_id, category_id),
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  manga_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  name TEXT NOT NULL,
  chapter_number REAL,
  source_order INTEGER,
  uploaded_at INTEGER,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (manga_id, source_url),
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS reading_progress (
  manga_id TEXT PRIMARY KEY,
  chapter_id TEXT,
  page_index INTEGER NOT NULL DEFAULT 0,
  progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  last_read_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chapter_state (
  chapter_id TEXT PRIMARY KEY,
  read INTEGER NOT NULL DEFAULT 0,
  bookmarked INTEGER NOT NULL DEFAULT 0,
  last_page_read INTEGER NOT NULL DEFAULT 0,
  read_at INTEGER,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS update_runs (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  status TEXT NOT NULL,
  source_count INTEGER NOT NULL DEFAULT 0,
  new_chapter_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_manga_library ON manga(in_library, title);
CREATE INDEX IF NOT EXISTS idx_chapters_manga ON chapters(manga_id, source_order);
CREATE INDEX IF NOT EXISTS idx_progress_last_read ON reading_progress(last_read_at DESC);
