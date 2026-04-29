export function insertToken(db, { userId, purpose, tokenHash, expiresAt }) {
  const info = db
    .prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(userId, purpose, tokenHash, expiresAt);
  return info.lastInsertRowid;
}

export function findActiveByHash(db, tokenHash, purpose, now = new Date().toISOString()) {
  return (
    db
      .prepare(
        `SELECT * FROM auth_tokens
         WHERE token_hash = ?
           AND purpose = ?
           AND used_at IS NULL
           AND expires_at > ?`,
      )
      .get(tokenHash, purpose, now) ?? null
  );
}

export function markUsed(db, tokenId, when = new Date().toISOString()) {
  const info = db
    .prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL')
    .run(when, tokenId);
  return info.changes === 1;
}

export function deleteForUser(db, userId, purpose) {
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose);
}
