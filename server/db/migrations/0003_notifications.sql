-- 0003_notifications.sql — Stage 10: watching, mentions, and notifications.
-- Connection-level PRAGMAs are set in connection.js; the migration runner
-- wraps each file in its own transaction.
--
-- Design note: there is no email-worker timer. The application drains unsent
-- notifications opportunistically (after each issue mutation, on boot, and on
-- feed-fetch). The DB is the queue; emailed_at IS NULL means "still owed".

-- Per-issue, per-user watch.
CREATE TABLE issue_watchers (
  issue_id    INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX idx_issue_watchers_user ON issue_watchers(user_id);

-- Per-user notification preferences. Missing rows mean "enabled" (default opt-in).
-- Disabling a kind writes a row with enabled = 0.
CREATE TABLE notification_prefs (
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind     TEXT    NOT NULL,
  enabled  INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, kind),
  CHECK (kind IN ('assigned_to_me','mentioned','watched_status_change','watched_any_change'))
);

-- In-app feed + delivery tracking. emailed_at IS NULL means the row still
-- needs to be sent; read_at IS NULL means the user has not seen it yet.
CREATE TABLE notifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id)         ON DELETE CASCADE,
  issue_id    INTEGER NOT NULL REFERENCES issues(id)        ON DELETE CASCADE,
  history_id  INTEGER NOT NULL REFERENCES issue_history(id) ON DELETE CASCADE,
  kind        TEXT    NOT NULL
                CHECK (kind IN ('assigned_to_me','mentioned','watched_status_change','watched_any_change')),
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at     TEXT,
  emailed_at  TEXT
);
CREATE INDEX idx_notifications_user_unread ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_unsent      ON notifications(emailed_at) WHERE emailed_at IS NULL;
