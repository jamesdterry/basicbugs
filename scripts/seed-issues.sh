#!/usr/bin/env bash
# Seed a fresh project with 125 issues directly via the sqlite3 CLI.
# Used to manually exercise Stage 6: filters, sort, "Load more" pagination.
#
# Usage:
#   scripts/seed-issues.sh                  # uses DB_PATH from .env or default
#   DB_PATH=./data/basicbugs.sqlite scripts/seed-issues.sh "My Project"
#
# Requires the super admin user (SUPER_ADMIN_EMAIL) to already exist —
# i.e. you've logged in once via magic link. The script reads SUPER_ADMIN_EMAIL
# from .env if present.

set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB="${DB_PATH:-./data/basicbugs.sqlite}"
PROJECT_NAME="${1:-Stage6 Demo}"
ADMIN_EMAIL="${SUPER_ADMIN_EMAIL:?SUPER_ADMIN_EMAIL must be set in .env or the environment}"

if [[ ! -f "$DB" ]]; then
  echo "Database not found at $DB — run 'npm run migrate' first." >&2
  exit 1
fi

echo "DB:      $DB"
echo "Project: $PROJECT_NAME"
echo "Admin:   $ADMIN_EMAIL"

# Confirm the super admin row exists before we start writing.
ADMIN_COUNT=$(sqlite3 "$DB" "SELECT COUNT(*) FROM users WHERE email = '${ADMIN_EMAIL}' COLLATE NOCASE;")
if [[ "$ADMIN_COUNT" -eq 0 ]]; then
  echo "Super admin user (${ADMIN_EMAIL}) not found in $DB." >&2
  echo "Log in once via magic link so the row gets auto-created, then re-run." >&2
  exit 1
fi

sqlite3 "$DB" <<SQL
PRAGMA foreign_keys = ON;
BEGIN;

-- Create the project.
INSERT INTO projects (name) VALUES ('${PROJECT_NAME}');

-- Seed default metadata (mirrors services/metadataDefaults.js).
INSERT INTO issue_statuses (project_id, name, sort_order, is_default, is_closed) VALUES
  ((SELECT MAX(id) FROM projects), 'Open',        10, 1, 0),
  ((SELECT MAX(id) FROM projects), 'In Progress', 20, 0, 0),
  ((SELECT MAX(id) FROM projects), 'Blocked',     30, 0, 0),
  ((SELECT MAX(id) FROM projects), 'Resolved',    40, 0, 1),
  ((SELECT MAX(id) FROM projects), 'Closed',      50, 0, 1),
  ((SELECT MAX(id) FROM projects), 'Wontfix',     60, 0, 1);

INSERT INTO issue_categories (project_id, name, sort_order, is_default) VALUES
  ((SELECT MAX(id) FROM projects), 'Bug',     10, 1),
  ((SELECT MAX(id) FROM projects), 'Feature', 20, 0),
  ((SELECT MAX(id) FROM projects), 'Chore',   30, 0);

INSERT INTO issue_priorities (project_id, name, sort_order, is_default) VALUES
  ((SELECT MAX(id) FROM projects), 'Trivial',  10, 0),
  ((SELECT MAX(id) FROM projects), 'Low',      20, 0),
  ((SELECT MAX(id) FROM projects), 'Medium',   30, 1),
  ((SELECT MAX(id) FROM projects), 'High',     40, 0),
  ((SELECT MAX(id) FROM projects), 'Critical', 50, 0);

-- Add the admin as a developer member of the new project.
INSERT INTO project_members (project_id, user_id, role)
SELECT (SELECT MAX(id) FROM projects),
       (SELECT id FROM users WHERE email = '${ADMIN_EMAIL}' COLLATE NOCASE),
       'developer';

-- Generate 125 issues with a recursive CTE.
WITH RECURSIVE
  proj(id) AS (SELECT MAX(id) FROM projects),
  uid(id)  AS (SELECT id FROM users WHERE email = '${ADMIN_EMAIL}' COLLATE NOCASE),
  s(id, idx) AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
      FROM issue_statuses WHERE project_id = (SELECT id FROM proj)
  ),
  c(id, idx) AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
      FROM issue_categories WHERE project_id = (SELECT id FROM proj)
  ),
  p(id, idx) AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
      FROM issue_priorities WHERE project_id = (SELECT id FROM proj)
  ),
  seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 125)
INSERT INTO issues
  (project_id, number, name, description,
   status_id, category_id, priority_id,
   assigned_to, created_by,
   created_at, updated_at, archived_at)
SELECT
  (SELECT id FROM proj),
  seq.n,
  CASE (seq.n % 7)
    WHEN 0 THEN 'login bug #' || seq.n
    WHEN 1 THEN 'logout flow #' || seq.n
    WHEN 2 THEN 'signup race #' || seq.n
    WHEN 3 THEN 'pagination glitch #' || seq.n
    WHEN 4 THEN 'sort order off #' || seq.n
    WHEN 5 THEN 'filter persists wrong #' || seq.n
    ELSE        'cosmetic CSS tweak #' || seq.n
  END,
  'Auto-seeded issue ' || seq.n || ' for Stage 6 manual testing.',
  (SELECT id FROM s WHERE s.idx = (seq.n % 6)),
  (SELECT id FROM c WHERE c.idx = (seq.n % 3)),
  (SELECT id FROM p WHERE p.idx = (seq.n % 5)),
  CASE WHEN seq.n % 4 = 0 THEN (SELECT id FROM uid) ELSE NULL END,
  (SELECT id FROM uid),
  datetime('now', '-' || (200 - seq.n) || ' minutes'),
  datetime('now', '-' || (125 - seq.n) || ' minutes'),
  CASE WHEN seq.n % 25 = 0 THEN datetime('now', '-1 day') ELSE NULL END
FROM seq;

-- One creation history event per issue, so the records look real.
INSERT INTO issue_history (issue_id, user_id, kind, changed_at)
SELECT i.id, (SELECT id FROM users WHERE email = '${ADMIN_EMAIL}' COLLATE NOCASE),
       'creation', i.created_at
  FROM issues i
 WHERE i.project_id = (SELECT MAX(id) FROM projects);

COMMIT;
SQL

echo
echo "Seeded. Issue count:"
sqlite3 "$DB" "SELECT COUNT(*) FROM issues WHERE project_id = (SELECT MAX(id) FROM projects);"

echo "Project id:"
sqlite3 "$DB" "SELECT MAX(id) FROM projects;"
