import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
import { config } from '../server/config.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

function newApp() {
  resetRateLimit();
  const db = createTestDb();
  const app = createApp({ db });
  return { app, db };
}

async function seedUser(db, { email, password = 'longenough-password', name = null }) {
  const passwordHash = await hash(password);
  usersDb.create(db, { email, name, passwordHash });
  return usersDb.getByEmail(db, email);
}

async function loggedIn(app, email, password = 'longenough-password') {
  const agent = request.agent(app);
  const r = await agent.post('/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}

async function loginAsSuperAdmin(app, db) {
  await seedUser(db, { email: config.superAdminEmail });
  return loggedIn(app, config.superAdminEmail);
}

async function makeProject(agent, name = 'P') {
  const r = await agent.post('/api/admin/projects').send({ name });
  if (r.status !== 201) throw new Error(`create project failed: ${r.status}`);
  return r.body.project;
}

async function setupProjectWith(role) {
  const { app, db } = newApp();
  const sa = await loginAsSuperAdmin(app, db);
  const project = await makeProject(sa, 'P');
  const alice = await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
  await sa
    .post(`/api/admin/projects/${project.id}/members`)
    .send({ userId: alice.id, role });
  const aliceAgent = await loggedIn(app, 'alice@x.com');
  return { app, db, sa, alice, aliceAgent, project };
}

describe('POST /api/projects/:id/issues', () => {
  beforeEach(() => resetRateLimit());

  it('user creates an issue with defaults', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'first', description: 'hello' });
    expect(r.status).toBe(201);
    expect(r.body.issue.number).toBe(1);
    expect(r.body.issue.status.name).toBe('Open');
    expect(r.body.issue.priority.name).toBe('Medium');
  });

  it('viewer is forbidden', async () => {
    const { aliceAgent, project } = await setupProjectWith('viewer');
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'first' });
    expect(r.status).toBe(403);
    expect(r.body.error).toBe('forbidden');
  });

  it('rejects invalid name', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_name');
  });
});

describe('GET /api/projects/:id/issues/:number', () => {
  beforeEach(() => resetRateLimit());

  it('returns the issue with its history', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'i' });
    await aliceAgent
      .patch(`/api/projects/${project.id}/issues/1`)
      .send({ patch: { name: 'i2' }, note: 'rename' });
    await aliceAgent
      .post(`/api/projects/${project.id}/issues/1/comments`)
      .send({ body: 'hi' });

    const r = await aliceAgent.get(`/api/projects/${project.id}/issues/1`);
    expect(r.status).toBe(200);
    expect(r.body.issue.name).toBe('i2');
    expect(r.body.history).toHaveLength(3);
    expect(r.body.history.map((e) => e.kind)).toEqual(['comment', 'change', 'creation']);
  });

  it('returns 404 for unknown number', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    const r = await aliceAgent.get(`/api/projects/${project.id}/issues/999`);
    expect(r.status).toBe(404);
  });
});

describe('PATCH /api/projects/:id/issues/:number', () => {
  beforeEach(() => resetRateLimit());

  it('user can patch name but not status', async () => {
    const { app, db, sa, project } = await setupProjectWith('developer');
    await sa.post(`/api/projects/${project.id}/issues`).send({ name: 'i' });

    const bob = await seedUser(db, { email: 'bob@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: bob.id, role: 'user' });
    const bobAgent = await loggedIn(app, 'bob@x.com');

    const ok = await bobAgent
      .patch(`/api/projects/${project.id}/issues/1`)
      .send({ patch: { name: 'renamed' } });
    expect(ok.status).toBe(200);

    const allStatuses = await sa.get(`/api/projects/${project.id}/metadata/statuses`);
    const inProgress = allStatuses.body.items.find((s) => s.name === 'In Progress');

    const denied = await bobAgent
      .patch(`/api/projects/${project.id}/issues/1`)
      .send({ patch: { statusId: inProgress.id } });
    expect(denied.status).toBe(403);
  });

  it('rejects unknown field', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'i' });
    const r = await aliceAgent
      .patch(`/api/projects/${project.id}/issues/1`)
      .send({ patch: { bogus: 1 } });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_field');
  });
});

describe('GET /api/projects/:id/issues — list + filters', () => {
  beforeEach(() => resetRateLimit());

  it('lists, filters, paginates', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    for (let i = 0; i < 3; i++) {
      await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: `i${i}` });
    }
    const allStatuses = await aliceAgent.get(`/api/projects/${project.id}/metadata/statuses`);
    const inProgress = allStatuses.body.items.find((s) => s.name === 'In Progress');
    await aliceAgent
      .patch(`/api/projects/${project.id}/issues/2`)
      .send({ patch: { statusId: inProgress.id } });

    const open = await aliceAgent.get(
      `/api/projects/${project.id}/issues?status=${inProgress.id}`,
    );
    expect(open.status).toBe(200);
    expect(open.body.items).toHaveLength(1);
    expect(open.body.items[0].number).toBe(2);

    const page1 = await aliceAgent.get(
      `/api/projects/${project.id}/issues?sort=number_asc&limit=2`,
    );
    expect(page1.body.items.map((i) => i.number)).toEqual([1, 2]);
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await aliceAgent.get(
      `/api/projects/${project.id}/issues?sort=number_asc&limit=2&cursor=${encodeURIComponent(page1.body.nextCursor)}`,
    );
    expect(page2.body.items.map((i) => i.number)).toEqual([3]);
    expect(page2.body.nextCursor).toBeNull();
  });

  it('non-member receives 404 (mask existence)', async () => {
    const { app, db, sa } = await setupProjectWith('developer');
    const project = await makeProject(sa, 'Hidden');
    await seedUser(db, { email: 'eve@x.com' });
    const eve = await loggedIn(app, 'eve@x.com');
    const r = await eve.get(`/api/projects/${project.id}/issues`);
    expect(r.status).toBe(404);
  });

  it('q filter matches by name substring (case-insensitive ASCII)', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'Login bug' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'logout flow' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'Signup race' });

    const hits = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=${encodeURIComponent('log')}`,
    );
    expect(hits.status).toBe(200);
    expect(hits.body.items.map((i) => i.name).sort()).toEqual(['Login bug', 'logout flow']);

    const upper = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=${encodeURIComponent('LOGIN')}`,
    );
    expect(upper.body.items.map((i) => i.name)).toEqual(['Login bug']);
  });

  it('q treats LIKE wildcards literally', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'plain' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'pct 50%' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'under_score' });

    const pct = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=${encodeURIComponent('%')}`,
    );
    expect(pct.body.items.map((i) => i.name)).toEqual(['pct 50%']);

    const usc = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=${encodeURIComponent('_')}`,
    );
    expect(usc.body.items.map((i) => i.name)).toEqual(['under_score']);
  });

  it('q rejects strings longer than the limit', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    const tooLong = 'a'.repeat(201);
    const r = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=${encodeURIComponent(tooLong)}`,
    );
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_filter');
  });

  it('q combines with status filter', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'foo open' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'foo closed' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'bar' });

    const allStatuses = await aliceAgent.get(`/api/projects/${project.id}/metadata/statuses`);
    const closed = allStatuses.body.items.find((s) => s.is_closed);
    await aliceAgent
      .patch(`/api/projects/${project.id}/issues/2`)
      .send({ patch: { statusId: closed.id } });

    const r = await aliceAgent.get(
      `/api/projects/${project.id}/issues?q=foo&status=${closed.id}&archived=1`,
    );
    expect(r.body.items.map((i) => i.name)).toEqual(['foo closed']);
  });

  it('blank or whitespace q is ignored', async () => {
    const { aliceAgent, project } = await setupProjectWith('developer');
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'one' });
    await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'two' });

    const r = await aliceAgent.get(`/api/projects/${project.id}/issues?q=${encodeURIComponent('   ')}`);
    expect(r.body.items).toHaveLength(2);
  });
});

describe('archive routes', () => {
  beforeEach(() => resetRateLimit());

  it('developer archives + unarchives; user is forbidden', async () => {
    const { app, db, sa, project } = await setupProjectWith('developer');
    await sa.post(`/api/projects/${project.id}/issues`).send({ name: 'i' });
    const bob = await seedUser(db, { email: 'bob@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: bob.id, role: 'user' });
    const bobAgent = await loggedIn(app, 'bob@x.com');

    const denied = await bobAgent.post(`/api/projects/${project.id}/issues/1/archive`);
    expect(denied.status).toBe(403);

    const arch = await sa.post(`/api/projects/${project.id}/issues/1/archive`);
    expect(arch.status).toBe(200);
    expect(arch.body.issue.archived_at).toBeTruthy();

    const unarch = await sa.post(`/api/projects/${project.id}/issues/1/unarchive`);
    expect(unarch.status).toBe(200);
    expect(unarch.body.issue.archived_at).toBeNull();
  });
});

describe('comments route', () => {
  beforeEach(() => resetRateLimit());

  it('viewer is forbidden', async () => {
    const { app, db, sa, project } = await setupProjectWith('developer');
    await sa.post(`/api/projects/${project.id}/issues`).send({ name: 'i' });
    const eve = await seedUser(db, { email: 'eve@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: eve.id, role: 'viewer' });
    const eveAgent = await loggedIn(app, 'eve@x.com');
    const r = await eveAgent
      .post(`/api/projects/${project.id}/issues/1/comments`)
      .send({ body: 'hi' });
    expect(r.status).toBe(403);
  });

  it('user can comment', async () => {
    const { app, db, sa, project } = await setupProjectWith('developer');
    await sa.post(`/api/projects/${project.id}/issues`).send({ name: 'i' });
    const bob = await seedUser(db, { email: 'bob@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: bob.id, role: 'user' });
    const bobAgent = await loggedIn(app, 'bob@x.com');
    const r = await bobAgent
      .post(`/api/projects/${project.id}/issues/1/comments`)
      .send({ body: 'works on my machine' });
    expect(r.status).toBe(201);

    const detail = await sa.get(`/api/projects/${project.id}/issues/1`);
    expect(detail.body.history.find((e) => e.kind === 'comment').note).toBe(
      'works on my machine',
    );
  });
});
