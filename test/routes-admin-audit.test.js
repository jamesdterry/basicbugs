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

async function seedUser(db, { email, password = 'longenough-password' }) {
  const passwordHash = password ? await hash(password) : null;
  usersDb.create(db, { email, passwordHash });
  return usersDb.getByEmail(db, email);
}

async function loginAsSuperAdmin(app, db) {
  await seedUser(db, { email: config.superAdminEmail });
  const agent = request.agent(app);
  const r = await agent
    .post('/auth/login')
    .send({ email: config.superAdminEmail, password: 'longenough-password' });
  if (r.status !== 200) throw new Error(`login failed ${r.status}`);
  return agent;
}

describe('admin audit log', () => {
  beforeEach(() => resetRateLimit());

  it('records project.create when a super admin creates a project', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);

    const created = await sa.post('/api/admin/projects').send({ name: 'Audited' });
    expect(created.status).toBe(201);

    const list = await sa.get('/api/admin/audit');
    expect(list.status).toBe(200);
    expect(list.body.total).toBeGreaterThan(0);
    const entry = list.body.entries.find((e) => e.action === 'project.create');
    expect(entry).toBeTruthy();
    expect(entry.target_type).toBe('project');
    expect(entry.target_id).toBe(created.body.project.id);
    const payload = JSON.parse(entry.payload_json);
    expect(payload.name).toBe('Audited');
  });

  it('records user.disable and user.enable for the same user', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const target = await seedUser(db, { email: 'bob@x.com' });

    const dis = await sa.post(`/api/admin/users/${target.id}/disable`);
    expect(dis.status).toBe(200);
    const ena = await sa.post(`/api/admin/users/${target.id}/enable`);
    expect(ena.status).toBe(200);

    const list = await sa.get('/api/admin/audit');
    const actions = list.body.entries.map((e) => e.action);
    expect(actions).toContain('user.disable');
    expect(actions).toContain('user.enable');
  });

  it('rejects non-super-admin access to /api/admin/audit', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'mort@x.com' });
    const agent = request.agent(app);
    const login = await agent
      .post('/auth/login')
      .send({ email: 'mort@x.com', password: 'longenough-password' });
    expect(login.status).toBe(200);

    const denied = await agent.get('/api/admin/audit');
    expect(denied.status).toBe(403);
  });
});
