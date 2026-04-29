import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
import { config } from '../server/config.js';
import { hash } from '../server/services/passwords.js';
import * as tokensSvc from '../server/services/tokens.js';
import * as usersDb from '../server/db/users.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

function newApp() {
  resetRateLimit();
  const db = createTestDb();
  const app = createApp({ db });
  return { app, db };
}

async function seedUser(db, { email, password, isDisabled = false, name = null }) {
  const passwordHash = password ? await hash(password) : null;
  return usersDb.create(db, { email, name, passwordHash }) && usersDb.getByEmail(db, email)
    ? (() => {
        const user = usersDb.getByEmail(db, email);
        if (isDisabled) usersDb.setDisabled(db, user.id, true);
        return usersDb.getByEmail(db, email);
      })()
    : null;
}

function getSessionCookie(res) {
  const setCookie = res.headers['set-cookie'] ?? [];
  return setCookie.find((c) => c.startsWith('bb_session=')) ?? null;
}

describe('POST /auth/magic-link — bootstrap and anti-leakage', () => {
  beforeEach(() => resetRateLimit());

  it('auto-creates the super admin on first request and mints a token', async () => {
    const { app, db } = newApp();
    expect(config.superAdminEmail).toBeTruthy();

    const res = await request(app)
      .post('/auth/magic-link')
      .send({ email: config.superAdminEmail });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const user = usersDb.getByEmail(db, config.superAdminEmail);
    expect(user).not.toBeNull();
    expect(user.email).toBe(config.superAdminEmail);

    const tokenRows = db.prepare('SELECT * FROM auth_tokens').all();
    expect(tokenRows).toHaveLength(1);
    expect(tokenRows[0].purpose).toBe('magic_link');
    expect(tokenRows[0].user_id).toBe(user.id);
  });

  it('a second request reuses the existing user row and replaces the outstanding token', async () => {
    const { app, db } = newApp();
    await request(app).post('/auth/magic-link').send({ email: config.superAdminEmail });
    const firstToken = db.prepare('SELECT token_hash FROM auth_tokens').get();

    await request(app).post('/auth/magic-link').send({ email: config.superAdminEmail });
    const users = db.prepare('SELECT * FROM users').all();
    expect(users).toHaveLength(1);

    const tokens = db.prepare('SELECT * FROM auth_tokens').all();
    expect(tokens).toHaveLength(1);
    expect(tokens[0].token_hash).not.toBe(firstToken.token_hash);
  });

  it('does not create a user or token for an unknown email', async () => {
    const { app, db } = newApp();
    const res = await request(app)
      .post('/auth/magic-link')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(db.prepare('SELECT COUNT(*) as n FROM users').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) as n FROM auth_tokens').get().n).toBe(0);
  });
});

describe('GET /auth/verify', () => {
  beforeEach(() => resetRateLimit());

  it('consumes a magic-link token, sets a session cookie, and redirects to /', async () => {
    const { app, db } = newApp();
    await request(app).post('/auth/magic-link').send({ email: config.superAdminEmail });

    // Mint our own token so we know the raw value (the email is logged but not returned).
    const userId = usersDb.getByEmail(db, config.superAdminEmail).id;
    db.prepare('DELETE FROM auth_tokens').run();
    const t = tokensSvc.generate();
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'magic_link', ?, ?)`,
    ).run(userId, t.hash, new Date(Date.now() + 60_000).toISOString());

    const res = await request(app).get(`/auth/verify?token=${encodeURIComponent(t.raw)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
    expect(getSessionCookie(res)).toBeTruthy();

    const sessions = db.prepare('SELECT * FROM sessions').all();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].user_id).toBe(userId);

    const tokenRow = db.prepare('SELECT * FROM auth_tokens').get();
    expect(tokenRow.used_at).not.toBeNull();
  });

  it('rejects a token a second time (one-time use)', async () => {
    const { app, db } = newApp();
    const user = usersDb.create(db, { email: 'a@example.com' });
    const t = tokensSvc.generate();
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'magic_link', ?, ?)`,
    ).run(user.id, t.hash, new Date(Date.now() + 60_000).toISOString());

    const r1 = await request(app).get(`/auth/verify?token=${encodeURIComponent(t.raw)}`);
    expect(r1.status).toBe(302);
    expect(r1.headers.location).toBe('/');

    const r2 = await request(app).get(`/auth/verify?token=${encodeURIComponent(t.raw)}`);
    expect(r2.status).toBe(302);
    expect(r2.headers.location).toBe('/login.html?error=invalid_link');
  });

  it('rejects an expired token', async () => {
    const { app, db } = newApp();
    const user = usersDb.create(db, { email: 'a@example.com' });
    const t = tokensSvc.generate();
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'magic_link', ?, ?)`,
    ).run(user.id, t.hash, new Date(Date.now() - 1000).toISOString());

    const res = await request(app).get(`/auth/verify?token=${encodeURIComponent(t.raw)}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login.html?error=invalid_link');
  });

  it('rejects an unknown token', async () => {
    const { app } = newApp();
    const res = await request(app).get('/auth/verify?token=not-a-real-token');
    expect(res.headers.location).toBe('/login.html?error=invalid_link');
  });

  it('rejects a missing token', async () => {
    const { app } = newApp();
    const res = await request(app).get('/auth/verify');
    expect(res.headers.location).toBe('/login.html?error=invalid_link');
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => resetRateLimit());

  it('logs in with correct password and returns user payload', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@example.com', password: 'hunter22-strong', name: 'Alice' });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'hunter22-strong' });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'alice@example.com', name: 'Alice' });
    expect(getSessionCookie(res)).toBeTruthy();

    expect(db.prepare('SELECT COUNT(*) as n FROM sessions').get().n).toBe(1);
  });

  it('returns identical 401 for unknown email, wrong password, and disabled user', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'live@example.com', password: 'good-password-1' });
    await seedUser(db, { email: 'dead@example.com', password: 'good-password-1', isDisabled: true });

    const r1 = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'good-password-1' });
    const r2 = await request(app)
      .post('/auth/login')
      .send({ email: 'live@example.com', password: 'wrong-password!' });
    const r3 = await request(app)
      .post('/auth/login')
      .send({ email: 'dead@example.com', password: 'good-password-1' });

    for (const r of [r1, r2, r3]) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'invalid_credentials' });
    }
  });

  it('marks isSuperAdmin: true when email matches the super admin', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: config.superAdminEmail, password: 'super-password-1' });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: config.superAdminEmail, password: 'super-password-1' });
    expect(res.status).toBe(200);
    expect(res.body.user.isSuperAdmin).toBe(true);
  });
});

describe('POST /auth/logout and requireUser', () => {
  beforeEach(() => resetRateLimit());

  it('logout clears the cookie and revokes the session', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@example.com', password: 'good-password-1' });

    const agent = request.agent(app);
    const login = await agent
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'good-password-1' });
    expect(login.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions').get().n).toBe(1);

    const me = await agent.get('/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('alice@example.com');

    const logout = await agent.post('/auth/logout');
    expect(logout.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions').get().n).toBe(0);

    const after = await agent.get('/auth/me');
    expect(after.status).toBe(401);
  });

  it('rejects a tampered/garbage cookie with 401', async () => {
    const { app } = newApp();
    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', 'bb_session=not-a-valid-signed-cookie');
    expect(res.status).toBe(401);
  });

  it('returns 401 with no cookie at all', async () => {
    const { app } = newApp();
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('Password reset flow', () => {
  beforeEach(() => resetRateLimit());

  it('forgot mints a reset token; reset consumes it, revokes sessions, and sets new password', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@example.com', password: 'old-password-1' });

    // Existing session on the account, to verify it gets revoked on reset.
    await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'old-password-1' });
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions').get().n).toBe(1);

    const forgot = await request(app)
      .post('/auth/forgot')
      .send({ email: 'alice@example.com' });
    expect(forgot.status).toBe(200);
    const tokenRows = db
      .prepare("SELECT * FROM auth_tokens WHERE purpose = 'password_reset'")
      .all();
    expect(tokenRows).toHaveLength(1);

    // Forge the raw token by minting a known one (the real one's raw isn't returned).
    db.prepare("DELETE FROM auth_tokens WHERE purpose = 'password_reset'").run();
    const t = tokensSvc.generate();
    const userId = usersDb.getByEmail(db, 'alice@example.com').id;
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'password_reset', ?, ?)`,
    ).run(userId, t.hash, new Date(Date.now() + 60_000).toISOString());

    const reset = await request(app)
      .post('/auth/reset')
      .send({ token: t.raw, password: 'new-password-stronger' });
    expect(reset.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM sessions').get().n).toBe(0);

    // Old password no longer works; new one does.
    const oldLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'old-password-1' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'new-password-stronger' });
    expect(newLogin.status).toBe(200);

    // Token marked used.
    const tokenAfter = db.prepare('SELECT used_at FROM auth_tokens').get();
    expect(tokenAfter.used_at).not.toBeNull();
  });

  it('rejects a weak password', async () => {
    const { app, db } = newApp();
    const user = usersDb.create(db, { email: 'a@example.com' });
    const t = tokensSvc.generate();
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'password_reset', ?, ?)`,
    ).run(user.id, t.hash, new Date(Date.now() + 60_000).toISOString());

    const res = await request(app).post('/auth/reset').send({ token: t.raw, password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'weak_password' });
  });

  it('rejects a missing or unknown token', async () => {
    const { app } = newApp();
    const r1 = await request(app).post('/auth/reset').send({ password: 'long-enough-pwd' });
    expect(r1.status).toBe(400);
    expect(r1.body).toEqual({ error: 'invalid_token' });

    const r2 = await request(app)
      .post('/auth/reset')
      .send({ token: 'no-such-token', password: 'long-enough-pwd' });
    expect(r2.status).toBe(400);
    expect(r2.body).toEqual({ error: 'invalid_token' });
  });

  it('forgot does not leak existence (200 for unknown email, no token created)', async () => {
    const { app, db } = newApp();
    const res = await request(app)
      .post('/auth/forgot')
      .send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) as n FROM auth_tokens').get().n).toBe(0);
  });

  it('a reset token cannot be consumed twice (CAS prevents double-use)', async () => {
    const { app, db } = newApp();
    const user = usersDb.create(db, { email: 'a@example.com' });
    const t = tokensSvc.generate();
    db.prepare(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES (?, 'password_reset', ?, ?)`,
    ).run(user.id, t.hash, new Date(Date.now() + 60_000).toISOString());

    const first = await request(app)
      .post('/auth/reset')
      .send({ token: t.raw, password: 'new-pwd-good-1' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/auth/reset')
      .send({ token: t.raw, password: 'new-pwd-good-2' });
    expect(second.status).toBe(400);
    expect(second.body).toEqual({ error: 'invalid_token' });
  });
});

describe('Rate limiting on /auth/reset', () => {
  beforeEach(() => resetRateLimit());

  it('returns 429 after 5 reset attempts from the same IP', async () => {
    const { app } = newApp();
    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/auth/reset')
        .send({ token: `bogus-${i}`, password: 'long-enough-pwd' });
      expect(r.status).toBe(400);
    }
    const sixth = await request(app)
      .post('/auth/reset')
      .send({ token: 'bogus-6', password: 'long-enough-pwd' });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: 'rate_limited' });
  });
});

describe('Rate limiting', () => {
  beforeEach(() => resetRateLimit());

  it('returns 429 after 5 failed login attempts from the same IP', async () => {
    const { app, db } = newApp();
    await seedUser(db, { email: 'alice@example.com', password: 'good-password-1' });

    for (let i = 0; i < 5; i++) {
      const r = await request(app)
        .post('/auth/login')
        .send({ email: 'alice@example.com', password: 'wrong-password!' });
      expect(r.status).toBe(401);
    }
    const sixth = await request(app)
      .post('/auth/login')
      .send({ email: 'alice@example.com', password: 'wrong-password!' });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: 'rate_limited' });
  });

  it('returns 429 after 5 magic-link requests from the same IP', async () => {
    const { app } = newApp();
    for (let i = 0; i < 5; i++) {
      const r = await request(app).post('/auth/magic-link').send({ email: `u${i}@example.com` });
      expect(r.status).toBe(200);
    }
    const sixth = await request(app)
      .post('/auth/magic-link')
      .send({ email: 'u5@example.com' });
    expect(sixth.status).toBe(429);
  });
});
