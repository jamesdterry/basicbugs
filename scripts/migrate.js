#!/usr/bin/env node
import { runMigrations } from '../server/db/migrate.js';
import { logger } from '../server/logger.js';

const result = runMigrations();
if (result.applied.length === 0) {
  logger.info('No migrations to apply.');
} else {
  logger.info(`Applied ${result.applied.length} migration(s):`, result.applied);
}
