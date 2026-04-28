import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as issues from '../server/services/issues.js';
import * as projects from '../server/services/projects.js';
import * as projectMembers from '../server/services/projectMembers.js';
import * as usersDb from '../server/db/users.js';
import * as metadataDb from '../server/db/metadata.js';
import * as metadataSvc from '../server/services/metadata.js';
import * as historyDb from '../server/db/history.js';

function bootstrap() {
  const db = createTestDb();
  const owner = usersDb.create(db, { email: 'owner@x.com', name: 'Owner' });
  const project = projects.createProject(db, { name: 'P' });
  return { db, owner, project };
}

function addMember(db, projectId, email, role) {
  const u = usersDb.create(db, { email, name: email.split('@')[0] });
  projectMembers.addMember(db, projectId, u.id, role);
  return u;
}

describe('services/issues.createIssue', () => {
  it('uses defaults when ids are omitted; writes a creation event', () => {
    const { db, owner, project } = bootstrap();
    const issue = issues.createIssue(db, project.id, owner.id, 'developer', {
      name: 'first',
      description: 'hello',
    });
    expect(issue.number).toBe(1);
    expect(issue.status.name).toBe('Open');
    expect(issue.priority.name).toBe('Medium');
    expect(issue.category.name).toBe('Bug');
    expect(issue.created_by.email).toBe('owner@x.com');

    const events = historyDb.listForIssue(db, issue.id);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('creation');
    expect(events[0].changes).toHaveLength(0);
  });

  it('rejects non-member assignee', () => {
    const { db, owner, project } = bootstrap();
    const ghost = usersDb.create(db, { email: 'ghost@x.com' });
    expect(() =>
      issues.createIssue(db, project.id, owner.id, 'developer', {
        name: 'x',
        assignedTo: ghost.id,
      }),
    ).toThrow(/assignee_not_member/);
  });

  it('rejects archived metadata', () => {
    const { db, owner, project } = bootstrap();
    const inProgress = metadataDb.list(db, 'statuses', project.id).find((s) => s.name === 'In Progress');
    metadataSvc.archiveItem(db, 'statuses', project.id, inProgress.id);
    expect(() =>
      issues.createIssue(db, project.id, owner.id, 'developer', {
        name: 'x',
        statusId: inProgress.id,
      }),
    ).toThrow(/archived_metadata/);
  });

  it('rejects empty name', () => {
    const { db, owner, project } = bootstrap();
    expect(() =>
      issues.createIssue(db, project.id, owner.id, 'user', { name: '   ' }),
    ).toThrow(/invalid_name/);
  });

  it('viewer cannot create', () => {
    const { db, owner, project } = bootstrap();
    expect(() =>
      issues.createIssue(db, project.id, owner.id, 'viewer', { name: 'x' }),
    ).toThrow(/forbidden/);
  });
});

describe('services/issues.updateIssue — permission matrix', () => {
  function setup() {
    const { db, owner, project } = bootstrap();
    const issue = issues.createIssue(db, project.id, owner.id, 'developer', { name: 'i' });
    const inProgress = metadataDb.list(db, 'statuses', project.id).find((s) => s.name === 'In Progress');
    return { db, owner, project, issue, inProgress };
  }

  it('viewer can change nothing', () => {
    const { db, owner, project } = setup();
    expect(() =>
      issues.updateIssue(db, project.id, 1, owner.id, 'viewer', { name: 'new' }),
    ).toThrow(/forbidden/);
  });

  it('user can change name/description/assignee but not status/category/priority', () => {
    const { db, owner, project, inProgress } = setup();
    const u2 = addMember(db, project.id, 'u2@x.com', 'user');

    // allowed
    issues.updateIssue(db, project.id, 1, owner.id, 'user', { name: 'renamed' });
    issues.updateIssue(db, project.id, 1, owner.id, 'user', { description: 'd' });
    issues.updateIssue(db, project.id, 1, owner.id, 'user', { assignedTo: u2.id });

    // not allowed
    expect(() =>
      issues.updateIssue(db, project.id, 1, owner.id, 'user', { statusId: inProgress.id }),
    ).toThrow(/forbidden/);
    expect(() =>
      issues.updateIssue(db, project.id, 1, owner.id, 'user', { categoryId: 999 }),
    ).toThrow(/forbidden/);
    expect(() =>
      issues.updateIssue(db, project.id, 1, owner.id, 'user', { priorityId: 999 }),
    ).toThrow(/forbidden/);
  });

  it('developer can change everything', () => {
    const { db, owner, project, inProgress } = setup();
    const updated = issues.updateIssue(db, project.id, 1, owner.id, 'developer', {
      statusId: inProgress.id,
    });
    expect(updated.status.name).toBe('In Progress');
  });

  it('rejects unknown patch fields', () => {
    const { db, owner, project } = setup();
    expect(() =>
      issues.updateIssue(db, project.id, 1, owner.id, 'developer', { isBananas: true }),
    ).toThrow(/invalid_field/);
  });
});

describe('services/issues — history fidelity & display strings', () => {
  it('5 sequential edits + 2 comments produce 7 history events with display strings', () => {
    const { db, owner, project } = bootstrap();
    const issue = issues.createIssue(db, project.id, owner.id, 'developer', { name: 'orig' });
    const inProgress = metadataDb.list(db, 'statuses', project.id).find((s) => s.name === 'In Progress');
    const blocked = metadataDb.list(db, 'statuses', project.id).find((s) => s.name === 'Blocked');
    const high = metadataDb.list(db, 'priorities', project.id).find((p) => p.name === 'High');
    const feature = metadataDb.list(db, 'categories', project.id).find((c) => c.name === 'Feature');
    const bob = addMember(db, project.id, 'bob@x.com', 'developer');

    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { name: 'second' });
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { statusId: inProgress.id });
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { priorityId: high.id });
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { categoryId: feature.id });
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { assignedTo: bob.id });
    issues.commentIssue(db, project.id, 1, owner.id, 'developer', 'first comment');
    issues.commentIssue(db, project.id, 1, owner.id, 'developer', 'second comment');

    const events = historyDb.listForIssue(db, issue.id);
    // creation + 5 changes + 2 comments = 8 total
    expect(events).toHaveLength(8);

    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === 'comment')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'change')).toHaveLength(5);
    expect(kinds.filter((k) => k === 'creation')).toHaveLength(1);

    // Each change event must have exactly 1 change row.
    const changeEvents = events.filter((e) => e.kind === 'change');
    for (const ev of changeEvents) expect(ev.changes).toHaveLength(1);

    // The status change row must hold display strings, not ids.
    const statusChange = changeEvents.find((e) => e.changes[0].field === 'status');
    expect(statusChange.changes[0].old_value).toBe('Open');
    expect(statusChange.changes[0].new_value).toBe('In Progress');

    // Now rename the status; the history must keep the OLD display string.
    metadataSvc.renameItem(db, 'statuses', project.id, inProgress.id, 'Working On It');
    const after = historyDb.listForIssue(db, issue.id);
    const stillOpen = after
      .filter((e) => e.kind === 'change')
      .map((e) => e.changes[0])
      .find((c) => c.field === 'status');
    expect(stillOpen.new_value).toBe('In Progress');
    expect(stillOpen.old_value).toBe('Open');

    // Then archive a new status further along; old history still uses Blocked.
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { statusId: blocked.id });
    metadataSvc.renameItem(db, 'statuses', project.id, blocked.id, 'Stalled');
    const finalEvents = historyDb.listForIssue(db, issue.id);
    const blockedRow = finalEvents
      .filter((e) => e.kind === 'change')
      .map((e) => e.changes[0])
      .find((c) => c.new_value === 'Blocked');
    expect(blockedRow).toBeTruthy();
  });

  it('no-op rule: empty patch + no note produces no event', () => {
    const { db, owner, project } = bootstrap();
    const issue = issues.createIssue(db, project.id, owner.id, 'developer', { name: 'n' });
    const before = historyDb.countForIssue(db, issue.id);
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', {}, null);
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { name: 'n' }, null);
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', { name: 'n' }, '   ');
    const after = historyDb.countForIssue(db, issue.id);
    expect(after).toBe(before);
  });

  it('a note alone (no field changes) writes a change event with zero rows', () => {
    const { db, owner, project } = bootstrap();
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'n' });
    issues.updateIssue(db, project.id, 1, owner.id, 'developer', {}, 'just a note');
    const events = historyDb.listForIssue(db, 1);
    const evs = events.filter((e) => e.kind === 'change');
    expect(evs).toHaveLength(1);
    expect(evs[0].note).toBe('just a note');
    expect(evs[0].changes).toHaveLength(0);
  });
});

describe('services/issues.commentIssue', () => {
  it('viewer cannot comment', () => {
    const { db, owner, project } = bootstrap();
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'n' });
    expect(() =>
      issues.commentIssue(db, project.id, 1, owner.id, 'viewer', 'hi'),
    ).toThrow(/forbidden/);
  });

  it('rejects empty body', () => {
    const { db, owner, project } = bootstrap();
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'n' });
    expect(() =>
      issues.commentIssue(db, project.id, 1, owner.id, 'user', '   '),
    ).toThrow(/invalid_body/);
  });
});

describe('services/issues.archiveIssue', () => {
  it('developer-only; idempotent', () => {
    const { db, owner, project } = bootstrap();
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'n' });
    expect(() =>
      issues.archiveIssue(db, project.id, 1, owner.id, 'user'),
    ).toThrow(/forbidden/);

    const a1 = issues.archiveIssue(db, project.id, 1, owner.id, 'developer');
    expect(a1.archived_at).toBeTruthy();
    const a2 = issues.archiveIssue(db, project.id, 1, owner.id, 'developer');
    expect(a2.archived_at).toBeTruthy();
  });
});

describe('services/issues.listIssues — filter parser', () => {
  it('rejects cross-project ids', () => {
    const { db, owner, project } = bootstrap();
    const other = projects.createProject(db, { name: 'Other' });
    const otherStatus = metadataDb.list(db, 'statuses', other.id)[0];
    expect(() =>
      issues.listIssues(db, project.id, { status: String(otherStatus.id) }),
    ).toThrow(/invalid_filter/);
    // ensure unused warning silenced
    expect(owner).toBeTruthy();
  });

  it('rejects unknown ids and bad sorts', () => {
    const { db, project } = bootstrap();
    expect(() => issues.listIssues(db, project.id, { status: '99999' })).toThrow(
      /invalid_filter/,
    );
    expect(() => issues.listIssues(db, project.id, { sort: 'bogus' })).toThrow(
      /invalid_filter/,
    );
    expect(() => issues.listIssues(db, project.id, { limit: '0' })).toThrow(
      /invalid_filter/,
    );
  });

  it('parses unassigned token + paginates with opaque cursor', () => {
    const { db, owner, project } = bootstrap();
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'a' });
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'b' });
    issues.createIssue(db, project.id, owner.id, 'developer', { name: 'c' });
    const r = issues.listIssues(db, project.id, { assignee: 'unassigned', limit: '2', sort: 'number_asc' });
    expect(r.items).toHaveLength(2);
    expect(typeof r.nextCursor).toBe('string');
    const r2 = issues.listIssues(db, project.id, {
      assignee: 'unassigned',
      limit: '2',
      sort: 'number_asc',
      cursor: r.nextCursor,
    });
    expect(r2.items).toHaveLength(1);
    expect(r2.nextCursor).toBeNull();
  });

  it('rejects malformed cursor', () => {
    const { db, project } = bootstrap();
    expect(() => issues.listIssues(db, project.id, { cursor: 'not-base64-json!' })).toThrow(
      /invalid_cursor/,
    );
  });
});
