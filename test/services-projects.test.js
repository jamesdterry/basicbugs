import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as usersDb from '../server/db/users.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import * as projects from '../server/services/projects.js';
import * as projectMembers from '../server/services/projectMembers.js';

describe('services/projects.createProject', () => {
  it('creates the project and seeds 14 metadata rows atomically', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: '  Acme Corp  ' });
    expect(p.name).toBe('Acme Corp');

    expect(db.prepare('SELECT COUNT(*) AS n FROM issue_statuses WHERE project_id = ?').get(p.id).n).toBe(6);
    expect(db.prepare('SELECT COUNT(*) AS n FROM issue_categories WHERE project_id = ?').get(p.id).n).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM issue_priorities WHERE project_id = ?').get(p.id).n).toBe(5);
  });

  it('rejects an empty / whitespace-only name', () => {
    const db = createTestDb();
    expect(() => projects.createProject(db, { name: '   ' })).toThrow(/invalid_name/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM projects').get().n).toBe(0);
  });

  it('rejects a non-string name', () => {
    const db = createTestDb();
    expect(() => projects.createProject(db, { name: 123 })).toThrow(/invalid_name/);
  });
});

describe('services/projects.renameProject', () => {
  it('renames an existing project', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'Old' });
    const renamed = projects.renameProject(db, p.id, 'New Name');
    expect(renamed.name).toBe('New Name');
  });

  it('throws not_found for missing project', () => {
    const db = createTestDb();
    expect(() => projects.renameProject(db, 99999, 'X')).toThrow(/not_found/);
  });
});

describe('services/projects.archiveProject', () => {
  it('archives and is idempotent', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'A' });
    const a = projects.archiveProject(db, p.id);
    expect(a.archived_at).not.toBeNull();
    const a2 = projects.archiveProject(db, p.id);
    expect(a2.archived_at).toBe(a.archived_at);
  });

  it('unarchive restores', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'A' });
    projects.archiveProject(db, p.id);
    const restored = projects.unarchiveProject(db, p.id);
    expect(restored.archived_at).toBeNull();
  });
});

describe('services/projects.listVisibleForUser', () => {
  it('super admin sees all projects (active by default)', () => {
    const db = createTestDb();
    const a = projects.createProject(db, { name: 'A' });
    projects.createProject(db, { name: 'B' });
    projects.archiveProject(db, a.id);

    const u = usersDb.create(db, { email: 'admin@x' });
    const list = projects.listVisibleForUser(db, { ...u, isSuperAdmin: true });
    expect(list.map((p) => p.name)).toEqual(['B']);

    const all = projects.listVisibleForUser(db, { ...u, isSuperAdmin: true }, { includeArchived: true });
    expect(all.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('non-super-admin sees only memberships', () => {
    const db = createTestDb();
    const u = usersDb.create(db, { email: 'u@x' });
    const a = projects.createProject(db, { name: 'A' });
    const b = projects.createProject(db, { name: 'B' });
    projectMembersDb.add(db, { projectId: a.id, userId: u.id, role: 'viewer' });

    const list = projects.listVisibleForUser(db, { ...u, isSuperAdmin: false });
    expect(list.map((p) => p.name)).toEqual(['A']);
    expect(list[0].role).toBe('viewer');
    expect(b.id).toBeTypeOf('number');
  });
});

describe('services/projects.getProjectDetail', () => {
  it('returns project + members + metadata grouped by kind', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'P' });
    const u = usersDb.create(db, { email: 'a@x', name: 'Ann' });
    projectMembersDb.add(db, { projectId: p.id, userId: u.id, role: 'developer' });

    const detail = projects.getProjectDetail(db, p.id);
    expect(detail.project.id).toBe(p.id);
    expect(detail.members).toHaveLength(1);
    expect(detail.members[0].email).toBe('a@x');
    expect(detail.metadata.statuses).toHaveLength(6);
    expect(detail.metadata.categories).toHaveLength(3);
    expect(detail.metadata.priorities).toHaveLength(5);
  });

  it('returns null for unknown id', () => {
    const db = createTestDb();
    expect(projects.getProjectDetail(db, 99999)).toBeNull();
  });
});

describe('services/projectMembers', () => {
  it('addMember validates project, user, and role', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'P' });
    const u = usersDb.create(db, { email: 'a@x' });

    projectMembers.addMember(db, p.id, u.id, 'developer');
    expect(projectMembersDb.getRole(db, p.id, u.id)).toBe('developer');

    expect(() => projectMembers.addMember(db, p.id, u.id, 'admin')).toThrow(/invalid_role/);
    expect(() => projectMembers.addMember(db, 99999, u.id, 'viewer')).toThrow(/project_not_found/);
    expect(() => projectMembers.addMember(db, p.id, 99999, 'viewer')).toThrow(/user_not_found/);
    expect(() => projectMembers.addMember(db, p.id, u.id, 'viewer')).toThrow(/duplicate_member/);

    projects.archiveProject(db, p.id);
    const u2 = usersDb.create(db, { email: 'b@x' });
    expect(() => projectMembers.addMember(db, p.id, u2.id, 'viewer')).toThrow(/project_archived/);
  });

  it('changeRole + removeMember', () => {
    const db = createTestDb();
    const p = projects.createProject(db, { name: 'P' });
    const u = usersDb.create(db, { email: 'a@x' });
    projectMembers.addMember(db, p.id, u.id, 'viewer');
    projectMembers.changeRole(db, p.id, u.id, 'developer');
    expect(projectMembersDb.getRole(db, p.id, u.id)).toBe('developer');

    projectMembers.removeMember(db, p.id, u.id);
    expect(projectMembersDb.getRole(db, p.id, u.id)).toBeNull();

    expect(() => projectMembers.changeRole(db, p.id, u.id, 'viewer')).toThrow(/not_a_member/);
    expect(() => projectMembers.removeMember(db, p.id, u.id)).toThrow(/not_a_member/);
  });
});
