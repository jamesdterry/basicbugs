export function add(db, { projectId, userId, role }) {
  const info = db
    .prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
    .run(projectId, userId, role);
  return getById(db, info.lastInsertRowid);
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM project_members WHERE id = ?').get(id) ?? null;
}

export function remove(db, projectId, userId) {
  db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(
    projectId,
    userId,
  );
}

export function setRole(db, projectId, userId, role) {
  db.prepare('UPDATE project_members SET role = ? WHERE project_id = ? AND user_id = ?').run(
    role,
    projectId,
    userId,
  );
}

export function getRole(db, projectId, userId) {
  const row = db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);
  return row?.role ?? null;
}

export function listForProject(db, projectId) {
  return db
    .prepare(
      `SELECT u.id           AS user_id,
              u.email        AS email,
              u.name         AS name,
              pm.role        AS role,
              pm.created_at  AS created_at
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY u.email COLLATE NOCASE`,
    )
    .all(projectId);
}

export function listForUser(db, userId) {
  return db
    .prepare(
      `SELECT pm.project_id  AS project_id,
              pm.role         AS role,
              pm.created_at   AS created_at
         FROM project_members pm
        WHERE pm.user_id = ?`,
    )
    .all(userId);
}
