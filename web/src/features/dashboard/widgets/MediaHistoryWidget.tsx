import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ListMusic, Music } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { cleanNil } from '@/lib/cleanNil';
import { safeArray } from '@/lib/safeArray';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';

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
        <p className={dashboardTokens.metricLabel} title={label}>{label}</p>
      </div>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function MediaHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatTime, formatDateTime } = useDateFormat();
  const { formatRelativeDays } = useDateLabels();
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const query = useMediaHistory(vidStr ?? '');
  const {
    data: history,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = useDataState({ ...query, data: history ?? undefined }, { provenance: 'historical' });
  const displayState = vid === undefined && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;
  const recover = () => {
    if (vid === undefined) void vehicleQuery.refetch();
    else void refetch();
  };

  const isCompact = size.cols <= 1;
  const list = useMemo(() => safeArray(history), [history]);

  const entries = useMemo<DetailEntry[]>(() => {
    const rows = list.map((item) => {
      const trackTitle = cleanNil(item.now_playing_title) ?? '—';
      const artist = cleanNil(item.now_playing_artist);
      const source = cleanNil(item.playback_source);
      const subtitle = [artist, source].filter(Boolean).join(' · ') || undefined;
      const timestamp = cleanNil(item.created_at) ?? '';
      return {
        id: item.id ?? `${timestamp}-${trackTitle}-${artist ?? ''}-${source ?? ''}`,
        label: trackTitle,
        sublabel: subtitle,
        value: timestamp,
      };
    });

    return rows.sort((a, b) => {
      const timestampA = typeof a.value === 'string' ? new Date(a.value).getTime() : Number.NaN;
      const timestampB = typeof b.value === 'string' ? new Date(b.value).getTime() : Number.NaN;
      const epochA = Number.isNaN(timestampA) ? Number.NEGATIVE_INFINITY : timestampA;
      const epochB = Number.isNaN(timestampB) ? Number.NEGATIVE_INFINITY : timestampB;
      return epochA === epochB ? 0 : epochA > epochB ? -1 : 1;
    }).map((entry) => {
      const timestamp = typeof entry.value === 'string' ? entry.value : '';
      const ms = new Date(timestamp).getTime();
      let value = '—';
      if (!Number.isNaN(ms)) {
        const diffMin = Math.floor((Date.now() - ms) / 60_000);
        if (diffMin < 1) {
          value = formatTime(timestamp);
        } else if (diffMin < 60) {
          value = t('widget.eventFeed.minutesAgo', '{{minutes}}m ago', { minutes: diffMin });
        } else {
          const day = formatRelativeDays(timestamp);
          value = day === 'Today' || day === 'Yesterday'
            ? `${day} ${formatTime(timestamp)}`
            : formatDateTime(timestamp);
        }
      }
      return { ...entry, value };
    });
  }, [list, t, formatRelativeDays, formatTime, formatDateTime]);

  const lastTrack = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.mediaHistory', 'Media history')}
      icon={<ListMusic className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={recover}
    >
      {isCompact ? (
        lastTrack ? (
          <CompactView
            title={cleanNil(lastTrack.now_playing_title) ?? '—'}
            artist={cleanNil(lastTrack.now_playing_artist) ?? '—'}
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
          <WidgetDetailCard
            entries={entries.slice(0, 10)}
            compact={false}
            emptyMessage={t('widget.noMediaPlayed', 'No tracks played')}
            emptyIcon={<ListMusic className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
