import { createApp } from './app.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { kickDrain } from './services/notifications.js';

const app = createApp();

app.listen(config.port, () => {
  logger.info(`basicbugs listening on ${config.baseUrl} (env=${config.nodeEnv})`);
  // Flush any notifications left unsent by a prior crash.
  kickDrain();
});
