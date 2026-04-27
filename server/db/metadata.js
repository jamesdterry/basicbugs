export const KINDS = Object.freeze(['statuses', 'categories', 'priorities']);

const TABLE = Object.freeze({
  statuses: 'issue_statuses',
  categories: 'issue_categories',
  priorities: 'issue_priorities',
});

function tableFor(kind) {
  const t = TABLE[kind];
  if (!t) throw new Error(`unknown metadata kind: ${kind}`);
  return t;
}

export function isValidKind(kind) {
  return Object.prototype.hasOwnProperty.call(TABLE, kind);
}

export function create(db, kind, { projectId, name, sortOrder, isDefault = 0, isClosed = 0 }) {
  const table = tableFor(kind);
  let info;
  if (kind === 'statuses') {
    info = db
      .prepare(
        `INSERT INTO ${table} (project_id, name, sort_order, is_default, is_closed)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(projectId, name, sortOrder, isDefault ? 1 : 0, isClosed ? 1 : 0);
  } else {
    info = db
      .prepare(
        `INSERT INTO ${table} (project_id, name, sort_order, is_default)
         VALUES (?, ?, ?, ?)`,
      )
      .run(projectId, name, sortOrder, isDefault ? 1 : 0);
  }
  return getById(db, kind, info.lastInsertRowid);
}

export function getById(db, kind, id) {
  const table = tableFor(kind);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) ?? null;
}

export function list(db, kind, projectId, { includeArchived = false } = {}) {
  const table = tableFor(kind);
  const sql = includeArchived
    ? `SELECT * FROM ${table} WHERE project_id = ? ORDER BY sort_order, id`
    : `SELECT * FROM ${table} WHERE project_id = ? AND archived_at IS NULL ORDER BY sort_order, id`;
  return db.prepare(sql).all(projectId);
}

export function rename(db, kind, id, name) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, id);
}

export function setSortOrder(db, kind, id, sortOrder) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`).run(sortOrder, id);
}

export function clearDefault(db, kind, projectId) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET is_default = 0 WHERE project_id = ?`).run(projectId);
}

export function setDefault(db, kind, id) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET is_default = 1 WHERE id = ?`).run(id);
}

export function setClosed(db, id, isClosed) {
  db.prepare('UPDATE issue_statuses SET is_closed = ? WHERE id = ?').run(isClosed ? 1 : 0, id);
}

export function archive(db, kind, id, when = new Date().toISOString()) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET archived_at = ? WHERE id = ?`).run(when, id);
}

export function unarchive(db, kind, id) {
  const table = tableFor(kind);
  db.prepare(`UPDATE ${table} SET archived_at = NULL WHERE id = ?`).run(id);
}

export function countActive(db, kind, projectId) {
  const table = tableFor(kind);
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE project_id = ? AND archived_at IS NULL`)
    .get(projectId);
  return row.n;
}

export function getDefault(db, kind, projectId) {
  const table = tableFor(kind);
  return (
    db
      .prepare(
        `SELECT * FROM ${table}
          WHERE project_id = ? AND is_default = 1 AND archived_at IS NULL`,
      )
      .get(projectId) ?? null
  );
}

export function maxSortOrder(db, kind, projectId) {
  const table = tableFor(kind);
  const row = db
    .prepare(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${table} WHERE project_id = ?`)
    .get(projectId);
  return row.m;
}
