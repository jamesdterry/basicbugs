import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';

export function createTestDb() {
  const db = openConnection(':memory:');
  runMigrations(db);
  return db;
}
