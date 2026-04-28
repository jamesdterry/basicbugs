export function add(db, issueId, userId) {
  db.prepare('INSERT OR IGNORE INTO issue_watchers (issue_id, user_id) VALUES (?, ?)').run(
    issueId,
    userId,
  );
}

export function remove(db, issueId, userId) {
  db.prepare('DELETE FROM issue_watchers WHERE issue_id = ? AND user_id = ?').run(
    issueId,
    userId,
  );
}

export function isWatching(db, issueId, userId) {
  const row = db
    .prepare('SELECT 1 AS x FROM issue_watchers WHERE issue_id = ? AND user_id = ?')
    .get(issueId, userId);
  return !!row;
}

export function listForIssue(db, issueId) {
  return db
    .prepare(
      `SELECT w.user_id, u.email, u.name, u.is_disabled
         FROM issue_watchers w
         JOIN users u ON u.id = w.user_id
        WHERE w.issue_id = ?`,
    )
    .all(issueId);
}
