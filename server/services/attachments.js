import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import * as attachmentsDb from '../db/attachments.js';
import * as issuesDb from '../db/issues.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as backup from './backup.js';

export class AttachmentError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'AttachmentError';
    this.code = code;
  }
}

export const MAX_BYTES = 25 * 1024 * 1024;

// Tight allowlist — what consultants typically attach. SVG and HTML are
// excluded because both can carry script payloads when served inline.
export const ALLOWED_MIME = Object.freeze(
  new Set([
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.ms-excel',
  ]),
);

const ROLE_RANK = Object.freeze({ viewer: 1, user: 2, developer: 3 });

const FILENAME_MAX = 200;
const WINDOWS_RESERVED = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
]);

// First few bytes that must be present for a declared image/PDF MIME type.
// Each entry is { offset, signature: Uint8Array | string }.
const MAGIC_BYTES = Object.freeze({
  'image/png': [{ offset: 0, signature: Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) }],
  'image/jpeg': [{ offset: 0, signature: Uint8Array.of(0xff, 0xd8, 0xff) }],
  'image/gif': [
    { offset: 0, signature: Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) },
    { offset: 0, signature: Uint8Array.of(0x47, 0x49, 0x46, 0x38, 0x39, 0x61) },
  ],
  'image/webp': [
    { offset: 0, signature: 'RIFF' },
    { offset: 8, signature: 'WEBP' },
  ],
  'application/pdf': [{ offset: 0, signature: '%PDF-' }],
});

export function safeFilename(raw) {
  if (typeof raw !== 'string') return 'file';
  // NFC-normalize; strip null bytes and control chars; convert path separators
  // to space; drop dot-only tokens (so "..", "..." cannot survive); collapse
  // whitespace; drop leading dots.
  let s = raw.normalize('NFC');
  s = s.replace(/[\\/]+/g, ' ');
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\x00-\x1f\x7f]/g, '');
  s = s
    .split(/\s+/)
    .filter((t) => t && !/^\.+$/.test(t))
    .join(' ');
  s = s.replace(/^\.+/, '').trim();
  if (!s) return 'file';

  // Strip extension to reason about the stem.
  const dot = s.lastIndexOf('.');
  let stem = dot > 0 ? s.slice(0, dot) : s;
  let ext = dot > 0 ? s.slice(dot) : '';

  if (WINDOWS_RESERVED.has(stem.toUpperCase())) {
    stem = `_${stem}`;
  }

  // Truncate while preserving the extension if it is short and reasonable.
  let combined = `${stem}${ext}`;
  if (combined.length > FILENAME_MAX) {
    if (ext.length > 0 && ext.length < 32) {
      const room = FILENAME_MAX - ext.length;
      combined = `${stem.slice(0, Math.max(0, room))}${ext}`;
    } else {
      combined = combined.slice(0, FILENAME_MAX);
    }
  }
  return combined || 'file';
}

export function relativeStoragePath({ projectId, issueId, uuid, safeName }) {
  return `${projectId}/${issueId}/${uuid}-${safeName}`;
}

export function absoluteStoragePath(rel) {
  return path.resolve(config.attachmentsDir, rel);
}

function rank(role) {
  return ROLE_RANK[role] ?? 0;
}

function requireRole(role, minimum) {
  if (rank(role) < ROLE_RANK[minimum]) throw new AttachmentError('forbidden');
}

function bytesStartWith(buf, offset, signature) {
  const sig = typeof signature === 'string' ? Buffer.from(signature, 'ascii') : Buffer.from(signature);
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (buf[offset + i] !== sig[i]) return false;
  }
  return true;
}

export function magicBytesMatch(contentType, headBuffer) {
  const groups = MAGIC_BYTES[contentType];
  if (!groups) return true; // no magic check defined for this type
  // image/webp requires both signatures; others match if any group matches.
  if (contentType === 'image/webp') {
    return groups.every((g) => bytesStartWith(headBuffer, g.offset, g.signature));
  }
  return groups.some((g) => bytesStartWith(headBuffer, g.offset, g.signature));
}

/**
 * Persist an already-on-disk file under a `*.partial` suffix into the final
 * attachments table + storage path. Atomicity contract:
 *   1. Caller has streamed bytes to a temp path under attachmentsDir.
 *   2. Caller has already validated size <= MAX_BYTES and contentType is in
 *      ALLOWED_MIME and magicBytesMatch passed.
 *   3. We rename temp -> final, then INSERT in a transaction. On INSERT
 *      failure we unlink the final path. On any earlier failure the caller
 *      unlinks the partial.
 *
 * Use storeUpload for the full server-side flow (write + finalize). This
 * helper exists so the route can stream straight to disk without buffering.
 */
export async function finalizeUpload(
  db,
  {
    projectId,
    issue,
    userId,
    contentType,
    sizeBytes,
    safeName,
    partialPath,
  },
) {
  const uuid = crypto.randomUUID();
  const relPath = relativeStoragePath({
    projectId,
    issueId: issue.id,
    uuid,
    safeName,
  });
  const finalAbs = absoluteStoragePath(relPath);

  await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
  await fsp.rename(partialPath, finalAbs);

  let row;
  try {
    row = db.transaction(() =>
      attachmentsDb.create(db, {
        issueId: issue.id,
        uploadedBy: userId,
        filename: safeName,
        contentType,
        sizeBytes,
        storagePath: relPath,
      }),
    )();
  } catch (err) {
    await fsp.unlink(finalAbs).catch(() => {});
    throw err;
  }

  await mirrorAttachmentToS3(relPath, finalAbs, contentType);
  return hydrateAttachment(row);
}

/**
 * Server-side helper used by tests and any caller that already has the bytes
 * in memory. Validates size + MIME + magic bytes, writes to the final path
 * directly, inserts the DB row in a transaction.
 */
export async function storeUpload(
  db,
  { projectId, issueId, userId, role, file },
) {
  requireRole(role, 'user');

  const issue = issuesDb.getById(db, issueId);
  if (!issue || issue.project_id !== projectId) {
    throw new AttachmentError('not_found');
  }
  if (issue.archived_at) {
    throw new AttachmentError('issue_archived');
  }

  if (!file || !file.buffer) throw new AttachmentError('invalid_filename');

  const sizeBytes = file.buffer.length;
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new AttachmentError('invalid_filename');
  }
  if (sizeBytes > MAX_BYTES) {
    throw new AttachmentError('attachment_too_large');
  }

  const contentType = typeof file.contentType === 'string' ? file.contentType.toLowerCase() : '';
  if (!ALLOWED_MIME.has(contentType)) {
    throw new AttachmentError('unsupported_media_type');
  }

  const head = file.buffer.slice(0, 16);
  if (!magicBytesMatch(contentType, head)) {
    throw new AttachmentError('unsupported_media_type');
  }

  const safeName = safeFilename(file.filename);
  const uuid = crypto.randomUUID();
  const relPath = relativeStoragePath({ projectId, issueId: issue.id, uuid, safeName });
  const finalAbs = absoluteStoragePath(relPath);

  await fsp.mkdir(path.dirname(finalAbs), { recursive: true });
  await fsp.writeFile(finalAbs, file.buffer);

  let row;
  try {
    row = db.transaction(() =>
      attachmentsDb.create(db, {
        issueId: issue.id,
        uploadedBy: userId,
        filename: safeName,
        contentType,
        sizeBytes,
        storagePath: relPath,
      }),
    )();
  } catch (err) {
    await fsp.unlink(finalAbs).catch(() => {});
    throw err;
  }

  await mirrorAttachmentToS3(relPath, finalAbs, contentType);
  return hydrateAttachment(row);
}

// Best-effort write-through to the S3 backup. The DB row + local file are
// already durable when this runs; an S3 failure must never fail the upload.
// scripts/sync-attachments.js reconciles whatever this misses.
async function mirrorAttachmentToS3(relPath, absPath, contentType) {
  if (!backup.isConfigured()) return;
  try {
    await backup.putAttachment(relPath, absPath, contentType);
  } catch (err) {
    console.warn(
      `[attachments] S3 write-through failed for ${relPath}: ${err.message}. ` +
        `Local file saved; run scripts/sync-attachments.js to reconcile.`,
    );
  }
}

/**
 * Returns { attachment, projectId, role } where attachment is the raw row
 * (includes storage_path, used by the stream route) and role is the
 * requester's role on the owning project ('developer' for super admin).
 * Throws not_found if the attachment doesn't exist or if the user is not a
 * member of the project. Routes that return JSON should run the result
 * through hydrateAttachment to strip storage_path.
 */
export function getAccessibleAttachment(db, attachmentId, user) {
  const found = attachmentsDb.getWithProject(db, attachmentId);
  if (!found) throw new AttachmentError('not_found');

  let role;
  if (user.isSuperAdmin) {
    role = 'developer';
  } else {
    const r = projectMembersDb.getRole(db, found.projectId, user.id);
    if (!r) throw new AttachmentError('not_found');
    role = r;
  }

  // Archived attachments: visible to uploader and to project developers; mask
  // existence from other members.
  if (found.attachment.archived_at) {
    const isUploader = found.attachment.uploaded_by === user.id;
    const isDeveloper = rank(role) >= ROLE_RANK.developer;
    if (!isUploader && !isDeveloper) throw new AttachmentError('not_found');
  }

  return {
    attachment: found.attachment,
    projectId: found.projectId,
    role,
  };
}

export { hydrateAttachment };

export function archiveAttachment(db, attachmentId, user) {
  const found = attachmentsDb.getWithProject(db, attachmentId);
  if (!found) throw new AttachmentError('not_found');

  let role;
  if (user.isSuperAdmin) {
    role = 'developer';
  } else {
    const r = projectMembersDb.getRole(db, found.projectId, user.id);
    if (!r) throw new AttachmentError('not_found');
    role = r;
  }

  const isUploader = found.attachment.uploaded_by === user.id;
  const isDeveloper = rank(role) >= ROLE_RANK.developer;
  if (!isUploader && !isDeveloper) throw new AttachmentError('forbidden');

  if (!found.attachment.archived_at) {
    attachmentsDb.archive(db, attachmentId);
  }
  return hydrateAttachment(attachmentsDb.getById(db, attachmentId));
}

export function listAttachmentsForIssue(db, issueId, { includeArchived = false } = {}) {
  const rows = attachmentsDb.listForIssue(db, issueId, { includeArchived });
  return rows.map((row) => ({
    id: row.id,
    issue_id: row.issue_id,
    issue_history_id: row.issue_history_id,
    uploaded_by: row.uploaded_by,
    uploader: row.uploader_email
      ? { id: row.uploaded_by, name: row.uploader_name, email: row.uploader_email }
      : null,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    archived_at: row.archived_at,
  }));
}

function hydrateAttachment(row) {
  if (!row) return null;
  return {
    id: row.id,
    issue_id: row.issue_id,
    issue_history_id: row.issue_history_id,
    uploaded_by: row.uploaded_by,
    filename: row.filename,
    content_type: row.content_type,
    size_bytes: row.size_bytes,
    created_at: row.created_at,
    archived_at: row.archived_at,
  };
}

// Used by the GET stream route. Confirms the file exists on disk; returns a
// readable stream. Returns null if the file is missing (route can 410).
// Pass the raw attachment row (must include storage_path).
export function openStream(rawAttachment) {
  if (!rawAttachment?.storage_path) return null;
  const abs = absoluteStoragePath(rawAttachment.storage_path);
  if (!fs.existsSync(abs)) return null;
  return { absolutePath: abs, stream: fs.createReadStream(abs) };
}
