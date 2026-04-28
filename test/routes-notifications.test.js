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
  if (r.status !== 200) throw new Error(`login failed: ${r.status}`);
  return agent;
}

async function loginAsSuperAdmin(app, db) {
  await seedUser(db, { email: config.superAdminEmail });
  return loggedIn(app, config.superAdminEmail);
}

async function setupTwoMembers() {
  const { app, db } = newApp();
  const sa = await loginAsSuperAdmin(app, db);
  const projectRes = await sa.post('/api/admin/projects').send({ name: 'P' });
  const project = projectRes.body.project;
  const alice = await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
  const bob = await seedUser(db, { email: 'bob@x.com', name: 'Bob' });
  await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: alice.id, role: 'developer' });
  await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: bob.id, role: 'user' });
  const aliceAgent = await loggedIn(app, 'alice@x.com');
  const bobAgent = await loggedIn(app, 'bob@x.com');
  return { app, db, sa, alice, bob, aliceAgent, bobAgent, project };
}

describe('Stage 10 — notification feed', () => {
  beforeEach(() => resetRateLimit());

  it('GET /api/me/notifications returns own rows with unread count', async () => {
    const { aliceAgent, bobAgent, project, alice } = await setupTwoMembers();
    const bobMe = await bobAgent.get('/api/me');
    const created = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'I' });
    expect(created.status).toBe(201);
    const issueNumber = created.body.issue.number;
    // Alice assigns to Bob.
    await aliceAgent
      .patch(`/api/projects/${project.id}/issues/${issueNumber}`)
      .send({ patch: { assignedTo: bobMe.body.user.id } });
    // Bob fetches feed.
    const feed = await bobAgent.get('/api/me/notifications');
    expect(feed.status).toBe(200);
    expect(feed.body.unreadCount).toBeGreaterThanOrEqual(1);
    expect(feed.body.items[0].kind).toBe('assigned_to_me');
    // Alice should not see Bob's notifications.
    const aliceFeed = await aliceAgent.get('/api/me/notifications');
    for (const item of aliceFeed.body.items) {
      expect(item.user_id).toBe(alice.id);
    }
  });

  it('marking read decreases unread count', async () => {
    const { aliceAgent, bobAgent, project } = await setupTwoMembers();
    const bobMe = await bobAgent.get('/api/me');
    const created = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'I', assignedTo: bobMe.body.user.id });
    const number = created.body.issue.number;
    await aliceAgent
      .post(`/api/projects/${project.id}/issues/${number}/comments`)
      .send({ body: '@bob hi' });
    const feed = await bobAgent.get('/api/me/notifications');
    const before = feed.body.unreadCount;
    expect(before).toBeGreaterThanOrEqual(1);
    const target = feed.body.items[0];
    const r = await bobAgent.post(`/api/me/notifications/${target.id}/read`).send({});
    expect(r.status).toBe(200);
    expect(r.body.unreadCount).toBe(before - 1);
  });

  it('marking another user notification 404s', async () => {
    const { aliceAgent, bobAgent, project } = await setupTwoMembers();
    const bobMe = await bobAgent.get('/api/me');
    const created = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'I', assignedTo: bobMe.body.user.id });
    const number = created.body.issue.number;
    await aliceAgent
      .post(`/api/projects/${project.id}/issues/${number}/comments`)
      .send({ body: '@bob' });
    const feed = await bobAgent.get('/api/me/notifications');
    const target = feed.body.items[0];
    const r = await aliceAgent.post(`/api/me/notifications/${target.id}/read`).send({});
    expect(r.status).toBe(404);
  });
});

describe('Stage 10 — watch endpoints', () => {
  beforeEach(() => resetRateLimit());

  it('PUT and DELETE /watch are idempotent and reflected in issue GET', async () => {
    const { aliceAgent, project } = await setupTwoMembers();
    const created = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'I' });
    const number = created.body.issue.number;
    const get1 = await aliceAgent.get(`/api/projects/${project.id}/issues/${number}`);
    expect(get1.body.isWatching).toBe(true); // auto-watch on creation

    const off = await aliceAgent.delete(`/api/projects/${project.id}/issues/${number}/watch`);
    expect(off.status).toBe(200);
    expect(off.body.isWatching).toBe(false);
    const off2 = await aliceAgent.delete(`/api/projects/${project.id}/issues/${number}/watch`);
    expect(off2.status).toBe(200); // idempotent

    const on = await aliceAgent.put(`/api/projects/${project.id}/issues/${number}/watch`);
    expect(on.body.isWatching).toBe(true);
    const get2 = await aliceAgent.get(`/api/projects/${project.id}/issues/${number}`);
    expect(get2.body.isWatching).toBe(true);
  });

  it('rejects non-members', async () => {
    const { app, db, aliceAgent, project } = await setupTwoMembers();
    const created = await aliceAgent
      .post(`/api/projects/${project.id}/issues`)
      .send({ name: 'I' });
    const number = created.body.issue.number;

    await seedUser(db, { email: 'evan@x.com' });
    const evan = await loggedIn(app, 'evan@x.com');
    const r = await evan.put(`/api/projects/${project.id}/issues/${number}/watch`);
    // Not a member → requireProjectViewer returns 403/404.
    expect([403, 404]).toContain(r.status);
  });
});

describe('Stage 10 — notification prefs', () => {
  beforeEach(() => resetRateLimit());

  it('GET returns defaults; PATCH persists; invalid kind rejected', async () => {
    const { bobAgent } = await setupTwoMembers();
    const get1 = await bobAgent.get('/api/me/notification-prefs');
    expect(get1.status).toBe(200);
    expect(get1.body.prefs.assigned_to_me).toBe(true);

    const patch = await bobAgent
      .patch('/api/me/notification-prefs')
      .send({ assigned_to_me: false });
    expect(patch.status).toBe(200);
    expect(patch.body.prefs.assigned_to_me).toBe(false);

    const bad = await bobAgent.patch('/api/me/notification-prefs').send({ bogus: true });
    expect(bad.status).toBe(400);
  });

  it('opt-out of watched_any_change silences notifications on rename', async () => {
    const { aliceAgent, bobAgent, project } = await setupTwoMembers();
    const bobMe = await bobAgent.get('/api/me');
    // Bob watches an issue.
    const created = await aliceAgent.post(`/api/projects/${project.id}/issues`).send({ name: 'I' });
    const number = created.body.issue.number;
    await bobAgent.put(`/api/projects/${project.id}/issues/${number}/watch`);
    // Bob opts out of any-change.
    await bobAgent
      .patch('/api/me/notification-prefs')
      .send({ watched_any_change: false });

    const before = (await bobAgent.get('/api/me/notifications')).body.unreadCount;
    // Alice renames (not a status change, not a mention, not an assignment).
    await aliceAgent
      .patch(`/api/projects/${project.id}/issues/${number}`)
      .send({ patch: { name: 'renamed' } });
    const after = (await bobAgent.get('/api/me/notifications')).body.unreadCount;
    expect(after).toBe(before);
    void bobMe;
  });
});
