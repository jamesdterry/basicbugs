import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { getDb } from './db/connection.js';
import { createAuthRouter } from './routes/auth.js';
import { createProjectsRouter } from './routes/projects.js';
import { createAdminRouter } from './routes/admin.js';
import { createMeRouter } from './routes/me.js';
import { createAttachmentsRouter } from './routes/attachments.js';
import { loadSessionFromCookie } from './middleware/requireUser.js';
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');

export function createApp({ db } = {}) {
  const dbHandle = db ?? getDb();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.isProduction ? 1 : false);
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser(config.sessionSecret));
  app.use(express.json({ limit: '1mb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/auth', createAuthRouter({ db: dbHandle }));
  app.use('/api/admin', createAdminRouter({ db: dbHandle }));
  app.use('/api/me', createMeRouter({ db: dbHandle }));
  app.use('/api/attachments', createAttachmentsRouter({ db: dbHandle }));
  app.use('/api', createProjectsRouter({ db: dbHandle }));

  function appShellGate(req, res) {
    const loaded = loadSessionFromCookie(dbHandle, req, res);
    if (!loaded) return res.redirect(302, '/login.html');
    res.sendFile(INDEX_HTML);
  }

  app.get('/', appShellGate);
  app.get('/index.html', appShellGate);

  app.use(express.static(PUBLIC_DIR, { index: false }));

  app.use((err, req, res, _next) => {
    logger.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
