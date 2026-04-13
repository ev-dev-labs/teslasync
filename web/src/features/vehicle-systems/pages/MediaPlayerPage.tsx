import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Music, Disc3, Radio, Bluetooth, Podcast,
  Headphones, Volume2, ListMusic, BarChart3,
} from 'lucide-react';
import clsx from 'clsx';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import { RadialGauge } from '@/components/charts/RadialGauge';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
  ChartGradient, chartGrid, axisTickSm, CHART_COLORS,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { request } from '@/api/client';

/* ── Types ─────────────────────────────────────────────────────── */

interface MediaSnapshot {
  id: number;
  vehicle_id: number;
  playback_status: string;
  playback_source: string;
  now_playing_title: string;
  now_playing_artist: string;
  now_playing_album: string;
  now_playing_station: string;
  now_playing_elapsed: number;
  now_playing_duration: number;
  audio_volume: number;
  audio_volume_max: number;
  created_at: string;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

interface SourceSlice {
  name: string;
  value: number;
  color: string;
}

/* ── Constants ─────────────────────────────────────────────────── */

const TIME_RANGES = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '15d', days: 15 },
  { label: '30d', days: 30 },
  { label: 'All', days: 0 },
] as const;

/* ── Helpers ───────────────────────────────────────────────────── */

function fmtPlayTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function sourceIcon(source: string) {
  const s = (source ?? '').toLowerCase();
  if (s.includes('spotify')) return <Disc3 className="h-4 w-4 text-green-400" />;
  if (s.includes('bluetooth')) return <Bluetooth className="h-4 w-4 text-blue-400" />;
  if (s.includes('radio') || s.includes('fm') || s.includes('am'))
    return <Radio className="h-4 w-4 text-amber-400" />;
  if (s.includes('podcast')) return <Podcast className="h-4 w-4 text-purple-400" />;
  return <Headphones className="h-4 w-4 text-cyan-400" />;
}

function statusVariant(status: string): 'success' | 'warning' | 'neutral' {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) return 'success';
  if (s.includes('paused')) return 'warning';
  return 'neutral';
}

function statusLabel(status: string, t: (k: string) => string): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) return t('Playing');
  if (s.includes('paused')) return t('Paused');
  return t('Stopped');
}

/* ── Component ─────────────────────────────────────────────────── */

export default function MediaPlayerPage() {
  const { t } = useTranslation();
  usePageTitle(t('Media Player'));

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [range, setRange] = useState<number>(7);
  const [tableSortKey, setTableSortKey] = useState('created_at');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  /* ── Queries ──────────────────────────────────────────────── */

  const { data: vehicles } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const activeId = vehicleId ?? (vehicles?.[0] ? String(vehicles[0].id) : '');

  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
  } = useQuery({
    queryKey: ['media', 'latest', activeId],
    queryFn: () => request<MediaSnapshot>(`/media/latest?vehicle_id=${activeId}`),
    enabled: !!activeId,
    refetchInterval: 10_000,
  });

  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ['media', 'history', activeId],
    queryFn: () => request<MediaSnapshot[]>(`/media?vehicle_id=${activeId}&limit=500`),
    enabled: !!activeId,
  });

  const isLoading = latestLoading || historyLoading;

  /* ── Filtered history ─────────────────────────────────────── */

  const filtered = useMemo(() => {
    if (!history?.length) return [];
    if (range === 0) return history;
    const cutoff = Date.now() - range * 86_400_000;
    return history.filter((s) => new Date(s.created_at).getTime() >= cutoff);
  }, [history, range]);

  /* ── Derived stats ────────────────────────────────────────── */

  const stats = useMemo(() => {
    if (!filtered.length)
      return { uniqueTracks: 0, topSource: '--', avgVolume: 0 };

    const titles = new Set(
      filtered.map((s) => s.now_playing_title).filter(Boolean),
    );

    const sources = filtered.reduce<Record<string, number>>((acc, s) => {
      if (s.playback_source)
        acc[s.playback_source] = (acc[s.playback_source] ?? 0) + 1;
      return acc;
    }, {});

    const topSource =
      Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '--';

    const avgVol =
      filtered.reduce((sum, s) => sum + s.audio_volume, 0) / filtered.length;

    return { uniqueTracks: titles.size, topSource, avgVolume: Math.round(avgVol) };
  }, [filtered]);

  /* ── Volume chart data ────────────────────────────────────── */

  const volumeChartData = useMemo(() => {
    if (!filtered.length) return [];
    const sorted = [...filtered].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
    return sorted.map((s) => ({
      time: formatDateTime(s.created_at),
      volume: s.audio_volume,
    }));
  }, [filtered]);

  /* ── Source distribution ──────────────────────────────────── */

  const sourceData = useMemo<SourceSlice[]>(() => {
    if (!filtered.length) return [];
    const counts = filtered.reduce<Record<string, number>>((acc, s) => {
      const src = s.playback_source || 'Unknown';
      acc[src] = (acc[src] ?? 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], i) => ({
        name,
        value,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
  }, [filtered]);

  /* ── Table columns ────────────────────────────────────────── */

  const columns = useMemo<Column<MediaSnapshot>[]>(
    () => [
      {
        key: 'created_at',
        header: t('Time'),
        sortable: true,
        render: (row) => (
          <span className="text-gray-400 text-xs whitespace-nowrap">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        key: 'now_playing_title',
        header: t('Track'),
        sortable: true,
        render: (row) => (
          <span className="truncate max-w-[200px] block font-medium text-white">
            {row.now_playing_title || '--'}
          </span>
        ),
      },
      {
        key: 'now_playing_artist',
        header: t('Artist'),
        sortable: true,
        render: (row) => (
          <span className="truncate max-w-[160px] block text-gray-300">
            {row.now_playing_artist || '--'}
          </span>
        ),
      },
      {
        key: 'playback_source',
        header: t('Source'),
        sortable: true,
        render: (row) => (
          <span className="flex items-center gap-1.5">
            {sourceIcon(row.playback_source)}
            <span className="text-gray-300">{row.playback_source || '--'}</span>
          </span>
        ),
      },
      {
        key: 'audio_volume',
        header: t('Volume'),
        sortable: true,
        render: (row) => (
          <span className="text-cyan-400">
            {row.audio_volume}/{row.audio_volume_max}
          </span>
        ),
      },
      {
        key: 'playback_status',
        header: t('Status'),
        sortable: true,
        render: (row) => (
          <Badge variant={statusVariant(row.playback_status)} size="sm">
            {statusLabel(row.playback_status, t)}
          </Badge>
        ),
      },
    ],
    [t],
  );

  /* ── Table sort handler ───────────────────────────────────── */

  const handleSort = (key: string) => {
    if (key === tableSortKey) {
      setTableSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setTableSortKey(key);
      setTableSortDir('desc');
    }
  };

  const sortedHistory = useMemo(() => {
    const data = [...filtered];
    data.sort((a, b) => {
      const aVal = a[tableSortKey as keyof MediaSnapshot];
      const bVal = b[tableSortKey as keyof MediaSnapshot];
      if (typeof aVal === 'number' && typeof bVal === 'number')
        return tableSortDir === 'asc' ? aVal - bVal : bVal - aVal;
      const aStr = String(aVal ?? '');
      const bStr = String(bVal ?? '');
      return tableSortDir === 'asc'
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
    return data;
  }, [filtered, tableSortKey, tableSortDir]);

  /* ── Derived state ────────────────────────────────────────── */

  const isPlaying = latest?.playback_status?.toLowerCase().includes('playing');
  const progressPct =
    latest?.now_playing_duration && latest.now_playing_duration > 0
      ? (latest.now_playing_elapsed / latest.now_playing_duration) * 100
      : 0;

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('Media Player')}
      subtitle={t('Now playing, volume, and listening history')}
      loading={isLoading}
      error={latestError as Error | null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicles.map((v) => ({
              value: String(v.id),
              label: v.display_name || v.vin,
            }))}
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {/* ── Time range selector ──────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        {TIME_RANGES.map((tr) => (
          <Button
            key={tr.label}
            variant={range === tr.days ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setRange(tr.days)}
          >
            {t(tr.label)}
          </Button>
        ))}
      </div>

      {/* ── Now Playing card ─────────────────────────────────── */}
      <FadeIn>
        <GlassPanel glow={isPlaying ? 'cyan' : 'none'} className="p-6">
          <div className="flex items-start gap-6">
            {/* Album art placeholder */}
            <div
              className={clsx(
                'flex h-28 w-28 shrink-0 items-center justify-center rounded-xl bg-gray-800/60',
                isPlaying && 'animate-pulse',
              )}
            >
              <Music className="h-12 w-12 text-cyan-400/60" />
            </div>

            {/* Track info */}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-white truncate">
                  {latest?.now_playing_title || t('No track')}
                </h2>
                {latest?.playback_status && (
                  <Badge
                    variant={statusVariant(latest.playback_status)}
                    dot
                  >
                    {statusLabel(latest.playback_status, t)}
                  </Badge>
                )}
              </div>

              <p className="text-sm text-gray-400 truncate">
                {latest?.now_playing_artist || t('Unknown artist')}
                {latest?.now_playing_album
                  ? ` — ${latest.now_playing_album}`
                  : ''}
              </p>

              {latest?.now_playing_station && (
                <p className="text-xs text-gray-500 truncate">
                  {latest.now_playing_station}
                </p>
              )}

              {/* Source */}
              {latest?.playback_source && (
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  {sourceIcon(latest.playback_source)}
                  <span>{latest.playback_source}</span>
                </div>
              )}

              {/* Progress bar */}
              {latest?.now_playing_duration ? (
                <div className="flex items-center gap-2 text-xs text-gray-400 pt-1">
                  <span className="tabular-nums">
                    {fmtPlayTime(latest.now_playing_elapsed)}
                  </span>
                  <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-cyan-400 rounded-full transition-all duration-500"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <span className="tabular-nums">
                    {fmtPlayTime(latest.now_playing_duration)}
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </GlassPanel>
      </FadeIn>

      {/* ── Volume + Stats row ───────────────────────────────── */}
      <FadeIn delay={100}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <GlassPanel className="flex items-center justify-center p-4">
            <RadialGauge
              value={latest?.audio_volume ?? 0}
              max={latest?.audio_volume_max || 11}
              label={t('Volume')}
              unit=""
              color={CHART_COLORS[0]}
              size={120}
            />
          </GlassPanel>

          <MetricCard
            label={t('Unique Tracks')}
            value={stats.uniqueTracks}
            icon={<ListMusic className="h-5 w-5" />}
            color="purple"
          />

          <MetricCard
            label={t('Top Source')}
            value={stats.topSource}
            icon={<Radio className="h-5 w-5" />}
            color="green"
          />

          <MetricCard
            label={t('Avg Volume')}
            value={stats.avgVolume}
            icon={<Volume2 className="h-5 w-5" />}
            color="cyan"
          />
        </div>
      </FadeIn>

      {/* ── Charts row ───────────────────────────────────────── */}
      <FadeIn delay={200}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Volume over Time */}
          <GlassPanel className="p-4 lg:col-span-2">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Volume2 className="h-4 w-4 text-cyan-400" />
              {t('Volume over Time')}
            </h3>
            {volumeChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={volumeChartData}>
                  <defs>
                    <ChartGradient id="volGrad" color={CHART_COLORS[0]} />
                  </defs>
                  <CartesianGrid {...chartGrid} />
                  <XAxis dataKey="time" {...axisTickSm} />
                  <YAxis
                    {...axisTickSm}
                    domain={[0, latest?.audio_volume_max ?? 11]}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Area
                    type="monotone"
                    dataKey="volume"
                    name={t('Volume')}
                    stroke={CHART_COLORS[0]}
                    fill="url(#volGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState
                icon={<BarChart3 className="h-8 w-8 text-gray-600" />}
                message={t('No volume data for this period')}
              />
            )}
          </GlassPanel>

          {/* Source Distribution */}
          <GlassPanel className="p-4">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
              <Disc3 className="h-4 w-4 text-purple-400" />
              {t('Source Distribution')}
            </h3>
            {sourceData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie
                      data={sourceData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={3}
                      strokeWidth={0}
                    >
                      {sourceData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  {sourceData.map((s) => (
                    <span key={s.name} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: s.color }}
                      />
                      <span className="text-gray-300">{s.name}</span>
                      <span className="text-gray-500">({s.value})</span>
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState
                icon={<Disc3 className="h-8 w-8 text-gray-600" />}
                message={t('No source data available')}
              />
            )}
          </GlassPanel>
        </div>
      </FadeIn>

      {/* ── Playback History table ───────────────────────────── */}
      <FadeIn delay={300}>
        <GlassPanel className="p-4">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <ListMusic className="h-4 w-4 text-cyan-400" />
            {t('Playback History')}
            <Badge variant="neutral" size="sm" className="ml-auto">
              {filtered.length} {t('records')}
            </Badge>
          </h3>
          {sortedHistory.length > 0 ? (
            <DataTable<MediaSnapshot>
              columns={columns}
              data={sortedHistory}
              keyExtractor={(row) => row.id}
              sortKey={tableSortKey}
              sortDir={tableSortDir}
              onSort={handleSort}
              emptyMessage={t('No playback history')}
              compact
            />
          ) : (
            <EmptyState
              icon={<Music className="h-8 w-8 text-gray-600" />}
              message={t('No playback history for this period')}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
