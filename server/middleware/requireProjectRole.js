import * as projectsDb from '../db/projects.js';
import * as projectMembersDb from '../db/projectMembers.js';

const RANK = Object.freeze({ viewer: 1, user: 2, developer: 3 });

export function createRequireProjectRole({ db, minimum = 'viewer', paramName = 'id' } = {}) {
  if (!RANK[minimum]) throw new Error(`unknown role: ${minimum}`);
  const min = RANK[minimum];

  return function requireProjectRole(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });

    const idRaw = req.params?.[paramName];
    const projectId = Number.parseInt(idRaw, 10);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(404).json({ error: 'not_found' });
    }

    const project = projectsDb.getById(db, projectId);
    if (!project) return res.status(404).json({ error: 'not_found' });

    if (req.user.isSuperAdmin) {
      req.project = project;
      req.projectRole = 'developer';
      return next();
    }

    const role = projectMembersDb.getRole(db, projectId, req.user.id);
    if (!role) return res.status(404).json({ error: 'not_found' });

    if (RANK[role] < min) return res.status(403).json({ error: 'forbidden' });

    req.project = project;
    req.projectRole = role;
    next();
  };
}
