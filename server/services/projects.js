import * as projectsDb from '../db/projects.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as metadata from './metadata.js';

export class ProjectError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
  }
}

const NAME_MAX = 80;

function validateName(raw) {
  if (typeof raw !== 'string') throw new ProjectError('invalid_name');
  const name = raw.trim().replace(/\s+/g, ' ');
  if (!name) throw new ProjectError('invalid_name');
  if (name.length > NAME_MAX) throw new ProjectError('invalid_name');
  return name;
}

export function createProject(db, { name }) {
  const cleanName = validateName(name);
  return db.transaction(() => {
    const project = projectsDb.create(db, { name: cleanName });
    metadata.seedDefaults(db, project.id);
    return project;
  })();
}

export function renameProject(db, id, name) {
  const cleanName = validateName(name);
  const project = projectsDb.getById(db, id);
  if (!project) throw new ProjectError('not_found');
  projectsDb.rename(db, id, cleanName);
  return projectsDb.getById(db, id);
}

export function archiveProject(db, id) {
  const project = projectsDb.getById(db, id);
  if (!project) throw new ProjectError('not_found');
  if (project.archived_at) return project;
  projectsDb.archive(db, id);
  return projectsDb.getById(db, id);
}

export function unarchiveProject(db, id) {
  const project = projectsDb.getById(db, id);
  if (!project) throw new ProjectError('not_found');
  if (!project.archived_at) return project;
  projectsDb.unarchive(db, id);
  return projectsDb.getById(db, id);
}

export function listVisibleForUser(db, user, { includeArchived = false } = {}) {
  if (user?.isSuperAdmin) {
    return projectsDb.list(db, { includeArchived }).map((p) => ({ ...p, role: 'super_admin' }));
  }
  return projectsDb.listForUser(db, user.id, { includeArchived });
}

export function getProjectDetail(db, projectId) {
  const project = projectsDb.getById(db, projectId);
  if (!project) return null;
  return {
    project,
    members: projectMembersDb.listForProject(db, projectId),
    metadata: metadata.listForProject(db, projectId),
  };
}
