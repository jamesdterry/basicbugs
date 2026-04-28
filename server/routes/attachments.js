import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Busboy from 'busboy';
import { createRequireUser } from '../middleware/requireUser.js';
import * as attachments from '../services/attachments.js';
import * as issuesDb from '../db/issues.js';
import { handleError } from './errors.js';

const ALLOWED_INLINE_PREFIXES = ['image/', 'application/pdf'];

function inlineDisposition(contentType) {
  return ALLOWED_INLINE_PREFIXES.some((p) => contentType.startsWith(p));
}

// RFC 5987 ext-value encoding for the `filename*` param. Falls back to a
// percent-encoded UTF-8 form. Also produces a quoted ASCII-only `filename`
// fallback for old user agents.
function contentDispositionHeader(disposition, filename) {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const utf8 = encodeURIComponent(filename);
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

/**
 * Per-issue upload subrouter, mounted at
 *   /api/projects/:id/issues/:number/attachments
 * from createIssuesRouter. The parent router has already enforced
 * requireProjectViewer; we additionally require role >= 'user' via the
 * service layer.
 */
export function createIssueAttachmentsRouter({ db }) {
  const router = express.Router({ mergeParams: true });

  router.post('/', (req, res) => {
    const number = Number.parseInt(req.params.number, 10);
    if (!Number.isInteger(number) || number <= 0) {
      return res.status(404).json({ error: 'not_found' });
    }
    const issue = issuesDb.getByNumber(db, req.project.id, number);
    if (!issue) return res.status(404).json({ error: 'not_found' });
    if (issue.archived_at) return res.status(409).json({ error: 'issue_archived' });

    const contentTypeHeader = req.headers['content-type'] ?? '';
    if (!contentTypeHeader.toLowerCase().startsWith('multipart/form-data')) {
      return res.status(400).json({ error: 'invalid_content_type' });
    }

    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: {
          fileSize: attachments.MAX_BYTES + 1, // +1 so the limit event fires for exactly-too-big files
          files: 1,
          fields: 0,
        },
      });
    } catch {
      return res.status(400).json({ error: 'invalid_content_type' });
    }

    let handled = false;
    let partialPath = null;

    function fail(status, code) {
      if (handled) return;
      handled = true;
      bb.removeAllListeners();
      try {
        req.unpipe(bb);
      } catch {
        /* noop */
      }
      const cleanup = partialPath
        ? fsp.unlink(partialPath).catch(() => {})
        : Promise.resolve();
      cleanup.finally(() => {
        if (!res.headersSent) res.status(status).json({ error: code });
      });
    }

    bb.on('file', (fieldname, fileStream, info) => {
      if (fieldname !== 'file') {
        fileStream.resume();
        fail(400, 'invalid_field');
        return;
      }

      const declaredMime = (info.mimeType ?? '').toLowerCase();
      if (!attachments.ALLOWED_MIME.has(declaredMime)) {
        fileStream.resume();
        fail(415, 'unsupported_media_type');
        return;
      }

      const safeName = attachments.safeFilename(info.filename ?? 'file');
      const tmpName = `${crypto.randomUUID()}.partial`;
      partialPath = path.join(os.tmpdir(), tmpName);

      const writeStream = fs.createWriteStream(partialPath);
      let firstChunk = null;
      let bytes = 0;
      let truncated = false;

      fileStream.on('limit', () => {
        truncated = true;
      });
      fileStream.on('data', (chunk) => {
        if (firstChunk == null) firstChunk = chunk.subarray(0, Math.min(chunk.length, 16));
        bytes += chunk.length;
      });
      fileStream.on('error', () => fail(500, 'attachment_storage_error'));
      writeStream.on('error', () => fail(500, 'attachment_storage_error'));
      fileStream.pipe(writeStream);

      writeStream.on('close', async () => {
        if (handled) return;

        if (truncated || bytes > attachments.MAX_BYTES) {
          fail(413, 'attachment_too_large');
          return;
        }
        if (bytes === 0) {
          fail(400, 'invalid_filename');
          return;
        }
        if (!firstChunk || !attachments.magicBytesMatch(declaredMime, firstChunk)) {
          fail(415, 'unsupported_media_type');
          return;
        }

        try {
          const att = await attachments.finalizeUpload(db, {
            projectId: req.project.id,
            issue,
            userId: req.user.id,
            contentType: declaredMime,
            sizeBytes: bytes,
            safeName,
            partialPath,
          });
          partialPath = null;
          handled = true;
          res.status(201).json({ attachment: att });
        } catch (err) {
          fail(err?.code ? statusForCode(err.code) : 500, err?.code ?? 'attachment_storage_error');
        }
      });
    });

    bb.on('filesLimit', () => fail(400, 'too_many_files'));
    bb.on('partsLimit', () => fail(400, 'too_many_parts'));
    bb.on('error', () => fail(400, 'invalid_content_type'));
    bb.on('finish', () => {
      // If finish fires without seeing a `file` event, no upload happened.
      if (!handled && !partialPath) {
        fail(400, 'missing_file');
      }
    });

    req.on('aborted', () => fail(499, 'aborted'));

    // Service-layer role check (developer/user/viewer): viewers should not
    // even start an upload.
    if (req.projectRole === 'viewer') {
      return fail(403, 'forbidden');
    }

    req.pipe(bb);
  });

  return router;
}

/**
 * Global attachments router mounted at /api/attachments.
 * GET /:id streams; POST /:id/archive archives; both require an authed user
 * (cookie session) and per-attachment access via the service.
 */
export function createAttachmentsRouter({ db }) {
  const router = express.Router();
  const requireUser = createRequireUser({ db });

  router.use(requireUser);

  router.get('/:id', (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: 'not_found' });
      }

      const { attachment } = attachments.getAccessibleAttachment(db, id, req.user);
      const opened = attachments.openStream(attachment);
      if (!opened) return res.status(410).json({ error: 'gone' });

      const disposition = inlineDisposition(attachment.content_type) ? 'inline' : 'attachment';
      res.setHeader('Content-Type', attachment.content_type);
      res.setHeader('Content-Length', attachment.size_bytes);
      res.setHeader(
        'Content-Disposition',
        contentDispositionHeader(disposition, attachment.filename),
      );
      res.setHeader('Cache-Control', 'private, max-age=300');
      opened.stream.on('error', () => {
        if (!res.headersSent) res.status(500).end();
        else res.destroy();
      });
      opened.stream.pipe(res);
    } catch (err) {
      handleError(res, next, err);
    }
  });

  router.post('/:id/archive', (req, res, next) => {
    try {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(404).json({ error: 'not_found' });
      }
      const att = attachments.archiveAttachment(db, id, req.user);
      res.json({ attachment: attachments.hydrateAttachment(att) });
    } catch (err) {
      handleError(res, next, err);
    }
  });

  return router;
}

// Map service codes to status. Same table as routes/errors.js but kept local
// to avoid a circular dep when service errors are produced from the busboy
// handler before `handleError` is reachable.
function statusForCode(code) {
  switch (code) {
    case 'forbidden':
      return 403;
    case 'not_found':
      return 404;
    case 'attachment_too_large':
      return 413;
    case 'unsupported_media_type':
      return 415;
    case 'invalid_filename':
      return 400;
    case 'issue_archived':
      return 409;
    default:
      return 500;
  }
}
