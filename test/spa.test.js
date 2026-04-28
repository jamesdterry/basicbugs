import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

async function newAppWithLoggedInAgent() {
  resetRateLimit();
  const db = createTestDb();
  const app = createApp({ db });
  const password = 'good-password-1';
  const passwordHash = await hash(password);
  usersDb.create(db, { email: 'alice@example.com', passwordHash });

  const agent = request.agent(app);
  const login = await agent
    .post('/auth/login')
    .send({ email: 'alice@example.com', password });
  if (login.status !== 200) throw new Error('seed login failed');
  return { app, db, agent };
}

describe('SPA shell auth gate', () => {
  beforeEach(() => resetRateLimit());

  it('redirects unauthenticated GET / to /login.html', async () => {
    const db = createTestDb();
    const app = createApp({ db });
    const res = await request(app).get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login.html');
  });

  it('redirects unauthenticated GET /index.html to /login.html', async () => {
    const db = createTestDb();
    const app = createApp({ db });
    const res = await request(app).get('/index.html');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login.html');
  });

  it('serves index.html to an authenticated session for both / and /index.html', async () => {
    const { agent } = await newAppWithLoggedInAgent();

    const root = await agent.get('/');
    expect(root.status).toBe(200);
    expect(root.headers['content-type']).toMatch(/text\/html/);
    expect(root.text).toContain('Basic Bugs');
    expect(root.text).toContain('id="app-root"');

    const idx = await agent.get('/index.html');
    expect(idx.status).toBe(200);
    expect(idx.headers['content-type']).toMatch(/text\/html/);
    expect(idx.text).toContain('id="app-root"');
  });

  it('clears a stale session cookie and redirects to /login.html', async () => {
    const { db, agent } = await newAppWithLoggedInAgent();
    db.prepare('DELETE FROM sessions').run();

    const res = await agent.get('/');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login.html');
    const setCookie = res.headers['set-cookie'] ?? [];
    expect(setCookie.some((c) => c.startsWith('bb_session=') && /Expires=|Max-Age=0/i.test(c)))
      .toBe(true);
  });

  it('serves public static assets without authentication', async () => {
    const db = createTestDb();
    const app = createApp({ db });

    const login = await request(app).get('/login.html');
    expect(login.status).toBe(200);
    expect(login.text).toContain('Sign in');

    const css = await request(app).get('/app.css');
    expect(css.status).toBe(200);
    expect(css.headers['content-type']).toMatch(/text\/css/);

    const js = await request(app).get('/app.js');
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toMatch(/javascript/);

    const lib = await request(app).get('/lib/router.js');
    expect(lib.status).toBe(200);
    expect(lib.headers['content-type']).toMatch(/javascript/);
  });

  it('does not auto-serve index.html on directory probes', async () => {
    const db = createTestDb();
    const app = createApp({ db });
    // express.static({ index: false }) means a non-/ directory probe should 404,
    // and / itself is handled by the auth gate (tested above).
    const res = await request(app).get('/lib/');
    expect(res.status).toBe(404);
  });
});
