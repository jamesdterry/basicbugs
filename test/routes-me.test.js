import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
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
  const passwordHash = password ? await hash(password) : null;
  usersDb.create(db, { email, name, passwordHash });
  return usersDb.getByEmail(db, email);
}

async function loggedIn(app, email, password = 'longenough-password') {
  const agent = request.agent(app);
  const r = await agent.post('/auth/login').send({ email, password });
  if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
  return agent;
}

describe('GET /api/me', () => {
  beforeEach(() => resetRateLimit());

  it('returns current user with last_login_at', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
    const agent = await loggedIn(app, 'alice@x.com');
    const res = await agent.get('/api/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: 'alice@x.com',
      name: 'Alice',
      has_password: true,
    });
    expect(res.body.user.last_login_at).toBeTruthy();
  });

  it('401 without session', async () => {
    const { app } = newApp();
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/me', () => {
  beforeEach(() => resetRateLimit());

  it('updates own name', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
    const agent = await loggedIn(app, 'alice@x.com');
    const res = await agent.patch('/api/me').send({ name: 'Alice A.' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Alice A.');
  });

  it('rejects empty name', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const agent = await loggedIn(app, 'alice@x.com');
    const res = await agent.patch('/api/me').send({ name: '  ' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/me/password', () => {
  beforeEach(() => resetRateLimit());

  it('changes password and revokes other sessions but keeps current', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', password: 'old-password-1' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');

    const a1 = await loggedIn(app, 'alice@x.com', 'old-password-1');
    await loggedIn(app, 'alice@x.com', 'old-password-1'); // second session
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(2);

    const res = await a1.post('/api/me/password').send({
      currentPassword: 'old-password-1',
      newPassword: 'new-password-stronger',
    });
    expect(res.status).toBe(200);

    // a1 still works (current session preserved)
    const me = await a1.get('/api/me');
    expect(me.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(1);

    // old password no longer works
    const oldLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@x.com', password: 'old-password-1' });
    expect(oldLogin.status).toBe(401);

    // new password works
    const newLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@x.com', password: 'new-password-stronger' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects wrong current password', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', password: 'old-password-1' });
    const a1 = await loggedIn(app, 'alice@x.com', 'old-password-1');
    const res = await a1.post('/api/me/password').send({
      currentPassword: 'wrong-current',
      newPassword: 'new-password-stronger',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('wrong_password');
  });

  it('rejects too-short new password', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', password: 'old-password-1' });
    const a1 = await loggedIn(app, 'alice@x.com', 'old-password-1');
    const res = await a1.post('/api/me/password').send({
      currentPassword: 'old-password-1',
      newPassword: 'short',
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('password_too_short');
  });
});

describe('Sessions on /api/me', () => {
  beforeEach(() => resetRateLimit());

  it('lists own sessions and flags current', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const a1 = await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');

    const res = await a1.get('/api/me/sessions');
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(2);
    const current = res.body.sessions.filter((s) => s.is_current);
    expect(current).toHaveLength(1);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(2);
  });

  it('revokes own session by id', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const a1 = await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');

    const list = await a1.get('/api/me/sessions');
    const otherId = list.body.sessions.find((s) => !s.is_current).id;

    const del = await a1.delete(`/api/me/sessions/${encodeURIComponent(otherId)}`);
    expect(del.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(1);
  });

  it('cannot revoke another user\'s session', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    await seedUser(db, { email: 'bob@x.com' });
    const a1 = await loggedIn(app, 'alice@x.com');
    const b1 = await loggedIn(app, 'bob@x.com');

    const bobSessions = await b1.get('/api/me/sessions');
    const bobSessionId = bobSessions.body.sessions[0].id;

    const res = await a1.delete(`/api/me/sessions/${encodeURIComponent(bobSessionId)}`);
    expect(res.status).toBe(404);
  });

  it('revoke-others kills all but current', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const a1 = await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(3);

    const res = await a1.post('/api/me/sessions/revoke-others');
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(1);
    expect(await a1.get('/api/me').then((r) => r.status)).toBe(200);
  });
});
