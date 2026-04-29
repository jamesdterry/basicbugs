import { describe, it, expect } from 'vitest';
import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';

const EXPECTED_TABLES = [
  'users',
  'projects',
  'project_members',
  'issue_statuses',
  'issue_categories',
  'issue_priorities',
  'issues',
  'issue_history',
  'issue_history_changes',
  'auth_tokens',
  'sessions',
  'attachments',
  'issue_watchers',
  'notification_prefs',
  'notifications',
  '_health',
  'error_log',
  'admin_audit',
];

function listSchemaTables(db) {
  return db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type='table'
         AND name NOT LIKE 'sqlite_%'
         AND name != '_migrations'
       ORDER BY name`,
    )
    .all()
    .map((row) => row.name);
}

describe('runMigrations', () => {
  it('creates all expected schema tables on a fresh db', () => {
    const db = openConnection(':memory:');
    runMigrations(db);

    const tables = listSchemaTables(db);
    expect(tables).toHaveLength(EXPECTED_TABLES.length);
    for (const name of EXPECTED_TABLES) {
      expect(tables).toContain(name);
    }
  });

  it('returns { applied, skipped } and tracks applied migrations', () => {
    const db = openConnection(':memory:');
    const result = runMigrations(db);

    expect(Array.isArray(result.applied)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
    expect(result.applied).toContain('0001_initial.sql');
    expect(result.skipped).toEqual([]);

    const tracked = db.prepare('SELECT name FROM _migrations ORDER BY name').all();
    expect(tracked.map((r) => r.name)).toEqual(result.applied);
  });

  it('is idempotent — a second run applies nothing and skips everything', () => {
    const db = openConnection(':memory:');
    const first = runMigrations(db);
    const second = runMigrations(db);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(first.applied);

    expect(listSchemaTables(db)).toHaveLength(EXPECTED_TABLES.length);
  });
});
