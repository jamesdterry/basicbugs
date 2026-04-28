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

describe('GET /api/admin/sessions', () => {
  beforeEach(() => resetRateLimit());

  it('lists all sessions for super-admin', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    await loggedIn(app, 'alice@x.com');
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.get('/api/admin/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBeGreaterThanOrEqual(2);
    const current = res.body.sessions.filter((s) => s.is_current);
    expect(current).toHaveLength(1);
    expect(current[0].email).toBe(config.superAdminEmail);
  });

  it('filters by userId', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.get(`/api/admin/sessions?userId=${alice.id}`);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    expect(res.body.sessions.every((s) => s.user_id === alice.id)).toBe(true);
  });

  it('forbids non-admin', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = await loggedIn(app, 'alice@x.com');
    const res = await alice.get('/api/admin/sessions');
    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/admin/sessions/:id', () => {
  beforeEach(() => resetRateLimit());

  it('revokes a session', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    const session = db.prepare('SELECT id FROM sessions WHERE user_id = ?').get(alice.id);

    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.delete(`/api/admin/sessions/${encodeURIComponent(session.id)}`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(0);
  });

  it('returns 404 for unknown session id', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.delete('/api/admin/sessions/no-such-session');
    expect(res.status).toBe(404);
  });
});
