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

export function setDisabled(db, userId, isDisabled) {
  db.prepare('UPDATE users SET is_disabled = ? WHERE id = ?').run(isDisabled ? 1 : 0, userId);
}
