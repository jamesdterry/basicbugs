export function record(db, { method, route, status, userId, message, stack }) {
  const stmt = db.prepare(
    `INSERT INTO error_log (method, route, status, user_id, message, stack)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    method ?? null,
    route ?? null,
    status ?? null,
    userId ?? null,
    message ?? null,
    stack ?? null,
  );
  return info.lastInsertRowid;
}

export function list(db, { limit = 50, before } = {}) {
  const cap = Math.min(Math.max(limit, 1), 200);
  if (before) {
    return db
      .prepare(
        `SELECT id, created_at, method, route, status, user_id, message, stack
         FROM error_log WHERE id < ? ORDER BY id DESC LIMIT ?`,
      )
      .all(before, cap);
  }
  return db
    .prepare(
      `SELECT id, created_at, method, route, status, user_id, message, stack
       FROM error_log ORDER BY id DESC LIMIT ?`,
    )
    .all(cap);
}

export function count(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM error_log').get().n;
}

export function prune(db, olderThanDays = 30) {
  const info = db
    .prepare(
      `DELETE FROM error_log
       WHERE created_at < datetime('now', ?)`,
    )
    .run(`-${olderThanDays} days`);
  return info.changes;
}
