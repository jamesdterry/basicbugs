import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { kickDrain } from './services/notifications.js';
import { sweepPartialUploads } from './routes/attachments.js';
import { getDb } from './db/connection.js';
import * as errorLog from './db/errorLog.js';

const app = createApp();

const ERROR_LOG_RETENTION_DAYS = 30;
const PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;

function pruneErrorLog() {
  try {
    const removed = errorLog.prune(getDb(), ERROR_LOG_RETENTION_DAYS);
    if (removed > 0) {
      logger.info(`Pruned ${removed} error_log row(s) older than ${ERROR_LOG_RETENTION_DAYS}d`);
    }
  } catch (err) {
    logger.error('error_log prune failed', err);
  }
}

app.listen(config.port, () => {
  logger.info(`basicbugs listening on ${config.baseUrl} (env=${config.nodeEnv})`);
  // Flush any notifications left unsent by a prior crash.
  kickDrain();
  pruneErrorLog();
  setInterval(pruneErrorLog, PRUNE_INTERVAL_MS).unref();
  sweepPartialUploads()
    .then((n) => {
      if (n > 0) logger.info(`Removed ${n} orphan attachment partial(s) from .tmp`);
    })
    .catch((err) => logger.error('sweepPartialUploads failed', err));
});

process.on('unhandledRejection', (reason) => {
  logger.error('unhandledRejection', reason);
  try {
    errorLog.record(getDb(), {
      method: null,
      route: null,
      status: 500,
      userId: null,
      message: reason?.message ?? String(reason),
      stack: reason?.stack ?? null,
    });
  } catch {
    /* swallow — we've already logged */
  }
});
