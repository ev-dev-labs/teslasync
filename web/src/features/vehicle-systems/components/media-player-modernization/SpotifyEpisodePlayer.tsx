import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Text } from '@/components/ui';

const protocol = 'teslasync-spotify-episode-v1';
type PlaybackState = 'off' | 'checking' | 'not-current' | 'loading' | 'ready' | 'observed' | 'unconfirmed' | 'unavailable';

interface Props {
  uri: string;
  positionS: number;
  disabled: boolean;
  verifyLoad: () => Promise<boolean>;
}

export function SpotifyEpisodePlayer({ uri, positionS, disabled, verifyLoad }: Props) {
  const { t } = useTranslation();
  const iframe = useRef<HTMLIFrameElement>(null);
  const sent = useRef(false);
  const [state, setState] = useState<PlaybackState>('off');
  const active = state === 'loading' || state === 'ready' || state === 'observed' || state === 'unconfirmed';
  const blocked = state === 'checking' || disabled;

  useEffect(() => {
    if (!active) return;
    const receive = (event: MessageEvent) => {
      if (event.origin !== 'null' || event.source !== iframe.current?.contentWindow ||
          event.data?.protocol !== protocol || event.data?.uri !== uri) return;
      if (event.data.type === 'ready') {
        setState(current => current === 'loading' ? 'ready' : current);
      } else if (event.data.type === 'unavailable') {
        setState(current => current === 'loading' ? 'unavailable' : current);
      } else if (event.data.type === 'unconfirmed') {
        setState(current => current === 'ready' ? 'unconfirmed' : current);
      } else if (event.data.type === 'observed' && typeof event.data.positionMs === 'number' &&
          Number.isFinite(event.data.positionMs) && event.data.positionMs >= 0) {
        const offset = event.data.positionMs - positionS * 1000;
        if (offset >= -1000 && offset <= 5000) setState(current => current === 'ready' ? 'observed' : current);
      }
    };
    window.addEventListener('message', receive);
    const timeout = window.setTimeout(
      () => setState(current => current === 'loading' ? 'unavailable' : current), 20_000,
    );
    return () => {
      window.removeEventListener('message', receive);
      window.clearTimeout(timeout);
    };
  }, [active, positionS, uri]);

  const status = {
    off: '',
    checking: t('media.episode.playerChecking', 'Checking that this private episode review is still current.'),
    'not-current': t('media.episode.playerNotCurrent', 'The episode review could not be verified. No Spotify player was loaded.'),
    loading: t('media.episode.playerLoading', 'Loading the Spotify player.'),
    ready: t('media.episode.playerReady', 'Spotify player ready. Playback at the saved position is not confirmed.'),
    observed: t('media.episode.playbackObserved', 'Spotify reported playback near the saved position.'),
    unconfirmed: t('media.episode.playbackDifferent', 'Spotify did not report playback near the saved position.'),
    unavailable: t('media.episode.playerUnavailable', 'Spotify playback could not be confirmed. You can still open the episode in Spotify.'),
  };

  async function load() {
    setState('checking');
    let allowed = false;
    try { allowed = await verifyLoad(); } catch { /* No player is mounted when verification fails. */ }
    if (allowed) sent.current = false;
    setState(allowed ? 'loading' : 'not-current');
  }

  return <div className="space-y-2">
    <Text as="p" variant="caption">{t(
      'media.episode.playerPrivacy',
      'Loading the player shares this episode and its saved position with Spotify. Then choose Play in the player.',
    )}</Text>
    <Button type="button" className="min-h-11" variant="secondary" wrapLabel aria-disabled={!active && blocked}
      onClick={() => {
        if (active) setState('off');
        else if (!blocked) void load();
      }}>
      {active ? t('media.episode.closePlayer', 'Close Spotify player')
        : t('media.episode.loadPlayer', 'Load Spotify player at saved position')}
    </Button>
    {active && <iframe ref={iframe} className="h-[232px] w-full border-0" src="/spotify-episode-bridge.html"
        title={t('media.episode.playerFrame', 'Spotify episode player')}
        sandbox="allow-scripts" allow="encrypted-media *" referrerPolicy="no-referrer"
        onLoad={() => {
          const player = iframe.current?.contentWindow;
          if (!player || sent.current) return;
          sent.current = true;
          player.postMessage({ protocol, type: 'load', uri, positionS }, '*');
        }} />}
    {status[state] && <Text as="p" variant="bodySm" role="status">{status[state]}</Text>}
  </div>;
}
