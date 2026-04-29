#!/usr/bin/env node
// Seed a fresh project with N issues for performance benchmarking.
// Mirrors scripts/seed-issues.sh but in JS so it runs without the sqlite3 CLI.
//
// Usage:
//   node scripts/seed-perf.js                                     # 1000 issues, ./data/perf.sqlite
//   node scripts/seed-perf.js --count=5000 --db=./data/big.sqlite
//   node scripts/seed-perf.js --project="Perf Demo"
//
// The target DB is wiped and re-migrated each run so benches start from a
// known state.

import fs from 'node:fs';
import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';
import * as usersDb from '../server/db/users.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import { createProject } from '../server/services/projects.js';
import { logger } from '../server/logger.js';

const args = parseArgs(process.argv.slice(2));
const COUNT = args.count ?? 1000;
const DB_PATH = args.db ?? './data/perf.sqlite';
const PROJECT_NAME = args.project ?? 'Perf Demo';
const USER_EMAIL = 'perf@local';

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > 100_000) {
  logger.error(`--count must be an integer in [1, 100000], got ${COUNT}`);
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = DB_PATH + suffix;
  if (fs.existsSync(file)) fs.rmSync(file);
}

const db = openConnection(DB_PATH);
runMigrations(db);

const user = usersDb.create(db, { email: USER_EMAIL, name: 'Perf User' });
const project = createProject(db, { name: PROJECT_NAME });
projectMembersDb.add(db, { projectId: project.id, userId: user.id, role: 'developer' });

const insertIssues = db.transaction((projectId, userId, n) => {
  db.prepare(
    `WITH RECURSIVE
       s(id, idx) AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
           FROM issue_statuses WHERE project_id = ?
       ),
       c(id, idx) AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
           FROM issue_categories WHERE project_id = ?
       ),
       p(id, idx) AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order) - 1
           FROM issue_priorities WHERE project_id = ?
       ),
       seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ?)
     INSERT INTO issues
       (project_id, number, name, description,
        status_id, category_id, priority_id,
        assigned_to, created_by,
        created_at, updated_at, archived_at)
     SELECT
       ?,
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
       'Auto-seeded issue ' || seq.n || ' for perf benchmarking.',
       (SELECT id FROM s WHERE s.idx = (seq.n % 6)),
       (SELECT id FROM c WHERE c.idx = (seq.n % 3)),
       (SELECT id FROM p WHERE p.idx = (seq.n % 5)),
       CASE WHEN seq.n % 4 = 0 THEN ? ELSE NULL END,
       ?,
       datetime('now', '-' || (? - seq.n) || ' minutes'),
       datetime('now', '-' || (? - seq.n) || ' minutes'),
       CASE WHEN seq.n % 25 = 0 THEN datetime('now', '-1 day') ELSE NULL END
     FROM seq`,
  ).run(projectId, projectId, projectId, n, projectId, userId, userId, n + 100, n);

  db.prepare(
    `INSERT INTO issue_history (issue_id, user_id, kind, changed_at)
     SELECT i.id, ?, 'creation', i.created_at
       FROM issues i
      WHERE i.project_id = ?`,
  ).run(userId, projectId);
});

const t0 = performance.now();
insertIssues(project.id, user.id, COUNT);
const elapsed = (performance.now() - t0).toFixed(0);

const total = db
  .prepare('SELECT COUNT(*) AS c FROM issues WHERE project_id = ?')
  .get(project.id).c;

db.close();

logger.info(`Seeded ${total} issues into ${DB_PATH} (${elapsed} ms)`);
logger.info(`  project: ${PROJECT_NAME} (id ${project.id})`);
logger.info(`  user:    ${USER_EMAIL} (id ${user.id})`);

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === 'count') out.count = Number.parseInt(raw, 10);
    else if (key === 'db') out.db = raw;
    else if (key === 'project') out.project = raw;
  }
  return out;
}
