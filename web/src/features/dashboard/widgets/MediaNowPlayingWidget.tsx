import { useTranslation } from 'react-i18next';
import { Music } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { MetricBar } from '@/components/data-display';
import { Caption, Text } from '@/components/ui';
import { useVehicles, useMediaLatest } from '@/api/hooks/useVehicles';
import { formatDurationClock } from '@/lib/dateConvert';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';

/**
 * Clamp a raw percentage into the inclusive 0–100 range. A non-finite input
 * (e.g. a divide-by-zero) collapses to 0 so a bar width is never `NaN%`.
 */
function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

/** Playback progress as a 0–100 %. Returns 0 when the track duration is unknown. */
export function progressPercent(elapsed: number, duration: number): number {
  return duration > 0 ? clampPct((elapsed / duration) * 100) : 0;
}

/** Audio volume as a 0–100 %. Returns 0 when the scale max is unusable (≤ 0). */
export function volumePercent(volume: number, max: number): number {
  return max > 0 ? clampPct((volume / max) * 100) : 0;
}

export default function MediaNowPlayingWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const packId = usePackPresentation();
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const query = useMediaLatest(id, 5_000);
  const { data: media, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const state = useDataState({ ...query, data: media ?? undefined }, { provenance: 'live' });
  const displayState = !id && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;
  const recover = () => {
    if (!id) void vehicleQuery.refetch();
    else void refetch();
  };

  const isCompact = size.cols === 1 && size.rows === 1;
  const title = typeof media?.now_playing_title === 'string' && media.now_playing_title.trim()
    ? media.now_playing_title
    : '—';
  const artist = typeof media?.now_playing_artist === 'string' && media.now_playing_artist.trim()
    ? media.now_playing_artist
    : null;
  const source = media?.playback_source ?? media?.now_playing_station;
  const sourceText = typeof source === 'string' && source.trim() ? source : null;
  const subtitle = [artist, sourceText].filter((value): value is string => Boolean(value)).join(' · ');
  const rawElapsed = knownNumber(media?.now_playing_elapsed);
  const elapsed = rawElapsed != null && rawElapsed >= 0 ? rawElapsed : null;
  const duration = knownNumber(media?.now_playing_duration);
  const artwork = (
    <div className="flex items-center justify-center h-14 w-14 rounded-shape-lg bg-gradient-to-br from-[var(--theme-primary)]/70 to-[var(--text-secondary)]/30 shrink-0" aria-hidden="true">
      <Music className="h-6 w-6 text-[var(--text-primary)]" />
    </div>
  );
  const playback = (segmented = false) => duration != null && duration > 0 && elapsed != null ? (
    <div className="space-y-1">
      <MetricBar
        value={progressPercent(elapsed, duration)}
        max={100}
        color="var(--theme-primary)"
        ariaLabel={t('widget.playbackProgress', 'Playback progress')}
        showHeader={false}
        size="slim"
        fill={segmented ? 'segmented' : 'solid'}
      />
      <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
        <span>{formatDurationClock(elapsed)}</span>
        <span>{formatDurationClock(duration)}</span>
      </div>
    </div>
  ) : null;
  const empty = (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Music className="h-5 w-5" aria-hidden="true" />}
      message={t('widget.noMedia', 'Nothing playing')}
      className="py-4"
    />
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.nowPlaying', 'Now playing')}
      icon={<Music className="h-3.5 w-3.5 text-theme-accent" aria-hidden="true" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={recover}
    >
      <InstrumentPresentation
        family="media"
        compact={isCompact}
        icon={media ? isCompact ? <Music className="h-5 w-5" aria-hidden="true" /> : artwork : undefined}
        headline={media ? (
          <div className={`min-w-0 ${isCompact ? 'text-center' : ''}`}>
            <Text as="p" size="sm" weight="medium" color="primary" className="break-words [overflow-wrap:anywhere]" title={title}>{title}</Text>
            {(isCompact ? artist : subtitle) && (
              <Caption as="p" className="break-words [overflow-wrap:anywhere]" title={isCompact ? artist ?? undefined : subtitle}>
                {isCompact ? artist : subtitle}
              </Caption>
            )}
          </div>
        ) : undefined}
        instrument={media ? isCompact ? undefined : playback(packId === 'v7') ?? (
          <Caption as="p">{t('dashboardWidgets.media.mediaProgressUnavailable', 'Playback progress depends on available media signals.')}</Caption>
        ) : empty}
      >
      {media ? (
        isCompact ? (
          /* ── Compact 1×1 ── */
          <div className="flex flex-col items-center justify-center h-full gap-1 text-center px-1">
            <Music className="h-5 w-5 text-theme-accent shrink-0" aria-hidden="true" />
            <p className={`${dashboardTokens.metricLabel} w-full`} title={title}>{title}</p>
            {artist && <p className={`${dashboardTokens.metricLabel} w-full`} title={artist}>{artist}</p>}
          </div>
        ) : (
          /* ── Standard / Tall ── */
          <div className="flex flex-col gap-3 h-full">
            <div className="flex items-start gap-3 min-w-0">
              {artwork}
              <div className="min-w-0 flex-1">
                <p className={`${dashboardTokens.secondaryMetric} break-words [overflow-wrap:anywhere]`} title={title}>{title}</p>
                {subtitle && (
                  <p className={dashboardTokens.metricLabel} title={subtitle}>{subtitle}</p>
                )}
              </div>
            </div>

            {playback()}

          </div>
        )
      ) : (
        empty
      )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
