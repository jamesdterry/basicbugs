// Issues persistence layer. Plain SQL helpers; every fn takes the db handle
// first so callers can pass a transaction-bound connection.

export const SORTS = Object.freeze(['updated_desc', 'created_desc', 'number_asc', 'number_desc']);

export function isValidSort(sort) {
  return SORTS.includes(sort);
}

export function nextNumber(db, projectId) {
  const row = db
    .prepare('SELECT COALESCE(MAX(number), 0) AS m FROM issues WHERE project_id = ?')
    .get(projectId);
  return row.m + 1;
}

export function create(
  db,
  {
    projectId,
    number,
    name,
    description = null,
    statusId,
    categoryId,
    priorityId,
    assignedTo = null,
    createdBy,
  },
) {
  const info = db
    .prepare(
      `INSERT INTO issues
         (project_id, number, name, description,
          status_id, category_id, priority_id,
          assigned_to, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      projectId,
      number,
      name,
      description,
      statusId,
      categoryId,
      priorityId,
      assignedTo,
      createdBy,
    );
  return getById(db, info.lastInsertRowid);
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM issues WHERE id = ?').get(id) ?? null;
}

export function getByNumber(db, projectId, number) {
  return (
    db.prepare('SELECT * FROM issues WHERE project_id = ? AND number = ?').get(projectId, number) ??
    null
  );
}

const COLUMN_FOR_KEY = Object.freeze({
  name: 'name',
  description: 'description',
  statusId: 'status_id',
  categoryId: 'category_id',
  priorityId: 'priority_id',
  assignedTo: 'assigned_to',
});

export function update(db, id, patch) {
  const sets = [];
  const params = [];
  for (const [key, value] of Object.entries(patch)) {
    const col = COLUMN_FOR_KEY[key];
    if (!col) continue;
    sets.push(`${col} = ?`);
    params.push(value);
  }
  if (sets.length === 0) return getById(db, id);
  sets.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  db.prepare(`UPDATE issues SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getById(db, id);
}

export function archive(db, id, when = new Date().toISOString()) {
  db.prepare('UPDATE issues SET archived_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
    when,
    id,
  );
}

export function unarchive(db, id) {
  db.prepare(
    'UPDATE issues SET archived_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
  ).run(id);
}

function orderByClause(sort) {
  switch (sort) {
    case 'created_desc':
      return 'ORDER BY created_at DESC, id DESC';
    case 'number_asc':
      return 'ORDER BY number ASC, id ASC';
    case 'number_desc':
      return 'ORDER BY number DESC, id DESC';
    case 'updated_desc':
    default:
      return 'ORDER BY updated_at DESC, id DESC';
  }
}

function escapeLike(s) {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * List issues for a project with optional filters and page pagination.
 *
 * @param db
 * @param projectId
 * @param opts
 *   statusIds?, categoryIds?, priorityIds?, assigneeIds? — arrays of ints
 *   includeUnassigned? — boolean; combined with assigneeIds with OR
 *   includeArchived?   — boolean (default false)
 *   q?                 — non-empty trimmed string; matches name via LIKE
 *   sort?              — one of SORTS, default 'updated_desc'
 *   limit?             — integer 1..100, default 50
 *   page?              — 1-based page number, default 1
 *
 * Returns { items, page, pageSize, total, totalPages }.
 */
export function list(db, projectId, opts = {}) {
  const {
    statusIds = null,
    categoryIds = null,
    priorityIds = null,
    assigneeIds = null,
    includeUnassigned = false,
    includeArchived = false,
    q = null,
    sort = 'updated_desc',
    limit = 50,
    page = 1,
  } = opts;

  const where = ['project_id = ?'];
  const params = [projectId];
  const pageNumber = Number.isInteger(page) && page > 0 ? page : 1;

  if (!includeArchived) where.push('archived_at IS NULL');

  if (Array.isArray(statusIds) && statusIds.length > 0) {
    where.push(`status_id IN (${statusIds.map(() => '?').join(',')})`);
    params.push(...statusIds);
  }
  if (Array.isArray(categoryIds) && categoryIds.length > 0) {
    where.push(`category_id IN (${categoryIds.map(() => '?').join(',')})`);
    params.push(...categoryIds);
  }
  if (Array.isArray(priorityIds) && priorityIds.length > 0) {
    where.push(`priority_id IN (${priorityIds.map(() => '?').join(',')})`);
    params.push(...priorityIds);
  }

  const hasAssignees = Array.isArray(assigneeIds) && assigneeIds.length > 0;
  if (hasAssignees && includeUnassigned) {
    where.push(`(assigned_to IN (${assigneeIds.map(() => '?').join(',')}) OR assigned_to IS NULL)`);
    params.push(...assigneeIds);
  } else if (hasAssignees) {
    where.push(`assigned_to IN (${assigneeIds.map(() => '?').join(',')})`);
    params.push(...assigneeIds);
  } else if (includeUnassigned) {
    where.push('assigned_to IS NULL');
  }

  if (typeof q === 'string' && q.length > 0) {
    where.push(`name LIKE ? ESCAPE '\\'`);
    params.push(`%${escapeLike(q)}%`);
  }

  const whereSql = where.join(' AND ');
  const total = db
    .prepare(`SELECT COUNT(*) AS total FROM issues WHERE ${whereSql}`)
    .get(...params).total;
  const totalPages = Math.ceil(total / limit);
  const offset = (pageNumber - 1) * limit;
  const sql = `SELECT * FROM issues WHERE ${whereSql} ${orderByClause(sort)} LIMIT ? OFFSET ?`;
  const items = db.prepare(sql).all(...params, limit, offset);

  return { items, page: pageNumber, pageSize: limit, total, totalPages };
}
