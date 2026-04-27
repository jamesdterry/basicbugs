import { config } from '../config.js';
import * as sessions from '../services/sessions.js';

export const SESSION_COOKIE = 'bb_session';

export function createRequireUser({ db }) {
  return function requireUser(req, res, next) {
    const cookieValue = req.signedCookies?.[SESSION_COOKIE];
    if (!cookieValue) return res.status(401).json({ error: 'unauthorized' });

    const session = sessions.getByCookie(db, cookieValue);
    if (!session) {
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      return res.status(401).json({ error: 'unauthorized' });
    }

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isSuperAdmin:
        !!config.superAdminEmail && session.user.email.toLowerCase() === config.superAdminEmail,
    };
    req.sessionId = session.sessionId;

    sessions.touch(db, session.sessionId, session.lastSeenAt);
    next();
  };
}
