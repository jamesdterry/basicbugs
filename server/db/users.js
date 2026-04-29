export function getByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email) ?? null;
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) ?? null;
}

export function create(db, { email, name = null, passwordHash = null }) {
  const info = db
    .prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)')
    .run(email, name, passwordHash);
  return getById(db, info.lastInsertRowid);
}

export function setPasswordHash(db, userId, passwordHash) {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function setLastLoginAt(db, userId, when = new Date().toISOString()) {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(when, userId);
}

export function setName(db, userId, name) {
  db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
}

export function setEmail(db, userId, email) {
  db.prepare('UPDATE users SET email = ? WHERE id = ?').run(email, userId);
}

export function setDisabled(db, userId, isDisabled) {
  db.prepare('UPDATE users SET is_disabled = ? WHERE id = ?').run(isDisabled ? 1 : 0, userId);
}

export function list(db, { search = '', includeDisabled = true } = {}) {
  const term = (search || '').trim();
  const where = [];
  const params = [];
  if (!includeDisabled) where.push('is_disabled = 0');
  if (term) {
    where.push("(email LIKE ? ESCAPE '\\' OR (name IS NOT NULL AND name LIKE ? ESCAPE '\\'))");
    const like = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
    params.push(like, like);
  }
  const sql =
    'SELECT id, email, name, created_at, last_login_at, is_disabled, password_hash IS NOT NULL AS has_password' +
    ' FROM users' +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    " ORDER BY COALESCE(NULLIF(name, ''), email) COLLATE NOCASE";
  return db.prepare(sql).all(...params);
}
