#!/usr/bin/env node
// Download a snapshot from s3://${BUCKET_NAME}/snapshots/ to a local
// path. Operator-driven: the operator chooses which snapshot and where
// to place it, then manually swaps it in for the live DB.
//
// Usage:
//   node scripts/restore.js
//     → most recent snapshot → ./data/basicbugs.restored.sqlite
//   node scripts/restore.js --key=snapshots/basicbugs-2026-04-29T03-00-00Z.sqlite
//   node scripts/restore.js --out=/tmp/restored.sqlite
//   node scripts/restore.js --list                 (just print snapshot keys)
//   node scripts/restore.js --force                (overwrite an existing out)
//
// Refuses to write on top of an existing file unless --force, so that a
// stale --out path can never silently clobber the live DB.

import fs from 'node:fs';
import path from 'node:path';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as backup from '../server/services/backup.js';

function parseArgs(argv) {
  const out = { key: null, out: null, list: false, force: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--list') out.list = true;
    else if (arg === '--force') out.force = true;
    else if (arg.startsWith('--key=')) out.key = arg.slice('--key='.length);
    else if (arg.startsWith('--out=')) out.out = arg.slice('--out='.length);
    else {
      logger.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return out;
}

async function main() {
  if (!backup.isConfigured()) {
    logger.error('S3 not configured (BUCKET_NAME / AWS_* env vars). Refusing to run.');
    process.exit(1);
  }

  const args = parseArgs(process.argv);

  const all = await backup.listSnapshotKeys();
  if (all.length === 0) {
    logger.error('No snapshots found in the bucket.');
    process.exit(1);
  }
  // Newest first.
  all.sort((a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0));

  if (args.list) {
    for (const obj of all) {
      const ts = obj.lastModified ? obj.lastModified.toISOString() : '?';
      logger.info(`${ts}  ${obj.size}  ${obj.key}`);
    }
    return;
  }

  let key = args.key;
  if (!key) {
    key = all[0].key;
    logger.info(`Defaulting to most-recent snapshot: ${key}`);
  } else if (!all.some((o) => o.key === key)) {
    logger.error(`Snapshot key not found: ${key}`);
    process.exit(1);
  }

  const out = path.resolve(
    args.out || path.join(path.dirname(config.dbPath), 'basicbugs.restored.sqlite'),
  );
  if (fs.existsSync(out) && !args.force) {
    logger.error(`Refusing to overwrite ${out} (use --force).`);
    process.exit(1);
  }

  logger.info(`Downloading ${key} → ${out}`);
  await backup.getSnapshot(key, out);

  const size = fs.statSync(out).size;
  logger.info(`Restore complete: ${size} bytes at ${out}`);
  logger.info('To put this into service, stop the server and replace the live DB:');
  logger.info(`  systemctl stop basicbugs   # or fly machine stop`);
  logger.info(`  mv ${out} ${config.dbPath}`);
  logger.info(`  systemctl start basicbugs`);
}

main().catch((err) => {
  logger.error(`Restore failed: ${err.message}`);
  process.exit(1);
});
