import * as projectsDb from '../db/projects.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as usersDb from '../db/users.js';

export const ROLES = Object.freeze(['viewer', 'user', 'developer']);

export class MemberError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MemberError';
    this.code = code;
  }
}

function validateRole(role) {
  if (!ROLES.includes(role)) throw new MemberError('invalid_role');
}

export function addMember(db, projectId, userId, role) {
  validateRole(role);
  const project = projectsDb.getById(db, projectId);
  if (!project) throw new MemberError('project_not_found');
  if (project.archived_at) throw new MemberError('project_archived');
  const user = usersDb.getById(db, userId);
  if (!user) throw new MemberError('user_not_found');
  try {
    return projectMembersDb.add(db, { projectId, userId, role });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new MemberError('duplicate_member');
    }
    throw err;
  }
}

export function removeMember(db, projectId, userId) {
  const role = projectMembersDb.getRole(db, projectId, userId);
  if (!role) throw new MemberError('not_a_member');
  projectMembersDb.remove(db, projectId, userId);
}

export function changeRole(db, projectId, userId, role) {
  validateRole(role);
  const current = projectMembersDb.getRole(db, projectId, userId);
  if (!current) throw new MemberError('not_a_member');
  projectMembersDb.setRole(db, projectId, userId, role);
}
