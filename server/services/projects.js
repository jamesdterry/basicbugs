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

// Hard-deletes a project and every row that hangs off it (issues, history,
// attachments, watchers, notifications, members, metadata). Returns the
// project row that was deleted plus the list of attachment storage_paths
// captured before the cascade so the caller can clean up files on disk / S3.
// Throws ProjectError('not_found') if the id does not resolve.
//
// Cascade map (see migrations 0001-0005):
//   projects --CASCADE--> project_members, issue_statuses, issue_categories,
//                         issue_priorities
//   projects --(no cascade)--> issues   (deleted explicitly here)
//   issues   --CASCADE--> issue_history, attachments, issue_watchers,
//                         notifications
//   issue_history --CASCADE--> issue_history_changes
export function hardDeleteProject(db, projectId) {
  return db.transaction(() => {
    const project = projectsDb.getById(db, projectId);
    if (!project) throw new ProjectError('not_found');

    const relPaths = db
      .prepare(
        `SELECT a.storage_path AS storagePath
           FROM attachments a
           JOIN issues i ON i.id = a.issue_id
          WHERE i.project_id = ?`,
      )
      .all(projectId)
      .map((row) => row.storagePath);

    db.prepare('DELETE FROM issues WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);

    return { project, relPaths };
  })();
}
