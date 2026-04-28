// Filter state for the issue list. Pure module — no DOM, no globals.
// Filter shape:
//   {
//     status:   number[],
//     category: number[],
//     priority: number[],
//     assignee: (number|'unassigned')[],
//     q:        string,
//     archived: boolean,
//     sort:     'updated_desc'|'created_desc'|'number_asc'|'number_desc',
//   }

export const VALID_SORTS = ['updated_desc', 'created_desc', 'number_asc', 'number_desc'];

const FILTER_KEYS = ['status', 'category', 'priority', 'assignee', 'q', 'archived', 'sort'];

export function defaults(metadata) {
  const statuses = (metadata?.statuses ?? [])
    .filter((s) => !s.is_closed && !s.archived_at)
    .map((s) => s.id);
  return {
    status: statuses,
    category: [],
    priority: [],
    assignee: [],
    q: '',
    archived: false,
    sort: 'updated_desc',
  };
}

export function hasAnyFilterKey(queryObj) {
  if (!queryObj) return false;
  return FILTER_KEYS.some((k) => Object.prototype.hasOwnProperty.call(queryObj, k));
}

export function parseFromQuery(queryObj, defaultsObj) {
  if (!hasAnyFilterKey(queryObj)) return null;
  return {
    status: parseIdList(queryObj.status, defaultsObj.status),
    category: parseIdList(queryObj.category, defaultsObj.category),
    priority: parseIdList(queryObj.priority, defaultsObj.priority),
    assignee: parseAssigneeList(queryObj.assignee, defaultsObj.assignee),
    q: typeof queryObj.q === 'string' ? queryObj.q : defaultsObj.q,
    archived: queryObj.archived === '1' || queryObj.archived === 'true',
    sort: VALID_SORTS.includes(queryObj.sort) ? queryObj.sort : defaultsObj.sort,
  };
}

export function serializeToQuery(filters, defaultsObj) {
  const out = {};
  if (!arraysEqual(filters.status, defaultsObj.status)) {
    out.status = filters.status.join(',');
  }
  if (!arraysEqual(filters.category, defaultsObj.category)) {
    out.category = filters.category.join(',');
  }
  if (!arraysEqual(filters.priority, defaultsObj.priority)) {
    out.priority = filters.priority.join(',');
  }
  if (!arraysEqual(filters.assignee, defaultsObj.assignee)) {
    out.assignee = filters.assignee.join(',');
  }
  if (filters.q && filters.q.length > 0) out.q = filters.q;
  if (filters.archived !== defaultsObj.archived) out.archived = filters.archived ? '1' : '0';
  if (filters.sort !== defaultsObj.sort) out.sort = filters.sort;
  return out;
}

export function isDefault(filters, defaultsObj) {
  return (
    arraysEqual(filters.status, defaultsObj.status) &&
    arraysEqual(filters.category, defaultsObj.category) &&
    arraysEqual(filters.priority, defaultsObj.priority) &&
    arraysEqual(filters.assignee, defaultsObj.assignee) &&
    (filters.q ?? '') === (defaultsObj.q ?? '') &&
    filters.archived === defaultsObj.archived &&
    filters.sort === defaultsObj.sort
  );
}

export function storageKey(userId, projectId) {
  return `basicbugs.filters.${userId}.${projectId}`;
}

export function loadFromStorage(userId, projectId, storage = globalThis.localStorage) {
  if (!storage) return null;
  let raw;
  try {
    raw = storage.getItem(storageKey(userId, projectId));
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeStored(parsed);
  } catch {
    return null;
  }
}

export function saveToStorage(userId, projectId, filters, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.setItem(storageKey(userId, projectId), JSON.stringify(filters));
  } catch {
    // Quota or disabled storage — silently ignore.
  }
}

export function clearStorage(userId, projectId, storage = globalThis.localStorage) {
  if (!storage) return;
  try {
    storage.removeItem(storageKey(userId, projectId));
  } catch {
    // ignore
  }
}

function parseIdList(raw, fallback) {
  if (raw === undefined) return fallback.slice();
  if (typeof raw !== 'string') return [];
  if (raw === '') return [];
  const out = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    const n = Number.parseInt(t, 10);
    if (Number.isInteger(n) && n > 0 && String(n) === t) out.push(n);
  }
  return out;
}

function parseAssigneeList(raw, fallback) {
  if (raw === undefined) return fallback.slice();
  if (typeof raw !== 'string') return [];
  if (raw === '') return [];
  const out = [];
  for (const part of raw.split(',')) {
    const t = part.trim();
    if (!t) continue;
    if (t === 'unassigned') {
      out.push('unassigned');
      continue;
    }
    const n = Number.parseInt(t, 10);
    if (Number.isInteger(n) && n > 0 && String(n) === t) out.push(n);
  }
  return out;
}

function arraysEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}

function normalizeStored(obj) {
  const status = Array.isArray(obj.status) ? obj.status.filter(Number.isInteger) : [];
  const category = Array.isArray(obj.category) ? obj.category.filter(Number.isInteger) : [];
  const priority = Array.isArray(obj.priority) ? obj.priority.filter(Number.isInteger) : [];
  const assignee = Array.isArray(obj.assignee)
    ? obj.assignee.filter((v) => v === 'unassigned' || Number.isInteger(v))
    : [];
  const q = typeof obj.q === 'string' ? obj.q : '';
  const archived = obj.archived === true;
  const sort = VALID_SORTS.includes(obj.sort) ? obj.sort : 'updated_desc';
  return { status, category, priority, assignee, q, archived, sort };
}
