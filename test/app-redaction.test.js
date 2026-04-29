import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp, redactUrl } from '../server/app.js';
import { createTestDb } from './db.js';

describe('URL redaction', () => {
  it('redacts sensitive query params while preserving route context', () => {
    expect(redactUrl('/auth/verify?token=secret&email=a%40b.test&next=%2F')).toBe(
      '/auth/verify?token=%5Bredacted%5D&email=%5Bredacted%5D&next=%2F',
    );
  });

  it('redacts persisted error_log routes', async () => {
    const db = createTestDb();
    const app = createApp({ db });

    const res = await request(app)
      .post('/api/projects?token=secret-token&x=1')
      .set('Content-Type', 'application/json')
      .send('{"bad"');

    expect(res.status).toBe(500);
    const row = db.prepare('SELECT route FROM error_log').get();
    expect(row.route).toBe('/api/projects?token=%5Bredacted%5D&x=1');
    expect(row.route).not.toContain('secret-token');
  });
});
