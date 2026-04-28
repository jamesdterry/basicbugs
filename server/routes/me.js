import express from 'express';
import { config } from '../config.js';
import { createRequireUser } from '../middleware/requireUser.js';
import * as users from '../services/users.js';
import * as sessions from '../services/sessions.js';
import * as usersDb from '../db/users.js';
import * as notificationsDb from '../db/notifications.js';
import * as prefsDb from '../db/notificationPrefs.js';
import * as notificationsService from '../services/notifications.js';
import { handleError } from './errors.js';

function isSuperAdminEmail(email) {
  return !!config.superAdminEmail && email.toLowerCase() === config.superAdminEmail;
}

function publicSession(row, currentSessionId) {
  return {
    id: row.session_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    user_agent: row.user_agent,
    is_current: row.session_id === currentSessionId,
  };
}

export function createMeRouter({ db }) {
  const router = express.Router();
  router.use(createRequireUser({ db }));

  router.get('/', (req, res, next) => {
    try {
      const row = usersDb.getById(db, req.user.id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      res.json({
        user: {
          id: row.id,
          email: row.email,
          name: row.name,
          created_at: row.created_at,
          last_login_at: row.last_login_at,
          has_password: !!row.password_hash,
          is_super_admin: isSuperAdminEmail(row.email),
        },
      });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch('/', (req, res, next) => {
    try {
      const updated = users.updateName(db, req.user.id, req.body?.name);
      res.json({ user: { id: updated.id, name: updated.name, email: updated.email } });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/password', async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body ?? {};
      const row = usersDb.getById(db, req.user.id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      await users.changePassword(db, req.user.id, {
        currentPassword,
        newPassword,
        requireCurrent: !!row.password_hash,
        exceptSessionId: req.sessionId,
      });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.get('/sessions', (req, res, next) => {
    try {
      const list = sessions.listForUser(db, req.user.id);
      res.json({ sessions: list.map((row) => publicSession(row, req.sessionId)) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.delete('/sessions/:id', (req, res, next) => {
    try {
      const sessionId = req.params.id;
      if (!sessionId) return res.status(404).json({ error: 'not_found' });
      const row = sessions.getById(db, sessionId);
      if (!row || row.user_id !== req.user.id) {
        return res.status(404).json({ error: 'not_found' });
      }
      sessions.revoke(db, sessionId);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/sessions/revoke-others', (req, res, next) => {
    try {
      sessions.revokeOthersForUser(db, req.user.id, req.sessionId);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // ---------- Notifications ----------

  router.get('/notifications', (req, res, next) => {
    try {
      const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
      const limitRaw = Number.parseInt(req.query.limit, 10);
      const limit = Number.isInteger(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 50;
      const items = notificationsDb.listForUser(db, req.user.id, { unreadOnly, limit });
      const unread = notificationsDb.unreadCount(db, req.user.id);
      // Opportunistic recovery — flush rows the previous attempt left behind.
      notificationsService.kickDrain(db);
      res.json({ items, unreadCount: unread });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/notifications/:id/read', (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(404).json({ error: 'not_found' });
      const ok = notificationsDb.markRead(db, id, req.user.id);
      if (!ok) return res.status(404).json({ error: 'not_found' });
      const unread = notificationsDb.unreadCount(db, req.user.id);
      res.json({ ok: true, unreadCount: unread });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/notifications/read-all', (req, res, next) => {
    try {
      const updated = notificationsDb.markAllRead(db, req.user.id);
      res.json({ ok: true, updated });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.get('/notification-prefs', (req, res, next) => {
    try {
      res.json({ prefs: prefsDb.getAll(db, req.user.id) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch('/notification-prefs', (req, res, next) => {
    try {
      const body = req.body ?? {};
      const updates = {};
      for (const k of prefsDb.KINDS) {
        if (Object.prototype.hasOwnProperty.call(body, k)) {
          updates[k] = !!body[k];
        }
      }
      const extra = Object.keys(body).filter((k) => !prefsDb.KINDS.includes(k));
      if (extra.length > 0) return res.status(400).json({ error: 'invalid_pref_kind' });
      prefsDb.setMany(db, req.user.id, updates);
      res.json({ prefs: prefsDb.getAll(db, req.user.id) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  return router;
}
