import { useTranslation } from 'react-i18next';
import { Music, Radio, Volume2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useMediaLatest } from '@/api/hooks/useVehicles';
import { formatDurationClock } from '@/lib/dateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

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

function ProgressBar({ elapsed, duration, label }: { elapsed: number; duration: number; label: string }) {
  const pct = progressPercent(elapsed, duration);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      className="w-full h-1 rounded-full bg-[var(--surface-2)] overflow-hidden"
    >
      <div
        className="h-full rounded-full bg-neon-cyan transition-all duration-slow"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function MediaNowPlayingWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const { data: media, isLoading, isFetching, isStale, isError, dataUpdatedAt, refetch } = useMediaLatest(id, 5_000);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  const title = media?.now_playing_title ?? '—';
  const artist = media?.now_playing_artist ?? '—';
  const album = media?.now_playing_album;
  const source = media?.playback_source ?? media?.now_playing_station;
  const status = media?.playback_status;
  const elapsed = media?.now_playing_elapsed ?? 0;
  const duration = media?.now_playing_duration ?? 0;
  const volume = media?.audio_volume;
  const volumeMax = media?.audio_volume_max ?? 11;

  const isPlaying = status === 'Playing';

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.nowPlaying', 'Now Playing')}
      icon={<Music className="h-3.5 w-3.5 text-neon-cyan" aria-hidden="true" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {media ? (
        isCompact ? (
          /* ── Compact 1×1 ── */
          <div className="flex flex-col items-center justify-center h-full gap-1 text-center px-1">
            <Music className="h-5 w-5 text-neon-cyan shrink-0" aria-hidden="true" />
            <p className="text-xs font-semibold text-[var(--text-primary)] truncate w-full">{title}</p>
            <p className="text-2xs text-[var(--text-secondary)] truncate w-full">{artist}</p>
          </div>
        ) : (
          /* ── Standard / Tall ── */
          <div className="flex flex-col gap-2 h-full">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-neon-cyan/10 shrink-0">
                <Music className="h-5 w-5 text-neon-cyan" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[var(--text-primary)] truncate">{title}</p>
                <p className="text-xs text-[var(--text-secondary)] truncate">{artist}</p>
                {isTall && album && (
                  <p className="text-xs text-[var(--text-muted)] truncate">{album}</p>
                )}
              </div>
              {isPlaying && (
                <span className="text-2xs px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 shrink-0">
                  {t('widget.playing', 'Playing')}
                </span>
              )}
            </div>

            {duration > 0 && (
              <div className="space-y-1">
                <ProgressBar elapsed={elapsed} duration={duration} label={t('widget.playbackProgress', 'Playback progress')} />
                <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
                  <span>{formatDurationClock(elapsed)}</span>
                  <span>{formatDurationClock(duration)}</span>
                </div>
              </div>
            )}

            {isTall && (
              <div className="space-y-1.5 mt-auto">
                {source && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{source}</span>
                  </div>
                )}
                {volume != null && (
                  <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                    <Volume2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    <div
                      role="progressbar"
                      aria-label={t('widget.volume', 'Volume')}
                      aria-valuemin={0}
                      aria-valuemax={volumeMax}
                      aria-valuenow={volume}
                      className="flex-1 h-1 rounded-full bg-[var(--surface-2)] overflow-hidden"
                    >
                      <div
                        className="h-full rounded-full bg-[var(--text-secondary)]"
                        style={{ width: `${volumePercent(volume, volumeMax)}%` }}
                      />
                    </div>
                    <span className="text-2xs tabular-nums">{volume}</span>
                  </div>
                )}
              </div>
            )}

            {!isTall && source && (
              <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] mt-auto">
                <Radio className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{source}</span>
              </div>
            )}
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Music className="h-5 w-5" aria-hidden="true" />}
          message={t('widget.noMedia', 'Nothing playing')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
