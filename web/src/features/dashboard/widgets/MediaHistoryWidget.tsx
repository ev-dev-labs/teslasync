import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic, Music } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

// ── Source → badge variant mapping ───────────────────────────────────

function sourceLabel(source: string): string {
  const lower = source.toLowerCase();
  if (lower === 'usb') return 'USB';
  return source.charAt(0).toUpperCase() + source.slice(1);
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  title,
  artist,
  t,
}: {
  title: string;
  artist: string;
  t: (key: string, fallback: string) => string;
}) {
  const hasTitle = title !== '—';
  const label = hasTitle
    ? artist !== '—'
      ? `${title} — ${artist}`
      : title
    : t('widget.noMediaPlayed', 'No tracks played');
  return (
    <div className="flex items-center gap-2 min-h-[44px]">
      <Music className="h-4 w-4 flex-shrink-0 text-neon-cyan" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[var(--text-primary)] truncate">{label}</p>
      </div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function MediaHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: history,
    isLoading,
    isFetching,
    isStale,
    isError,
    error,
    dataUpdatedAt,
    refetch,
  } = useMediaHistory(vidStr ?? '');

  const isCompact = size.cols <= 1;
  const list = useMemo(() => history ?? [], [history]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((item) => {
        const trackTitle = item.now_playing_title ?? '—';
        const artist = item.now_playing_artist ?? '—';
        const source = item.playback_source ?? '';
        const isPlaying = (item.playback_status ?? '').toLowerCase() === 'playing';

        return {
          id: item.id,
          icon: <Music className="h-3.5 w-3.5" />,
          title: `🎵 ${trackTitle} — ${artist}`,
          subtitle: source ? sourceLabel(source) : undefined,
          timestamp: item.created_at ?? new Date(0).toISOString(),
          color: isPlaying ? '#22c55e' : '#6b7280',
          severity: 'info' as const,
        };
      }),
    [list],
  );

  const lastTrack = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.mediaHistory', 'Media History')}
      icon={<ListMusic className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        lastTrack ? (
          <CompactView
            title={lastTrack.now_playing_title ?? '—'}
            artist={lastTrack.now_playing_artist ?? '—'}
            t={t}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<ListMusic className="h-5 w-5" />}
            message={t('widget.noMediaPlayed', 'No tracks played')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WidgetEventFeed
            items={feedItems}
            maxItems={10}
            compact={false}
            emptyMessage={t('widget.noMediaPlayed', 'No tracks played')}
            emptyIcon={<ListMusic className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
