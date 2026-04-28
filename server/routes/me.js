import express from 'express';
import { config } from '../config.js';
import { createRequireUser } from '../middleware/requireUser.js';
import * as users from '../services/users.js';
import * as sessions from '../services/sessions.js';
import * as usersDb from '../db/users.js';
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

  return router;
}
