// Deterministic env for tests. Loaded before any test file imports server/config.js.
process.env.NODE_ENV = 'test';
process.env.SUPER_ADMIN_EMAIL = 'admin@test.local';
process.env.SESSION_SECRET = 'test-session-secret-do-not-use-in-prod';
process.env.BASE_URL = 'http://localhost:8080';
process.env.DB_PATH = ':memory:';
process.env.ATTACHMENTS_DIR = './data/attachments-test';
// SMTP_HOST left empty so services/email.js logs instead of sending.
process.env.SMTP_HOST = '';
