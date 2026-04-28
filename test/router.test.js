import { describe, it, expect } from 'vitest';
import { parseHash } from '../public/lib/router.js';

describe('parseHash', () => {
  it('returns the home route for empty/null hash', () => {
    expect(parseHash('')).toEqual({ name: 'home', params: { query: {} } });
    expect(parseHash(null)).toEqual({ name: 'home', params: { query: {} } });
    expect(parseHash(undefined)).toEqual({ name: 'home', params: { query: {} } });
  });

  it('returns the home route for "#" and "#/"', () => {
    expect(parseHash('#')).toEqual({ name: 'home', params: { query: {} } });
    expect(parseHash('#/')).toEqual({ name: 'home', params: { query: {} } });
  });

  it('parses #/projects/:id', () => {
    expect(parseHash('#/projects/3')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: {} },
    });
    expect(parseHash('#/projects/abc')).toEqual({
      name: 'projectHome',
      params: { id: 'abc', query: {} },
    });
  });

  it('parses #/projects/:id/issues/:number', () => {
    expect(parseHash('#/projects/3/issues/42')).toEqual({
      name: 'issueDetail',
      params: { id: '3', number: '42', query: {} },
    });
  });

  it('matches #/admin and #/admin/anything to the admin route', () => {
    expect(parseHash('#/admin')).toEqual({ name: 'admin', params: { query: {} } });
    expect(parseHash('#/admin/users')).toEqual({ name: 'admin', params: { query: {} } });
  });

  it('parses #/me', () => {
    expect(parseHash('#/me')).toEqual({ name: 'me', params: { query: {} } });
  });

  it('falls back to notFound for unknown hashes', () => {
    expect(parseHash('#/wat')).toEqual({ name: 'notFound', params: { query: {} } });
    expect(parseHash('#/projects')).toEqual({ name: 'notFound', params: { query: {} } });
    expect(parseHash('#/projects/3/issues')).toEqual({ name: 'notFound', params: { query: {} } });
    expect(parseHash('#/projects/3/foo/4')).toEqual({ name: 'notFound', params: { query: {} } });
  });

  it('ignores trailing/leading slashes in the parts', () => {
    expect(parseHash('#/projects/3/')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: {} },
    });
    expect(parseHash('#//projects//3')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: {} },
    });
  });

  it('parses the query string into params.query', () => {
    expect(parseHash('#/projects/3?status=1,2&sort=number_asc')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: { status: '1,2', sort: 'number_asc' } },
    });
  });

  it('decodes URL-encoded query values', () => {
    expect(parseHash('#/projects/3?q=hello%20world')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: { q: 'hello world' } },
    });
  });

  it('returns empty query when string has no params', () => {
    expect(parseHash('#/projects/3?')).toEqual({
      name: 'projectHome',
      params: { id: '3', query: {} },
    });
  });
});
