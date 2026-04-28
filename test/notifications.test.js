import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb } from './db.js';
import * as usersDb from '../server/db/users.js';
import * as projectsDb from '../server/db/projects.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import * as metadataDb from '../server/db/metadata.js';
import * as issuesDb from '../server/db/issues.js';
import * as historyDb from '../server/db/history.js';
import * as notificationsDb from '../server/db/notifications.js';
import * as prefsDb from '../server/db/notificationPrefs.js';
import * as watchersDb from '../server/db/watchers.js';
import { extractTokens, resolveMentions } from '../server/services/mentions.js';
import {
  recordForCreation,
  recordForChange,
  recordForComment,
  drainNotifications,
  _resetDrainLockForTests,
} from '../server/services/notifications.js';
import * as emailService from '../server/services/email.js';

function seedProject(db, ownerEmail = 'admin@test.local') {
  const owner = usersDb.create(db, { email: ownerEmail });
  const project = projectsDb.create(db, { name: 'P' });
  metadataDb.create(db, 'statuses', {
    projectId: project.id,
    name: 'Open',
    sortOrder: 1,
    isDefault: 1,
    isClosed: 0,
  });
  metadataDb.create(db, 'statuses', {
    projectId: project.id,
    name: 'Closed',
    sortOrder: 2,
    isDefault: 0,
    isClosed: 1,
  });
  metadataDb.create(db, 'categories', {
    projectId: project.id,
    name: 'Bug',
    sortOrder: 1,
    isDefault: 1,
  });
  metadataDb.create(db, 'priorities', {
    projectId: project.id,
    name: 'Med',
    sortOrder: 1,
    isDefault: 1,
  });
  projectMembersDb.add(db, { projectId: project.id, userId: owner.id, role: 'developer' });
  return { owner, project };
}

function makeIssue(db, { project, author, assignee = null }) {
  const status = metadataDb.getDefault(db, 'statuses', project.id);
  const category = metadataDb.getDefault(db, 'categories', project.id);
  const priority = metadataDb.getDefault(db, 'priorities', project.id);
  const number = issuesDb.nextNumber(db, project.id);
  return issuesDb.create(db, {
    projectId: project.id,
    number,
    name: 'I',
    description: null,
    statusId: status.id,
    categoryId: category.id,
    priorityId: priority.id,
    assignedTo: assignee?.id ?? null,
    createdBy: author.id,
  });
}

function addMember(db, project, email, role = 'user', name = null) {
  const u = usersDb.create(db, { email, name });
  projectMembersDb.add(db, { projectId: project.id, userId: u.id, role });
  return u;
}

describe('extractTokens', () => {
  it('finds tokens at start, after newline, after punctuation', () => {
    expect(extractTokens('@alice and @bob, hi @carol!')).toEqual(['alice', 'bob', 'carol']);
    expect(extractTokens('newline\n@dave')).toEqual(['dave']);
  });

  it('does not treat email-style addresses as mentions', () => {
    expect(extractTokens('contact me at alice@example.com')).toEqual([]);
  });

  it('dedups case-insensitively', () => {
    expect(extractTokens('@alice @ALICE @Alice')).toEqual(['alice']);
  });

  it('returns [] on non-string or empty', () => {
    expect(extractTokens(null)).toEqual([]);
    expect(extractTokens('')).toEqual([]);
  });
});

describe('resolveMentions', () => {
  it('resolves by email-local-part and ignores unknown tokens', () => {
    const db = createTestDb();
    const { project } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com', 'user', 'Alice');
    addMember(db, project, 'bob@x.com');
    const out = resolveMentions(db, project.id, 'hi @alice and @nobody');
    expect(out).toEqual([{ userId: alice.id, token: 'alice' }]);
  });

  it('falls back to spaceless name match', () => {
    const db = createTestDb();
    const { project } = seedProject(db);
    const carol = addMember(db, project, 'c@x.com', 'user', 'Carol');
    addMember(db, project, 'd@x.com', 'user', 'Dave Davidson');
    expect(resolveMentions(db, project.id, '@carol')).toEqual([
      { userId: carol.id, token: 'carol' },
    ]);
    // "Dave Davidson" has a space — does not match.
    expect(resolveMentions(db, project.id, '@dave')).toEqual([]);
  });
});

describe('recordForCreation', () => {
  it('notifies new assignee and auto-watches author + assignee', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner, assignee: alice });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'creation',
    });
    recordForCreation(db, {
      issue,
      authorId: owner.id,
      historyId: event.id,
      mentionsText: null,
    });
    const rows = notificationsDb.listForUser(db, alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('assigned_to_me');
    expect(watchersDb.isWatching(db, issue.id, owner.id)).toBe(true);
    expect(watchersDb.isWatching(db, issue.id, alice.id)).toBe(true);
  });

  it('does not notify author', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const issue = makeIssue(db, { project, author: owner, assignee: owner });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'creation',
    });
    recordForCreation(db, { issue, authorId: owner.id, historyId: event.id });
    expect(notificationsDb.listForUser(db, owner.id)).toEqual([]);
  });

  it('respects assigned_to_me preference (opt-out)', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    prefsDb.setOne(db, alice.id, 'assigned_to_me', false);
    const issue = makeIssue(db, { project, author: owner, assignee: alice });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'creation',
    });
    recordForCreation(db, { issue, authorId: owner.id, historyId: event.id });
    expect(notificationsDb.listForUser(db, alice.id)).toEqual([]);
  });
});

describe('recordForChange', () => {
  it('uses watched_status_change kind when status changes', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner });
    watchersDb.add(db, issue.id, alice.id);
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'change',
    });
    recordForChange(db, {
      issue,
      authorId: owner.id,
      historyId: event.id,
      diff: [{ field: 'status', oldValue: 'Open', newValue: 'Closed' }],
      mentionsText: null,
    });
    const rows = notificationsDb.listForUser(db, alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('watched_status_change');
  });

  it('uses watched_any_change kind for non-status changes; opt-out silences it', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner });
    watchersDb.add(db, issue.id, alice.id);
    prefsDb.setOne(db, alice.id, 'watched_any_change', false);
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'change',
    });
    recordForChange(db, {
      issue,
      authorId: owner.id,
      historyId: event.id,
      diff: [{ field: 'name', oldValue: 'A', newValue: 'B' }],
      mentionsText: null,
    });
    expect(notificationsDb.listForUser(db, alice.id)).toEqual([]);
  });

  it('mentions in note take priority over watched_*', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner });
    watchersDb.add(db, issue.id, alice.id);
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'change',
      note: 'cc @alice',
    });
    recordForChange(db, {
      issue,
      authorId: owner.id,
      historyId: event.id,
      diff: [{ field: 'name', oldValue: 'A', newValue: 'B' }],
      mentionsText: 'cc @alice',
    });
    const rows = notificationsDb.listForUser(db, alice.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('mentioned');
  });
});

describe('recordForComment', () => {
  it('notifies watchers, assignee, and mentioned (deduped)', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const bob = addMember(db, project, 'bob@x.com');
    const carol = addMember(db, project, 'carol@x.com');
    const issue = makeIssue(db, { project, author: owner, assignee: alice });
    // Bob is a watcher; Carol is mentioned; Alice is the assignee.
    watchersDb.add(db, issue.id, bob.id);
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'comment',
      note: 'hey @carol',
    });
    recordForComment(db, {
      issue,
      authorId: owner.id,
      historyId: event.id,
      body: 'hey @carol',
    });
    expect(notificationsDb.listForUser(db, alice.id)).toHaveLength(1);
    expect(notificationsDb.listForUser(db, bob.id)).toHaveLength(1);
    expect(notificationsDb.listForUser(db, carol.id)[0].kind).toBe('mentioned');
    // Author skipped.
    expect(notificationsDb.listForUser(db, owner.id)).toEqual([]);
  });

  it('auto-watches the comment author', () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: alice.id,
      kind: 'comment',
      note: 'hi',
    });
    recordForComment(db, {
      issue,
      authorId: alice.id,
      historyId: event.id,
      body: 'hi',
    });
    expect(watchersDb.isWatching(db, issue.id, alice.id)).toBe(true);
  });
});

describe('drainNotifications', () => {
  beforeEach(() => _resetDrainLockForTests());

  it('marks rows emailed on success and skips disabled users', async () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const bob = addMember(db, project, 'bob@x.com');
    usersDb.setDisabled(db, bob.id, true);
    const issue = makeIssue(db, { project, author: owner });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'comment',
      note: '@alice',
    });
    notificationsDb.insert(db, { userId: alice.id, issueId: issue.id, historyId: event.id, kind: 'mentioned' });
    notificationsDb.insert(db, { userId: bob.id,   issueId: issue.id, historyId: event.id, kind: 'mentioned' });

    const sendSpy = vi.spyOn(emailService, 'send').mockResolvedValue({ delivered: true });
    const res = await drainNotifications(db);
    sendSpy.mockRestore();

    expect(res.sent).toBe(1);
    expect(notificationsDb.listUnsent(db)).toEqual([]);
  });

  it('leaves rows unsent on send failure and aborts the batch', async () => {
    const db = createTestDb();
    const { project, owner } = seedProject(db);
    const alice = addMember(db, project, 'alice@x.com');
    const issue = makeIssue(db, { project, author: owner });
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: owner.id,
      kind: 'comment',
      note: '@alice',
    });
    notificationsDb.insert(db, { userId: alice.id, issueId: issue.id, historyId: event.id, kind: 'mentioned' });

    const sendSpy = vi.spyOn(emailService, 'send').mockRejectedValue(new Error('smtp_down'));
    const res = await drainNotifications(db);
    sendSpy.mockRestore();

    expect(res.aborted).toBe(true);
    expect(notificationsDb.listUnsent(db)).toHaveLength(1);
  });
});

describe('notification_prefs defaults', () => {
  it('isEnabled returns true when no row exists', () => {
    const db = createTestDb();
    const u = usersDb.create(db, { email: 'x@y.com' });
    expect(prefsDb.isEnabled(db, u.id, 'mentioned')).toBe(true);
  });

  it('rejects invalid kinds', () => {
    const db = createTestDb();
    const u = usersDb.create(db, { email: 'x@y.com' });
    expect(() => prefsDb.setOne(db, u.id, 'bogus', true)).toThrow();
  });
});
