export function create(db, { name }) {
  const info = db.prepare('INSERT INTO projects (name) VALUES (?)').run(name);
  return getById(db, info.lastInsertRowid);
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id) ?? null;
}

export function rename(db, id, name) {
  db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id);
}

export function archive(db, id, when = new Date().toISOString()) {
  db.prepare('UPDATE projects SET archived_at = ? WHERE id = ?').run(when, id);
}

export function unarchive(db, id) {
  db.prepare('UPDATE projects SET archived_at = NULL WHERE id = ?').run(id);
}

export function list(db, { includeArchived = false } = {}) {
  if (includeArchived) {
    return db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all();
  }
  return db
    .prepare('SELECT * FROM projects WHERE archived_at IS NULL ORDER BY name COLLATE NOCASE')
    .all();
}

export function listForUser(db, userId, { includeArchived = false } = {}) {
  const sql = includeArchived
    ? `SELECT p.*, pm.role
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = ?
        ORDER BY p.name COLLATE NOCASE`
    : `SELECT p.*, pm.role
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = ?
          AND p.archived_at IS NULL
        ORDER BY p.name COLLATE NOCASE`;
  return db.prepare(sql).all(userId);
}
