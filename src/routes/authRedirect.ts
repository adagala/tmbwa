type RedirectLocation = {
  pathname: string;
  search?: string;
  hash?: string;
};

type RedirectState = {
  from?: RedirectLocation;
};

export function getPostSignInPath(state: unknown): string | null {
  const from = (state as RedirectState | null)?.from;

  if (
    !from ||
    typeof from.pathname !== 'string' ||
    !from.pathname.startsWith('/') ||
    from.pathname.startsWith('//') ||
    from.pathname === '/auth' ||
    from.pathname.startsWith('/auth/')
  ) {
    return null;
  }

  const search =
    typeof from.search === 'string' && from.search.startsWith('?')
      ? from.search
      : '';
  const hash =
    typeof from.hash === 'string' && from.hash.startsWith('#') ? from.hash : '';

  return `${from.pathname}${search}${hash}`;
}
