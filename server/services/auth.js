import { config } from '../config.js';
import * as tokens from './tokens.js';
import * as email from './email.js';
import * as authDb from '../db/auth.js';

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

function mintToken(db, { userId, purpose, ttlMs }) {
  const t = tokens.generate();
  authDb.deleteForUser(db, userId, purpose);
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  authDb.insertToken(db, { userId, purpose, tokenHash: t.hash, expiresAt });
  return t.raw;
}

export async function sendMagicLink(db, user) {
  const raw = db.transaction(() =>
    mintToken(db, {
      userId: user.id,
      purpose: 'magic_link',
      ttlMs: MAGIC_LINK_TTL_MS,
    }),
  )();
  const url = `${config.baseUrl}/auth/verify?token=${encodeURIComponent(raw)}`;
  const tmpl = email.magicLinkEmail({ url });
  await email.send({ to: user.email, ...tmpl });
}

export async function sendPasswordReset(db, user) {
  const raw = db.transaction(() =>
    mintToken(db, {
      userId: user.id,
      purpose: 'password_reset',
      ttlMs: PASSWORD_RESET_TTL_MS,
    }),
  )();
  const url = `${config.baseUrl}/reset.html?token=${encodeURIComponent(raw)}`;
  const tmpl = email.passwordResetEmail({ url });
  await email.send({ to: user.email, ...tmpl });
}
