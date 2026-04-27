export function insert(db, { id, userId, expiresAt, userAgent = null }) {
  db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, user_agent)
     VALUES (?, ?, ?, ?)`,
  ).run(id, userId, expiresAt, userAgent);
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) ?? null;
}

export function getWithUser(db, id) {
  return (
    db
      .prepare(
        `SELECT s.id            AS session_id,
                s.user_id       AS user_id,
                s.expires_at    AS expires_at,
                s.last_seen_at  AS last_seen_at,
                u.email         AS email,
                u.name          AS name,
                u.is_disabled   AS is_disabled
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
      )
      .get(id) ?? null
  );
}

export function touchLastSeen(db, id, when = new Date().toISOString()) {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(when, id);
}

export function deleteById(db, id) {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function deleteAllForUser(db, userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function deleteExpired(db, now = new Date().toISOString()) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
}
