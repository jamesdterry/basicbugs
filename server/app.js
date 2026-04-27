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
import { logger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

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
  app.use('/api', createProjectsRouter({ db: dbHandle }));

  app.use(express.static(PUBLIC_DIR));

  app.use((err, req, res, _next) => {
    logger.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
