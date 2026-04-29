import express from 'express';
import { createRequireUser } from '../middleware/requireUser.js';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin.js';
import { createRequireProjectRole } from '../middleware/requireProjectRole.js';
import * as projects from '../services/projects.js';
import * as projectMembers from '../services/projectMembers.js';
import * as metadata from '../services/metadata.js';
import * as metadataDb from '../db/metadata.js';
import * as mentions from '../services/mentions.js';
import * as adminAudit from '../services/adminAudit.js';
import { createIssuesRouter } from './issues.js';
import { handleError } from './errors.js';

export function createProjectsRouter({ db }) {
  const router = express.Router();
  const requireUser = createRequireUser({ db });
  const requireProjectViewer = createRequireProjectRole({ db, minimum: 'viewer' });
  const requireProjectDeveloper = createRequireProjectRole({ db, minimum: 'developer' });

  router.use(requireUser);

  // ---------- Admin: projects ----------

  router.post('/admin/projects', requireSuperAdmin, (req, res, next) => {
    try {
      const addSelf = req.body?.addSelfAsMember !== false;
      const project = db.transaction(() => {
        const created = projects.createProject(db, { name: req.body?.name });
        if (addSelf) {
          projectMembers.addMember(db, created.id, req.user.id, 'developer');
        }
        adminAudit.log(db, req, {
          action: 'project.create',
          targetType: 'project',
          targetId: created.id,
          payload: { name: created.name, addSelfAsMember: addSelf },
        });
        return created;
      })();
      res.status(201).json({ project });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch('/admin/projects/:id', requireSuperAdmin, (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const project = db.transaction(() => {
        const result = projects.renameProject(db, id, req.body?.name);
        adminAudit.log(db, req, {
          action: 'project.rename',
          targetType: 'project',
          targetId: id,
          payload: { name: result.name },
        });
        return result;
      })();
      res.json({ project });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/admin/projects/:id/archive', requireSuperAdmin, (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const project = db.transaction(() => {
        const result = projects.archiveProject(db, id);
        adminAudit.log(db, req, {
          action: 'project.archive',
          targetType: 'project',
          targetId: id,
        });
        return result;
      })();
      res.json({ project });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/admin/projects/:id/unarchive', requireSuperAdmin, (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      const project = db.transaction(() => {
        const result = projects.unarchiveProject(db, id);
        adminAudit.log(db, req, {
          action: 'project.unarchive',
          targetType: 'project',
          targetId: id,
        });
        return result;
      })();
      res.json({ project });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // ---------- Admin: members ----------

  router.post('/admin/projects/:id/members', requireSuperAdmin, (req, res, next) => {
    try {
      const projectId = Number.parseInt(req.params.id, 10);
      const userId = Number.parseInt(req.body?.userId, 10);
      if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: 'invalid_user_id' });
      }
      const member = db.transaction(() => {
        const result = projectMembers.addMember(db, projectId, userId, req.body?.role);
        adminAudit.log(db, req, {
          action: 'member.add',
          targetType: 'project',
          targetId: projectId,
          payload: { userId, role: req.body?.role ?? null },
        });
        return result;
      })();
      res.status(201).json({ member });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch('/admin/projects/:id/members/:userId', requireSuperAdmin, (req, res, next) => {
    try {
      const projectId = Number.parseInt(req.params.id, 10);
      const userId = Number.parseInt(req.params.userId, 10);
      db.transaction(() => {
        projectMembers.changeRole(db, projectId, userId, req.body?.role);
        adminAudit.log(db, req, {
          action: 'member.change_role',
          targetType: 'project',
          targetId: projectId,
          payload: { userId, role: req.body?.role ?? null },
        });
      })();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.delete('/admin/projects/:id/members/:userId', requireSuperAdmin, (req, res, next) => {
    try {
      const projectId = Number.parseInt(req.params.id, 10);
      const userId = Number.parseInt(req.params.userId, 10);
      db.transaction(() => {
        projectMembers.removeMember(db, projectId, userId);
        adminAudit.log(db, req, {
          action: 'member.remove',
          targetType: 'project',
          targetId: projectId,
          payload: { userId },
        });
      })();
      res.json({ ok: true });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // ---------- Project listing & detail ----------

  router.get('/projects', (req, res, next) => {
    try {
      const includeArchived = req.query.includeArchived === '1';
      const items = projects.listVisibleForUser(db, req.user, { includeArchived });
      res.json({ projects: items });
    } catch (err) {
      next(err);
    }
  });

  router.get('/projects/:id', requireProjectViewer, (req, res, next) => {
    try {
      const detail = projects.getProjectDetail(db, req.project.id);
      res.json(detail);
    } catch (err) {
      next(err);
    }
  });

  // ---------- Metadata ----------

  function readKind(req, res) {
    const kind = req.params.kind;
    if (!metadataDb.isValidKind(kind)) {
      res.status(404).json({ error: 'invalid_kind' });
      return null;
    }
    return kind;
  }

  router.get('/projects/:id/metadata/:kind', requireProjectViewer, (req, res, next) => {
    try {
      const kind = readKind(req, res);
      if (!kind) return;
      const includeArchived = req.query.includeArchived === '1';
      const items = metadata.listKind(db, kind, req.project.id, { includeArchived });
      res.json({ items });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/projects/:id/metadata/:kind', requireProjectDeveloper, (req, res, next) => {
    try {
      const kind = readKind(req, res);
      if (!kind) return;
      const item = metadata.createItem(db, kind, req.project.id, {
        name: req.body?.name,
        isClosed: req.body?.isClosed,
      });
      res.status(201).json({ item });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.patch(
    '/projects/:id/metadata/:kind/:itemId',
    requireProjectDeveloper,
    (req, res, next) => {
      try {
        const kind = readKind(req, res);
        if (!kind) return;
        const itemId = Number.parseInt(req.params.itemId, 10);
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return res.status(404).json({ error: 'not_found' });
        }

        const projectId = req.project.id;
        const body = req.body ?? {};

        db.transaction(() => {
          if (typeof body.name === 'string') {
            metadata.renameItem(db, kind, projectId, itemId, body.name);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) {
            metadata.reorder(db, kind, projectId, itemId, body.sortOrder);
          }
          if (body.isDefault === true) {
            metadata.setDefault(db, kind, projectId, itemId);
          }
          if (Object.prototype.hasOwnProperty.call(body, 'isClosed')) {
            metadata.setClosed(db, kind, projectId, itemId, !!body.isClosed);
          }
        })();

        const item = metadataDb.getById(db, kind, itemId);
        if (!item || item.project_id !== projectId) {
          return res.status(404).json({ error: 'not_found' });
        }
        res.json({ item });
      } catch (err) {
        handleError(res, next, err);
      }
    },
  );

  router.delete(
    '/projects/:id/metadata/:kind/:itemId',
    requireProjectDeveloper,
    (req, res, next) => {
      try {
        const kind = readKind(req, res);
        if (!kind) return;
        const itemId = Number.parseInt(req.params.itemId, 10);
        if (!Number.isInteger(itemId) || itemId <= 0) {
          return res.status(404).json({ error: 'not_found' });
        }
        metadata.archiveItem(db, kind, req.project.id, itemId);
        res.json({ ok: true });
      } catch (err) {
        handleError(res, next, err);
      }
    },
  );

  router.post(
    '/admin/projects/:id/metadata/:kind/reset',
    requireSuperAdmin,
    (req, res, next) => {
      try {
        const kind = readKind(req, res);
        if (!kind) return;
        const projectId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(projectId) || projectId <= 0) {
          return res.status(404).json({ error: 'not_found' });
        }
        const items = db.transaction(() => {
          metadata.resetToDefaults(db, projectId, kind);
          adminAudit.log(db, req, {
            action: 'metadata.reset',
            targetType: 'project',
            targetId: projectId,
            payload: { kind },
          });
          return metadata.listKind(db, kind, projectId, { includeArchived: false });
        })();
        res.json({ items });
      } catch (err) {
        handleError(res, next, err);
      }
    },
  );

  router.post(
    '/admin/projects/:id/metadata/:kind/copy-from/:srcId',
    requireSuperAdmin,
    (req, res, next) => {
      try {
        const kind = readKind(req, res);
        if (!kind) return;
        const projectId = Number.parseInt(req.params.id, 10);
        const srcId = Number.parseInt(req.params.srcId, 10);
        if (!Number.isInteger(projectId) || projectId <= 0) {
          return res.status(404).json({ error: 'not_found' });
        }
        if (!Number.isInteger(srcId) || srcId <= 0) {
          return res.status(400).json({ error: 'invalid_source' });
        }
        const result = db.transaction(() => {
          const inserted = metadata.copyFromProject(db, srcId, projectId, kind);
          adminAudit.log(db, req, {
            action: 'metadata.copy_from',
            targetType: 'project',
            targetId: projectId,
            payload: { kind, sourceProjectId: srcId, inserted },
          });
          const items = metadata.listKind(db, kind, projectId, { includeArchived: false });
          return { inserted, items };
        })();
        res.json(result);
      } catch (err) {
        handleError(res, next, err);
      }
    },
  );

  // ---------- Mention autocomplete ----------

  router.get('/projects/:id/member-mentions', requireProjectViewer, (req, res, next) => {
    try {
      const items = mentions.listMembersForMentions(db, req.project.id);
      res.json({ items });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  // ---------- Issues ----------
  router.use('/projects/:id/issues', createIssuesRouter({ db }));

  // Map service errors that propagate via next(err) from sub-routers.
  router.use((err, _req, res, next) => {
    handleError(res, next, err);
  });

  return router;
}
