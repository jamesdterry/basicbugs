import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as attachmentsDb from '../server/db/attachments.js';
import * as issuesDb from '../server/db/issues.js';
import * as projectsDb from '../server/db/projects.js';
import * as usersDb from '../server/db/users.js';
import * as metadata from '../server/services/metadata.js';
import * as metadataDb from '../server/db/metadata.js';

function bootstrap() {
  const db = createTestDb();
  const user = usersDb.create(db, { email: 'creator@example.com', name: 'Creator' });
  const project = projectsDb.create(db, { name: 'P' });
  metadata.seedDefaults(db, project.id);
  const status = metadataDb.getDefault(db, 'statuses', project.id);
  const category = metadataDb.getDefault(db, 'categories', project.id);
  const priority = metadataDb.getDefault(db, 'priorities', project.id);
  const issue = issuesDb.create(db, {
    projectId: project.id,
    number: issuesDb.nextNumber(db, project.id),
    name: 'Issue 1',
    statusId: status.id,
    categoryId: category.id,
    priorityId: priority.id,
    createdBy: user.id,
  });
  return { db, user, project, issue };
}

function makeAttachment(db, overrides = {}) {
  return attachmentsDb.create(db, {
    issueId: overrides.issueId,
    uploadedBy: overrides.uploadedBy,
    filename: overrides.filename ?? 'screenshot.png',
    contentType: overrides.contentType ?? 'image/png',
    sizeBytes: overrides.sizeBytes ?? 1234,
    storagePath: overrides.storagePath ?? '1/1/uuid-screenshot.png',
    issueHistoryId: overrides.issueHistoryId ?? null,
  });
}

describe('db/attachments.create + getById', () => {
  it('round-trips columns', () => {
    const { db, user, issue } = bootstrap();
    const created = makeAttachment(db, { issueId: issue.id, uploadedBy: user.id });
    expect(created.id).toBeTruthy();
    expect(created.issue_id).toBe(issue.id);
    expect(created.uploaded_by).toBe(user.id);
    expect(created.filename).toBe('screenshot.png');
    expect(created.content_type).toBe('image/png');
    expect(created.size_bytes).toBe(1234);
    expect(created.storage_path).toBe('1/1/uuid-screenshot.png');
    expect(created.issue_history_id).toBeNull();
    expect(created.archived_at).toBeNull();
    expect(created.created_at).toBeTruthy();

    const fetched = attachmentsDb.getById(db, created.id);
    expect(fetched.id).toBe(created.id);
  });
});

describe('db/attachments.listForIssue', () => {
  it('returns non-archived rows by default with uploader name', () => {
    const { db, user, issue } = bootstrap();
    const a = makeAttachment(db, {
      issueId: issue.id,
      uploadedBy: user.id,
      filename: 'a.png',
    });
    const b = makeAttachment(db, {
      issueId: issue.id,
      uploadedBy: user.id,
      filename: 'b.pdf',
      contentType: 'application/pdf',
    });
    attachmentsDb.archive(db, b.id);

    const rows = attachmentsDb.listForIssue(db, issue.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(a.id);
    expect(rows[0].uploader_name).toBe('Creator');

    const all = attachmentsDb.listForIssue(db, issue.id, { includeArchived: true });
    expect(all.map((r) => r.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('db/attachments.archive + unarchive', () => {
  it('toggles archived_at', () => {
    const { db, user, issue } = bootstrap();
    const a = makeAttachment(db, { issueId: issue.id, uploadedBy: user.id });
    expect(attachmentsDb.getById(db, a.id).archived_at).toBeNull();
    attachmentsDb.archive(db, a.id);
    expect(attachmentsDb.getById(db, a.id).archived_at).toBeTruthy();
    attachmentsDb.unarchive(db, a.id);
    expect(attachmentsDb.getById(db, a.id).archived_at).toBeNull();
  });
});

describe('db/attachments.getWithProject', () => {
  it('joins to issues + projects', () => {
    const { db, user, project, issue } = bootstrap();
    const a = makeAttachment(db, { issueId: issue.id, uploadedBy: user.id });
    const got = attachmentsDb.getWithProject(db, a.id);
    expect(got.attachment.id).toBe(a.id);
    expect(got.projectId).toBe(project.id);
    expect(got.issueArchivedAt).toBeNull();
  });

  it('returns null for missing id', () => {
    const { db } = bootstrap();
    expect(attachmentsDb.getWithProject(db, 9999)).toBeNull();
  });
});

describe('db/attachments cascades when issue is deleted', () => {
  it('removes attachments when their issue row is hard-deleted', () => {
    const { db, user, issue } = bootstrap();
    const a = makeAttachment(db, { issueId: issue.id, uploadedBy: user.id });
    db.prepare('DELETE FROM issues WHERE id = ?').run(issue.id);
    expect(attachmentsDb.getById(db, a.id)).toBeNull();
  });
});
