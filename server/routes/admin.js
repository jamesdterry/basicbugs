import express from 'express';
import { config } from '../config.js';
import { createRequireUser } from '../middleware/requireUser.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import * as users from '../services/users.js';
import * as sessions from '../services/sessions.js';
import * as auth from '../services/auth.js';
import * as projectMembers from '../services/projectMembers.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as usersDb from '../db/users.js';
import { handleError } from './errors.js';

function parseId(raw) {
  const id = Number.parseInt(raw, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isSuperAdminEmail(email) {
  return !!config.superAdminEmail && email.toLowerCase() === config.superAdminEmail;
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    last_login_at: row.last_login_at,
    is_disabled: !!row.is_disabled,
    has_password:
      row.has_password !== undefined ? !!row.has_password : !!row.password_hash,
    is_super_admin: isSuperAdminEmail(row.email),
  };
}

function publicSession(row, currentSessionId) {
  return {
    id: row.session_id,
    user_id: row.user_id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
    expires_at: row.expires_at,
    last_seen_at: row.last_seen_at,
    user_agent: row.user_agent,
    is_current: row.session_id === currentSessionId,
  };
}

export function createAdminRouter({ db }) {
  const router = express.Router();
  const requireUser = createRequireUser({ db });
  const gate = [requireUser, requireSuperAdmin];

  // ---------- Users ----------

  router.get('/users', ...gate, (req, res, next) => {
    try {
      const search = typeof req.query.search === 'string' ? req.query.search : '';
      const includeDisabled = req.query.includeDisabled !== '0';
      const list = users.listUsers(db, { search, includeDisabled });
      res.json({ users: list.map(publicUser) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users', ...gate, async (req, res, next) => {
    try {
      const { email, name, sendInvite = true, projectId, role } = req.body ?? {};
      const wantsMembership = projectId !== undefined && projectId !== null && projectId !== '';
      const projectIdNum = wantsMembership ? Number.parseInt(projectId, 10) : null;
      if (wantsMembership && (!Number.isInteger(projectIdNum) || projectIdNum <= 0)) {
        return res.status(400).json({ error: 'invalid_project' });
      }

      const created = db.transaction(() => {
        const user = users.inviteUser(db, { email, name });
        if (wantsMembership) {
          projectMembers.addMember(db, projectIdNum, user.id, role);
        }
        return user;
      })();

      if (sendInvite !== false) {
        await auth.sendMagicLink(db, { id: created.id, email: created.email });
      }
      res.status(201).json({ user: publicUser(created) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.get('/users/:id', ...gate, (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const user = users.getById(db, id);
      const memberships = projectMembersDb.listForUser(db, id);
      res.json({ user: publicUser(user), memberships });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch('/users/:id', ...gate, (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const updated = users.updateName(db, id, req.body?.name);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users/:id/disable', ...gate, (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const updated = users.setDisabled(db, id, true);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users/:id/enable', ...gate, (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const updated = users.setDisabled(db, id, false);
      res.json({ user: publicUser(updated) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users/:id/send-magic-link', ...gate, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const row = usersDb.getById(db, id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (row.is_disabled) return res.status(409).json({ error: 'user_disabled' });
      await auth.sendMagicLink(db, { id: row.id, email: row.email });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users/:id/send-reset', ...gate, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const row = usersDb.getById(db, id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      if (row.is_disabled) return res.status(409).json({ error: 'user_disabled' });
      await auth.sendPasswordReset(db, { id: row.id, email: row.email });
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/users/:id/sign-out-everywhere', ...gate, (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (!id) return res.status(404).json({ error: 'not_found' });
      const row = usersDb.getById(db, id);
      if (!row) return res.status(404).json({ error: 'not_found' });
      sessions.revokeAllForUser(db, id);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // ---------- Sessions ----------

  router.get('/sessions', ...gate, (req, res, next) => {
    try {
      const userIdParam = req.query.userId;
      let list;
      if (userIdParam !== undefined) {
        const userId = parseId(userIdParam);
        if (!userId) return res.json({ sessions: [] });
        list = sessions.listForUser(db, userId);
      } else {
        const limit = Math.min(Math.max(parseId(req.query.limit) ?? 200, 1), 500);
        list = sessions.listAll(db, { limit });
      }
      res.json({ sessions: list.map((row) => publicSession(row, req.sessionId)) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.delete('/sessions/:id', ...gate, (req, res, next) => {
    try {
      const sessionId = req.params.id;
      if (!sessionId) return res.status(404).json({ error: 'not_found' });
      const row = sessions.getById(db, sessionId);
      if (!row) return res.status(404).json({ error: 'not_found' });
      sessions.revoke(db, sessionId);
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // Map service errors that propagate via next(err) to HTTP responses.
  router.use((err, _req, res, next) => {
    handleError(res, next, err);
  });

  return router;
}
