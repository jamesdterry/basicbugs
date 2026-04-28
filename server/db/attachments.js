// Attachments persistence layer. Plain SQL helpers; every fn takes the db
// handle first so callers can pass a transaction-bound connection.

export function create(
  db,
  {
    issueId,
    issueHistoryId = null,
    uploadedBy,
    filename,
    contentType,
    sizeBytes,
    storagePath,
  },
) {
  const info = db
    .prepare(
      `INSERT INTO attachments
         (issue_id, issue_history_id, uploaded_by,
          filename, content_type, size_bytes, storage_path)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(issueId, issueHistoryId, uploadedBy, filename, contentType, sizeBytes, storagePath);
  return getById(db, info.lastInsertRowid);
}

export function getById(db, id) {
  return db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) ?? null;
}

export function listForIssue(db, issueId, { includeArchived = false } = {}) {
  const where = includeArchived
    ? 'a.issue_id = ?'
    : 'a.issue_id = ? AND a.archived_at IS NULL';
  return db
    .prepare(
      `SELECT a.id, a.issue_id, a.issue_history_id, a.uploaded_by,
              a.filename, a.content_type, a.size_bytes, a.storage_path,
              a.created_at, a.archived_at,
              u.name AS uploader_name, u.email AS uploader_email
         FROM attachments a
         LEFT JOIN users u ON u.id = a.uploaded_by
        WHERE ${where}
        ORDER BY a.created_at ASC, a.id ASC`,
    )
    .all(issueId);
}

export function archive(db, id, when = new Date().toISOString()) {
  db.prepare('UPDATE attachments SET archived_at = ? WHERE id = ?').run(when, id);
}

export function unarchive(db, id) {
  db.prepare('UPDATE attachments SET archived_at = NULL WHERE id = ?').run(id);
}

// Returns { attachment, projectId, issueArchivedAt } or null if the attachment
// or its issue/project no longer exist. Used to authorize access by joining to
// the project.
export function getWithProject(db, attachmentId) {
  const row = db
    .prepare(
      `SELECT a.id, a.issue_id, a.issue_history_id, a.uploaded_by,
              a.filename, a.content_type, a.size_bytes, a.storage_path,
              a.created_at, a.archived_at,
              i.project_id AS project_id,
              i.archived_at AS issue_archived_at
         FROM attachments a
         JOIN issues i ON i.id = a.issue_id
        WHERE a.id = ?`,
    )
    .get(attachmentId);
  if (!row) return null;
  return {
    attachment: {
      id: row.id,
      issue_id: row.issue_id,
      issue_history_id: row.issue_history_id,
      uploaded_by: row.uploaded_by,
      filename: row.filename,
      content_type: row.content_type,
      size_bytes: row.size_bytes,
      storage_path: row.storage_path,
      created_at: row.created_at,
      archived_at: row.archived_at,
    },
    projectId: row.project_id,
    issueArchivedAt: row.issue_archived_at,
  };
}
