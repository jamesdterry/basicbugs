import * as issuesDb from '../db/issues.js';
import * as historyDb from '../db/history.js';
import * as metadataDb from '../db/metadata.js';
import * as projectMembersDb from '../db/projectMembers.js';
import * as usersDb from '../db/users.js';

export class IssueError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'IssueError';
    this.code = code;
  }
}

const NAME_MAX = 200;
const DESCRIPTION_MAX = 10_000;
const NOTE_MAX = 5_000;
const COMMENT_MAX = 10_000;
const LIMIT_MAX = 100;
const LIMIT_DEFAULT = 50;
const SEARCH_MAX = 200;

const ROLE_RANK = Object.freeze({ viewer: 1, user: 2, developer: 3 });

// Patch key → minimum role required to set it.
const FIELD_ROLE = Object.freeze({
  name: 'user',
  description: 'user',
  assignedTo: 'user',
  statusId: 'developer',
  categoryId: 'developer',
  priorityId: 'developer',
});

function rank(role) {
  return ROLE_RANK[role] ?? 0;
}

function requireRole(role, minimum) {
  if (rank(role) < ROLE_RANK[minimum]) throw new IssueError('forbidden');
}

function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) throw new IssueError('invalid_name');
  if (name.length > NAME_MAX) throw new IssueError('invalid_name');
  return name;
}

function normalizeDescription(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new IssueError('invalid_description');
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > DESCRIPTION_MAX) throw new IssueError('invalid_description');
  return trimmed;
}

function validateNote(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw new IssueError('invalid_note');
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > NOTE_MAX) throw new IssueError('invalid_note');
  return trimmed;
}

function validateBody(raw) {
  if (typeof raw !== 'string') throw new IssueError('invalid_body');
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new IssueError('invalid_body');
  if (trimmed.length > COMMENT_MAX) throw new IssueError('invalid_body');
  return trimmed;
}

function resolveMetadata(db, projectId, kind, id, errorCode) {
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new IssueError(errorCode);
  if (row.archived_at) throw new IssueError('archived_metadata');
  return row;
}

function pickDefault(db, projectId, kind) {
  const row = metadataDb.getDefault(db, kind, projectId);
  if (!row) throw new IssueError(`no_default_${kind}`);
  return row;
}

function resolveAssignee(db, projectId, userId) {
  if (userId == null) return null;
  if (!Number.isInteger(userId) || userId <= 0) throw new IssueError('invalid_assignee');
  const role = projectMembersDb.getRole(db, projectId, userId);
  if (!role) throw new IssueError('assignee_not_member');
  const user = usersDb.getById(db, userId);
  if (!user || user.is_disabled) throw new IssueError('assignee_not_member');
  return user;
}

function userDisplay(user) {
  if (!user) return null;
  return user.name && user.name.trim() ? user.name : user.email;
}

function hydrateIssue(db, issue) {
  if (!issue) return null;
  const status = metadataDb.getById(db, 'statuses', issue.status_id);
  const category = metadataDb.getById(db, 'categories', issue.category_id);
  const priority = metadataDb.getById(db, 'priorities', issue.priority_id);
  const assignee = issue.assigned_to ? usersDb.getById(db, issue.assigned_to) : null;
  const createdBy = usersDb.getById(db, issue.created_by);
  return {
    id: issue.id,
    project_id: issue.project_id,
    number: issue.number,
    name: issue.name,
    description: issue.description,
    status: status ? { id: status.id, name: status.name, is_closed: !!status.is_closed } : null,
    category: category ? { id: category.id, name: category.name } : null,
    priority: priority ? { id: priority.id, name: priority.name } : null,
    assignee: assignee
      ? { id: assignee.id, name: assignee.name, email: assignee.email }
      : null,
    created_by: createdBy
      ? { id: createdBy.id, name: createdBy.name, email: createdBy.email }
      : null,
    created_at: issue.created_at,
    updated_at: issue.updated_at,
    archived_at: issue.archived_at,
  };
}

// ---------- Public API ----------

export function createIssue(db, projectId, userId, role, payload = {}) {
  requireRole(role, 'user');

  const name = validateName(payload.name);
  const description = normalizeDescription(payload.description);

  const status =
    payload.statusId != null
      ? resolveMetadata(db, projectId, 'statuses', toInt(payload.statusId, 'invalid_status'), 'invalid_status')
      : pickDefault(db, projectId, 'statuses');
  const category =
    payload.categoryId != null
      ? resolveMetadata(
          db,
          projectId,
          'categories',
          toInt(payload.categoryId, 'invalid_category'),
          'invalid_category',
        )
      : pickDefault(db, projectId, 'categories');
  const priority =
    payload.priorityId != null
      ? resolveMetadata(
          db,
          projectId,
          'priorities',
          toInt(payload.priorityId, 'invalid_priority'),
          'invalid_priority',
        )
      : pickDefault(db, projectId, 'priorities');

  const assignee =
    payload.assignedTo != null ? resolveAssignee(db, projectId, toInt(payload.assignedTo, 'invalid_assignee')) : null;

  const issue = db.transaction(() => {
    const number = issuesDb.nextNumber(db, projectId);
    const row = issuesDb.create(db, {
      projectId,
      number,
      name,
      description,
      statusId: status.id,
      categoryId: category.id,
      priorityId: priority.id,
      assignedTo: assignee?.id ?? null,
      createdBy: userId,
    });
    historyDb.insertEvent(db, {
      issueId: row.id,
      userId,
      kind: 'creation',
      note: null,
    });
    return row;
  })();

  return hydrateIssue(db, issue);
}

export function getIssue(db, projectId, number) {
  const issue = issuesDb.getByNumber(db, projectId, number);
  if (!issue) throw new IssueError('not_found');
  return {
    issue: hydrateIssue(db, issue),
    history: historyDb.listForIssue(db, issue.id),
  };
}

export function listIssues(db, projectId, query = {}) {
  const opts = parseFilters(db, projectId, query);
  const { items, nextCursor } = issuesDb.list(db, projectId, opts);
  const cursorOut = nextCursor ? encodeCursor(nextCursor) : null;
  return {
    items: items.map((i) => hydrateIssue(db, i)),
    nextCursor: cursorOut,
  };
}

export function updateIssue(db, projectId, number, userId, role, rawPatch = {}, rawNote = null) {
  const patch = sanitizePatch(rawPatch);
  // Permission check on every key the caller wants to change.
  for (const key of Object.keys(patch)) {
    const min = FIELD_ROLE[key];
    if (!min) throw new IssueError('invalid_field');
    if (rank(role) < ROLE_RANK[min]) throw new IssueError('forbidden');
  }

  const note = validateNote(rawNote);

  const current = issuesDb.getByNumber(db, projectId, number);
  if (!current) throw new IssueError('not_found');

  // Resolve new values + build display strings without writing yet.
  const dbPatch = {};
  const diff = [];

  if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
    const newName = validateName(patch.name);
    if (newName !== current.name) {
      dbPatch.name = newName;
      diff.push({ field: 'name', oldValue: current.name, newValue: newName });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'description')) {
    const newDescription = normalizeDescription(patch.description);
    if ((newDescription ?? null) !== (current.description ?? null)) {
      dbPatch.description = newDescription;
      diff.push({
        field: 'description',
        oldValue: current.description,
        newValue: newDescription,
      });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'statusId')) {
    const id = toInt(patch.statusId, 'invalid_status');
    if (id !== current.status_id) {
      const next = resolveMetadata(db, projectId, 'statuses', id, 'invalid_status');
      const prev = metadataDb.getById(db, 'statuses', current.status_id);
      dbPatch.statusId = next.id;
      diff.push({ field: 'status', oldValue: prev?.name ?? null, newValue: next.name });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'categoryId')) {
    const id = toInt(patch.categoryId, 'invalid_category');
    if (id !== current.category_id) {
      const next = resolveMetadata(db, projectId, 'categories', id, 'invalid_category');
      const prev = metadataDb.getById(db, 'categories', current.category_id);
      dbPatch.categoryId = next.id;
      diff.push({ field: 'category', oldValue: prev?.name ?? null, newValue: next.name });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'priorityId')) {
    const id = toInt(patch.priorityId, 'invalid_priority');
    if (id !== current.priority_id) {
      const next = resolveMetadata(db, projectId, 'priorities', id, 'invalid_priority');
      const prev = metadataDb.getById(db, 'priorities', current.priority_id);
      dbPatch.priorityId = next.id;
      diff.push({ field: 'priority', oldValue: prev?.name ?? null, newValue: next.name });
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, 'assignedTo')) {
    const newId =
      patch.assignedTo == null ? null : toInt(patch.assignedTo, 'invalid_assignee');
    if ((newId ?? null) !== (current.assigned_to ?? null)) {
      const nextUser = newId == null ? null : resolveAssignee(db, projectId, newId);
      const prevUser = current.assigned_to ? usersDb.getById(db, current.assigned_to) : null;
      dbPatch.assignedTo = nextUser?.id ?? null;
      diff.push({
        field: 'assignee',
        oldValue: userDisplay(prevUser),
        newValue: userDisplay(nextUser),
      });
    }
  }

  if (diff.length === 0 && !note) {
    return hydrateIssue(db, current);
  }

  const updated = db.transaction(() => {
    const row =
      Object.keys(dbPatch).length > 0 ? issuesDb.update(db, current.id, dbPatch) : current;
    const event = historyDb.insertEvent(db, {
      issueId: current.id,
      userId,
      kind: 'change',
      note,
    });
    for (const d of diff) {
      historyDb.insertChange(db, {
        eventId: event.id,
        field: d.field,
        oldValue: d.oldValue,
        newValue: d.newValue,
      });
    }
    return row;
  })();

  return hydrateIssue(db, updated);
}

export function commentIssue(db, projectId, number, userId, role, body) {
  requireRole(role, 'user');
  const text = validateBody(body);
  const issue = issuesDb.getByNumber(db, projectId, number);
  if (!issue) throw new IssueError('not_found');
  historyDb.insertEvent(db, { issueId: issue.id, userId, kind: 'comment', note: text });
  return hydrateIssue(db, issue);
}

export function archiveIssue(db, projectId, number, _userId, role) {
  requireRole(role, 'developer');
  const issue = issuesDb.getByNumber(db, projectId, number);
  if (!issue) throw new IssueError('not_found');
  if (issue.archived_at) return hydrateIssue(db, issue);
  issuesDb.archive(db, issue.id);
  return hydrateIssue(db, issuesDb.getById(db, issue.id));
}

export function unarchiveIssue(db, projectId, number, _userId, role) {
  requireRole(role, 'developer');
  const issue = issuesDb.getByNumber(db, projectId, number);
  if (!issue) throw new IssueError('not_found');
  if (!issue.archived_at) return hydrateIssue(db, issue);
  issuesDb.unarchive(db, issue.id);
  return hydrateIssue(db, issuesDb.getById(db, issue.id));
}

// ---------- Helpers ----------

function toInt(raw, errorCode) {
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n <= 0) throw new IssueError(errorCode);
  return n;
}

const PATCH_KEYS = Object.freeze(['name', 'description', 'statusId', 'categoryId', 'priorityId', 'assignedTo']);

function sanitizePatch(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!PATCH_KEYS.includes(key)) throw new IssueError('invalid_field');
    out[key] = raw[key];
  }
  return out;
}

// ---------- Filter parser ----------

function parseIdList(raw) {
  if (raw == null) return [];
  const tokens = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  for (const token of tokens) {
    if (typeof token !== 'string' && typeof token !== 'number') {
      throw new IssueError('invalid_filter');
    }
    for (const part of String(token).split(',')) {
      const t = part.trim();
      if (!t) continue;
      const n = Number.parseInt(t, 10);
      if (!Number.isInteger(n) || n <= 0 || String(n) !== t) {
        throw new IssueError('invalid_filter');
      }
      ids.push(n);
    }
  }
  return ids;
}

function parseAssignees(raw) {
  if (raw == null) return { assigneeIds: [], includeUnassigned: false };
  const tokens = Array.isArray(raw) ? raw : [raw];
  const ids = [];
  let includeUnassigned = false;
  for (const token of tokens) {
    if (typeof token !== 'string' && typeof token !== 'number') {
      throw new IssueError('invalid_filter');
    }
    for (const part of String(token).split(',')) {
      const t = part.trim();
      if (!t) continue;
      if (t === 'unassigned') {
        includeUnassigned = true;
        continue;
      }
      const n = Number.parseInt(t, 10);
      if (!Number.isInteger(n) || n <= 0 || String(n) !== t) {
        throw new IssueError('invalid_filter');
      }
      ids.push(n);
    }
  }
  return { assigneeIds: ids, includeUnassigned };
}

function validateMetadataIds(db, projectId, kind, ids) {
  for (const id of ids) {
    const row = metadataDb.getById(db, kind, id);
    if (!row || row.project_id !== projectId) throw new IssueError('invalid_filter');
  }
}

function validateAssigneeIds(db, projectId, ids) {
  for (const id of ids) {
    const role = projectMembersDb.getRole(db, projectId, id);
    if (!role) throw new IssueError('invalid_filter');
  }
}

function decodeCursor(raw) {
  if (raw == null || raw === '') return null;
  try {
    const json = Buffer.from(String(raw), 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    if (
      parsed == null ||
      typeof parsed !== 'object' ||
      parsed.primary == null ||
      !Number.isInteger(parsed.id)
    ) {
      throw new Error('shape');
    }
    return { primary: parsed.primary, id: parsed.id };
  } catch {
    throw new IssueError('invalid_cursor');
  }
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64');
}

function parseFilters(db, projectId, query) {
  const statusIds = parseIdList(query.status);
  const categoryIds = parseIdList(query.category);
  const priorityIds = parseIdList(query.priority);
  const { assigneeIds, includeUnassigned } = parseAssignees(query.assignee);

  validateMetadataIds(db, projectId, 'statuses', statusIds);
  validateMetadataIds(db, projectId, 'categories', categoryIds);
  validateMetadataIds(db, projectId, 'priorities', priorityIds);
  validateAssigneeIds(db, projectId, assigneeIds);

  const sort = query.sort ?? 'updated_desc';
  if (!issuesDb.isValidSort(sort)) throw new IssueError('invalid_filter');

  const includeArchived = query.archived === '1' || query.archived === 'true';

  let limit = LIMIT_DEFAULT;
  if (query.limit != null) {
    const n = Number.parseInt(query.limit, 10);
    if (!Number.isInteger(n) || n < 1 || n > LIMIT_MAX) throw new IssueError('invalid_filter');
    limit = n;
  }

  const cursor = decodeCursor(query.cursor);

  let q = null;
  if (query.q != null) {
    if (typeof query.q !== 'string') throw new IssueError('invalid_filter');
    const trimmed = query.q.trim();
    if (trimmed.length > SEARCH_MAX) throw new IssueError('invalid_filter');
    if (trimmed.length > 0) q = trimmed;
  }

  return {
    statusIds,
    categoryIds,
    priorityIds,
    assigneeIds,
    includeUnassigned,
    includeArchived,
    q,
    sort,
    limit,
    cursor,
  };
}

