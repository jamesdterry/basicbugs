import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
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
import { csrfMiddleware } from './middleware/csrf.js';
import { logger } from './logger.js';
import * as errorLog from './db/errorLog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
const INDEX_HTML = path.join(PUBLIC_DIR, 'index.html');
const SENSITIVE_QUERY_KEYS = new Set(['token', 'code', 'password', 'email']);

export function redactUrl(rawUrl) {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl, 'http://basicbugs.local');
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.set(key, '[redacted]');
      }
    }
    return `${url.pathname}${url.search}`;
  } catch {
    return String(rawUrl).replace(
      /([?&](?:token|code|password|email)=)[^&#]*/gi,
      '$1[redacted]',
    );
  }
}

export function createApp({ db } = {}) {
  const dbHandle = db ?? getDb();
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.isProduction ? 1 : false);

  if (config.nodeEnv !== 'test') {
    app.use(
      pinoHttp({
        logger: logger.raw,
        customLogLevel: (_req, res, err) => {
          if (err || res.statusCode >= 500) return 'error';
          if (res.statusCode >= 400) return 'warn';
          return 'info';
        },
        serializers: {
          req: (req) => ({ method: req.method, url: redactUrl(req.url) }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      }),
    );
  }

  app.use(helmet());
  app.use(compression());
  app.use(cookieParser(config.sessionSecret));
  app.use(express.json({ limit: '1mb' }));
  app.use(csrfMiddleware);

  app.get('/healthz', (_req, res) => {
    try {
      dbHandle
        .prepare("UPDATE _health SET last_check = datetime('now') WHERE id = 1")
        .run();
      res.json({ status: 'ok' });
    } catch (err) {
      logger.error('healthz db write failed', err);
      res.status(503).json({ status: 'error', error: 'db_unavailable' });
    }
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
    try {
      errorLog.record(dbHandle, {
        method: req.method,
        route: redactUrl(req.originalUrl),
        status: 500,
        userId: req.user?.id ?? null,
        message: err?.message ?? String(err),
        stack: err?.stack ?? null,
      });
    } catch (writeErr) {
      logger.error('error_log write failed', writeErr);
    }
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal' });
  });

  return app;
}
