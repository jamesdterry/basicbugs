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

async function makeProject(agent, name) {
  const r = await agent.post('/api/admin/projects').send({ name });
  if (r.status !== 201) throw new Error(`create project failed: ${r.status}`);
  return r.body.project;
}

describe('POST /api/admin/projects', () => {
  beforeEach(() => resetRateLimit());

  it('super admin creates a project; defaults are seeded', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);

    const create = await sa.post('/api/admin/projects').send({ name: 'Acme' });
    expect(create.status).toBe(201);
    expect(create.body.project.name).toBe('Acme');

    const detail = await sa.get(`/api/projects/${create.body.project.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.metadata.statuses).toHaveLength(6);
    expect(detail.body.metadata.categories).toHaveLength(3);
    expect(detail.body.metadata.priorities).toHaveLength(5);
  });

  it('returns 401 without a session', async () => {
    const { app } = newApp();
    const r = await request(app).post('/api/admin/projects').send({ name: 'X' });
    expect(r.status).toBe(401);
  });

  it('returns 403 for a non-super-admin session', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = await loggedIn(app, 'alice@x.com');
    const r = await alice.post('/api/admin/projects').send({ name: 'X' });
    expect(r.status).toBe(403);
  });

  it('rejects an invalid name', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const r = await sa.post('/api/admin/projects').send({ name: '   ' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_name');
  });

  it('adds the super admin as a developer member by default', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const create = await sa.post('/api/admin/projects').send({ name: 'Acme' });
    const adminUser = usersDb.getByEmail(db, config.superAdminEmail);
    const member = db
      .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(create.body.project.id, adminUser.id);
    expect(member?.role).toBe('developer');
  });

  it('skips adding the super admin when addSelfAsMember=false', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const create = await sa
      .post('/api/admin/projects')
      .send({ name: 'Acme', addSelfAsMember: false });
    const adminUser = usersDb.getByEmail(db, config.superAdminEmail);
    const member = db
      .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(create.body.project.id, adminUser.id);
    expect(member).toBeUndefined();
  });
});

describe('PATCH /api/admin/projects/:id and archive', () => {
  beforeEach(() => resetRateLimit());

  it('renames and archives/unarchives', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'A');

    const renamed = await sa.patch(`/api/admin/projects/${project.id}`).send({ name: 'B' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.project.name).toBe('B');

    const arch = await sa.post(`/api/admin/projects/${project.id}/archive`);
    expect(arch.status).toBe(200);
    expect(arch.body.project.archived_at).not.toBeNull();

    const unarch = await sa.post(`/api/admin/projects/${project.id}/unarchive`);
    expect(unarch.status).toBe(200);
    expect(unarch.body.project.archived_at).toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const r = await sa.patch('/api/admin/projects/99999').send({ name: 'X' });
    expect(r.status).toBe(404);
  });
});

describe('GET /api/projects', () => {
  beforeEach(() => resetRateLimit());

  it('super admin sees all projects', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    await makeProject(sa, 'A');
    await makeProject(sa, 'B');
    const r = await sa.get('/api/projects');
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p) => p.name)).toEqual(['A', 'B']);
  });

  it('non-super-admin only sees projects they belong to', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const p1 = await makeProject(sa, 'Mine');
    await makeProject(sa, 'Theirs');

    const alice = await seedUser(db, { email: 'alice@x.com' });
    await sa.post(`/api/admin/projects/${p1.id}/members`).send({ userId: alice.id, role: 'viewer' });

    const aliceAgent = await loggedIn(app, 'alice@x.com');
    const r = await aliceAgent.get('/api/projects');
    expect(r.status).toBe(200);
    expect(r.body.projects.map((p) => p.name)).toEqual(['Mine']);
    expect(r.body.projects[0].role).toBe('viewer');
  });
});

describe('GET /api/projects/:id', () => {
  beforeEach(() => resetRateLimit());

  it('returns 404 (not 403) when caller is not a member, masking existence', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'Hidden');

    await seedUser(db, { email: 'eve@x.com' });
    const eve = await loggedIn(app, 'eve@x.com');
    const r = await eve.get(`/api/projects/${project.id}`);
    expect(r.status).toBe(404);
  });

  it('returns 404 for an unknown project even for super admin', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const r = await sa.get('/api/projects/99999');
    expect(r.status).toBe(404);
  });
});

describe('Member management', () => {
  beforeEach(() => resetRateLimit());

  it('add → patch → delete lifecycle', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');
    const alice = await seedUser(db, { email: 'alice@x.com' });

    const add = await sa
      .post(`/api/admin/projects/${project.id}/members`)
      .send({ userId: alice.id, role: 'viewer' });
    expect(add.status).toBe(201);

    const patch = await sa
      .patch(`/api/admin/projects/${project.id}/members/${alice.id}`)
      .send({ role: 'developer' });
    expect(patch.status).toBe(200);

    const del = await sa.delete(`/api/admin/projects/${project.id}/members/${alice.id}`);
    expect(del.status).toBe(200);

    const delAgain = await sa.delete(`/api/admin/projects/${project.id}/members/${alice.id}`);
    expect(delAgain.status).toBe(404);
  });

  it('rejects bad role', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');
    const alice = await seedUser(db, { email: 'alice@x.com' });
    const r = await sa
      .post(`/api/admin/projects/${project.id}/members`)
      .send({ userId: alice.id, role: 'admin' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('invalid_role');
  });

  it('duplicate add returns 409', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');
    const alice = await seedUser(db, { email: 'alice@x.com' });
    await sa
      .post(`/api/admin/projects/${project.id}/members`)
      .send({ userId: alice.id, role: 'viewer' });
    const r = await sa
      .post(`/api/admin/projects/${project.id}/members`)
      .send({ userId: alice.id, role: 'developer' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('duplicate_member');
  });
});

describe('Metadata routes', () => {
  beforeEach(() => resetRateLimit());

  async function setupProjectWithMember(role) {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');
    const alice = await seedUser(db, { email: 'alice@x.com' });
    await sa
      .post(`/api/admin/projects/${project.id}/members`)
      .send({ userId: alice.id, role });
    const aliceAgent = await loggedIn(app, 'alice@x.com');
    return { app, db, sa, alice, aliceAgent, project };
  }

  it('viewer can read metadata but not write', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('viewer');
    const list = await aliceAgent.get(`/api/projects/${project.id}/metadata/statuses`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(6);

    const post = await aliceAgent
      .post(`/api/projects/${project.id}/metadata/statuses`)
      .send({ name: 'New One' });
    expect(post.status).toBe(403);
  });

  it('developer can create + rename + archive metadata', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('developer');

    const create = await aliceAgent
      .post(`/api/projects/${project.id}/metadata/statuses`)
      .send({ name: 'On Hold', isClosed: false });
    expect(create.status).toBe(201);
    const newId = create.body.item.id;

    const rename = await aliceAgent
      .patch(`/api/projects/${project.id}/metadata/statuses/${newId}`)
      .send({ name: 'Pending' });
    expect(rename.status).toBe(200);
    expect(rename.body.item.name).toBe('Pending');

    const arch = await aliceAgent.delete(
      `/api/projects/${project.id}/metadata/statuses/${newId}`,
    );
    expect(arch.status).toBe(200);
  });

  it('rejects archiving the default status', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('developer');
    const list = await aliceAgent.get(`/api/projects/${project.id}/metadata/statuses`);
    const open = list.body.items.find((s) => s.name === 'Open');
    const r = await aliceAgent.delete(
      `/api/projects/${project.id}/metadata/statuses/${open.id}`,
    );
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('cannot_archive_default');
  });

  it('re-pointing default then archiving the old default succeeds', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('developer');
    const list = await aliceAgent.get(`/api/projects/${project.id}/metadata/priorities`);
    const oldDefault = list.body.items.find((p) => p.is_default === 1);
    const newDefault = list.body.items.find((p) => p.name === 'Low');

    const repoint = await aliceAgent
      .patch(`/api/projects/${project.id}/metadata/priorities/${newDefault.id}`)
      .send({ isDefault: true });
    expect(repoint.status).toBe(200);

    const arch = await aliceAgent.delete(
      `/api/projects/${project.id}/metadata/priorities/${oldDefault.id}`,
    );
    expect(arch.status).toBe(200);
  });

  it('rejects archiving the only remaining row of a kind', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');

    // Strip the priorities table down to 1 row.
    db.prepare(
      'DELETE FROM issue_priorities WHERE project_id = ? AND is_default = 0',
    ).run(project.id);
    const remaining = db
      .prepare('SELECT id FROM issue_priorities WHERE project_id = ?')
      .get(project.id);
    db.prepare('UPDATE issue_priorities SET is_default = 0 WHERE id = ?').run(remaining.id);

    const r = await sa.delete(`/api/projects/${project.id}/metadata/priorities/${remaining.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('cannot_archive_only_remaining');
  });

  it('duplicate metadata name returns 409', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('developer');
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/metadata/statuses`)
      .send({ name: 'Open' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('duplicate_name');
  });

  it('invalid kind returns 404', async () => {
    const { aliceAgent, project } = await setupProjectWithMember('viewer');
    const r = await aliceAgent.get(`/api/projects/${project.id}/metadata/wat`);
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('invalid_kind');
  });

  it('non-member gets 404 (not 403) on metadata reads', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const project = await makeProject(sa, 'P');
    await seedUser(db, { email: 'eve@x.com' });
    const eve = await loggedIn(app, 'eve@x.com');
    const r = await eve.get(`/api/projects/${project.id}/metadata/statuses`);
    expect(r.status).toBe(404);
  });
});
