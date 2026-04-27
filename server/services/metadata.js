import * as metadataDb from '../db/metadata.js';
import {
  DEFAULT_STATUSES,
  DEFAULT_CATEGORIES,
  DEFAULT_PRIORITIES,
} from './metadataDefaults.js';

export class MetadataError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'MetadataError';
    this.code = code;
  }
}

const NAME_MAX = 64;

function normalizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().replace(/\s+/g, ' ');
}

function validateName(raw) {
  const name = normalizeName(raw);
  if (!name) throw new MetadataError('invalid_name');
  if (name.length > NAME_MAX) throw new MetadataError('invalid_name');
  return name;
}

export function seedDefaults(db, projectId) {
  for (const s of DEFAULT_STATUSES) {
    metadataDb.create(db, 'statuses', {
      projectId,
      name: s.name,
      sortOrder: s.sort_order,
      isDefault: s.is_default,
      isClosed: s.is_closed,
    });
  }
  for (const c of DEFAULT_CATEGORIES) {
    metadataDb.create(db, 'categories', {
      projectId,
      name: c.name,
      sortOrder: c.sort_order,
      isDefault: c.is_default,
    });
  }
  for (const p of DEFAULT_PRIORITIES) {
    metadataDb.create(db, 'priorities', {
      projectId,
      name: p.name,
      sortOrder: p.sort_order,
      isDefault: p.is_default,
    });
  }
}

export function listForProject(db, projectId, { includeArchived = false } = {}) {
  return {
    statuses: metadataDb.list(db, 'statuses', projectId, { includeArchived }),
    categories: metadataDb.list(db, 'categories', projectId, { includeArchived }),
    priorities: metadataDb.list(db, 'priorities', projectId, { includeArchived }),
  };
}

export function listKind(db, kind, projectId, { includeArchived = false } = {}) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  return metadataDb.list(db, kind, projectId, { includeArchived });
}

export function createItem(db, kind, projectId, payload) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  const name = validateName(payload?.name);
  const isClosed = kind === 'statuses' ? (payload?.isClosed ? 1 : 0) : 0;
  try {
    const sortOrder = metadataDb.maxSortOrder(db, kind, projectId) + 1;
    return metadataDb.create(db, kind, {
      projectId,
      name,
      sortOrder,
      isDefault: 0,
      isClosed,
    });
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new MetadataError('duplicate_name');
    }
    throw err;
  }
}

export function renameItem(db, kind, projectId, id, rawName) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  const name = validateName(rawName);
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  try {
    metadataDb.rename(db, kind, id, name);
  } catch (err) {
    if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw new MetadataError('duplicate_name');
    }
    throw err;
  }
}

export function reorder(db, kind, projectId, id, sortOrder) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  if (!Number.isInteger(sortOrder)) throw new MetadataError('invalid_sort_order');
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  metadataDb.setSortOrder(db, kind, id, sortOrder);
}

export function setDefault(db, kind, projectId, id) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  if (row.archived_at) throw new MetadataError('cannot_default_archived');
  db.transaction(() => {
    metadataDb.clearDefault(db, kind, projectId);
    metadataDb.setDefault(db, kind, id);
  })();
}

export function setClosed(db, kind, projectId, id, isClosed) {
  if (kind !== 'statuses') throw new MetadataError('invalid_kind');
  const row = metadataDb.getById(db, 'statuses', id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  metadataDb.setClosed(db, id, isClosed);
}

export function archiveItem(db, kind, projectId, id) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  if (row.archived_at) return; // idempotent
  if (row.is_default) throw new MetadataError('cannot_archive_default');
  if (metadataDb.countActive(db, kind, projectId) <= 1) {
    throw new MetadataError('cannot_archive_only_remaining');
  }
  metadataDb.archive(db, kind, id);
}

export function unarchiveItem(db, kind, projectId, id) {
  if (!metadataDb.isValidKind(kind)) throw new MetadataError('invalid_kind');
  const row = metadataDb.getById(db, kind, id);
  if (!row || row.project_id !== projectId) throw new MetadataError('not_found');
  if (!row.archived_at) return;
  metadataDb.unarchive(db, kind, id);
}
