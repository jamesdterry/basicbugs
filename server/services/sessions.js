import crypto from 'node:crypto';
import * as sessionsDb from '../db/sessions.js';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_THROTTLE_MS = 60 * 1000;

export function createForUser(db, { userId, userAgent = null, now = new Date() } = {}) {
  if (!userId) throw new Error('createForUser requires userId');
  const id = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  sessionsDb.insert(db, { id, userId, expiresAt, userAgent });
  return { id, expiresAt };
}

export function getByCookie(db, cookieValue, { now = new Date() } = {}) {
  if (!cookieValue) return null;
  const row = sessionsDb.getWithUser(db, cookieValue);
  if (!row) return null;
  if (row.is_disabled) return null;
  if (new Date(row.expires_at) <= now) return null;
  return {
    sessionId: row.session_id,
    user: {
      id: row.user_id,
      email: row.email,
      name: row.name,
    },
    lastSeenAt: row.last_seen_at,
  };
}

export function touch(db, sessionId, lastSeenAt, { now = new Date() } = {}) {
  if (!sessionId) return;
  if (lastSeenAt && now.getTime() - new Date(lastSeenAt).getTime() < TOUCH_THROTTLE_MS) {
    return;
  }
  sessionsDb.touchLastSeen(db, sessionId, now.toISOString());
}

export function revoke(db, sessionId) {
  if (!sessionId) return;
  sessionsDb.deleteById(db, sessionId);
}

export function revokeAllForUser(db, userId) {
  sessionsDb.deleteAllForUser(db, userId);
}

export function revokeOthersForUser(db, userId, exceptSessionId) {
  if (!exceptSessionId) {
    sessionsDb.deleteAllForUser(db, userId);
    return;
  }
  sessionsDb.deleteAllForUserExcept(db, userId, exceptSessionId);
}

export function listAll(db, opts = {}) {
  return sessionsDb.listAll(db, opts);
}

export function listForUser(db, userId) {
  return sessionsDb.listForUser(db, userId);
}

export function getById(db, sessionId) {
  return sessionsDb.getById(db, sessionId);
}

export const TTL_MS = SESSION_TTL_MS;
