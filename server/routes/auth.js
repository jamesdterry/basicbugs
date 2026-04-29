import express from 'express';
import { config } from '../config.js';
import * as passwords from '../services/passwords.js';
import * as tokens from '../services/tokens.js';
import * as sessions from '../services/sessions.js';
import * as auth from '../services/auth.js';
import * as usersDb from '../db/users.js';
import * as authDb from '../db/auth.js';
import { createRequireUser, SESSION_COOKIE } from '../middleware/requireUser.js';
import { byIp, byEmail } from '../middleware/rateLimit.js';

const MAGIC_LINK_TTL_MS = auth.MAGIC_LINK_TTL_MS;
const PASSWORD_RESET_TTL_MS = auth.PASSWORD_RESET_TTL_MS;
const MIN_PASSWORD_LENGTH = 10;

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    signed: true,
    secure: config.isProduction,
    maxAge: sessions.TTL_MS,
  };
}

function setSessionCookie(res, sessionId) {
  res.cookie(SESSION_COOKIE, sessionId, cookieOptions());
}

function isValidEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeEmail(value) {
  return value.toLowerCase().trim();
}

export function createAuthRouter({ db }) {
  const router = express.Router();
  const requireUser = createRequireUser({ db });

  const limitLogin = [
    byIp({ name: 'login', capacity: 5, refillMs: 15 * 60 * 1000 }),
    byEmail({ name: 'login', capacity: 5, refillMs: 15 * 60 * 1000 }),
  ];
  const limitMagic = [
    byIp({ name: 'magic', capacity: 5, refillMs: 15 * 60 * 1000 }),
    byEmail({ name: 'magic', capacity: 5, refillMs: 15 * 60 * 1000 }),
  ];
  const limitForgot = [
    byIp({ name: 'forgot', capacity: 5, refillMs: 15 * 60 * 1000 }),
    byEmail({ name: 'forgot', capacity: 5, refillMs: 15 * 60 * 1000 }),
  ];
  const limitReset = [byIp({ name: 'reset', capacity: 5, refillMs: 15 * 60 * 1000 })];

  router.post('/login', ...limitLogin, async (req, res, next) => {
    try {
      const rawEmail = req.body?.email;
      const password = req.body?.password;
      if (!isValidEmail(rawEmail) || typeof password !== 'string' || !password) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const user = usersDb.getByEmail(db, normalizeEmail(rawEmail));
      if (!user || user.is_disabled || !user.password_hash) {
        return res.status(401).json({ error: 'invalid_credentials' });
      }
      const ok = await passwords.verify(password, user.password_hash);
      if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

      const session = db.transaction(() => {
        usersDb.setLastLoginAt(db, user.id);
        return sessions.createForUser(db, {
          userId: user.id,
          userAgent: req.get('user-agent') ?? null,
        });
      })();

      setSessionCookie(res, session.id);
      res.json({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin:
            !!config.superAdminEmail && user.email.toLowerCase() === config.superAdminEmail,
        },
      });
    } catch (err) {
      next(err);
    }
  });

  router.post('/magic-link', ...limitMagic, async (req, res, next) => {
    try {
      const rawEmail = req.body?.email;
      if (!isValidEmail(rawEmail)) return res.json({ ok: true });
      const normalized = normalizeEmail(rawEmail);

      const target = db.transaction(() => {
        let user = usersDb.getByEmail(db, normalized);
        if (!user && normalized === config.superAdminEmail) {
          user = usersDb.create(db, { email: normalized });
        }
        if (!user || user.is_disabled) return null;
        return { id: user.id, email: user.email };
      })();

      if (target) await auth.sendMagicLink(db, target);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/verify', (req, res) => {
    const raw = typeof req.query.token === 'string' ? req.query.token : '';
    if (!raw) return res.redirect('/login.html?error=invalid_link');
    res.redirect(`/verify.html?token=${encodeURIComponent(raw)}`);
  });

  router.post('/verify', (req, res, next) => {
    try {
      const raw = typeof req.body?.token === 'string' ? req.body.token : '';
      if (!raw) return res.status(400).json({ error: 'invalid_link' });
      const hash = tokens.hashRaw(raw);

      const sessionResult = db.transaction(() => {
        const tokenRow = authDb.findActiveByHash(db, hash, 'magic_link');
        if (!tokenRow) return null;
        if (!authDb.markUsed(db, tokenRow.id)) return null;
        usersDb.setLastLoginAt(db, tokenRow.user_id);
        return sessions.createForUser(db, {
          userId: tokenRow.user_id,
          userAgent: req.get('user-agent') ?? null,
        });
      })();

      if (!sessionResult) return res.status(400).json({ error: 'invalid_link' });
      setSessionCookie(res, sessionResult.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', requireUser, (req, res, next) => {
    try {
      sessions.revoke(db, req.sessionId);
      res.clearCookie(SESSION_COOKIE, { path: '/' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/forgot', ...limitForgot, async (req, res, next) => {
    try {
      const rawEmail = req.body?.email;
      if (!isValidEmail(rawEmail)) return res.json({ ok: true });
      const normalized = normalizeEmail(rawEmail);

      const target = db.transaction(() => {
        const user = usersDb.getByEmail(db, normalized);
        if (!user || user.is_disabled || !user.password_hash) return null;
        return { id: user.id, email: user.email };
      })();

      if (target) await auth.sendPasswordReset(db, target);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.post('/reset', ...limitReset, async (req, res, next) => {
    try {
      const raw = req.body?.token;
      const password = req.body?.password;
      if (typeof raw !== 'string' || !raw) {
        return res.status(400).json({ error: 'invalid_token' });
      }
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        return res.status(400).json({ error: 'weak_password' });
      }

      const hash = tokens.hashRaw(raw);
      const tokenRow = authDb.findActiveByHash(db, hash, 'password_reset');
      if (!tokenRow) return res.status(400).json({ error: 'invalid_token' });

      const passwordHash = await passwords.hash(password);

      const claimed = db.transaction(() => {
        if (!authDb.markUsed(db, tokenRow.id)) return false;
        usersDb.setPasswordHash(db, tokenRow.user_id, passwordHash);
        sessions.revokeAllForUser(db, tokenRow.user_id);
        return true;
      })();

      if (!claimed) return res.status(400).json({ error: 'invalid_token' });
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireUser, (req, res) => {
    res.json({ user: req.user });
  });

  return router;
}

export function _consts() {
  return { MAGIC_LINK_TTL_MS, PASSWORD_RESET_TTL_MS, MIN_PASSWORD_LENGTH };
}
