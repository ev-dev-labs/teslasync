import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Music, Disc3, Radio, Bluetooth, Podcast,
  Headphones, Volume2, ListMusic, BarChart3, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel, Badge, DataTable, PanelTitle, Text, Caption, type Column,
} from '@/components/ui';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { MetricCard, TimeStamp } from '@/components/data-display';
import { EmptyState, AlertBanner, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  RadialGauge, ChartTooltip, ChartGradient, chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from '@/components/charts';

import { useMedia, useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtInt, fmtNumber } from '@/lib/numberFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import type { MediaSnapshot } from '@/api/types';

/* ── Types ─────────────────────────────────────────────────────── */

interface SourceSlice {
  name: string;
  value: number;
  color: string;
}

/* ── Constants ─────────────────────────────────────────────────── */

const PRESET_IDS = ['today', '7d', '30d', '90d', 'mtd', 'ytd', 'all'];
const VOLUME_FALLBACK_MAX = 11;

/* ── Helpers ───────────────────────────────────────────────────── */

/** Milliseconds → `m:ss` play-time label. Non-finite/negative input clamps to
 *  `0:00` so a malformed elapsed/duration never renders `-1:-01`. */
function fmtPlayTime(ms: number): string {
  const safeMs = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSec = Math.floor(safeMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Source → toned accent icon. Decorative — the adjacent text carries meaning. */
function SourceIcon({ source }: { source: string }) {
  const s = (source ?? '').toLowerCase();
  const base = 'h-4 w-4';
  if (s.includes('spotify')) return <Disc3 className={cn(base, 'text-emerald-300')} aria-hidden="true" />;
  if (s.includes('bluetooth')) return <Bluetooth className={cn(base, 'text-indigo-300')} aria-hidden="true" />;
  if (s.includes('radio') || s.includes('fm') || s.includes('am'))
    return <Radio className={cn(base, 'text-amber-300')} aria-hidden="true" />;
  if (s.includes('podcast')) return <Podcast className={cn(base, 'text-purple-300')} aria-hidden="true" />;
  return <Headphones className={cn(base, 'text-cyan-300')} aria-hidden="true" />;
}

function statusVariant(status: string): 'success' | 'warning' | 'neutral' {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) return 'success';
  if (s.includes('paused')) return 'warning';
  return 'neutral';
}

function statusLabel(status: string, t: TFunction): string {
  const s = (status ?? '').toLowerCase();
  if (s.includes('playing')) return t('media.status.playing', 'Playing');
  if (s.includes('paused')) return t('media.status.paused', 'Paused');
  return t('media.status.stopped', 'Stopped');
}

/* ── Component ─────────────────────────────────────────────────── */

export default function MediaPlayerPage() {
  const { t } = useTranslation();
  usePageTitle(t('media.title', 'Media Player'));

  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const hasVehicle = activeId !== '';

  const { start, end, setRange } = useRangeState({
    persistKey: 'media-player.range',
    defaultPresetId: '7d',
  });

  const [tableSortKey, setTableSortKey] = useState<string>('created_at');
  const [tableSortDir, setTableSortDir] = useState<'asc' | 'desc'>('desc');

  /* ── Queries (via @/api/hooks) ────────────────────────────── */

  const mediaQuery = useMedia(activeId);
  const historyQuery = useMediaHistory(activeId, { start, end });

  const latest = mediaQuery.data ?? null;
  const history = historyQuery.data ?? [];
  const anyError = mediaQuery.error ?? historyQuery.error ?? null;

  /* ── Filtered history (client-side range guard) ───────────── */

  const filtered = useMemo<MediaSnapshot[]>(() => {
    if (!history.length) return [];
    const startMs = new Date(`${start}T00:00:00`).getTime();
    const endMs = new Date(`${end}T23:59:59.999`).getTime();
    return history.filter((s) => {
      const ts = new Date(s.created_at).getTime();
      return Number.isNaN(ts) ? true : ts >= startMs && ts <= endMs;
    });
  }, [history, start, end]);

  /* ── Derived stats ────────────────────────────────────────── */

  const stats = useMemo(() => {
    if (!filtered.length) return { uniqueTracks: 0, topSource: '—', avgVolume: 0 };

    const titles = new Set(filtered.map((s) => s.now_playing_title).filter(Boolean));

    const sources = filtered.reduce<Record<string, number>>((acc, s) => {
      if (s.playback_source) acc[s.playback_source] = (acc[s.playback_source] ?? 0) + 1;
      return acc;
    }, {});

    const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';

    // Average only snapshots that actually carry a volume reading. Treating a
    // missing `audio_volume` as 0 (the old behaviour) dragged the mean down and
    // reported a dishonest "Avg Volume" whenever some rows lacked the field.
    const volumes = filtered
      .map((s) => s.audio_volume)
      .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    const avgVolume = volumes.length
      ? volumes.reduce((sum, v) => sum + v, 0) / volumes.length
      : 0;

    return { uniqueTracks: titles.size, topSource, avgVolume };
  }, [filtered]);

  /* ── Volume chart data ────────────────────────────────────── */

  const volumeChartData = useMemo(() => {
    if (!filtered.length) return [];
    return [...filtered]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((s) => ({ time: formatDateTime(s.created_at), volume: s.audio_volume ?? 0 }));
  }, [filtered]);

  /* ── Volume axis ceiling ──────────────────────────────────── */
  // Derive the Y-axis max from the data actually being charted so historical
  // peaks are never clipped when the latest snapshot is missing or reports a
  // smaller max than a past reading. Always at least the fallback so a flat
  // low-volume series still renders against a sensible scale.
  const volumeAxisMax = useMemo(() => {
    const dataMax = volumeChartData.reduce((m, d) => Math.max(m, d.volume ?? 0), 0);
    const knownMax = Math.max(dataMax, latest?.audio_volume_max ?? 0);
    return knownMax > 0 ? knownMax : VOLUME_FALLBACK_MAX;
  }, [volumeChartData, latest?.audio_volume_max]);

  /* ── Source distribution ──────────────────────────────────── */

  const sourceData = useMemo<SourceSlice[]>(() => {
    if (!filtered.length) return [];
    const counts = filtered.reduce<Record<string, number>>((acc, s) => {
      const src = s.playback_source || t('media.unknownSource', 'Unknown');
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
  }, [filtered, t]);

  /* ── Table columns ────────────────────────────────────────── */

  const columns = useMemo<Column<MediaSnapshot>[]>(
    () => [
      {
        key: 'created_at',
        header: t('media.col.time', 'Time'),
        sortable: true,
        render: (row) => (
          <TimeStamp
            value={row.created_at}
            className={cn('whitespace-nowrap', typography.size.xs, typography.color.secondary)}
          />
        ),
      },
      {
        key: 'now_playing_title',
        header: t('media.col.track', 'Track'),
        sortable: true,
        render: (row) => (
          <Text as="span" size="sm" weight="medium" color="primary" className="block max-w-[200px] truncate">
            {row.now_playing_title || '—'}
          </Text>
        ),
      },
      {
        key: 'now_playing_artist',
        header: t('media.col.artist', 'Artist'),
        sortable: true,
        render: (row) => (
          <Text as="span" size="sm" color="secondary" className="block max-w-[160px] truncate">
            {row.now_playing_artist || '—'}
          </Text>
        ),
      },
      {
        key: 'playback_source',
        header: t('media.col.source', 'Source'),
        sortable: true,
        render: (row) => (
          <span className="flex items-center gap-1.5">
            <SourceIcon source={row.playback_source ?? ''} />
            <Text as="span" size="sm" color="secondary">
              {row.playback_source || '—'}
            </Text>
          </span>
        ),
      },
      {
        key: 'audio_volume',
        header: t('media.col.volume', 'Volume'),
        sortable: true,
        render: (row) => (
          <Text as="span" variant="body" className="tabular-nums text-cyan-300">
            {row.audio_volume ?? '—'}/{row.audio_volume_max ?? '—'}
          </Text>
        ),
      },
      {
        key: 'playback_status',
        header: t('media.col.status', 'Status'),
        sortable: true,
        render: (row) => (
          <Badge variant={statusVariant(row.playback_status ?? '')} size="sm">
            {statusLabel(row.playback_status ?? '', t)}
          </Badge>
        ),
      },
    ],
    [t],
  );

  /* ── Sorting ──────────────────────────────────────────────── */

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
      return tableSortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return data;
  }, [filtered, tableSortKey, tableSortDir]);

  /* ── Derived play state ───────────────────────────────────── */

  const isPlaying = (latest?.playback_status ?? '').toLowerCase().includes('playing');
  const progressPct =
    latest?.now_playing_duration && latest.now_playing_duration > 0
      ? Math.min(100, ((latest.now_playing_elapsed ?? 0) / latest.now_playing_duration) * 100)
      : 0;

  // Clamped seconds for the progressbar aria values so a negative or
  // overrun elapsed can never report a value outside [0, duration].
  const durationSec = latest?.now_playing_duration ? Math.round(latest.now_playing_duration / 1000) : 0;
  const elapsedSec = Math.min(
    durationSec,
    Math.max(0, Math.round((latest?.now_playing_elapsed ?? 0) / 1000)),
  );

  const noVehicleState = (icon: ReactNode, message: string) => (
    <EmptyState /* no-action: awaiting a vehicle selection — no recovery action */
      icon={icon}
      message={message}
    />
  );

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <PageContainer
      title={t('media.title', 'Media Player')}
      subtitle={t('media.subtitle', 'Now playing, volume, and listening history')}
      query={[mediaQuery, historyQuery]}
      actions={
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <VehicleSelect />
          <RangePicker
            value={{ start, end }}
            onChange={(r) => setRange(r)}
            presetIds={PRESET_IDS}
            align="end"
            triggerTestId="media-player-range"
          />
        </div>
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ── Row 1 — Now Playing hero + Volume gauge ──────────── */}
      <FadeIn>
        <section
          aria-label={t('media.nowPlayingSection', 'Now playing')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          {/* Now Playing — hero, spans two columns on wide screens */}
          <GlassPanel
            glow="cyan"
            hover
            className={cn('p-4 sm:p-5 xl:col-span-2', isPlaying && 'ring-1 ring-cyan-400/20')}
          >
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Music className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('media.nowPlaying', 'Now Playing')}
            </PanelTitle>

            {!hasVehicle ? (
              noVehicleState(
                <Music className="h-8 w-8" />,
                t('media.selectVehicle', 'Select a vehicle to see what’s playing'),
              )
            ) : mediaQuery.isLoading && !latest ? (
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="h-24 w-24 shrink-0 animate-pulse rounded-xl bg-white/[0.05] sm:h-28 sm:w-28" aria-hidden="true" />
                <div className="flex-1 space-y-3 py-1">
                  <Skeleton width="60%" height={20} />
                  <Skeleton width="40%" height={14} />
                  <Skeleton width="30%" height={12} />
                </div>
              </div>
            ) : mediaQuery.error ? (
              <QueryError
                error={mediaQuery.error}
                onRetry={() => mediaQuery.refetch()}
                resourceName={t('media.resource', 'Media')}
              />
            ) : (
              <div className="flex items-start gap-4 sm:gap-6">
                {/* Album-art placeholder */}
                <div
                  className={cn(
                    'flex h-24 w-24 shrink-0 items-center justify-center rounded-xl bg-white/[0.04] sm:h-28 sm:w-28',
                    isPlaying && 'animate-pulse',
                  )}
                  aria-hidden="true"
                >
                  <Music className="h-10 w-10 text-cyan-300/70 sm:h-12 sm:w-12" />
                </div>

                {/* Track info */}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="p" size="lg" weight="bold" color="primary" className="truncate">
                      {latest?.now_playing_title || t('media.noTrack', 'No track')}
                    </Text>
                    {latest?.playback_status && (
                      <Badge variant={statusVariant(latest.playback_status)} dot>
                        {statusLabel(latest.playback_status, t)}
                      </Badge>
                    )}
                  </div>

                  <Text as="p" size="sm" color="secondary" className="truncate">
                    {latest?.now_playing_artist || t('media.unknownArtist', 'Unknown artist')}
                    {latest?.now_playing_album ? ` — ${latest.now_playing_album}` : ''}
                  </Text>

                  {latest?.now_playing_station && (
                    <Text as="p" variant="caption" className="truncate">
                      {latest.now_playing_station}
                    </Text>
                  )}

                  {latest?.playback_source && (
                    <div className="flex items-center gap-1.5">
                      <SourceIcon source={latest.playback_source} />
                      <Text as="span" variant="bodySm">
                        {latest.playback_source}
                      </Text>
                    </div>
                  )}

                  {latest?.now_playing_duration ? (
                    <div
                      className="flex items-center gap-2 pt-1"
                      role="progressbar"
                      aria-label={t('media.progress', 'Playback progress')}
                      aria-valuemin={0}
                      aria-valuemax={durationSec}
                      aria-valuenow={elapsedSec}
                    >
                      <Text as="span" variant="caption" className="tabular-nums">
                        {fmtPlayTime(latest.now_playing_elapsed ?? 0)}
                      </Text>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full bg-cyan-400 transition-all duration-slow"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <Text as="span" variant="caption" className="tabular-nums">
                        {fmtPlayTime(latest.now_playing_duration)}
                      </Text>
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </GlassPanel>

          {/* Volume gauge */}
          <GlassPanel className="flex flex-col p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('media.volume', 'Volume')}
            </PanelTitle>
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2">
              <RadialGauge
                value={latest?.audio_volume ?? 0}
                max={latest?.audio_volume_max || VOLUME_FALLBACK_MAX}
                label={t('media.volume', 'Volume')}
                unit=""
                color={CHART_COLORS[0]}
                size={128}
              />
              <Caption className="text-center">
                {t('media.volumeStep', 'Step')}:{' '}
                {latest?.audio_volume_increment != null
                  ? fmtNumber(latest.audio_volume_increment, 2)
                  : '—'}
              </Caption>
            </div>
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Row 2 — KPI band ─────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('media.statsSection', 'Listening stats')}
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          <MetricCard
            label={t('media.uniqueTracks', 'Unique Tracks')}
            value={stats.uniqueTracks}
            icon={<ListMusic className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
          <MetricCard
            label={t('media.topSource', 'Top Source')}
            value={stats.topSource}
            icon={<Radio className="h-5 w-5" aria-hidden="true" />}
            color="green"
          />
          <MetricCard
            label={t('media.avgVolume', 'Avg Volume')}
            value={fmtInt(stats.avgVolume)}
            icon={<Volume2 className="h-5 w-5" aria-hidden="true" />}
            color="cyan"
          />
          <MetricCard
            label={t('media.volumeStepFull', 'Volume Step')}
            value={
              latest?.audio_volume_increment != null
                ? fmtNumber(latest.audio_volume_increment, 2)
                : '—'
            }
            icon={<Volume2 className="h-5 w-5" aria-hidden="true" />}
            color="purple"
          />
        </section>
      </FadeIn>

      {/* ── Row 3 — Charts bento ─────────────────────────────── */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('media.chartsSection', 'Media charts')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5"
        >
          {/* Volume over time — hero chart, spans two columns */}
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Volume2 className="h-4 w-4 text-cyan-300" aria-hidden="true" />
              {t('media.volumeOverTime', 'Volume over Time')}
            </PanelTitle>
            {!hasVehicle ? (
              noVehicleState(
                <BarChart3 className="h-8 w-8" />,
                t('media.selectVehicleChart', 'Select a vehicle to view volume history'),
              )
            ) : historyQuery.isLoading ? (
              <Skeleton height={256} />
            ) : historyQuery.error ? (
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            ) : volumeChartData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no volume samples in the selected period */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('media.noVolumeData', 'No volume data for this period')}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={volumeChartData}>
                    <defs>
                      <ChartGradient id="volGrad" color={CHART_COLORS[0]} />
                    </defs>
                    <CartesianGrid {...chartGrid} />
                    <XAxis dataKey="time" {...axisTickSm} />
                    <YAxis
                      {...axisTickSm}
                      allowDecimals={false}
                      domain={[0, volumeAxisMax]}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="volume"
                      name={t('media.volume', 'Volume')}
                      stroke={CHART_COLORS[0]}
                      fill="url(#volGrad)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </GlassPanel>

          {/* Source distribution */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3 flex items-center gap-2">
              <Disc3 className="h-4 w-4 text-purple-300" aria-hidden="true" />
              {t('media.sourceDistribution', 'Source Distribution')}
            </PanelTitle>
            {!hasVehicle ? (
              noVehicleState(
                <Disc3 className="h-8 w-8" />,
                t('media.selectVehicleSource', 'Select a vehicle to view sources'),
              )
            ) : historyQuery.isLoading ? (
              <Skeleton height={224} />
            ) : historyQuery.error ? (
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            ) : sourceData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no source data in the selected period */
                icon={<Disc3 className="h-8 w-8" />}
                message={t('media.noSourceData', 'No source data available')}
              />
            ) : (
              <>
                <div className="h-48 sm:h-56">
                  <ResponsiveContainer width="100%" height="100%">
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
                </div>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                  {sourceData.map((s) => (
                    <li key={s.name} className="flex items-center gap-1.5">
                      <span
                        className="inline-block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: s.color }}
                        aria-hidden="true"
                      />
                      <Text as="span" variant="bodySm">
                        {s.name}
                      </Text>
                      <Caption>({fmtInt(s.value)})</Caption>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Row 4 — Playback History (full-width detail band) ── */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <ListMusic className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('media.playbackHistory', 'Playback History')}
            <Badge variant="neutral" size="sm" className="ml-auto">
              {fmtInt(filtered.length)} {t('media.records', 'records')}
            </Badge>
          </PanelTitle>
          {!hasVehicle ? (
            noVehicleState(
              <Music className="h-8 w-8" />,
              t('media.selectVehicleHistory', 'Select a vehicle to view playback history'),
            )
          ) : historyQuery.isLoading ? (
            <Skeleton height={320} />
          ) : historyQuery.error ? (
            <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState /* no-action: transient empty state — no playback history in the selected period */
              icon={<Music className="h-8 w-8" />}
              message={t('media.noHistory', 'No playback history for this period')}
            />
          ) : (
            <DataTable<MediaSnapshot>
              tableId="vehicle-systems:media-history"
              columns={columns}
              data={sortedHistory}
              keyExtractor={(row) => row.id}
              sortKey={tableSortKey}
              sortDir={tableSortDir}
              onSort={handleSort}
              emptyMessage={t('media.noHistoryShort', 'No playback history')}
              compact
              pagination
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
