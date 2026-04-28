import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as historyDb from '../server/db/history.js';
import * as issuesDb from '../server/db/issues.js';
import * as projectsDb from '../server/db/projects.js';
import * as usersDb from '../server/db/users.js';
import * as metadata from '../server/services/metadata.js';
import * as metadataDb from '../server/db/metadata.js';

function bootstrap() {
  const db = createTestDb();
  const user = usersDb.create(db, { email: 'h@example.com', name: 'H' });
  const project = projectsDb.create(db, { name: 'P' });
  metadata.seedDefaults(db, project.id);
  const issue = issuesDb.create(db, {
    projectId: project.id,
    number: 1,
    name: 'i',
    statusId: metadataDb.getDefault(db, 'statuses', project.id).id,
    categoryId: metadataDb.getDefault(db, 'categories', project.id).id,
    priorityId: metadataDb.getDefault(db, 'priorities', project.id).id,
    createdBy: user.id,
  });
  return { db, user, project, issue };
}

describe('db/history.insertEvent + insertChange', () => {
  it('writes parent + children', () => {
    const { db, user, issue } = bootstrap();
    const event = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: user.id,
      kind: 'change',
      note: 'moved',
    });
    historyDb.insertChange(db, {
      eventId: event.id,
      field: 'status',
      oldValue: 'Open',
      newValue: 'In Progress',
    });
    historyDb.insertChange(db, {
      eventId: event.id,
      field: 'name',
      oldValue: 'i',
      newValue: 'i2',
    });

    const evs = historyDb.listForIssue(db, issue.id);
    expect(evs).toHaveLength(1);
    expect(evs[0].kind).toBe('change');
    expect(evs[0].note).toBe('moved');
    expect(evs[0].user.email).toBe('h@example.com');
    expect(evs[0].changes.map((c) => c.field).sort()).toEqual(['name', 'status']);
  });

  it('listForIssue returns events reverse-chronological', () => {
    const { db, user, issue } = bootstrap();
    const e1 = historyDb.insertEvent(db, { issueId: issue.id, userId: user.id, kind: 'creation' });
    const e2 = historyDb.insertEvent(db, { issueId: issue.id, userId: user.id, kind: 'change' });
    const e3 = historyDb.insertEvent(db, {
      issueId: issue.id,
      userId: user.id,
      kind: 'comment',
      note: 'hi',
    });
    const evs = historyDb.listForIssue(db, issue.id);
    expect(evs.map((e) => e.id)).toEqual([e3.id, e2.id, e1.id]);
  });

  it('cascades delete when issue is removed', () => {
    const { db, user, issue } = bootstrap();
    historyDb.insertEvent(db, { issueId: issue.id, userId: user.id, kind: 'creation' });
    expect(historyDb.countForIssue(db, issue.id)).toBe(1);
    db.prepare('DELETE FROM issues WHERE id = ?').run(issue.id);
    expect(historyDb.countForIssue(db, issue.id)).toBe(0);
  });
});
