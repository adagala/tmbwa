import { describe, expect, it } from 'vitest';
import { getPostSignInPath } from '../src/routes/authRedirect';

describe('post-sign-in redirects', () => {
  it('restores the requested path, query string, and hash', () => {
    expect(
      getPostSignInPath({
        from: {
          pathname: '/members/member-123',
          search: '?tab=contributions',
          hash: '#history',
        },
      }),
    ).toBe('/members/member-123?tab=contributions#history');
  });

  it('ignores missing, external, and auth destinations', () => {
    expect(getPostSignInPath(null)).toBeNull();
    expect(
      getPostSignInPath({ from: { pathname: '//example.com/account' } }),
    ).toBeNull();
    expect(
      getPostSignInPath({ from: { pathname: '/auth/signin' } }),
    ).toBeNull();
  });

  it('ignores malformed query strings and hashes', () => {
    expect(
      getPostSignInPath({
        from: {
          pathname: '/profile',
          search: 'not-a-query',
          hash: 'not-a-hash',
        },
      }),
    ).toBe('/profile');
  });
});
