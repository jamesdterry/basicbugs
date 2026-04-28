import { describe, it, expect } from 'vitest';
import { parseHash } from '../public/lib/router.js';

describe('parseHash', () => {
  it('returns the home route for empty/null hash', () => {
    expect(parseHash('')).toEqual({ name: 'home', params: {} });
    expect(parseHash(null)).toEqual({ name: 'home', params: {} });
    expect(parseHash(undefined)).toEqual({ name: 'home', params: {} });
  });

  it('returns the home route for "#" and "#/"', () => {
    expect(parseHash('#')).toEqual({ name: 'home', params: {} });
    expect(parseHash('#/')).toEqual({ name: 'home', params: {} });
  });

  it('parses #/projects/:id', () => {
    expect(parseHash('#/projects/3')).toEqual({
      name: 'projectHome',
      params: { id: '3' },
    });
    expect(parseHash('#/projects/abc')).toEqual({
      name: 'projectHome',
      params: { id: 'abc' },
    });
  });

  it('parses #/projects/:id/issues/:number', () => {
    expect(parseHash('#/projects/3/issues/42')).toEqual({
      name: 'issueDetail',
      params: { id: '3', number: '42' },
    });
  });

  it('matches #/admin and #/admin/anything to the admin route', () => {
    expect(parseHash('#/admin')).toEqual({ name: 'admin', params: {} });
    expect(parseHash('#/admin/users')).toEqual({ name: 'admin', params: {} });
  });

  it('parses #/me', () => {
    expect(parseHash('#/me')).toEqual({ name: 'me', params: {} });
  });

  it('falls back to notFound for unknown hashes', () => {
    expect(parseHash('#/wat')).toEqual({ name: 'notFound', params: {} });
    expect(parseHash('#/projects')).toEqual({ name: 'notFound', params: {} });
    expect(parseHash('#/projects/3/issues')).toEqual({ name: 'notFound', params: {} });
    expect(parseHash('#/projects/3/foo/4')).toEqual({ name: 'notFound', params: {} });
  });

  it('ignores trailing/leading slashes in the parts', () => {
    expect(parseHash('#/projects/3/')).toEqual({
      name: 'projectHome',
      params: { id: '3' },
    });
    expect(parseHash('#//projects//3')).toEqual({
      name: 'projectHome',
      params: { id: '3' },
    });
  });
});
