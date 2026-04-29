export function record(db, { actorId, action, targetType, targetId, payload }) {
  const stmt = db.prepare(
    `INSERT INTO admin_audit (super_admin_user_id, action, target_type, target_id, payload_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const info = stmt.run(
    actorId,
    action,
    targetType ?? null,
    targetId ?? null,
    payload === undefined || payload === null ? null : JSON.stringify(payload),
  );
  return info.lastInsertRowid;
}

export function list(db, { limit = 50, before, action, targetType } = {}) {
  const cap = Math.min(Math.max(limit, 1), 200);
  const where = [];
  const params = [];
  if (before) {
    where.push('a.id < ?');
    params.push(before);
  }
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  if (targetType) {
    where.push('a.target_type = ?');
    params.push(targetType);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(cap);
  return db
    .prepare(
      `SELECT a.id, a.created_at, a.super_admin_user_id, a.action, a.target_type,
              a.target_id, a.payload_json, u.email AS actor_email, u.name AS actor_name
       FROM admin_audit a
       LEFT JOIN users u ON u.id = a.super_admin_user_id
       ${whereSql}
       ORDER BY a.id DESC
       LIMIT ?`,
    )
    .all(...params);
}

export function count(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM admin_audit').get().n;
}
