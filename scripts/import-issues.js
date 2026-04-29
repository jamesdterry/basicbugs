#!/usr/bin/env node
// Import issues from a CSV exported by another bug tracker into a basicbugs
// project. Columns expected (header row, case-insensitive):
//
//   Number, Subject, Status, Priority, Category, Milestone, Assignee,
//   Created, Opener, Last Updated, Last Updated By, Description
//
// Number and Milestone are dropped. Status / Priority / Category names are
// matched per-project (case-insensitive) and auto-created if missing. Blank
// metadata cells fall back to the project's default. Opener / Assignee /
// Last Updated By names are first checked against any --map mappings (see
// below). Otherwise they are matched to existing user.name; if still no
// match a disabled placeholder user is created with email <slug>@imported.local
// and added to the project at the 'user' role. Created / Last Updated values
// preserve the original timestamps on the issue and on the synthesized
//'creation' history event.
//
// Usage:
//   node scripts/import-issues.js --csv <path> --project <id-or-name>
//   node scripts/import-issues.js --csv <path> --project "My Project" --dry-run
//   node scripts/import-issues.js --csv <path> --project Acme \
//     --map 'jdoe=john@acme.com' --map 'JS=jane@acme.com:Jane Smith'
//
// --dry-run wraps the run in a savepoint and rolls back at the end so you can
// preview without writing.
//
// --map (repeatable) maps a CSV name (Opener/Assignee value) to a real email
// address, optionally with a display name: 'csvName=email[:Display Name]'.
// Names match case-insensitively. If the email already belongs to a user, that
// user is reused. Otherwise a *real* (non-placeholder) user is created with
// the given email and display name, marked disabled so they cannot sign in
// until an admin enables them and sends a magic link from the Users page.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';
import { config } from '../server/config.js';
import { logger } from '../server/logger.js';
import * as projectsDb from '../server/db/projects.js';
import * as usersDb from '../server/db/users.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import * as metadataDb from '../server/db/metadata.js';

const NAME_MAX = 200;
const DESCRIPTION_MAX = 10_000;

// ---------- CSV parser (RFC 4180-ish) ----------

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------- Helpers ----------

// '2025-05-20 15:08:52 -0400' -> '2025-05-20 19:08:52' (UTC, SQLite-friendly).
export function parseExportDate(raw) {
  const s = (raw ?? '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?$/);
  if (!m) throw new Error(`unparseable date: ${raw}`);
  const [, y, mo, d, h, mi, se, tz] = m;
  let offsetMinutes = 0;
  if (tz && tz !== 'Z') {
    const tzm = tz.match(/^([+-])(\d{2}):?(\d{2})$/);
    if (!tzm) throw new Error(`unparseable timezone: ${tz}`);
    const sign = tzm[1] === '-' ? -1 : 1;
    offsetMinutes = sign * (Number(tzm[2]) * 60 + Number(tzm[3]));
  }
  const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) - offsetMinutes * 60_000;
  const date = new Date(utcMs);
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

export function emailSlug(name) {
  const base = (name ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return base || 'imported';
}

const TABLE_FOR_KIND = Object.freeze({
  statuses: 'issue_statuses',
  categories: 'issue_categories',
  priorities: 'issue_priorities',
});

const SINGULAR_FOR_KIND = Object.freeze({
  statuses: 'status',
  categories: 'category',
  priorities: 'priority',
});

function findMetadataByName(db, kind, projectId, name) {
  const table = TABLE_FOR_KIND[kind];
  return (
    db
      .prepare(`SELECT * FROM ${table} WHERE project_id = ? AND name = ? COLLATE NOCASE`)
      .get(projectId, name) ?? null
  );
}

function findOrCreateMetadata(db, kind, projectId, rawName, log) {
  const name = (rawName ?? '').trim();
  if (!name) return null;
  let row = findMetadataByName(db, kind, projectId, name);
  if (row && row.archived_at) {
    metadataDb.unarchive(db, kind, row.id);
    row = metadataDb.getById(db, kind, row.id);
    log(`unarchived ${SINGULAR_FOR_KIND[kind]} "${row.name}" so it could be assigned`);
  }
  if (row) return row;
  const sortOrder = metadataDb.maxSortOrder(db, kind, projectId) + 1;
  const created = metadataDb.create(db, kind, {
    projectId,
    name,
    sortOrder,
    isDefault: 0,
    isClosed: 0,
  });
  log(`created ${SINGULAR_FOR_KIND[kind]} "${created.name}"`);
  return created;
}

function findUserByName(db, name) {
  const trimmed = (name ?? '').trim();
  if (!trimmed) return null;
  return (
    db
      .prepare(
        `SELECT * FROM users
          WHERE name IS NOT NULL AND TRIM(name) = ? COLLATE NOCASE
          ORDER BY is_disabled ASC, id ASC
          LIMIT 1`,
      )
      .get(trimmed) ?? null
  );
}

function findOrCreatePlaceholderUser(db, rawName, projectId, log) {
  const name = (rawName ?? '').trim();
  if (!name) return null;
  let user = findUserByName(db, name);
  if (!user) {
    const slug = emailSlug(name);
    let email = `${slug}@imported.local`;
    let suffix = 2;
    while (usersDb.getByEmail(db, email)) {
      email = `${slug}-${suffix}@imported.local`;
      suffix++;
    }
    user = usersDb.create(db, { email, name });
    usersDb.setDisabled(db, user.id, true);
    user = usersDb.getById(db, user.id);
    log(`created placeholder user "${name}" <${email}> (disabled)`);
  }
  if (!projectMembersDb.getRole(db, projectId, user.id)) {
    projectMembersDb.add(db, { projectId, userId: user.id, role: 'user' });
  }
  return user;
}

// Parse repeated --map specs ('csvName=email[:Display Name]') into a Map
// keyed by lowercased trimmed csv name. Throws a clear error on bad specs so
// CLI typos fail fast rather than silently importing as placeholders.
export function parseUserMap(rawArgs) {
  const map = new Map();
  for (const raw of rawArgs ?? []) {
    if (typeof raw !== 'string') {
      throw new Error(`invalid --map: expected string, got ${typeof raw}`);
    }
    const eqIdx = raw.indexOf('=');
    if (eqIdx < 0) {
      throw new Error(`invalid --map "${raw}": expected 'csvName=email[:Display Name]'`);
    }
    const name = raw.slice(0, eqIdx).trim();
    if (!name) {
      throw new Error(`invalid --map "${raw}": empty csv name`);
    }
    const rhs = raw.slice(eqIdx + 1);
    const colonIdx = rhs.indexOf(':');
    const email = (colonIdx === -1 ? rhs : rhs.slice(0, colonIdx)).trim().toLowerCase();
    const displayName = colonIdx === -1 ? null : rhs.slice(colonIdx + 1).trim() || null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`invalid --map "${raw}": bad email "${email}"`);
    }
    map.set(name.toLowerCase(), { email, displayName });
  }
  return map;
}

function findOrCreateMappedUser(db, rawName, projectId, log, userMap) {
  const name = (rawName ?? '').trim();
  if (!name) return null;
  const mapping = userMap?.get(name.toLowerCase());
  if (!mapping) return findOrCreatePlaceholderUser(db, name, projectId, log);

  let user = usersDb.getByEmail(db, mapping.email);
  if (!user) {
    const created = usersDb.create(db, {
      email: mapping.email,
      name: mapping.displayName ?? name,
    });
    usersDb.setDisabled(db, created.id, true);
    user = usersDb.getById(db, created.id);
    log(`created mapped user "${name}" <${mapping.email}> (disabled, awaiting invite)`);
  }
  if (!projectMembersDb.getRole(db, projectId, user.id)) {
    projectMembersDb.add(db, { projectId, userId: user.id, role: 'user' });
  }
  return user;
}

// ---------- Importer ----------

export function importIssues(db, projectId, csvText, opts = {}) {
  const log = opts.log ?? (() => {});
  const userMap = opts.userMap ?? new Map();
  const project = projectsDb.getById(db, projectId);
  if (!project) throw new Error(`project ${projectId} not found`);

  const rows = parseCsv(csvText).filter((r) => !(r.length === 1 && r[0] === ''));
  if (rows.length === 0) return { imported: 0, skipped: [] };

  const headers = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => headers.indexOf(name);

  const required = ['subject', 'created', 'opener'];
  for (const r of required) {
    if (col(r) < 0) throw new Error(`CSV missing required column: ${r}`);
  }

  const COL = {
    subject: col('subject'),
    status: col('status'),
    priority: col('priority'),
    category: col('category'),
    assignee: col('assignee'),
    created: col('created'),
    opener: col('opener'),
    updated: col('last updated'),
    description: col('description'),
  };

  const insertIssue = db.prepare(
    `INSERT INTO issues
       (project_id, number, name, description,
        status_id, category_id, priority_id,
        assigned_to, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertHistoryEvent = db.prepare(
    `INSERT INTO issue_history (issue_id, user_id, kind, changed_at)
     VALUES (?, ?, 'creation', ?)`,
  );
  const nextNumberStmt = db.prepare(
    'SELECT COALESCE(MAX(number), 0) + 1 AS n FROM issues WHERE project_id = ?',
  );

  let imported = 0;
  const skipped = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = i + 1;

    const subject = (row[COL.subject] ?? '').replace(/\s+/g, ' ').trim();
    if (!subject) {
      skipped.push({ line: lineNo, reason: 'missing subject' });
      continue;
    }

    const opener = (row[COL.opener] ?? '').trim();
    if (!opener) {
      skipped.push({ line: lineNo, reason: 'missing opener' });
      continue;
    }

    let createdAt;
    try {
      createdAt = parseExportDate(row[COL.created]);
    } catch (err) {
      skipped.push({ line: lineNo, reason: `invalid created date: ${err.message}` });
      continue;
    }

    let updatedAt = createdAt;
    if (COL.updated >= 0) {
      const raw = (row[COL.updated] ?? '').trim();
      if (raw) {
        try {
          updatedAt = parseExportDate(raw);
        } catch {
          log(`line ${lineNo}: invalid last-updated date, falling back to created`);
        }
      }
    }

    let name = subject;
    if (name.length > NAME_MAX) {
      log(`line ${lineNo}: subject truncated from ${name.length} to ${NAME_MAX} chars`);
      name = name.slice(0, NAME_MAX);
    }

    let description = COL.description >= 0 ? (row[COL.description] ?? '') : '';
    description = description.replace(/\r\n/g, '\n').trim();
    if (description.length === 0) {
      description = null;
    } else if (description.length > DESCRIPTION_MAX) {
      log(`line ${lineNo}: description truncated from ${description.length} to ${DESCRIPTION_MAX} chars`);
      description = description.slice(0, DESCRIPTION_MAX);
    }

    try {
      db.transaction(() => {
        const status = COL.status >= 0
          ? findOrCreateMetadata(db, 'statuses', projectId, row[COL.status], log)
          : null;
        const priority = COL.priority >= 0
          ? findOrCreateMetadata(db, 'priorities', projectId, row[COL.priority], log)
          : null;
        const category = COL.category >= 0
          ? findOrCreateMetadata(db, 'categories', projectId, row[COL.category], log)
          : null;

        const finalStatus = status ?? metadataDb.getDefault(db, 'statuses', projectId);
        const finalPriority = priority ?? metadataDb.getDefault(db, 'priorities', projectId);
        const finalCategory = category ?? metadataDb.getDefault(db, 'categories', projectId);
        if (!finalStatus) throw new Error('project has no default status');
        if (!finalPriority) throw new Error('project has no default priority');
        if (!finalCategory) throw new Error('project has no default category');

        const openerUser = findOrCreateMappedUser(db, opener, projectId, log, userMap);
        const assigneeRaw = COL.assignee >= 0 ? (row[COL.assignee] ?? '').trim() : '';
        const assigneeUser = assigneeRaw
          ? findOrCreateMappedUser(db, assigneeRaw, projectId, log, userMap)
          : null;

        const number = nextNumberStmt.get(projectId).n;
        const info = insertIssue.run(
          projectId,
          number,
          name,
          description,
          finalStatus.id,
          finalCategory.id,
          finalPriority.id,
          assigneeUser?.id ?? null,
          openerUser.id,
          createdAt,
          updatedAt,
        );
        insertHistoryEvent.run(info.lastInsertRowid, openerUser.id, createdAt);
      })();
      imported++;
    } catch (err) {
      skipped.push({ line: lineNo, reason: err.message });
    }
  }

  return { imported, skipped };
}

// ---------- CLI ----------

export function parseCliArgs(argv) {
  const out = { dryRun: false, maps: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--csv') out.csv = argv[++i];
    else if (a === '--project') out.project = argv[++i];
    else if (a === '--map') out.maps.push(argv[++i]);
    else if (a.startsWith('--csv=')) out.csv = a.slice('--csv='.length);
    else if (a.startsWith('--project=')) out.project = a.slice('--project='.length);
    else if (a.startsWith('--map=')) out.maps.push(a.slice('--map='.length));
  }
  return out;
}

function resolveProject(db, raw) {
  const asInt = Number.parseInt(raw, 10);
  if (Number.isInteger(asInt) && String(asInt) === String(raw).trim()) {
    return projectsDb.getById(db, asInt)?.id ?? null;
  }
  const row = db
    .prepare('SELECT id FROM projects WHERE name = ? COLLATE NOCASE')
    .get(String(raw));
  return row?.id ?? null;
}

const isMain = process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const args = parseCliArgs(process.argv.slice(2));
  if (!args.csv) {
    logger.error('missing --csv <path>');
    process.exit(1);
  }
  if (!args.project) {
    logger.error('missing --project <id-or-name>');
    process.exit(1);
  }
  if (!fs.existsSync(args.csv)) {
    logger.error(`CSV not found: ${args.csv}`);
    process.exit(1);
  }

  const db = openConnection(config.dbPath);
  runMigrations(db);

  const projectId = resolveProject(db, args.project);
  if (!projectId) {
    logger.error(`project not found: ${args.project}`);
    process.exit(1);
  }

  const csvText = fs.readFileSync(args.csv, 'utf8');
  const log = (m) => logger.info(m);

  let userMap;
  try {
    userMap = parseUserMap(args.maps);
  } catch (err) {
    logger.error(err.message);
    process.exit(1);
  }

  if (args.dryRun) {
    const sp = `import_dry_${Date.now()}`;
    db.exec(`SAVEPOINT ${sp}`);
    let summary;
    try {
      summary = importIssues(db, projectId, csvText, { log, userMap });
    } finally {
      db.exec(`ROLLBACK TO SAVEPOINT ${sp}`);
      db.exec(`RELEASE SAVEPOINT ${sp}`);
    }
    logger.info(`[dry-run] would import ${summary.imported} issues; ${summary.skipped.length} skipped`);
    for (const s of summary.skipped) logger.warn(`[dry-run] line ${s.line}: ${s.reason}`);
  } else {
    const summary = importIssues(db, projectId, csvText, { log, userMap });
    logger.info(`imported ${summary.imported} issues; ${summary.skipped.length} skipped`);
    for (const s of summary.skipped) logger.warn(`line ${s.line}: ${s.reason}`);
  }

  db.close();
}
