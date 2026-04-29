import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createTestDb } from './db.js';

describe('app skeleton', () => {
  it('GET /healthz returns 200 with status ok when DB is writable', async () => {
    const db = createTestDb();
    const app = createApp({ db });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    const row = db.prepare('SELECT last_check FROM _health WHERE id = 1').get();
    expect(row.last_check).toBeTruthy();
  });

  it('GET /healthz returns 503 when the DB write fails', async () => {
    const db = createTestDb();
    db.exec('DROP TABLE _health');
    const app = createApp({ db });
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', error: 'db_unavailable' });
  });
});
