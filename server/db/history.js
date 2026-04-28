// Issue history persistence layer. Plain SQL helpers; every fn takes the db
// handle first so callers can pass a transaction-bound connection.

export const KINDS = Object.freeze(['creation', 'change', 'comment']);
export const FIELDS = Object.freeze([
  'name',
  'description',
  'status',
  'category',
  'priority',
  'assignee',
]);

export function insertEvent(db, { issueId, userId, kind, note = null }) {
  const info = db
    .prepare(
      `INSERT INTO issue_history (issue_id, user_id, kind, note)
       VALUES (?, ?, ?, ?)`,
    )
    .run(issueId, userId, kind, note);
  return getEventById(db, info.lastInsertRowid);
}

export function insertChange(db, { eventId, field, oldValue = null, newValue = null }) {
  const info = db
    .prepare(
      `INSERT INTO issue_history_changes (issue_history_id, field, old_value, new_value)
       VALUES (?, ?, ?, ?)`,
    )
    .run(eventId, field, oldValue, newValue);
  return info.lastInsertRowid;
}

export function getEventById(db, id) {
  return db.prepare('SELECT * FROM issue_history WHERE id = ?').get(id) ?? null;
}

export function listChangesForEvent(db, eventId) {
  return db
    .prepare(
      `SELECT id, field, old_value, new_value
         FROM issue_history_changes
        WHERE issue_history_id = ?
        ORDER BY id ASC`,
    )
    .all(eventId);
}

/**
 * Returns events for an issue in reverse chronological order, each with its
 * change rows attached. The user is denormalized onto each event for display.
 */
export function listForIssue(db, issueId) {
  const events = db
    .prepare(
      `SELECT h.id          AS id,
              h.kind        AS kind,
              h.note        AS note,
              h.changed_at  AS changed_at,
              h.user_id     AS user_id,
              u.name        AS user_name,
              u.email       AS user_email
         FROM issue_history h
         LEFT JOIN users u ON u.id = h.user_id
        WHERE h.issue_id = ?
        ORDER BY h.changed_at DESC, h.id DESC`,
    )
    .all(issueId);

  if (events.length === 0) return [];

  const ids = events.map((e) => e.id);
  const placeholders = ids.map(() => '?').join(',');
  const changes = db
    .prepare(
      `SELECT id, issue_history_id, field, old_value, new_value
         FROM issue_history_changes
        WHERE issue_history_id IN (${placeholders})
        ORDER BY id ASC`,
    )
    .all(...ids);

  const byEvent = new Map();
  for (const id of ids) byEvent.set(id, []);
  for (const c of changes) byEvent.get(c.issue_history_id).push(c);

  return events.map((e) => ({
    id: e.id,
    kind: e.kind,
    note: e.note,
    changed_at: e.changed_at,
    user: { id: e.user_id, name: e.user_name, email: e.user_email },
    changes: byEvent.get(e.id) ?? [],
  }));
}

export function countForIssue(db, issueId) {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM issue_history WHERE issue_id = ?')
    .get(issueId);
  return row.n;
}
