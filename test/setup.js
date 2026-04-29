// Deterministic env for tests. Loaded before any test file imports server/config.js.
process.env.NODE_ENV = 'test';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SESSION_SECRET = 'test-session-secret-do-not-use-in-prod';
process.env.BASE_URL = 'http://localhost:8080';
process.env.DB_PATH = ':memory:';
process.env.ATTACHMENTS_DIR = './data/attachments-test';
// SMTP_HOST left empty so services/email.js logs instead of sending.
process.env.SMTP_HOST = '';
// Cost-12 bcrypt under parallel-file load saturates CPU and triggers
// ECONNRESETs in supertest. Cost 4 still exercises the same code path.
process.env.BCRYPT_COST = '4';

// CSRF middleware (Stage 14) requires X-CSRF-Token on /api/* mutations.
// Wrap supertest's agent so post/patch/put/delete auto-attach the header
// from the bb_csrf cookie in the agent's jar — keeping per-test changes to zero.
import supertest from 'supertest';

const MUTATING = ['post', 'patch', 'put', 'delete', 'del'];

function readCsrfFromJar(jar) {
  const cookies = jar.getCookies({
    domain: '127.0.0.1',
    path: '/',
    secure: false,
    script: false,
  });
  const arr = Array.isArray(cookies) ? cookies : [];
  return arr.find((c) => c.name === 'bb_csrf')?.value ?? null;
}

function wrapAgent(agent) {
  for (const method of MUTATING) {
    const orig = agent[method];
    if (typeof orig !== 'function') continue;
    agent[method] = function patched(...args) {
      const req = orig.apply(this, args);
      const token = readCsrfFromJar(this.jar);
      if (token && typeof req.set === 'function') req.set('X-CSRF-Token', token);
      return req;
    };
  }
  return agent;
}

const origAgent = supertest.agent.bind(supertest);
supertest.agent = function (...args) {
  return wrapAgent(origAgent(...args));
};
