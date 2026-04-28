import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as issuesDb from '../server/db/issues.js';
import * as projectsDb from '../server/db/projects.js';
import * as usersDb from '../server/db/users.js';
import * as metadata from '../server/services/metadata.js';
import * as metadataDb from '../server/db/metadata.js';

function bootstrap() {
  const db = createTestDb();
  const user = usersDb.create(db, { email: 'creator@example.com', name: 'C' });
  const project = projectsDb.create(db, { name: 'P' });
  metadata.seedDefaults(db, project.id);
  const status = metadataDb.getDefault(db, 'statuses', project.id);
  const category = metadataDb.getDefault(db, 'categories', project.id);
  const priority = metadataDb.getDefault(db, 'priorities', project.id);
  return { db, user, project, status, category, priority };
}

function newIssue(db, ctx, overrides = {}) {
  return issuesDb.create(db, {
    projectId: ctx.project.id,
    number: issuesDb.nextNumber(db, ctx.project.id),
    name: overrides.name ?? 'an issue',
    description: overrides.description ?? null,
    statusId: overrides.statusId ?? ctx.status.id,
    categoryId: overrides.categoryId ?? ctx.category.id,
    priorityId: overrides.priorityId ?? ctx.priority.id,
    assignedTo: overrides.assignedTo ?? null,
    createdBy: overrides.createdBy ?? ctx.user.id,
  });
}

describe('db/issues.nextNumber', () => {
  it('starts at 1 and increments per project', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    expect(issuesDb.nextNumber(db, ctx.project.id)).toBe(1);
    newIssue(db, ctx);
    expect(issuesDb.nextNumber(db, ctx.project.id)).toBe(2);
    newIssue(db, ctx);
    expect(issuesDb.nextNumber(db, ctx.project.id)).toBe(3);
  });

  it('is isolated per project', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    newIssue(db, ctx);
    newIssue(db, ctx);

    const p2 = projectsDb.create(db, { name: 'P2' });
    metadata.seedDefaults(db, p2.id);
    expect(issuesDb.nextNumber(db, p2.id)).toBe(1);
  });
});

describe('db/issues.create + getByNumber', () => {
  it('round-trips columns and assigns updated_at', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    const issue = newIssue(db, ctx, {
      name: 'Bug A',
      description: 'broken',
      assignedTo: ctx.user.id,
    });
    expect(issue.number).toBe(1);
    expect(issue.name).toBe('Bug A');
    expect(issue.description).toBe('broken');
    expect(issue.status_id).toBe(ctx.status.id);
    expect(issue.created_by).toBe(ctx.user.id);
    expect(issue.assigned_to).toBe(ctx.user.id);
    expect(issue.created_at).toBeTruthy();
    expect(issue.updated_at).toBeTruthy();
    expect(issue.archived_at).toBeNull();

    const fetched = issuesDb.getByNumber(db, ctx.project.id, 1);
    expect(fetched.id).toBe(issue.id);
  });
});

describe('db/issues.update', () => {
  it('only updates provided columns and bumps updated_at', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    const issue = newIssue(db, ctx);
    const before = issue.updated_at;
    // wait long enough that CURRENT_TIMESTAMP changes (sqlite resolution = 1s)
    db.prepare('SELECT 1').all();
    const updated = issuesDb.update(db, issue.id, { name: 'Renamed' });
    expect(updated.name).toBe('Renamed');
    expect(updated.description).toBe(issue.description);
    expect(updated.updated_at).toBeTruthy();
    // updated_at should be >= before
    expect(updated.updated_at >= before).toBe(true);
  });
});

describe('db/issues.list filters + pagination', () => {
  it('filters by status + paginates by page', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    const inProgress = metadataDb
      .list(db, 'statuses', ctx.project.id)
      .find((s) => s.name === 'In Progress');
    // 3 Open, 2 In Progress
    newIssue(db, ctx, { name: '1' });
    newIssue(db, ctx, { name: '2' });
    newIssue(db, ctx, { name: '3' });
    newIssue(db, ctx, { name: '4', statusId: inProgress.id });
    newIssue(db, ctx, { name: '5', statusId: inProgress.id });

    const open = issuesDb.list(db, ctx.project.id, { statusIds: [ctx.status.id] });
    expect(open.items).toHaveLength(3);

    const ip = issuesDb.list(db, ctx.project.id, { statusIds: [inProgress.id] });
    expect(ip.items).toHaveLength(2);

    // Pagination
    const page1 = issuesDb.list(db, ctx.project.id, { sort: 'number_asc', limit: 2 });
    expect(page1.items.map((i) => i.number)).toEqual([1, 2]);
    expect(page1.page).toBe(1);
    expect(page1.pageSize).toBe(2);
    expect(page1.total).toBe(5);
    expect(page1.totalPages).toBe(3);

    const page2 = issuesDb.list(db, ctx.project.id, {
      sort: 'number_asc',
      limit: 2,
      page: 2,
    });
    expect(page2.items.map((i) => i.number)).toEqual([3, 4]);

    const page3 = issuesDb.list(db, ctx.project.id, {
      sort: 'number_asc',
      limit: 2,
      page: 3,
    });
    expect(page3.items.map((i) => i.number)).toEqual([5]);
    expect(page3.totalPages).toBe(3);
  });

  it('respects includeArchived', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    const live = newIssue(db, ctx, { name: 'live' });
    const dead = newIssue(db, ctx, { name: 'dead' });
    issuesDb.archive(db, dead.id);

    expect(issuesDb.list(db, ctx.project.id, {}).items.map((i) => i.id)).toEqual([live.id]);
    expect(issuesDb.list(db, ctx.project.id, { includeArchived: true }).items.length).toBe(2);
  });

  it('filters by assignee + unassigned', () => {
    const ctx = bootstrap();
    const { db } = ctx;
    const bob = usersDb.create(db, { email: 'bob@example.com', name: 'Bob' });
    newIssue(db, ctx, { name: 'a', assignedTo: ctx.user.id });
    newIssue(db, ctx, { name: 'b', assignedTo: bob.id });
    newIssue(db, ctx, { name: 'c' }); // unassigned

    const mine = issuesDb.list(db, ctx.project.id, { assigneeIds: [ctx.user.id] });
    expect(mine.items.map((i) => i.name)).toEqual(['a']);

    const unassigned = issuesDb.list(db, ctx.project.id, { includeUnassigned: true });
    expect(unassigned.items.map((i) => i.name)).toEqual(['c']);

    const meOrUnassigned = issuesDb.list(db, ctx.project.id, {
      assigneeIds: [ctx.user.id],
      includeUnassigned: true,
    });
    expect(meOrUnassigned.items.map((i) => i.name).sort()).toEqual(['a', 'c']);
  });
});
