#!/usr/bin/env node
// Hard-deletes a project and everything that hangs off it: issues, history,
// attachments (DB rows + binary files on disk and in S3), watchers,
// notifications, members, and per-project metadata (statuses / priorities /
// categories). This is irreversible — there is no audit log entry, no
// archive, no soft delete. Use `npm run backup` first if you might want it
// back.
//
// Usage:
//   node scripts/delete-project.js --project <id-or-name>
//
// The script:
//   1. Resolves the project (numeric id or exact name, case-insensitive).
//   2. Prints a summary of what will be deleted.
//   3. Prompts for the project's exact name to confirm.
//   4. Deletes DB rows in a single transaction.
//   5. Best-effort deletes attachment binaries (local + S3 if configured).
//      Failures are logged but do not roll back the DB delete (it is already
//      committed). Exit code is non-zero if any binary failed.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as projectsDb from '../server/db/projects.js';
import { hardDeleteProject } from '../server/services/projects.js';
import * as backup from '../server/services/backup.js';
import { absoluteStoragePath } from '../server/services/attachments.js';

function parseCliArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--project') out.project = argv[++i];
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length);
  }
  return out;
}

function resolveProject(db, raw) {
  const asInt = Number.parseInt(raw, 10);
  if (Number.isInteger(asInt) && String(asInt) === String(raw).trim()) {
    return projectsDb.getById(db, asInt) ?? null;
  }
  return (
    db
      .prepare('SELECT * FROM projects WHERE name = ? COLLATE NOCASE')
      .get(String(raw)) ?? null
  );
}

function summarize(db, projectId) {
  const issues = db
    .prepare('SELECT COUNT(*) AS n FROM issues WHERE project_id = ?')
    .get(projectId).n;
  const history = db
    .prepare(
      `SELECT COUNT(*) AS n FROM issue_history h
         JOIN issues i ON i.id = h.issue_id
        WHERE i.project_id = ?`,
    )
    .get(projectId).n;
  const attachments = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes), 0) AS bytes
         FROM attachments a
         JOIN issues i ON i.id = a.issue_id
        WHERE i.project_id = ?`,
    )
    .get(projectId);
  const members = db
    .prepare('SELECT COUNT(*) AS n FROM project_members WHERE project_id = ?')
    .get(projectId).n;
  return {
    issues,
    history,
    attachments: attachments.n,
    attachmentBytes: attachments.bytes,
    members,
  };
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

async function promptForName(expectedName) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => {
      rl.question(
        `Type the project name (${expectedName}) to confirm deletion: `,
        (input) => resolve(input),
      );
    });
    return answer.trim() === expectedName;
  } finally {
    rl.close();
  }
}

async function deleteBinaries(relPaths) {
  const failures = [];
  const s3Configured = backup.isConfigured();

  for (const rel of relPaths) {
    const abs = absoluteStoragePath(rel);
    try {
      await fsp.rm(abs, { force: true });
    } catch (err) {
      failures.push({ where: 'disk', rel, error: err.message });
    }
    if (s3Configured) {
      try {
        await backup.deleteAttachment(rel);
      } catch (err) {
        failures.push({ where: 's3', rel, error: err.message });
      }
    }
  }
  return failures;
}

async function removeEmptyProjectDir(projectId) {
  const dir = absoluteStoragePath(String(projectId));
  try {
    if (!fs.existsSync(dir)) return;
    // fsp.rm with recursive=false fails if non-empty; use rmdir-style cleanup.
    const entries = await fsp.readdir(dir);
    if (entries.length === 0) {
      await fsp.rmdir(dir);
      return;
    }
    // Some uploads might have left empty issue subdirs after the file rm above.
    // Try to clear those, then the project dir.
    for (const entry of entries) {
      const entryPath = path.join(dir, entry);
      const stat = await fsp.stat(entryPath).catch(() => null);
      if (stat?.isDirectory()) {
        const sub = await fsp.readdir(entryPath).catch(() => []);
        if (sub.length === 0) await fsp.rmdir(entryPath).catch(() => {});
      }
    }
    const remaining = await fsp.readdir(dir).catch(() => []);
    if (remaining.length === 0) await fsp.rmdir(dir);
  } catch {
    // best-effort
  }
}

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.project) {
    logger.error('missing --project <id-or-name>');
    process.exit(1);
  }

  const db = openConnection(config.dbPath);
  runMigrations(db);

  const project = resolveProject(db, args.project);
  if (!project) {
    logger.error(`project not found: ${args.project}`);
    process.exit(1);
  }

  const counts = summarize(db, project.id);
  process.stdout.write(
    [
      '',
      'About to PERMANENTLY DELETE this project and all its data:',
      `  id:                ${project.id}`,
      `  name:              ${project.name}`,
      `  archived_at:       ${project.archived_at ?? '(active)'}`,
      `  issues:            ${counts.issues}`,
      `  history events:    ${counts.history}`,
      `  attachments:       ${counts.attachments} (${formatBytes(counts.attachmentBytes)})`,
      `  members:           ${counts.members}`,
      '',
      'This is irreversible. Attachment binaries on disk' +
        (backup.isConfigured() ? ' AND in S3' : '') +
        ' will be deleted too.',
      '',
    ].join('\n'),
  );

  const ok = await promptForName(project.name);
  if (!ok) {
    logger.warn('aborted: confirmation did not match');
    db.close();
    process.exit(1);
  }

  let result;
  try {
    result = hardDeleteProject(db, project.id);
  } catch (err) {
    logger.error(`delete failed: ${err.message}`);
    db.close();
    process.exit(1);
  }
  logger.info(
    `deleted project "${result.project.name}" (id ${result.project.id}); ` +
      `cleaning up ${result.relPaths.length} attachment binaries`,
  );

  const failures = await deleteBinaries(result.relPaths);
  await removeEmptyProjectDir(result.project.id);

  if (failures.length > 0) {
    for (const f of failures) {
      logger.warn(`failed to delete ${f.where} ${f.rel}: ${f.error}`);
    }
    logger.warn(
      `${failures.length} binary deletion${failures.length === 1 ? '' : 's'} failed; ` +
        'DB rows are gone. Re-run cleanup manually if needed.',
    );
    db.close();
    process.exit(2);
  }

  logger.info('done');
  db.close();
}
