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

async function seedUser(db, { email, password = 'longenough-password', name = null, isDisabled = false }) {
  const passwordHash = password ? await hash(password) : null;
  usersDb.create(db, { email, name, passwordHash });
  const u = usersDb.getByEmail(db, email);
  if (isDisabled) usersDb.setDisabled(db, u.id, true);
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

describe('GET /api/admin/users', () => {
  beforeEach(() => resetRateLimit());

  it('lists users; super-admin only', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
    await seedUser(db, { email: 'bob@x.com', name: 'Bob' });
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.get('/api/admin/users');
    expect(res.status).toBe(200);
    const emails = res.body.users.map((u) => u.email).sort();
    expect(emails).toEqual([config.superAdminEmail, 'alice@x.com', 'bob@x.com'].sort());
    const alice = res.body.users.find((u) => u.email === 'alice@x.com');
    expect(alice.is_super_admin).toBe(false);
    const admin = res.body.users.find((u) => u.email === config.superAdminEmail);
    expect(admin.is_super_admin).toBe(true);
  });

  it('filters by search term across email and name', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
    await seedUser(db, { email: 'bob@x.com', name: 'Robert' });
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.get('/api/admin/users?search=alice');
    expect(res.status).toBe(200);
    expect(res.body.users.map((u) => u.email)).toEqual(['alice@x.com']);

    const res2 = await sa.get('/api/admin/users?search=robert');
    expect(res2.body.users.map((u) => u.email)).toEqual(['bob@x.com']);
  });

  it('returns 403 for non-super-admin', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = await loggedIn(app, 'alice@x.com');
    const res = await alice.get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('returns 401 with no session', async () => {
    const { app } = newApp();
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/users (invite)', () => {
  beforeEach(() => resetRateLimit());

  it('creates a user and mints a magic-link token', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.post('/api/admin/users').send({ email: 'charlie@x.com', name: 'Charlie' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe('charlie@x.com');
    expect(res.body.user.has_password).toBe(false);

    const created = usersDb.getByEmail(db, 'charlie@x.com');
    expect(created).not.toBeNull();
    const tokens = db
      .prepare("SELECT * FROM auth_tokens WHERE user_id = ? AND purpose = 'magic_link'")
      .all(created.id);
    expect(tokens).toHaveLength(1);
  });

  it('rejects duplicate email', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.post('/api/admin/users').send({ email: 'alice@x.com' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('duplicate_email');
  });

  it('rejects an invalid email', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.post('/api/admin/users').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_email');
  });

  it('skips emailing when sendInvite=false', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa
      .post('/api/admin/users')
      .send({ email: 'silent@x.com', sendInvite: false });
    expect(res.status).toBe(201);
    const tokens = db.prepare("SELECT * FROM auth_tokens WHERE purpose = 'magic_link'").all();
    expect(tokens).toHaveLength(0);
  });
});

describe('PATCH /api/admin/users/:id', () => {
  beforeEach(() => resetRateLimit());

  it('renames a user', async () => {
    const { app, db } = newApp();
    const alice = await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.patch(`/api/admin/users/${alice.id}`).send({ name: 'Alice A.' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Alice A.');
    expect(usersDb.getById(db, alice.id).name).toBe('Alice A.');
  });

  it('rejects an empty name', async () => {
    const { app, db } = newApp();
    const alice = await seedUser(db, { email: 'alice@x.com' });
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.patch(`/api/admin/users/${alice.id}`).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_name');
  });

  it('returns 404 for unknown user', async () => {
    const { app, db } = newApp();
    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.patch('/api/admin/users/9999').send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('Disable / enable / sign-out-everywhere', () => {
  beforeEach(() => resetRateLimit());

  it('disable revokes existing sessions and blocks future logins', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    await loggedIn(app, 'alice@x.com'); // creates a session
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(1);

    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.post(`/api/admin/users/${alice.id}/disable`);
    expect(res.status).toBe(200);
    expect(res.body.user.is_disabled).toBe(true);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(0);

    const login = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@x.com', password: 'longenough-password' });
    expect(login.status).toBe(401);

    // re-enable lets them log in again
    const enable = await sa.post(`/api/admin/users/${alice.id}/enable`);
    expect(enable.status).toBe(200);
    expect(enable.body.user.is_disabled).toBe(false);
    const login2 = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@x.com', password: 'longenough-password' });
    expect(login2.status).toBe(200);
  });

  it('sign-out-everywhere revokes all of one user\'s sessions', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com' });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    await loggedIn(app, 'alice@x.com');
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(2);

    const sa = await loginAsSuperAdmin(app, db);
    const res = await sa.post(`/api/admin/users/${alice.id}/sign-out-everywhere`);
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions WHERE user_id = ?').get(alice.id).n).toBe(0);
  });
});

describe('Send magic link / send reset', () => {
  beforeEach(() => resetRateLimit());

  it('mints a magic-link token for the target user', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', password: null });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.post(`/api/admin/users/${alice.id}/send-magic-link`);
    expect(res.status).toBe(200);
    const tokens = db
      .prepare("SELECT * FROM auth_tokens WHERE user_id = ? AND purpose = 'magic_link'")
      .all(alice.id);
    expect(tokens).toHaveLength(1);
  });

  it('mints a reset token even for a passwordless user (admin override)', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', password: null });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.post(`/api/admin/users/${alice.id}/send-reset`);
    expect(res.status).toBe(200);
    const tokens = db
      .prepare("SELECT * FROM auth_tokens WHERE user_id = ? AND purpose = 'password_reset'")
      .all(alice.id);
    expect(tokens).toHaveLength(1);
  });

  it('refuses for a disabled user', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@x.com', isDisabled: true });
    const alice = usersDb.getByEmail(db, 'alice@x.com');
    const sa = await loginAsSuperAdmin(app, db);

    const res = await sa.post(`/api/admin/users/${alice.id}/send-magic-link`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('user_disabled');
  });
});
