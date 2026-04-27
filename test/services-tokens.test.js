import { describe, it, expect } from 'vitest';
import { generate, hashRaw } from '../server/services/tokens.js';

describe('services/tokens', () => {
  it('generate() returns { raw, hash } with the right shape', () => {
    const t = generate();
    expect(typeof t.raw).toBe('string');
    expect(typeof t.hash).toBe('string');
    // base64url of 32 bytes is 43 chars (no padding).
    expect(t.raw.length).toBe(43);
    expect(t.raw).toMatch(/^[A-Za-z0-9_-]+$/);
    // sha-256 hex.
    expect(t.hash.length).toBe(64);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash matches hashRaw(raw)', () => {
    const t = generate();
    expect(hashRaw(t.raw)).toBe(t.hash);
  });

  it('two consecutive tokens are distinct', () => {
    const a = generate();
    const b = generate();
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashRaw is deterministic', () => {
    expect(hashRaw('x')).toBe(hashRaw('x'));
    expect(hashRaw('x')).not.toBe(hashRaw('y'));
  });
});
