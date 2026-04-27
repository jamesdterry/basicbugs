-- nopbug schema (v1)
-- Apply to a fresh SQLite database:  sqlite3 nopbug.db < db.sql

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

BEGIN;

-- ---------------------------------------------------------------------------
-- Identity
-- Super admin is identified by SUPER_ADMIN_EMAIL env var, not by a column.
-- A user row is auto-created for the super admin on first login.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id              INTEGER PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT,
  password_hash   TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at   TEXT,
  is_disabled     INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------
CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at  TEXT
);

-- Per-project role. A user may belong to many projects with different roles.
CREATE TABLE project_members (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('developer','user','viewer')),
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Per-project issue metadata (statuses, categories, priorities)
-- Seeded at project creation time from app-layer defaults; editable thereafter
-- by developers on the project.
-- ---------------------------------------------------------------------------
CREATE TABLE issue_statuses (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  is_closed    INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  UNIQUE (project_id, name)
);

CREATE TABLE issue_categories (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  UNIQUE (project_id, name)
);

CREATE TABLE issue_priorities (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_default   INTEGER NOT NULL DEFAULT 0,
  archived_at  TEXT,
  UNIQUE (project_id, name)
);

-- ---------------------------------------------------------------------------
-- Issues
-- `number` is a per-project human-friendly id (#1, #2, ...) assigned by the
-- app as MAX(number)+1 within a transaction.
-- ---------------------------------------------------------------------------
CREATE TABLE issues (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects(id),
  number        INTEGER NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  status_id     INTEGER NOT NULL REFERENCES issue_statuses(id),
  category_id   INTEGER NOT NULL REFERENCES issue_categories(id),
  priority_id   INTEGER NOT NULL REFERENCES issue_priorities(id),
  assigned_to   INTEGER REFERENCES users(id),
  created_by    INTEGER NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at   TEXT,
  UNIQUE (project_id, number)
);

CREATE INDEX idx_issues_project_status   ON issues(project_id, status_id);
CREATE INDEX idx_issues_project_priority ON issues(project_id, priority_id);
CREATE INDEX idx_issues_project_category ON issues(project_id, category_id);
CREATE INDEX idx_issues_project_assignee ON issues(project_id, assigned_to);
CREATE INDEX idx_issues_project_updated  ON issues(project_id, updated_at DESC);

-- ---------------------------------------------------------------------------
-- Issue history (and comments)
-- One row per save action. Field-level changes go in issue_history_changes.
-- A comment is a row with kind='comment', a non-null note, and zero changes.
-- old_value/new_value are display strings, not FKs, so renaming/archiving a
-- status/priority/category/user does not corrupt old history.
-- ---------------------------------------------------------------------------
CREATE TABLE issue_history (
  id           INTEGER PRIMARY KEY,
  issue_id     INTEGER NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  changed_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note         TEXT,
  kind         TEXT NOT NULL DEFAULT 'change'
                 CHECK (kind IN ('creation','change','comment'))
);
CREATE INDEX idx_issue_history_issue ON issue_history(issue_id, changed_at DESC);

CREATE TABLE issue_history_changes (
  id                 INTEGER PRIMARY KEY,
  issue_history_id   INTEGER NOT NULL REFERENCES issue_history(id) ON DELETE CASCADE,
  field              TEXT NOT NULL
                       CHECK (field IN ('name','description','status','category','priority','assignee')),
  old_value          TEXT,
  new_value          TEXT
);
CREATE INDEX idx_issue_history_changes_event ON issue_history_changes(issue_history_id);

-- ---------------------------------------------------------------------------
-- Authentication
-- ---------------------------------------------------------------------------
CREATE TABLE auth_tokens (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('magic_link','password_reset')),
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_auth_tokens_user ON auth_tokens(user_id);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  user_agent    TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

COMMIT;
