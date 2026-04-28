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

export function deleteAllForUserExcept(db, userId, exceptSessionId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(userId, exceptSessionId);
}

const LIST_COLUMNS =
  's.id           AS session_id, ' +
  's.user_id      AS user_id, ' +
  's.created_at   AS created_at, ' +
  's.expires_at   AS expires_at, ' +
  's.last_seen_at AS last_seen_at, ' +
  's.user_agent   AS user_agent, ' +
  'u.email        AS email, ' +
  'u.name         AS name';

export function listAll(db, { limit = 200, now = new Date().toISOString() } = {}) {
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ?
        ORDER BY s.last_seen_at DESC
        LIMIT ?`,
    )
    .all(now, limit);
}

export function listForUser(db, userId, { now = new Date().toISOString() } = {}) {
  return db
    .prepare(
      `SELECT ${LIST_COLUMNS}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.user_id = ? AND s.expires_at > ?
        ORDER BY s.last_seen_at DESC`,
    )
    .all(userId, now);
}
