#!/usr/bin/env node
import { runMigrations } from '../server/db/migrate.js';
import { closeDb } from '../server/db/connection.js';
import { logger } from '../server/logger.js';

const { applied, skipped } = runMigrations();
if (applied.length === 0) {
  logger.info(`No migrations to apply (${skipped.length} already applied).`);
} else {
  logger.info(`Applied ${applied.length} migration(s):`, applied);
}
closeDb();
