#!/usr/bin/env node
// Benchmark listIssues() against a perf-seeded DB.
// Reports median + p95 timings + EXPLAIN QUERY PLAN + statement counts for
// each scenario in the matrix.
//
// Usage:
//   node scripts/seed-perf.js
//   node scripts/bench-issues-list.js
//
//   node scripts/bench-issues-list.js --db=./data/perf.sqlite --runs=20

import { openConnection } from '../server/db/connection.js';
import { listIssues } from '../server/services/issues.js';
import * as metadataDb from '../server/db/metadata.js';

const args = parseArgs(process.argv.slice(2));
const DB_PATH = args.db ?? './data/perf.sqlite';
const RUNS = args.runs ?? 20;
const WARMUP = 3;

const db = openConnection(DB_PATH);
const project = db.prepare('SELECT * FROM projects ORDER BY id DESC LIMIT 1').get();
if (!project) {
  console.error(`No project in ${DB_PATH}. Run scripts/seed-perf.js first.`);
  process.exit(1);
}
const totalIssues = db
  .prepare('SELECT COUNT(*) AS c FROM issues WHERE project_id = ?')
  .get(project.id).c;
const lastPage = Math.max(1, Math.ceil(totalIssues / 25));

const statuses = metadataDb.list(db, 'statuses', project.id, { includeArchived: false });
const firstStatusId = statuses[0]?.id;

const assignee = db
  .prepare(
    'SELECT DISTINCT assigned_to FROM issues WHERE project_id = ? AND assigned_to IS NOT NULL LIMIT 1',
  )
  .get(project.id)?.assigned_to;

const scenarios = [
  { name: 'default                 ', query: { limit: '25', page: '1' } },
  { name: 'created_desc sort       ', query: { limit: '25', page: '1', sort: 'created_desc' } },
  { name: 'number_desc sort        ', query: { limit: '25', page: '1', sort: 'number_desc' } },
  {
    name: 'filter by status        ',
    query: { limit: '25', page: '1', status: String(firstStatusId) },
  },
  {
    name: 'filter by assignee      ',
    query: { limit: '25', page: '1', assignee: String(assignee ?? '') },
  },
  { name: 'text search q=login     ', query: { limit: '25', page: '1', q: 'login' } },
  { name: 'archived view           ', query: { limit: '25', page: '1', archived: '1' } },
  { name: 'deep page (last)        ', query: { limit: '25', page: String(lastPage) } },
];

console.log(`DB:     ${DB_PATH}`);
console.log(`Project: ${project.name} (id ${project.id})`);
console.log(`Issues:  ${totalIssues}`);
console.log(`Runs:    ${RUNS} (after ${WARMUP} warm-up)`);
console.log();
console.log(
  'scenario                    median   p95   stmts   first-row',
);
console.log('-'.repeat(72));

for (const sc of scenarios) {
  const samples = [];
  for (let i = 0; i < WARMUP; i++) listIssues(db, project.id, sc.query);

  let stmtsObserved = 0;
  for (let i = 0; i < RUNS; i++) {
    let stmts = 0;
    const probe = openConnection(DB_PATH);
    const probeWithVerbose = wrapVerbose(probe, () => stmts++);
    const t0 = performance.now();
    listIssues(probeWithVerbose, project.id, sc.query);
    samples.push(performance.now() - t0);
    probe.close();
    stmtsObserved = stmts;
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const p95 = samples[Math.max(0, Math.floor(samples.length * 0.95) - 1)];
  const result = listIssues(db, project.id, sc.query);
  const firstRow = result.items[0];
  const firstRowLabel = firstRow ? `#${firstRow.number}` : '(none)';

  console.log(
    `${sc.name}  ${pad(median.toFixed(1) + ' ms', 8)} ${pad(p95.toFixed(1) + ' ms', 8)} ${pad(String(stmtsObserved), 5)}   ${firstRowLabel}`,
  );
}

console.log();
console.log('--- EXPLAIN QUERY PLAN ---');
console.log();

for (const sc of scenarios) {
  const built = buildQueryForExplain(db, project.id, sc.query);
  console.log(`# ${sc.name.trim()}`);
  console.log(`  count: ${formatPlan(db, 'EXPLAIN QUERY PLAN ' + built.countSql, built.params)}`);
  console.log(
    `  page:  ${formatPlan(db, 'EXPLAIN QUERY PLAN ' + built.pageSql, [...built.params, 25, 0])}`,
  );
  console.log();
}

db.close();

function pad(s, w) {
  return s.length >= w ? s : s + ' '.repeat(w - s.length);
}

function wrapVerbose(db, onStmt) {
  // Intercept .prepare so every call to .run/.get/.all on a returned statement
  // increments the counter. We can't use better-sqlite3's verbose option mid-
  // life cycle, but counting prepared executions is what we want anyway.
  const origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const stmt = origPrepare(sql);
    const orig = {
      run: stmt.run.bind(stmt),
      get: stmt.get.bind(stmt),
      all: stmt.all.bind(stmt),
    };
    stmt.run = (...a) => {
      onStmt();
      return orig.run(...a);
    };
    stmt.get = (...a) => {
      onStmt();
      return orig.get(...a);
    };
    stmt.all = (...a) => {
      onStmt();
      return orig.all(...a);
    };
    return stmt;
  };
  return db;
}

// Mirror the where/order builders from db/issues.js so EXPLAIN matches what
// listIssues actually executes. (We import-and-call would require touching
// the production code; this stays read-only.)
function buildQueryForExplain(db, projectId, query) {
  const opts = parseFiltersLite(db, projectId, query);
  const where = ['project_id = ?'];
  const params = [projectId];
  if (!opts.includeArchived) where.push('archived_at IS NULL');
  if (opts.statusIds.length) {
    where.push(`status_id IN (${opts.statusIds.map(() => '?').join(',')})`);
    params.push(...opts.statusIds);
  }
  if (opts.categoryIds.length) {
    where.push(`category_id IN (${opts.categoryIds.map(() => '?').join(',')})`);
    params.push(...opts.categoryIds);
  }
  if (opts.priorityIds.length) {
    where.push(`priority_id IN (${opts.priorityIds.map(() => '?').join(',')})`);
    params.push(...opts.priorityIds);
  }
  if (opts.assigneeIds.length && opts.includeUnassigned) {
    where.push(
      `(assigned_to IN (${opts.assigneeIds.map(() => '?').join(',')}) OR assigned_to IS NULL)`,
    );
    params.push(...opts.assigneeIds);
  } else if (opts.assigneeIds.length) {
    where.push(`assigned_to IN (${opts.assigneeIds.map(() => '?').join(',')})`);
    params.push(...opts.assigneeIds);
  } else if (opts.includeUnassigned) {
    where.push('assigned_to IS NULL');
  }
  if (opts.q) {
    where.push(`name LIKE ? ESCAPE '\\'`);
    params.push(`%${opts.q}%`);
  }
  const whereSql = where.join(' AND ');
  const order =
    opts.sort === 'created_desc'
      ? 'ORDER BY created_at DESC, id DESC'
      : opts.sort === 'number_asc'
        ? 'ORDER BY number ASC, id ASC'
        : opts.sort === 'number_desc'
          ? 'ORDER BY number DESC, id DESC'
          : 'ORDER BY updated_at DESC, id DESC';
  return {
    countSql: `SELECT COUNT(*) AS total FROM issues WHERE ${whereSql}`,
    pageSql: `SELECT * FROM issues WHERE ${whereSql} ${order} LIMIT ? OFFSET ?`,
    params,
  };
}

function parseFiltersLite(db, projectId, query) {
  const ids = (raw) =>
    raw == null
      ? []
      : String(raw)
          .split(',')
          .map((s) => Number.parseInt(s.trim(), 10))
          .filter((n) => Number.isInteger(n) && n > 0);
  return {
    statusIds: ids(query.status),
    categoryIds: ids(query.category),
    priorityIds: ids(query.priority),
    assigneeIds: ids(query.assignee),
    includeUnassigned: false,
    includeArchived: query.archived === '1' || query.archived === 'true',
    q: typeof query.q === 'string' && query.q.trim().length > 0 ? query.q.trim() : null,
    sort: query.sort ?? 'updated_desc',
  };
}

function formatPlan(db, sql, params) {
  try {
    const rows = db.prepare(sql).all(...params);
    return rows.map((r) => r.detail).join(' | ');
  } catch (err) {
    return `(EXPLAIN failed: ${err.message})`;
  }
}

function parseArgs(argv) {
  const out = {};
  for (const arg of argv) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (key === 'db') out.db = raw;
    else if (key === 'runs') out.runs = Number.parseInt(raw, 10);
  }
  return out;
}
