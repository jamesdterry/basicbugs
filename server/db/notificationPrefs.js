export const KINDS = Object.freeze([
  'assigned_to_me',
  'mentioned',
  'watched_status_change',
  'watched_any_change',
]);

// Default-on: missing rows mean "enabled".
export function isEnabled(db, userId, kind) {
  const row = db
    .prepare('SELECT enabled FROM notification_prefs WHERE user_id = ? AND kind = ?')
    .get(userId, kind);
  if (!row) return true;
  return !!row.enabled;
}

export function getAll(db, userId) {
  const rows = db
    .prepare('SELECT kind, enabled FROM notification_prefs WHERE user_id = ?')
    .all(userId);
  const map = {};
  for (const k of KINDS) map[k] = true;
  for (const r of rows) map[r.kind] = !!r.enabled;
  return map;
}

export function setOne(db, userId, kind, enabled) {
  if (!KINDS.includes(kind)) throw new Error(`invalid_pref_kind:${kind}`);
  db.prepare(
    `INSERT INTO notification_prefs (user_id, kind, enabled)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled`,
  ).run(userId, kind, enabled ? 1 : 0);
}

export function setMany(db, userId, prefs) {
  for (const [kind, enabled] of Object.entries(prefs)) {
    setOne(db, userId, kind, enabled);
  }
}
