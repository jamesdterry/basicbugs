import crypto from 'node:crypto';

const RAW_BYTES = 32;

export function generate() {
  const raw = crypto.randomBytes(RAW_BYTES).toString('base64url');
  return { raw, hash: hashRaw(raw) };
}

export function hashRaw(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}
