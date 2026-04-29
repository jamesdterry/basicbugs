import 'dotenv/config';
import crypto from 'node:crypto';

const REQUIRED_IN_PRODUCTION = [
  'SESSION_SECRET',
  'SUPER_ADMIN_EMAIL',
  'BASE_URL',
  'DB_PATH',
  'ATTACHMENTS_DIR',
];

const env = process.env;
const nodeEnv = env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';

if (isProduction) {
  const missing = REQUIRED_IN_PRODUCTION.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables in production: ${missing.join(', ')}`);
  }
}

let sessionSecret = env.SESSION_SECRET;
if (!sessionSecret) {
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('[config] SESSION_SECRET not set — generated an ephemeral secret for this process.');
}

export const config = Object.freeze({
  nodeEnv,
  isProduction,
  port: Number(env.PORT ?? 8080),
  baseUrl: env.BASE_URL ?? `http://localhost:${env.PORT ?? 8080}`,
  sessionSecret,
  superAdminEmail: (env.SUPER_ADMIN_EMAIL ?? '').toLowerCase(),
  dbPath: env.DB_PATH ?? './data/basicbugs.sqlite',
  attachmentsDir: env.ATTACHMENTS_DIR ?? './data/attachments',
  smtp: Object.freeze({
    host: env.SMTP_HOST ?? '',
    port: Number(env.SMTP_PORT ?? 587),
    secure: env.SMTP_SECURE === 'true',
    user: env.SMTP_USER ?? '',
    pass: env.SMTP_PASS ?? '',
    from: env.SMTP_FROM ?? '',
  }),
});
