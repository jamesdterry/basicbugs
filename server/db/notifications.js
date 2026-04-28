export function insert(db, { userId, issueId, historyId, kind }) {
  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, issue_id, history_id, kind)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, issueId, historyId, kind);
  return info.lastInsertRowid;
}

export function listForUser(db, userId, { unreadOnly = false, limit = 50 } = {}) {
  const where = ['n.user_id = ?'];
  const params = [userId];
  if (unreadOnly) where.push('n.read_at IS NULL');
  const sql = `
    SELECT n.id, n.user_id, n.issue_id, n.history_id, n.kind,
           n.created_at, n.read_at, n.emailed_at,
           i.number AS issue_number, i.name AS issue_name, i.project_id AS project_id,
           h.note AS history_note, h.kind AS history_kind,
           u.id AS actor_id, u.name AS actor_name, u.email AS actor_email
      FROM notifications n
      JOIN issues i        ON i.id = n.issue_id
      JOIN issue_history h ON h.id = n.history_id
      LEFT JOIN users u    ON u.id = h.user_id
     WHERE ${where.join(' AND ')}
     ORDER BY n.id DESC
     LIMIT ?`;
  params.push(limit);
  return db.prepare(sql).all(...params);
}

export function unreadCount(db, userId) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL')
    .get(userId);
  return row.n;
}

export function markRead(db, id, userId) {
  const info = db
    .prepare(
      `UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    )
    .run(id, userId);
  return info.changes > 0;
}

export function markAllRead(db, userId) {
  const info = db
    .prepare(
      `UPDATE notifications
          SET read_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND read_at IS NULL`,
    )
    .run(userId);
  return info.changes;
}

export function listUnsent(db, limit = 50) {
  return db
    .prepare(
      `SELECT n.id, n.user_id, n.issue_id, n.history_id, n.kind, n.created_at,
              u.email AS recipient_email, u.name AS recipient_name, u.is_disabled,
              i.number AS issue_number, i.name AS issue_name, i.project_id AS project_id,
              p.name AS project_name,
              h.note AS history_note, h.kind AS history_kind,
              au.id AS actor_id, au.name AS actor_name, au.email AS actor_email
         FROM notifications n
         JOIN users u         ON u.id = n.user_id
         JOIN issues i        ON i.id = n.issue_id
         JOIN projects p      ON p.id = i.project_id
         JOIN issue_history h ON h.id = n.history_id
         LEFT JOIN users au   ON au.id = h.user_id
        WHERE n.emailed_at IS NULL
        ORDER BY n.id ASC
        LIMIT ?`,
    )
    .all(limit);
}

export function markEmailed(db, id) {
  db.prepare(
    `UPDATE notifications SET emailed_at = CURRENT_TIMESTAMP WHERE id = ?`,
  ).run(id);
}
