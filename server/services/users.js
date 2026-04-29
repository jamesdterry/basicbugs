import * as usersDb from '../db/users.js';
import * as passwords from './passwords.js';
import * as sessions from './sessions.js';

export class UserError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'UserError';
    this.code = code;
  }
}

const NAME_MAX = 80;
const EMAIL_MAX = 254;
const MIN_PASSWORD_LENGTH = 10;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) throw new UserError('invalid_name');
  if (name.length > NAME_MAX) throw new UserError('invalid_name');
  return name;
}

function validateEmail(raw) {
  if (typeof raw !== 'string') throw new UserError('invalid_email');
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) {
    throw new UserError('invalid_email');
  }
  return email;
}

export function listUsers(db, { search = '', includeDisabled = true } = {}) {
  return usersDb.list(db, { search, includeDisabled });
}

export function getById(db, userId) {
  const row = usersDb.getById(db, userId);
  if (!row) throw new UserError('not_found');
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    is_disabled: !!row.is_disabled,
    has_password: !!row.password_hash,
  };
}

export function updateName(db, userId, name) {
  return updateProfile(db, userId, { name });
}

export function updateProfile(db, userId, { name, email } = {}) {
  const wantsName = name !== undefined;
  const wantsEmail = email !== undefined;
  if (!wantsName && !wantsEmail) throw new UserError('invalid_body');

  const existing = usersDb.getById(db, userId);
  if (!existing) throw new UserError('not_found');

  const cleanName = wantsName ? validateName(name) : null;
  let cleanEmail = null;
  if (wantsEmail) {
    cleanEmail = validateEmail(email);
    if (cleanEmail !== existing.email.toLowerCase()) {
      const clash = usersDb.getByEmail(db, cleanEmail);
      if (clash && clash.id !== userId) throw new UserError('duplicate_email');
    }
  }

  db.transaction(() => {
    if (wantsName) usersDb.setName(db, userId, cleanName);
    if (wantsEmail && cleanEmail !== existing.email) {
      usersDb.setEmail(db, userId, cleanEmail);
    }
  })();
  return getById(db, userId);
}

export function setDisabled(db, userId, isDisabled) {
  const existing = usersDb.getById(db, userId);
  if (!existing) throw new UserError('not_found');
  db.transaction(() => {
    usersDb.setDisabled(db, userId, !!isDisabled);
    if (isDisabled) sessions.revokeAllForUser(db, userId);
  })();
  return getById(db, userId);
}

export function inviteUser(db, { email, name = null }) {
  const cleanEmail = validateEmail(email);
  const cleanName = name == null || name === '' ? null : validateName(name);
  if (usersDb.getByEmail(db, cleanEmail)) throw new UserError('duplicate_email');
  return usersDb.create(db, { email: cleanEmail, name: cleanName });
}

export async function changePassword(
  db,
  userId,
  { currentPassword, newPassword, requireCurrent = true, exceptSessionId = null } = {},
) {
  if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new UserError('password_too_short');
  }
  const user = usersDb.getById(db, userId);
  if (!user) throw new UserError('not_found');
  if (requireCurrent) {
    if (typeof currentPassword !== 'string' || !currentPassword) {
      throw new UserError('wrong_password');
    }
    if (!user.password_hash) throw new UserError('wrong_password');
    const ok = await passwords.verify(currentPassword, user.password_hash);
    if (!ok) throw new UserError('wrong_password');
  }
  const passwordHash = await passwords.hash(newPassword);
  db.transaction(() => {
    usersDb.setPasswordHash(db, userId, passwordHash);
    sessions.revokeOthersForUser(db, userId, exceptSessionId);
  })();
}

export const PASSWORD_MIN = MIN_PASSWORD_LENGTH;
