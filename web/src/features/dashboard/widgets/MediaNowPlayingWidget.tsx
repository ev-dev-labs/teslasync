import { useTranslation } from 'react-i18next';
import { Music, Radio, Volume2 } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles, useMediaLatest } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function ProgressBar({ elapsed, duration }: { elapsed: number; duration: number }) {
  const pct = duration > 0 ? Math.min((elapsed / duration) * 100, 100) : 0;
  return (
    <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden">
      <div
        className="h-full rounded-full bg-neon-cyan transition-all duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
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
      icon={<Music className="h-3.5 w-3.5 text-neon-cyan" />}
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
            <Music className="h-5 w-5 text-neon-cyan shrink-0" />
            <p className="text-xs font-semibold text-white/90 truncate w-full">{title}</p>
            <p className="text-[10px] text-white/50 truncate w-full">{artist}</p>
          </div>
        ) : (
          /* ── Standard / Tall ── */
          <div className="flex flex-col gap-2 h-full">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-neon-cyan/10 shrink-0">
                <Music className="h-5 w-5 text-neon-cyan" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-white/90 truncate">{title}</p>
                <p className="text-xs text-white/60 truncate">{artist}</p>
                {isTall && album && (
                  <p className="text-[11px] text-white/40 truncate">{album}</p>
                )}
              </div>
              {isPlaying && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-400 shrink-0">
                  {t('widget.playing', 'Playing')}
                </span>
              )}
            </div>

            {duration > 0 && (
              <div className="space-y-1">
                <ProgressBar elapsed={elapsed} duration={duration} />
                <div className="flex items-center justify-between text-[10px] text-white/40">
                  <span>{formatDuration(elapsed)}</span>
                  <span>{formatDuration(duration)}</span>
                </div>
              </div>
            )}

            {isTall && (
              <div className="space-y-1.5 mt-auto">
                {source && (
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <Radio className="h-3 w-3 shrink-0" />
                    <span className="truncate">{source}</span>
                  </div>
                )}
                {volume != null && (
                  <div className="flex items-center gap-1.5 text-xs text-white/50">
                    <Volume2 className="h-3 w-3 shrink-0" />
                    <div className="flex-1 h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-white/30"
                        style={{ width: `${Math.min((volume / volumeMax) * 100, 100)}%` }}
                      />
                    </div>
                    <span className="text-[10px] tabular-nums">{volume}</span>
                  </div>
                )}
              </div>
            )}

            {!isTall && source && (
              <div className="flex items-center gap-1.5 text-[11px] text-white/40 mt-auto">
                <Radio className="h-3 w-3 shrink-0" />
                <span className="truncate">{source}</span>
              </div>
            )}
          </div>
        )
      ) : (
        <EmptyState
          icon={<Music className="h-5 w-5" />}
          message={t('widget.noMedia', 'Nothing playing')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
