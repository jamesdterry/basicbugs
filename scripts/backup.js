#!/usr/bin/env node
// Daily snapshot backup: open the live DB, VACUUM INTO a fresh .sqlite
// file at /tmp, upload it to s3://${BUCKET_NAME}/snapshots/, then prune
// older snapshots beyond BACKUP_SNAPSHOT_RETENTION_DAYS (default 30).
//
// Designed to run on the same machine that holds the live volume (Fly's
// single-volume invariant) — invoke via:
//   fly ssh console -a basicbugs -C 'node /app/scripts/backup.js'
// driven by an external cron (GitHub Actions, etc.). See BACKUPS.md.
//
// Idempotent: the timestamp in the key makes each run produce a new
// object. If the upload fails midway, no half-written object exists in
// the bucket (PutObject is atomic) and the local /tmp file is cleaned
// up on exit. Pruning is best-effort — a delete failure logs a warning
// and continues.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as backup from '../server/services/backup.js';

const RETENTION_DAYS = Number.parseInt(process.env.BACKUP_SNAPSHOT_RETENTION_DAYS ?? '30', 10);

async function main() {
  if (!backup.isConfigured()) {
    logger.error('S3 not configured (BUCKET_NAME / AWS_* env vars). Refusing to run.');
    process.exit(1);
  }

  if (!fs.existsSync(config.dbPath)) {
    logger.error(`DB not found at ${config.dbPath}. Refusing to run.`);
    process.exit(1);
  }

  const now = new Date();
  const key = backup.snapshotKey(now);
  const tmpName = path.basename(key);
  const tmpPath = path.join(os.tmpdir(), tmpName);

  logger.info(`Snapshot start: ${config.dbPath} → ${tmpPath}`);

  const db = new Database(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    // VACUUM INTO is online and lock-light: it takes a snapshot using a
    // read transaction and writes a fully-defragmented copy to a new file.
    // Quote the path; a malformed path would be a programmer error here.
    db.exec(`VACUUM INTO '${tmpPath.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }

  const stat = await fsp.stat(tmpPath);
  logger.info(`Snapshot written: ${stat.size} bytes`);

  try {
    await backup.putSnapshot(tmpPath, key);
    logger.info(`Snapshot uploaded: s3://${process.env.BUCKET_NAME}/${key}`);
  } finally {
    await fsp.unlink(tmpPath).catch(() => {});
  }

  await pruneOldSnapshots(now);
}

async function pruneOldSnapshots(now) {
  if (!Number.isFinite(RETENTION_DAYS) || RETENTION_DAYS <= 0) {
    logger.info('Pruning disabled (BACKUP_SNAPSHOT_RETENTION_DAYS <= 0).');
    return;
  }

  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const keys = await backup.listSnapshotKeys();
  let pruned = 0;
  let kept = 0;
  let failed = 0;
  for (const obj of keys) {
    if (obj.lastModified && obj.lastModified < cutoff) {
      try {
        await backup.deleteSnapshot(obj.key);
        logger.info(`Pruned ${obj.key} (lastModified ${obj.lastModified.toISOString()})`);
        pruned += 1;
      } catch (err) {
        logger.warn(`Failed to prune ${obj.key}: ${err.message}`);
        failed += 1;
      }
    } else {
      kept += 1;
    }
  }
  logger.info(`Prune done. pruned=${pruned} kept=${kept} failed=${failed} cutoff=${cutoff.toISOString()}`);
}

main().catch((err) => {
  logger.error(`Backup failed: ${err.message}`);
  process.exit(1);
});
