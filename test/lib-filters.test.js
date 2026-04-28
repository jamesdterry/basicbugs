import { describe, it, expect } from 'vitest';
import {
  defaults,
  hasAnyFilterKey,
  parseFromQuery,
  serializeToQuery,
  isDefault,
  storageKey,
  loadFromStorage,
  saveToStorage,
  clearStorage,
} from '../public/lib/filters.js';

const fixtureMetadata = {
  statuses: [
    { id: 1, name: 'Open', is_closed: false, archived_at: null },
    { id: 2, name: 'In Progress', is_closed: false, archived_at: null },
    { id: 3, name: 'Closed', is_closed: true, archived_at: null },
    { id: 4, name: 'Stale', is_closed: false, archived_at: '2026-01-01' },
  ],
  categories: [{ id: 10 }, { id: 11 }],
  priorities: [{ id: 20 }, { id: 21 }],
};

function makeStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    },
    _map: map,
  };
}

describe('filters defaults', () => {
  it('uses non-closed, non-archived statuses; empty for other lists; updated_desc sort', () => {
    const d = defaults(fixtureMetadata);
    expect(d.status.sort()).toEqual([1, 2]);
    expect(d.category).toEqual([]);
    expect(d.priority).toEqual([]);
    expect(d.assignee).toEqual([]);
    expect(d.q).toBe('');
    expect(d.archived).toBe(false);
    expect(d.sort).toBe('updated_desc');
  });

  it('returns empty status list when metadata is missing', () => {
    expect(defaults({}).status).toEqual([]);
    expect(defaults(null).status).toEqual([]);
  });
});

describe('hasAnyFilterKey', () => {
  it('detects any of the relevant keys', () => {
    expect(hasAnyFilterKey({})).toBe(false);
    expect(hasAnyFilterKey({ unrelated: 'x' })).toBe(false);
    expect(hasAnyFilterKey({ status: '1' })).toBe(true);
    expect(hasAnyFilterKey({ q: '' })).toBe(true);
    expect(hasAnyFilterKey({ sort: 'number_asc' })).toBe(true);
  });
});

describe('parseFromQuery', () => {
  it('returns null when no relevant keys are present', () => {
    expect(parseFromQuery({}, defaults(fixtureMetadata))).toBeNull();
  });

  it('parses comma-separated id lists', () => {
    const f = parseFromQuery(
      { status: '1,2', priority: '20', sort: 'number_asc' },
      defaults(fixtureMetadata),
    );
    expect(f.status).toEqual([1, 2]);
    expect(f.priority).toEqual([20]);
    expect(f.category).toEqual([]); // omitted → default ([] in this case)
    expect(f.sort).toBe('number_asc');
    expect(f.q).toBe('');
    expect(f.archived).toBe(false);
  });

  it('treats empty value as cleared filter (show all)', () => {
    const f = parseFromQuery({ status: '' }, defaults(fixtureMetadata));
    expect(f.status).toEqual([]);
  });

  it('honors archived=1', () => {
    const f = parseFromQuery({ archived: '1' }, defaults(fixtureMetadata));
    expect(f.archived).toBe(true);
  });

  it('falls back to default sort when sort value is invalid', () => {
    const f = parseFromQuery({ sort: 'bogus' }, defaults(fixtureMetadata));
    expect(f.sort).toBe('updated_desc');
  });

  it('parses unassigned literal in assignee list', () => {
    const f = parseFromQuery({ assignee: '5,unassigned' }, defaults(fixtureMetadata));
    expect(f.assignee).toEqual([5, 'unassigned']);
  });
});

describe('serializeToQuery', () => {
  it('omits keys equal to defaults', () => {
    const d = defaults(fixtureMetadata);
    expect(serializeToQuery(d, d)).toEqual({});
  });

  it('emits non-default values', () => {
    const d = defaults(fixtureMetadata);
    const filters = { ...d, sort: 'number_asc', q: 'foo', archived: true, priority: [21] };
    expect(serializeToQuery(filters, d)).toEqual({
      sort: 'number_asc',
      q: 'foo',
      archived: '1',
      priority: '21',
    });
  });

  it('emits status= empty string when user explicitly clears the status filter', () => {
    const d = defaults(fixtureMetadata);
    const filters = { ...d, status: [] };
    expect(serializeToQuery(filters, d)).toEqual({ status: '' });
  });

  it('round-trips through parseFromQuery', () => {
    const d = defaults(fixtureMetadata);
    const filters = { ...d, status: [2], priority: [21], q: 'login', sort: 'created_desc' };
    const round = parseFromQuery(serializeToQuery(filters, d), d);
    expect(round).toEqual(filters);
  });
});

describe('isDefault', () => {
  it('is true for unchanged defaults', () => {
    const d = defaults(fixtureMetadata);
    expect(isDefault(d, d)).toBe(true);
  });

  it('is false when any field differs', () => {
    const d = defaults(fixtureMetadata);
    expect(isDefault({ ...d, q: 'x' }, d)).toBe(false);
    expect(isDefault({ ...d, archived: true }, d)).toBe(false);
    expect(isDefault({ ...d, status: [] }, d)).toBe(false);
  });
});

describe('storage helpers', () => {
  it('uses the basicbugs.filters.${userId}.${projectId} key', () => {
    expect(storageKey(7, 42)).toBe('basicbugs.filters.7.42');
  });

  it('round-trips a filter through save + load', () => {
    const storage = makeStorage();
    const d = defaults(fixtureMetadata);
    const filters = { ...d, q: 'foo', priority: [21], archived: true, sort: 'number_asc' };
    saveToStorage(7, 42, filters, storage);
    const loaded = loadFromStorage(7, 42, storage);
    expect(loaded).toEqual(filters);
  });

  it('returns null for missing or corrupt JSON', () => {
    const storage = makeStorage();
    expect(loadFromStorage(7, 42, storage)).toBeNull();
    storage.setItem(storageKey(7, 42), '{not json');
    expect(loadFromStorage(7, 42, storage)).toBeNull();
  });

  it('clearStorage removes the entry', () => {
    const storage = makeStorage();
    saveToStorage(7, 42, defaults(fixtureMetadata), storage);
    expect(storage._map.has(storageKey(7, 42))).toBe(true);
    clearStorage(7, 42, storage);
    expect(storage._map.has(storageKey(7, 42))).toBe(false);
  });

  it('drops unexpected fields and bad types when loading', () => {
    const storage = makeStorage();
    storage.setItem(
      storageKey(7, 42),
      JSON.stringify({ status: 'not-array', q: 5, archived: 'yes', sort: 'bogus', extra: true }),
    );
    const loaded = loadFromStorage(7, 42, storage);
    expect(loaded).toEqual({
      status: [],
      category: [],
      priority: [],
      assignee: [],
      q: '',
      archived: false,
      sort: 'updated_desc',
    });
  });
});
