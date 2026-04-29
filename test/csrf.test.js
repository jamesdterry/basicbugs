import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';
import { config } from '../server/config.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

async function seedUser(db, email) {
  const passwordHash = await hash('longenough-password');
  usersDb.create(db, { email, passwordHash });
  return usersDb.getByEmail(db, email);
}

describe('CSRF (double-submit-cookie)', () => {
  it('mints a bb_csrf cookie on the first response (readable by client JS)', async () => {
    resetRateLimit();
    const db = createTestDb();
    const app = createApp({ db });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'] ?? [];
    const csrf = setCookie.find((c) => c.startsWith('bb_csrf='));
    expect(csrf).toBeTruthy();
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(csrf).toMatch(/SameSite=Lax/i);
  });

  it('blocks authenticated POSTs to /api/* without a matching X-CSRF-Token', async () => {
    resetRateLimit();
    const db = createTestDb();
    const app = createApp({ db });
    await seedUser(db, config.superAdminEmail);

    // Use a raw agent (NOT the patched supertest.agent) so we control headers.
    const agent = request.agent(app);
    // Bypass the global setup.js patch by deleting the wrapped methods so
    // they fall back to prototype originals.
    for (const m of ['post', 'patch', 'put', 'delete']) delete agent[m];

    const login = await agent
      .post('/auth/login')
      .send({ email: config.superAdminEmail, password: 'longenough-password' });
    expect(login.status).toBe(200);

    // POST without the X-CSRF-Token header → 403.
    const blocked = await agent.post('/api/admin/projects').send({ name: 'X' });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toEqual({ error: 'csrf' });
  });

  it('allows authenticated POSTs when X-CSRF-Token matches the cookie', async () => {
    resetRateLimit();
    const db = createTestDb();
    const app = createApp({ db });
    await seedUser(db, config.superAdminEmail);

    const agent = request.agent(app);
    for (const m of ['post', 'patch', 'put', 'delete']) delete agent[m];

    const login = await agent
      .post('/auth/login')
      .send({ email: config.superAdminEmail, password: 'longenough-password' });
    expect(login.status).toBe(200);

    const cookies = agent.jar.getCookies({
      domain: '127.0.0.1',
      path: '/',
      secure: false,
      script: false,
    });
    const arr = Array.isArray(cookies) ? cookies : [];
    const csrf = arr.find((c) => c.name === 'bb_csrf')?.value;
    expect(csrf).toBeTruthy();

    const ok = await agent
      .post('/api/admin/projects')
      .set('X-CSRF-Token', csrf)
      .send({ name: 'CSRF Project' });
    expect(ok.status).toBe(201);
  });
});
