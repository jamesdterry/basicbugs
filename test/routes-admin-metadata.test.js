import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
import { config } from '../server/config.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import * as metadataDb from '../server/db/metadata.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

function newApp() {
  resetRateLimit();
  const db = createTestDb();
  const app = createApp({ db });
  return { app, db };
}

async function seedUser(db, { email, password = 'longenough-password' }) {
  const passwordHash = password ? await hash(password) : null;
  usersDb.create(db, { email, passwordHash });
  return usersDb.getByEmail(db, email);
}

async function loggedIn(app, email, password = 'longenough-password') {
  const agent = request.agent(app);
  const r = await agent.post('/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return agent;
}

async function loginAsSuperAdmin(app, db) {
  await seedUser(db, { email: config.superAdminEmail });
  return loggedIn(app, config.superAdminEmail);
}

async function makeProject(agent, name) {
  const r = await agent.post('/api/admin/projects').send({ name });
  if (r.status !== 201) throw new Error(`create project failed: ${r.status}`);
  return r.body.project;
}

describe('POST /api/admin/projects/:id/metadata/:kind/reset', () => {
  beforeEach(() => resetRateLimit());

  it('restores missing default statuses without touching custom rows', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const proj = await makeProject(sa, 'P');

    // Find "Closed" status and archive it (need to remove default first).
    const before = metadataDb.list(db, 'statuses', proj.id, { includeArchived: false });
    const closed = before.find((s) => s.name === 'Closed');
    expect(closed).toBeTruthy();
    expect(closed.archived_at).toBeFalsy();
    await sa.delete(`/api/projects/${proj.id}/metadata/statuses/${closed.id}`);
    expect(metadataDb.getById(db, 'statuses', closed.id).archived_at).toBeTruthy();

    // Add a custom status that shouldn't be touched.
    const create = await sa
      .post(`/api/projects/${proj.id}/metadata/statuses`)
      .send({ name: 'Custom Pending' });
    expect(create.status).toBe(201);
    const customId = create.body.item.id;

    const reset = await sa.post(`/api/admin/projects/${proj.id}/metadata/statuses/reset`);
    expect(reset.status).toBe(200);

    // Closed is unarchived.
    expect(metadataDb.getById(db, 'statuses', closed.id).archived_at).toBeNull();
    // Custom row is still there and unchanged.
    expect(metadataDb.getById(db, 'statuses', customId).name).toBe('Custom Pending');
    // Returned list includes both.
    const names = reset.body.items.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining(['Open', 'Closed', 'Custom Pending']));
  });

  it('repoints default if the current default name was renamed away', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const proj = await makeProject(sa, 'P');

    const before = metadataDb.list(db, 'priorities', proj.id, { includeArchived: false });
    const medium = before.find((p) => p.name === 'Medium');
    expect(medium.is_default).toBe(1);

    // Rename Medium to something else; default stays on this row but its name no longer matches the spec.
    await sa.patch(`/api/projects/${proj.id}/metadata/priorities/${medium.id}`).send({ name: 'Normal' });
    expect(metadataDb.getById(db, 'priorities', medium.id).name).toBe('Normal');

    const reset = await sa.post(`/api/admin/projects/${proj.id}/metadata/priorities/reset`);
    expect(reset.status).toBe(200);

    const fresh = metadataDb.list(db, 'priorities', proj.id, { includeArchived: false });
    const names = fresh.map((p) => p.name);
    expect(names).toContain('Medium');
    expect(names).toContain('Normal');
    // Spec default was missing, so reset created Medium and left Normal as the default.
    const defaults = fresh.filter((p) => p.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Normal');
  });

  it('forbids non-super-admin', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const proj = await makeProject(sa, 'P');
    await seedUser(db, { email: 'alice@x.com' });
    const alice = await loggedIn(app, 'alice@x.com');
    const res = await alice.post(`/api/admin/projects/${proj.id}/metadata/statuses/reset`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/projects/:id/metadata/:kind/copy-from/:srcId', () => {
  beforeEach(() => resetRateLimit());

  it('copies only names not present in destination', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const src = await makeProject(sa, 'Src');
    const dst = await makeProject(sa, 'Dst');

    // Add a custom category to src.
    await sa.post(`/api/projects/${src.id}/metadata/categories`).send({ name: 'Question' });

    // Both projects share the seeded defaults already.
    const dstBefore = metadataDb.list(db, 'categories', dst.id, { includeArchived: false });
    expect(dstBefore.map((c) => c.name)).toEqual(expect.arrayContaining(['Bug', 'Feature', 'Task']));

    const copy = await sa.post(
      `/api/admin/projects/${dst.id}/metadata/categories/copy-from/${src.id}`,
    );
    expect(copy.status).toBe(200);
    expect(copy.body.inserted).toBe(1);

    const dstAfter = metadataDb.list(db, 'categories', dst.id, { includeArchived: false });
    const names = dstAfter.map((c) => c.name);
    expect(names).toContain('Question');

    // The copied row is not the default.
    const question = dstAfter.find((c) => c.name === 'Question');
    expect(question.is_default).toBe(0);

    // Bug is still the default in dst (untouched).
    const defaults = dstAfter.filter((c) => c.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].name).toBe('Bug');
  });

  it('rejects copy from itself', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const proj = await makeProject(sa, 'P');
    const res = await sa.post(
      `/api/admin/projects/${proj.id}/metadata/categories/copy-from/${proj.id}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_source');
  });
});
