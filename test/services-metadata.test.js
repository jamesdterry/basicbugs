import { describe, it, expect } from 'vitest';
import { createTestDb } from './db.js';
import * as projectsDb from '../server/db/projects.js';
import * as metadataDb from '../server/db/metadata.js';
import * as metadata from '../server/services/metadata.js';
import {
  DEFAULT_STATUSES,
  DEFAULT_CATEGORIES,
  DEFAULT_PRIORITIES,
} from '../server/services/metadataDefaults.js';

function freshProject(db, name = 'P') {
  return projectsDb.create(db, { name });
}

describe('services/metadata.seedDefaults', () => {
  it('inserts 6 statuses, 3 categories, 5 priorities with the right flags', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);

    const statuses = metadataDb.list(db, 'statuses', p.id);
    const categories = metadataDb.list(db, 'categories', p.id);
    const priorities = metadataDb.list(db, 'priorities', p.id);

    expect(statuses).toHaveLength(DEFAULT_STATUSES.length);
    expect(categories).toHaveLength(DEFAULT_CATEGORIES.length);
    expect(priorities).toHaveLength(DEFAULT_PRIORITIES.length);

    expect(statuses.map((s) => s.name)).toEqual(DEFAULT_STATUSES.map((s) => s.name));

    const defaultStatus = statuses.find((s) => s.is_default === 1);
    expect(defaultStatus.name).toBe('Open');

    const closedStatuses = statuses.filter((s) => s.is_closed === 1).map((s) => s.name);
    expect(closedStatuses.sort()).toEqual(['Closed', 'Resolved']);

    expect(categories.find((c) => c.is_default === 1).name).toBe('Bug');
    expect(priorities.find((p) => p.is_default === 1).name).toBe('Medium');

    // Exactly one default per kind.
    expect(statuses.filter((s) => s.is_default === 1)).toHaveLength(1);
    expect(categories.filter((c) => c.is_default === 1)).toHaveLength(1);
    expect(priorities.filter((p) => p.is_default === 1)).toHaveLength(1);
  });
});

describe('services/metadata.createItem', () => {
  it('trims, normalizes whitespace, assigns next sort order, never default', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const item = metadata.createItem(db, 'priorities', p.id, { name: '  Urgent   Hot  ' });
    expect(item.name).toBe('Urgent Hot');
    expect(item.is_default).toBe(0);
    expect(item.sort_order).toBe(DEFAULT_PRIORITIES.length + 1);
  });

  it('rejects empty / whitespace-only names', () => {
    const db = createTestDb();
    const p = freshProject(db);
    expect(() => metadata.createItem(db, 'statuses', p.id, { name: '   ' })).toThrow(
      /invalid_name/,
    );
  });

  it('maps UNIQUE conflict to duplicate_name', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    expect(() => metadata.createItem(db, 'statuses', p.id, { name: 'Open' })).toThrow(
      /duplicate_name/,
    );
  });

  it('rejects unknown kind', () => {
    const db = createTestDb();
    const p = freshProject(db);
    expect(() => metadata.createItem(db, 'wat', p.id, { name: 'x' })).toThrow(/invalid_kind/);
  });

  it('sets isClosed only on statuses', () => {
    const db = createTestDb();
    const p = freshProject(db);
    const s = metadata.createItem(db, 'statuses', p.id, { name: 'Done', isClosed: true });
    expect(s.is_closed).toBe(1);
    const c = metadata.createItem(db, 'categories', p.id, { name: 'Other', isClosed: true });
    expect(c.is_closed).toBeUndefined();
  });
});

describe('services/metadata.setDefault', () => {
  it('re-points exactly one default per kind', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const list = metadataDb.list(db, 'priorities', p.id);
    const newDefault = list.find((r) => r.name === 'Low');
    metadata.setDefault(db, 'priorities', p.id, newDefault.id);

    const after = metadataDb.list(db, 'priorities', p.id);
    expect(after.filter((r) => r.is_default === 1)).toHaveLength(1);
    expect(after.find((r) => r.is_default === 1).name).toBe('Low');
  });

  it('refuses to default an archived row', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const trivial = metadataDb.list(db, 'priorities', p.id).find((r) => r.name === 'Trivial');
    metadataDb.archive(db, 'priorities', trivial.id);
    expect(() => metadata.setDefault(db, 'priorities', p.id, trivial.id)).toThrow(
      /cannot_default_archived/,
    );
  });

  it('rejects an item from another project', () => {
    const db = createTestDb();
    const p1 = projectsDb.create(db, { name: 'P1' });
    const p2 = projectsDb.create(db, { name: 'P2' });
    metadata.seedDefaults(db, p1.id);
    metadata.seedDefaults(db, p2.id);
    const otherStatus = metadataDb.list(db, 'statuses', p2.id)[0];
    expect(() => metadata.setDefault(db, 'statuses', p1.id, otherStatus.id)).toThrow(/not_found/);
  });
});

describe('services/metadata.setClosed', () => {
  it('flips is_closed only for the statuses kind', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const open = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Open');
    metadata.setClosed(db, 'statuses', p.id, open.id, true);
    expect(metadataDb.getById(db, 'statuses', open.id).is_closed).toBe(1);

    const cat = metadataDb.list(db, 'categories', p.id)[0];
    expect(() => metadata.setClosed(db, 'categories', p.id, cat.id, true)).toThrow(/invalid_kind/);
  });
});

describe('services/metadata.archiveItem', () => {
  it('rejects archiving the default', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const open = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Open');
    expect(() => metadata.archiveItem(db, 'statuses', p.id, open.id)).toThrow(
      /cannot_archive_default/,
    );
  });

  it('rejects archiving the only non-archived row of a kind', () => {
    const db = createTestDb();
    const p = freshProject(db);
    const only = metadata.createItem(db, 'categories', p.id, { name: 'Solo' });
    expect(() => metadata.archiveItem(db, 'categories', p.id, only.id)).toThrow(
      /cannot_archive_only_remaining/,
    );
  });

  it('archives a non-default row when others remain', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const closed = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Closed');
    metadata.archiveItem(db, 'statuses', p.id, closed.id);
    expect(metadataDb.getById(db, 'statuses', closed.id).archived_at).not.toBeNull();
  });

  it('is idempotent on an already-archived row', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const closed = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Closed');
    metadata.archiveItem(db, 'statuses', p.id, closed.id);
    expect(() => metadata.archiveItem(db, 'statuses', p.id, closed.id)).not.toThrow();
  });
});

describe('services/metadata.renameItem', () => {
  it('renames inside the project', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const blocked = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Blocked');
    metadata.renameItem(db, 'statuses', p.id, blocked.id, '  On Hold  ');
    expect(metadataDb.getById(db, 'statuses', blocked.id).name).toBe('On Hold');
  });

  it('maps UNIQUE conflict to duplicate_name', () => {
    const db = createTestDb();
    const p = freshProject(db);
    metadata.seedDefaults(db, p.id);
    const blocked = metadataDb.list(db, 'statuses', p.id).find((s) => s.name === 'Blocked');
    expect(() => metadata.renameItem(db, 'statuses', p.id, blocked.id, 'Open')).toThrow(
      /duplicate_name/,
    );
  });

  it('rejects rename of an item from another project', () => {
    const db = createTestDb();
    const p1 = projectsDb.create(db, { name: 'P1' });
    const p2 = projectsDb.create(db, { name: 'P2' });
    metadata.seedDefaults(db, p1.id);
    metadata.seedDefaults(db, p2.id);
    const other = metadataDb.list(db, 'statuses', p2.id)[0];
    expect(() => metadata.renameItem(db, 'statuses', p1.id, other.id, 'Whatever')).toThrow(
      /not_found/,
    );
  });
});
