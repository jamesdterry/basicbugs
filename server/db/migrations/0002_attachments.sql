-- 0002_attachments.sql — file attachments on issues.
-- storage_path is stored relative to ATTACHMENTS_DIR so the data directory
-- stays portable.
-- issue_history_id is reserved nullable for future stages (Stage 10+) that may
-- want to tie attachments to a specific save/comment event; Stage 9 does not
-- create history rows for uploads.

CREATE TABLE attachments (
  id                INTEGER PRIMARY KEY,
  issue_id          INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  issue_history_id  INTEGER REFERENCES issue_history(id) ON DELETE SET NULL,
  uploaded_by       INTEGER NOT NULL REFERENCES users(id),
  filename          TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER NOT NULL,
  storage_path      TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at       TEXT
);

CREATE INDEX idx_attachments_issue ON attachments(issue_id, created_at DESC);
