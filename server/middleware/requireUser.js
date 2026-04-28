import { config } from '../config.js';
import * as sessions from '../services/sessions.js';

export const SESSION_COOKIE = 'bb_session';

export function loadSessionFromCookie(db, req, res) {
  const cookieValue = req.signedCookies?.[SESSION_COOKIE];
  if (!cookieValue) return null;

  const session = sessions.getByCookie(db, cookieValue);
  if (!session) {
    if (res) res.clearCookie(SESSION_COOKIE, { path: '/' });
    return null;
  }

  sessions.touch(db, session.sessionId, session.lastSeenAt);

  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isSuperAdmin:
        !!config.superAdminEmail && session.user.email.toLowerCase() === config.superAdminEmail,
    },
    sessionId: session.sessionId,
  };
}

export function createRequireUser({ db }) {
  return function requireUser(req, res, next) {
    const loaded = loadSessionFromCookie(db, req, res);
    if (!loaded) return res.status(401).json({ error: 'unauthorized' });
    req.user = loaded.user;
    req.sessionId = loaded.sessionId;
    next();
  };
}
