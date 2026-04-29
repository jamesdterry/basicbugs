import pino from 'pino';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const isProduction = nodeEnv === 'production';
const isTest = nodeEnv === 'test';

const transport =
  !isProduction && !isTest
    ? { target: 'pino-pretty', options: { colorize: true, singleLine: true } }
    : undefined;

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? (isTest ? 'silent' : 'info'),
  transport,
  base: { service: 'basicbugs' },
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', '*.password', '*.password_hash'],
    censor: '[redacted]',
  },
});

function format(args) {
  let mergeObj;
  const parts = [];
  for (const arg of args) {
    if (arg instanceof Error) {
      mergeObj = { ...(mergeObj ?? {}), err: arg };
      parts.push(arg.message);
    } else if (arg && typeof arg === 'object') {
      try {
        parts.push(JSON.stringify(arg));
      } catch {
        parts.push(String(arg));
      }
    } else {
      parts.push(String(arg));
    }
  }
  return { merge: mergeObj, msg: parts.join(' ') };
}

function wrap(level) {
  return (...args) => {
    if (args.length === 0) return;
    const { merge, msg } = format(args);
    if (merge) pinoLogger[level](merge, msg);
    else pinoLogger[level](msg);
  };
}

export const logger = {
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
  debug: wrap('debug'),
  raw: pinoLogger,
};
