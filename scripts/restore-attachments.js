#!/usr/bin/env node
// Manual restore of attachments from S3 to the local volume.
//
// Lists s3://${BUCKET_NAME}/attachments/ and downloads each object into
// ${ATTACHMENTS_DIR}/${rel}, where rel is the same
// "<projectId>/<issueId>/<uuid>-<safeName>" used by the live app.
// Atomic temp + rename per file so a partial fetch cannot leave a
// corrupted file in place. Idempotent — re-running overwrites with the
// replica copy (that's the point of a restore).
//
// Usage:
//   node scripts/restore-attachments.js               # all
//
// No sentinel gate (unlike the DB): missing attachment files do not
// prevent boot, the app just returns 410 Gone for the affected
// downloads. Operator intent is implicit in invoking this script.

import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as backup from '../server/services/backup.js';

async function restoreOne(rel, root) {
  const buffer = await backup.getAttachment(rel);
  const dest = path.join(root, rel);
  const tmp = `${dest}.partial`;
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  try {
    await fsp.writeFile(tmp, buffer);
    await fsp.rename(tmp, dest);
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
  return { rel, bytes: buffer.length, dest };
}

async function main() {
  if (!backup.isConfigured()) {
    logger.error('S3 not configured (BUCKET_NAME / AWS_* env vars). Refusing to run.');
    process.exit(1);
  }

  const root = path.resolve(config.attachmentsDir);
  logger.info(`Listing s3://${process.env.BUCKET_NAME}/${backup.ATTACHMENTS_PREFIX} ...`);
  const remote = await backup.listAttachmentKeys();
  const targets = remote
    .map((obj) => backup.relPathFromAttachmentKey(obj.key))
    .filter((rel) => rel != null);
  logger.info(`Found ${targets.length} attachment(s) in the replica.`);

  let ok = 0;
  let failed = 0;
  for (const rel of targets) {
    try {
      const { bytes, dest } = await restoreOne(rel, root);
      logger.info(`OK  ${rel} → ${dest} (${bytes} bytes)`);
      ok += 1;
    } catch (err) {
      logger.error(`FAIL ${rel}: ${err.message}`);
      failed += 1;
    }
  }

  logger.info(`Restore-attachments done. ok=${ok} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  logger.error(`Restore-attachments failed: ${err.message}`);
  process.exit(1);
});
