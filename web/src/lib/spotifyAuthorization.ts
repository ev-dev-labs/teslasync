type SpotifyScope = 'playlist-modify-private' | 'user-library-modify' | 'user-read-playback-position';

export function spotifyAuthorizationTarget(value: string | undefined, scope: SpotifyScope): string | undefined {
  if (!value || !URL.canParse(value)) return;
  const target = new URL(value);
  if (target.origin === 'https://accounts.spotify.com' && target.pathname === '/authorize' &&
    target.searchParams.get('scope') === scope && !target.username && !target.password && !target.hash) {
    return target.href;
  }
}
