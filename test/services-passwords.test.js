import { describe, it, expect } from 'vitest';
import { hash, verify } from '../server/services/passwords.js';

describe('services/passwords', () => {
  it('hashes and verifies a password roundtrip', async () => {
    const h = await hash('correct horse battery staple');
    expect(h).toMatch(/^\$2[aby]\$/);
    expect(await verify('correct horse battery staple', h)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const h = await hash('hunter2');
    expect(await verify('hunter3', h)).toBe(false);
  });

  it('returns false when stored hash is null/empty', async () => {
    expect(await verify('anything', null)).toBe(false);
    expect(await verify('anything', '')).toBe(false);
    expect(await verify('anything', undefined)).toBe(false);
  });

  it('produces distinct hashes for the same plaintext (salting)', async () => {
    const a = await hash('same');
    const b = await hash('same');
    expect(a).not.toBe(b);
    expect(await verify('same', a)).toBe(true);
    expect(await verify('same', b)).toBe(true);
  });
});
