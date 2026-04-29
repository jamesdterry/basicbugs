#!/usr/bin/env node
// Reconcile on-disk attachments up to S3.
//
// Walks ${ATTACHMENTS_DIR} recursively, lists s3://${BUCKET_NAME}/attachments/,
// and PUTs any local file whose key is missing or whose size differs.
// Idempotent — safe to re-run.
//
// Safety net for the best-effort write-through in services/attachments.js.
// Attachments are immutable (each upload gets a fresh UUID in its key), so
// "size match → skip" is a sound shortcut: a key never has two different
// payloads at the same size by accident.
//
// Usage:
//   node scripts/sync-attachments.js              # all
//   node scripts/sync-attachments.js --dry-run    # report only
//
// Run after first deploy with creds (one-time backfill of existing
// attachments) or after any incident where write-through warnings appeared
// in the logs.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as backup from '../server/services/backup.js';

function parseArgs(argv) {
  const out = { dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') out.dryRun = true;
    else {
      logger.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function listLocalFiles(rootDir) {
  const results = [];
  async function walk(dir, relPrefix) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        const stat = await fsp.stat(full);
        results.push({ rel, full, size: stat.size });
      }
    }
  }
  await walk(rootDir, '');
  return results;
}

async function main() {
  if (!backup.isConfigured()) {
    logger.error('S3 not configured (BUCKET_NAME / AWS_* env vars). Refusing to run.');
    process.exit(1);
  }

  const { dryRun } = parseArgs(process.argv);
  const root = path.resolve(config.attachmentsDir);
  if (!fs.existsSync(root)) {
    logger.info(`No attachments directory at ${root}; nothing to sync.`);
    return;
  }

  const local = await listLocalFiles(root);
  logger.info(`Found ${local.length} local attachment(s) under ${root}.`);

  const remote = await backup.listAttachmentKeys();
  const remoteByRel = new Map();
  for (const obj of remote) {
    const rel = backup.relPathFromAttachmentKey(obj.key);
    if (rel) remoteByRel.set(rel, obj);
  }

  let uploaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const entry of local) {
    const r = remoteByRel.get(entry.rel);
    if (r && r.size === entry.size) {
      skipped += 1;
      continue;
    }
    if (dryRun) {
      logger.info(`PUT (dry-run) ${entry.rel} (${r ? `size ${r.size}→${entry.size}` : 'missing'})`);
      uploaded += 1;
      continue;
    }
    try {
      await backup.putAttachment(entry.rel, entry.full);
      const reason = r ? `size ${r.size}→${entry.size}` : 'missing';
      logger.info(`PUT  ${entry.rel} (${reason})`);
      uploaded += 1;
    } catch (err) {
      logger.warn(`FAIL ${entry.rel}: ${err.message}`);
      failed += 1;
    }
  }

  logger.info(`Sync done. uploaded=${uploaded} skipped=${skipped} failed=${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  logger.error(`Sync failed: ${err.message}`);
  process.exit(1);
});
