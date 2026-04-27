import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as projectsDb from '../server/db/projects.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import * as metadataDb from '../server/db/metadata.js';
import * as usersDb from '../server/db/users.js';

function makeUser(db, email) {
  return usersDb.create(db, { email });
}

describe('db/projects', () => {
  it('create + getById round-trip', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'Acme' });
    expect(p.id).toBeTypeOf('number');
    expect(p.name).toBe('Acme');
    expect(p.archived_at).toBeNull();
    expect(projectsDb.getById(db, p.id).name).toBe('Acme');
    expect(projectsDb.getById(db, 99999)).toBeNull();
  });

  it('rename updates name', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'Old' });
    projectsDb.rename(db, p.id, 'New');
    expect(projectsDb.getById(db, p.id).name).toBe('New');
  });

  it('archive sets archived_at; unarchive clears it', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'A' });
    projectsDb.archive(db, p.id);
    expect(projectsDb.getById(db, p.id).archived_at).not.toBeNull();
    projectsDb.unarchive(db, p.id);
    expect(projectsDb.getById(db, p.id).archived_at).toBeNull();
  });

  it('list excludes archived by default; includeArchived returns all', () => {
    const db = createTestDb();
    const a = projectsDb.create(db, { name: 'Alpha' });
    projectsDb.create(db, { name: 'Beta' });
    projectsDb.archive(db, a.id);

    expect(projectsDb.list(db).map((p) => p.name)).toEqual(['Beta']);
    expect(projectsDb.list(db, { includeArchived: true }).map((p) => p.name)).toEqual([
      'Alpha',
      'Beta',
    ]);
  });

  it('listForUser returns memberships with role, sorted by name', () => {
    const db = createTestDb();
    const u = makeUser(db, 'u@example.com');
    const a = projectsDb.create(db, { name: 'Bee' });
    const b = projectsDb.create(db, { name: 'Ant' });
    projectsDb.create(db, { name: 'NotMyProject' });
    projectMembersDb.add(db, { projectId: a.id, userId: u.id, role: 'developer' });
    projectMembersDb.add(db, { projectId: b.id, userId: u.id, role: 'viewer' });

    const rows = projectsDb.listForUser(db, u.id);
    expect(rows.map((r) => r.name)).toEqual(['Ant', 'Bee']);
    expect(rows.map((r) => r.role)).toEqual(['viewer', 'developer']);
  });
});

describe('db/projectMembers', () => {
  it('add + getRole + listForProject round-trip', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const u1 = makeUser(db, 'a@x.com');
    const u2 = makeUser(db, 'b@x.com');
    projectMembersDb.add(db, { projectId: p.id, userId: u1.id, role: 'developer' });
    projectMembersDb.add(db, { projectId: p.id, userId: u2.id, role: 'viewer' });

    expect(projectMembersDb.getRole(db, p.id, u1.id)).toBe('developer');
    expect(projectMembersDb.getRole(db, p.id, u2.id)).toBe('viewer');
    expect(projectMembersDb.getRole(db, p.id, 9999)).toBeNull();

    const rows = projectMembersDb.listForProject(db, p.id);
    expect(rows.map((r) => r.email)).toEqual(['a@x.com', 'b@x.com']);
  });

  it('UNIQUE (project_id, user_id) prevents duplicate adds', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const u = makeUser(db, 'a@x.com');
    projectMembersDb.add(db, { projectId: p.id, userId: u.id, role: 'viewer' });
    expect(() =>
      projectMembersDb.add(db, { projectId: p.id, userId: u.id, role: 'developer' }),
    ).toThrow(/UNIQUE/);
  });

  it('setRole and remove update / clear membership', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const u = makeUser(db, 'a@x.com');
    projectMembersDb.add(db, { projectId: p.id, userId: u.id, role: 'viewer' });
    projectMembersDb.setRole(db, p.id, u.id, 'user');
    expect(projectMembersDb.getRole(db, p.id, u.id)).toBe('user');
    projectMembersDb.remove(db, p.id, u.id);
    expect(projectMembersDb.getRole(db, p.id, u.id)).toBeNull();
  });

  it('CHECK constraint rejects unknown roles', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const u = makeUser(db, 'a@x.com');
    expect(() =>
      projectMembersDb.add(db, { projectId: p.id, userId: u.id, role: 'admin' }),
    ).toThrow(/CHECK/);
  });
});

describe('db/metadata', () => {
  it('isValidKind', () => {
    expect(metadataDb.isValidKind('statuses')).toBe(true);
    expect(metadataDb.isValidKind('categories')).toBe(true);
    expect(metadataDb.isValidKind('priorities')).toBe(true);
    expect(metadataDb.isValidKind('nope')).toBe(false);
  });

  it('create + list + getById + setSortOrder', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const a = metadataDb.create(db, 'priorities', {
      projectId: p.id,
      name: 'High',
      sortOrder: 2,
    });
    const b = metadataDb.create(db, 'priorities', {
      projectId: p.id,
      name: 'Low',
      sortOrder: 1,
    });
    expect(metadataDb.getById(db, 'priorities', a.id).name).toBe('High');
    const list = metadataDb.list(db, 'priorities', p.id);
    expect(list.map((r) => r.name)).toEqual(['Low', 'High']);

    metadataDb.setSortOrder(db, 'priorities', a.id, 0);
    expect(metadataDb.list(db, 'priorities', p.id).map((r) => r.name)).toEqual(['High', 'Low']);
    expect(b.id).toBeTypeOf('number');
  });

  it('clearDefault + setDefault', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const a = metadataDb.create(db, 'statuses', {
      projectId: p.id,
      name: 'Open',
      sortOrder: 1,
      isDefault: 1,
    });
    const b = metadataDb.create(db, 'statuses', {
      projectId: p.id,
      name: 'Closed',
      sortOrder: 2,
      isDefault: 0,
      isClosed: 1,
    });
    expect(metadataDb.getDefault(db, 'statuses', p.id).id).toBe(a.id);
    metadataDb.clearDefault(db, 'statuses', p.id);
    metadataDb.setDefault(db, 'statuses', b.id);
    expect(metadataDb.getDefault(db, 'statuses', p.id).id).toBe(b.id);
  });

  it('setClosed flips is_closed on a status', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const s = metadataDb.create(db, 'statuses', {
      projectId: p.id,
      name: 'Open',
      sortOrder: 1,
      isClosed: 0,
    });
    metadataDb.setClosed(db, s.id, true);
    expect(metadataDb.getById(db, 'statuses', s.id).is_closed).toBe(1);
    metadataDb.setClosed(db, s.id, false);
    expect(metadataDb.getById(db, 'statuses', s.id).is_closed).toBe(0);
  });

  it('archive/unarchive + countActive', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    const a = metadataDb.create(db, 'categories', {
      projectId: p.id,
      name: 'A',
      sortOrder: 1,
    });
    const b = metadataDb.create(db, 'categories', {
      projectId: p.id,
      name: 'B',
      sortOrder: 2,
    });
    expect(metadataDb.countActive(db, 'categories', p.id)).toBe(2);
    metadataDb.archive(db, 'categories', a.id);
    expect(metadataDb.countActive(db, 'categories', p.id)).toBe(1);
    expect(metadataDb.list(db, 'categories', p.id).map((r) => r.name)).toEqual(['B']);
    expect(metadataDb.list(db, 'categories', p.id, { includeArchived: true }).map((r) => r.name)).toEqual([
      'A',
      'B',
    ]);
    metadataDb.unarchive(db, 'categories', a.id);
    expect(metadataDb.countActive(db, 'categories', p.id)).toBe(2);
    expect(b.id).toBeTypeOf('number');
  });

  it('UNIQUE (project_id, name) blocks duplicates per project', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    metadataDb.create(db, 'statuses', { projectId: p.id, name: 'Open', sortOrder: 1 });
    expect(() =>
      metadataDb.create(db, 'statuses', { projectId: p.id, name: 'Open', sortOrder: 2 }),
    ).toThrow(/UNIQUE/);
  });

  it('getDefault returns null when no default exists', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    expect(metadataDb.getDefault(db, 'statuses', p.id)).toBeNull();
  });

  it('maxSortOrder returns 0 when empty', () => {
    const db = createTestDb();
    const p = projectsDb.create(db, { name: 'P' });
    expect(metadataDb.maxSortOrder(db, 'statuses', p.id)).toBe(0);
  });

  it('throws on unknown kind', () => {
    const db = createTestDb();
    expect(() => metadataDb.list(db, 'nope', 1)).toThrow(/unknown metadata kind/);
  });
});
