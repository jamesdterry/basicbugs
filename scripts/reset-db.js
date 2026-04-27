#!/usr/bin/env node
import fs from 'node:fs';
import { config } from '../server/config.js';
import { closeDb } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';
import { logger } from '../server/logger.js';

if (config.isProduction) {
  logger.error('Refusing to reset database in production (NODE_ENV=production).');
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const file = config.dbPath + suffix;
  if (fs.existsSync(file)) {
    fs.rmSync(file);
    logger.info(`Removed ${file}`);
  }
}

const { applied } = runMigrations();
logger.info(`Applied ${applied.length} migration(s):`, applied);
closeDb();
