import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isConfigured, snapshotKey, _resetClientForTests } from '../server/services/backup.js';

const S3_ENV_KEYS = [
  'BUCKET_NAME',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_ENDPOINT_URL_S3',
  'AWS_REGION',
];

const savedEnv = {};

beforeEach(() => {
  for (const k of S3_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  _resetClientForTests();
});

afterEach(() => {
  for (const k of S3_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  _resetClientForTests();
});

describe('backup.isConfigured', () => {
  it('returns false when no S3 env vars are set', () => {
    expect(isConfigured()).toBe(false);
  });

  it('returns false when only some S3 env vars are set', () => {
    process.env.BUCKET_NAME = 'bb';
    process.env.AWS_ACCESS_KEY_ID = 'k';
    expect(isConfigured()).toBe(false);
  });

  it('returns true when all five S3 env vars are set', () => {
    process.env.BUCKET_NAME = 'bb';
    process.env.AWS_ACCESS_KEY_ID = 'k';
    process.env.AWS_SECRET_ACCESS_KEY = 's';
    process.env.AWS_ENDPOINT_URL_S3 = 'https://example';
    process.env.AWS_REGION = 'auto';
    expect(isConfigured()).toBe(true);
  });
});

describe('backup.snapshotKey', () => {
  it('produces a path-safe ISO key under snapshots/', () => {
    const key = snapshotKey(new Date('2026-04-29T15:30:45.123Z'));
    expect(key).toBe('snapshots/basicbugs-2026-04-29T15-30-45Z.sqlite');
  });

  it('uses the current time when called with no args', () => {
    const key = snapshotKey();
    expect(key).toMatch(/^snapshots\/basicbugs-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.sqlite$/);
  });
});
