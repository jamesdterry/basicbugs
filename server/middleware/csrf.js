import crypto from 'node:crypto';
import { config } from '../config.js';
import { SESSION_COOKIE } from './requireUser.js';

export const CSRF_COOKIE = 'bb_csrf';
export const CSRF_HEADER = 'x-csrf-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function mintToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function ensureCookie(req, res) {
  let token = req.cookies?.[CSRF_COOKIE];
  if (!token) {
    token = mintToken();
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      sameSite: 'lax',
      path: '/',
      secure: config.isProduction,
    });
    if (req.cookies) req.cookies[CSRF_COOKIE] = token;
  }
  return token;
}

export function csrfMiddleware(req, res, next) {
  ensureCookie(req, res);

  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.path.startsWith('/api/')) return next();

  // Pre-session requests can't mutate state anyway — let the auth layer
  // return 401. CSRF is only meaningful when there's a session to ride on.
  if (!req.signedCookies?.[SESSION_COOKIE]) return next();

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get(CSRF_HEADER);

  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'csrf' });
  }
  next();
}
