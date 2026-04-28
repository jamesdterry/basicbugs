#!/usr/bin/env node
import fs from 'node:fs';
import { openConnection } from '../server/db/connection.js';
import { runMigrations } from '../server/db/migrate.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import * as projectMembersDb from '../server/db/projectMembers.js';
import { createProject } from '../server/services/projects.js';
import { createIssue } from '../server/services/issues.js';
import { logger } from '../server/logger.js';

const DB_PATH = './data/e2e.sqlite';
const DEV_EMAIL = 'developer@e2e.local';
const DEV_PASSWORD = 'developer-pass-1';
const SUPER_ADMIN_EMAIL = 'admin@e2e.local';
const SUPER_ADMIN_PASSWORD = 'admin-pass-1';
const PROJECT_NAME = 'E2E Demo Project';
const ISSUE_NAME = 'Smoke test issue';

for (const suffix of ['', '-wal', '-shm']) {
  const file = DB_PATH + suffix;
  if (fs.existsSync(file)) fs.rmSync(file);
}

const db = openConnection(DB_PATH);
runMigrations(db);

const passwordHash = await hash(DEV_PASSWORD);
const developer = usersDb.create(db, {
  email: DEV_EMAIL,
  name: 'E2E Developer',
  passwordHash,
});

const adminPasswordHash = await hash(SUPER_ADMIN_PASSWORD);
usersDb.create(db, {
  email: SUPER_ADMIN_EMAIL,
  name: 'E2E Super Admin',
  passwordHash: adminPasswordHash,
});

const project = createProject(db, { name: PROJECT_NAME });
projectMembersDb.add(db, {
  projectId: project.id,
  userId: developer.id,
  role: 'developer',
});

createIssue(db, project.id, developer.id, 'developer', {
  name: ISSUE_NAME,
  description: 'Seeded by scripts/seed-e2e.js for Playwright smoke tests.',
});

db.close();

logger.info(`Seeded e2e DB at ${DB_PATH}`);
logger.info(`  user: ${DEV_EMAIL} / ${DEV_PASSWORD}`);
logger.info(`  super admin: ${SUPER_ADMIN_EMAIL} / ${SUPER_ADMIN_PASSWORD}`);
logger.info(`  project: ${PROJECT_NAME} (id ${project.id})`);
logger.info(`  issue: ${ISSUE_NAME}`);
