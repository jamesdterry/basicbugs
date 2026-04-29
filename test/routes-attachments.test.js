import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { partialUploadPath } from '../server/routes/attachments.js';
import { createTestDb } from './db.js';
import { config } from '../server/config.js';
import { hash } from '../server/services/passwords.js';
import * as usersDb from '../server/db/users.js';
import { _resetForTests as resetRateLimit } from '../server/middleware/rateLimit.js';

const TEST_DIR = path.resolve(config.attachmentsDir);

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00,
]);
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n', 'ascii'), Buffer.from('hello pdf', 'ascii')]);

beforeEach(async () => {
  resetRateLimit();
  await fsp.rm(TEST_DIR, { recursive: true, force: true });
});

afterAll(async () => {
  await fsp.rm(TEST_DIR, { recursive: true, force: true });
});

function newApp() {
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

async function makeProject(agent, name = 'P') {
  const r = await agent.post('/api/admin/projects').send({ name });
  return r.body.project;
}

async function makeIssue(agent, projectId, name = 'i') {
  const r = await agent.post(`/api/projects/${projectId}/issues`).send({ name });
  return r.body.issue;
}

async function setupProjectWith(role) {
  const { app, db } = newApp();
  const sa = await loginAsSuperAdmin(app, db);
  const project = await makeProject(sa);
  const alice = await seedUser(db, { email: 'alice@x.com', name: 'Alice' });
  await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: alice.id, role });
  const aliceAgent = await loggedIn(app, 'alice@x.com');
  return { app, db, sa, alice, aliceAgent, project };
}

describe('POST /api/projects/:id/issues/:number/attachments', () => {
  it('keeps partial upload files under ATTACHMENTS_DIR', () => {
    const partial = partialUploadPath('test-id');
    expect(path.relative(TEST_DIR, partial)).toBe(path.join('.tmp', 'test-id.partial'));
  });

  it('uploads a PNG and returns 201', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);

    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'shot.png', contentType: 'image/png' });

    expect(r.status).toBe(201);
    expect(r.body.attachment.filename).toBe('shot.png');
    expect(r.body.attachment.content_type).toBe('image/png');
    expect(r.body.attachment.size_bytes).toBe(PNG_BYTES.length);
  });

  it('uploads a PDF and returns 201', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PDF_BYTES, { filename: 'r.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(r.body.attachment.content_type).toBe('application/pdf');
  });

  it('viewer is forbidden', async () => {
    const { app, db, sa, project } = await setupProjectWith('developer');
    const issue = await makeIssue(sa, project.id);
    await seedUser(db, { email: 'vee@x.com' });
    const vee = usersDb.getByEmail(db, 'vee@x.com');
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: vee.id, role: 'viewer' });
    const veeAgent = await loggedIn(app, 'vee@x.com');
    const r = await veeAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status).toBe(403);
  });

  it('rejects disallowed MIME (HTML) with 415', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', Buffer.from('<html>'), { filename: 'evil.html', contentType: 'text/html' });
    expect(r.status).toBe(415);
    expect(r.body.error).toBe('unsupported_media_type');
  });

  it('rejects mismatched magic bytes with 415', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', Buffer.from('<html>'), { filename: 'sneaky.png', contentType: 'image/png' });
    expect(r.status).toBe(415);
  });

  it('rejects upload to archived issue with 409', async () => {
    const { aliceAgent, sa, project } = await setupProjectWith('developer');
    const issue = await makeIssue(aliceAgent, project.id);
    await sa.post(`/api/projects/${project.id}/issues/${issue.number}/archive`);
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('issue_archived');
  });

  it('returns 404 when issue does not exist', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const r = await aliceAgent
      .post(`/api/projects/${project.id}/issues/9999/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });
    expect(r.status).toBe(404);
  });
});

describe('GET /api/attachments/:id', () => {
  it('streams the file to a member', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'shot.png', contentType: 'image/png' });

    const r = await aliceAgent
      .get(`/api/attachments/${up.body.attachment.id}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.headers['content-disposition']).toMatch(/^inline;/);
    expect(Buffer.compare(r.body, PNG_BYTES)).toBe(0);
  });

  it('returns 404 when requester is in a different project (the spec verify case)', async () => {
    const { app, db, sa, project: projectA } = await setupProjectWith('user');
    const aliceAgent = await loggedIn(app, 'alice@x.com');
    const issueA = await makeIssue(aliceAgent, projectA.id);
    const up = await aliceAgent
      .post(`/api/projects/${projectA.id}/issues/${issueA.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'shot.png', contentType: 'image/png' });

    // Make a SECOND project with a different user.
    const projectB = await makeProject(sa, 'B');
    const bob = await seedUser(db, { email: 'bob@y.com' });
    await sa.post(`/api/admin/projects/${projectB.id}/members`).send({ userId: bob.id, role: 'user' });
    const bobAgent = await loggedIn(app, 'bob@y.com');

    const r = await bobAgent.get(`/api/attachments/${up.body.attachment.id}`);
    expect(r.status).toBe(404);
  });

  it('returns 404 to viewer non-uploader for archived attachment', async () => {
    const { app, db, sa, aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });

    // Add a separate viewer in the same project.
    const vee = await seedUser(db, { email: 'vee@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: vee.id, role: 'viewer' });
    const veeAgent = await loggedIn(app, 'vee@x.com');

    // Archive as super admin.
    await sa.post(`/api/attachments/${up.body.attachment.id}/archive`);

    const r = await veeAgent.get(`/api/attachments/${up.body.attachment.id}`);
    expect(r.status).toBe(404);

    // Uploader still gets 200.
    const r2 = await aliceAgent.get(`/api/attachments/${up.body.attachment.id}`);
    expect(r2.status).toBe(200);
  });

  it('requires authentication', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });

    const r = await request(aliceAgent.app).get(`/api/attachments/${up.body.attachment.id}`);
    expect(r.status).toBe(401);
  });
});

describe('POST /api/attachments/:id/archive', () => {
  it('lets the uploader archive', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });
    const r = await aliceAgent.post(`/api/attachments/${up.body.attachment.id}/archive`);
    expect(r.status).toBe(200);
    expect(r.body.attachment.archived_at).toBeTruthy();
  });

  it('lets a project developer archive someone else\'s attachment', async () => {
    const { app, db, sa, aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });

    const dev = await seedUser(db, { email: 'dev@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: dev.id, role: 'developer' });
    const devAgent = await loggedIn(app, 'dev@x.com');

    const r = await devAgent.post(`/api/attachments/${up.body.attachment.id}/archive`);
    expect(r.status).toBe(200);
  });

  it('forbids a non-uploader user (403)', async () => {
    const { app, db, sa, aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    const up = await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'x.png', contentType: 'image/png' });

    const u = await seedUser(db, { email: 'u@x.com' });
    await sa.post(`/api/admin/projects/${project.id}/members`).send({ userId: u.id, role: 'user' });
    const uAgent = await loggedIn(app, 'u@x.com');

    const r = await uAgent.post(`/api/attachments/${up.body.attachment.id}/archive`);
    expect(r.status).toBe(403);
  });
});

describe('GET /api/projects/:id/issues/:number includes attachments', () => {
  it('returns the attachments array on the issue', async () => {
    const { aliceAgent, project } = await setupProjectWith('user');
    const issue = await makeIssue(aliceAgent, project.id);
    await aliceAgent
      .post(`/api/projects/${project.id}/issues/${issue.number}/attachments`)
      .attach('file', PNG_BYTES, { filename: 'shot.png', contentType: 'image/png' });

    const r = await aliceAgent.get(`/api/projects/${project.id}/issues/${issue.number}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.attachments)).toBe(true);
    expect(r.body.attachments).toHaveLength(1);
    expect(r.body.attachments[0].filename).toBe('shot.png');
    expect(r.body.attachments[0].uploader.email).toBe('alice@x.com');
  });
});
