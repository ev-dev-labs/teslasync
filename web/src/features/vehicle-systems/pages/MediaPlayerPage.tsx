import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card, CardHeader } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { StatCard } from '@/components/data-display/StatCard';
import { useMedia, useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MediaPlayerPage() {
  const { t } = useTranslation();
  const { data: vehicles } = useVehicles();
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const activeId = vehicleId ?? vehicles?.[0]?.id ?? '';

  const { data: current, isLoading, error } = useMedia(activeId);
  const { data: history } = useMediaHistory(activeId);

  const stats = useMemo(() => {
    if (!history?.length) return { uniqueTracks: 0, topSource: '--', avgVolume: 0 };
    const titles = new Set(history.map((h) => h.title).filter(Boolean));
    const sources = history.reduce<Record<string, number>>((acc, h) => {
      if (h.source) acc[h.source] = (acc[h.source] ?? 0) + 1;
      return acc;
    }, {});
    const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--';
    const avgVol = history.reduce((sum, h) => sum + h.volume, 0) / history.length;
    return { uniqueTracks: titles.size, topSource, avgVolume: Math.round(avgVol) };
  }, [history]);

  const isPlaying = current?.playbackStatus?.toLowerCase().includes('playing');

  return (
    <PageContainer
      title={t('Media Player')}
      subtitle={t('Now playing, volume, and listening history')}
      loading={isLoading}
      error={error as Error | null}
      empty={!current}
      emptyMessage={t('No media data available.')}
      actions={
        vehicles && vehicles.length > 1 ? (
          <select
            className="rounded border px-2 py-1 text-sm"
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          >
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.displayName || v.vin}</option>
            ))}
          </select>
        ) : undefined
      }
    >
      <Card>
        <CardHeader
          title={t('Now Playing')}
          action={<Badge variant={isPlaying ? 'success' : 'neutral'}>{isPlaying ? t('Playing') : t('Paused')}</Badge>}
        />
        <div className="space-y-2 px-4 pb-4">
          <p className="text-lg font-semibold truncate">{current?.title || t('No track')}</p>
          <p className="text-sm text-gray-400 truncate">{current?.artist}{current?.album ? ` — ${current.album}` : ''}</p>
          {current?.station && <p className="text-xs text-gray-500">{current.station}</p>}
          {current?.duration ? (
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>{formatTime(current.elapsed)}</span>
              <div className="flex-1 h-1 bg-gray-700 rounded">
                <div
                  className="h-1 bg-cyan-400 rounded"
                  style={{ width: `${(current.elapsed / current.duration) * 100}%` }}
                />
              </div>
              <span>{formatTime(current.duration)}</span>
            </div>
          ) : null}
        </div>
      </Card>

      <Grid cols={{ default: 2, lg: 4 }} gap={4}>
        <StatCard label={t('Volume')} value={`${current?.volume ?? 0}/${current?.volumeMax ?? 11}`} />
        <StatCard label={t('Unique Tracks')} value={stats.uniqueTracks} />
        <StatCard label={t('Top Source')} value={stats.topSource} />
        <StatCard label={t('Avg Volume')} value={stats.avgVolume} />
      </Grid>

      <Card>
        <CardHeader title={t('Playback History')} subtitle={`${history?.length ?? 0} records`} />
        <div className="max-h-64 overflow-y-auto divide-y divide-gray-800">
          {history?.slice(0, 50).map((h) => (
            <div key={h.id} className="flex items-center gap-4 px-3 py-2 text-sm">
              <span className="w-36 text-gray-400 shrink-0">{new Date(h.timestamp).toLocaleString()}</span>
              <span className="flex-1 truncate max-w-[200px]">{h.title || '--'}</span>
              <span className="w-32 truncate shrink-0">{h.artist || '--'}</span>
              <Badge variant="neutral" size="sm">{h.source || '--'}</Badge>
            </div>
          ))}
        </div>
      </Card>
    </PageContainer>
  );
}
