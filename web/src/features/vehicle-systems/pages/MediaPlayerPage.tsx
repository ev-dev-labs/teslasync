import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Music, Disc3, Radio, Bluetooth, Podcast,
  Headphones, Volume2, BarChart3, AlertCircle,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';

import { CardGrid, PageLayout, LayoutCard } from '@/components/layout';
import {
  Badge, DataTable, Text, Caption, type Column,
} from '@/components/ui';

import { TimeStamp } from '@/components/data-display';
import { EmptyState, AlertBanner, Skeleton, QueryError } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  LinearGauge, ChartTooltip, ChartGradient, chartGrid, axisTickSm, CHART_COLORS,
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, EmbeddedChart,
} from '@/components/charts';

import { useMedia, useMediaHistory } from '@/api/hooks/useVehicleSystems';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { getErrorMessage } from '@/lib/errorMessage';
import type { MediaSnapshot } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { deriveDataState } from '@/api/dataState';
import { VehicleSourceContent } from '../components/VehicleSourceContent';
import {
  MediaSlot, MediaStats, finiteReading, playbackProgress,
} from '../components/media-player-modernization';

/* ── Types ─────────────────────────────────────────────────────── */

interface SourceSlice {
  name: string;
  value: number;
  color: string;
}

/* ── Constants ─────────────────────────────────────────────────── */


const VOLUME_FALLBACK_MAX = 11;

/* ── Helpers ───────────────────────────────────────────────────── */

function formatVolumeLevel(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? fmtNumber(value) : '—';
}

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
  if (!s) return t('media.modernization.unknownStatus', 'Unknown status');
  if (s.includes('playing')) return t('media.status.playing', 'Playing');
  if (s.includes('paused')) return t('media.status.paused', 'Paused');
  if (s.includes('stopped')) return t('media.status.stopped', 'Stopped');
  return status;
}

/* ── Component ─────────────────────────────────────────────────── */

export default function MediaPlayerPage() {
  const { fmtNumber, fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('media.title', 'Media player'));

  const { vehicleId } = useSelectedVehicle();
  const activeId = vehicleId != null ? String(vehicleId) : '';
  const hasVehicle = activeId !== '';

  const { start, end } = useRangeState({
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
  const mediaSource = deriveDataState({ ...mediaQuery, data: mediaQuery.data ?? undefined });
  const historySource = deriveDataState(historyQuery, { provenance: 'historical' });
  const anyError = mediaSource.fatalError ?? historySource.fatalError;
  const mediaState = {
    retained: mediaSource.refreshError != null || (mediaSource.hasData && mediaSource.isRefreshBlocked),
    loading: mediaQuery.isLoading && !mediaSource.hasData,
    fatal: mediaSource.fatalError != null,
    available: mediaSource.hasData,
  };
  const historyState = {
    retained: historySource.refreshError != null || (historySource.hasData && historySource.isRefreshBlocked),
    loading: historyQuery.isLoading && !historySource.hasData,
    fatal: historySource.fatalError != null,
    available: historySource.hasData,
  };

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

  /* ── Volume chart data ────────────────────────────────────── */

  const volumeChartData = useMemo(() => {
    if (!filtered.length) return [];
    // Drop snapshots without a volume reading (same predicate as the Avg
    // Volume KPI above): charting a missing field as 0 drew phantom drops to
    // silence that the KPI deliberately excludes.
    return [...filtered]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .filter(
        (s): s is MediaSnapshot & { audio_volume: number } =>
          typeof s.audio_volume === 'number' && Number.isFinite(s.audio_volume),
      )
      .map((s) => ({ time: formatDateTime(s.created_at), volume: s.audio_volume }));
  }, [filtered]);

  /* ── Volume axis ceiling ──────────────────────────────────── */
  // Derive the Y-axis max from the data actually being charted so historical
  // peaks are never clipped when the latest snapshot is missing or reports a
  // smaller max than a past reading. Always at least the fallback so a flat
  // low-volume series still renders against a sensible scale.
  const volumeAxisMax = useMemo(() => {
    const dataMax = volumeChartData.reduce((m, d) => Math.max(m, d.volume ?? 0), 0);
    const knownMax = Math.max(dataMax, finiteReading(latest?.audio_volume_max) ? latest.audio_volume_max : 0);
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
        filterValue: (row) => row.now_playing_title || null,
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
        filterValue: (row) => row.now_playing_artist || null,
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
        filterValue: (row) => row.playback_source || null,
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
        align: 'right',
        filterValue: (row) => row.audio_volume == null ? null : `${row.audio_volume}:${row.audio_volume_max ?? ''}`,
        filterValueLabel: (_value, row) => row.audio_volume == null ? '—' : `${formatVolumeLevel(row.audio_volume)}/${formatVolumeLevel(row.audio_volume_max)}`,
        header: t('media.col.volume', 'Volume'),
        sortable: true,
        render: (row) => (
          <Text as="span" variant="body" className="tabular-nums">
            {formatVolumeLevel(row.audio_volume)}/{formatVolumeLevel(row.audio_volume_max)}
          </Text>
        ),
      },
      {
        key: 'playback_status',
        filterValue: (row) => row.playback_status || null,
        filterValueLabel: (_value, row) => statusLabel(row.playback_status ?? '', t),
        header: t('media.col.status', 'Status'),
        sortable: true,
        render: (row) => (
          <Badge variant={statusVariant(row.playback_status ?? '')} size="sm">
            {statusLabel(row.playback_status ?? '', t)}
          </Badge>
        ),
      },
    ],
    [t, displayPrecision, displayLocale],
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

  const progress = playbackProgress(latest);

  const noVehicleState = (icon: ReactNode, message: string) => (
    <EmptyState /* no-action: awaiting a vehicle selection — no recovery action */
      icon={icon}
      message={message}
    />
  );

  /* ── Render ───────────────────────────────────────────────── */

  return (
    <PageLayout
      title={t('media.title', 'Media player')}
      subtitle={t('media.subtitle', 'Now playing, volume, and listening history')}
      query={[mediaQuery, historyQuery]}
      busy={mediaQuery.isFetching || historyQuery.isFetching}
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" aria-hidden="true" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}
      {(mediaState.retained || historyState.retained) && (
        <Caption role="status">
          {mediaSource.refreshError || historySource.refreshError
            ? t('media.modernization.retained', 'Refresh failed; previously loaded data remains visible for the affected source.')
            : t('dataState.refreshBlocked.message', 'The device is offline, so this section is showing the last values it received.')}
        </Caption>
      )}

      {/* ── Row 1 — Now Playing hero + Volume gauge ──────────── */}
      <FadeIn>
        <section aria-label={t('media.nowPlayingSection', 'Now playing')}>
        <CardGrid label={t('media.nowPlayingSection', 'Now playing')} items={[
          { id: 'media-now-playing', size: 'half', content: <MediaSlot>
          {/* Now Playing — retained metadata in the shared packed layout */}
          <LayoutCard title={t('media.nowPlaying', 'Now playing')}>
            <VehicleSourceContent source={mediaSource} enabled={hasVehicle}
              label={t('media.nowPlaying', 'Now playing')}>
            {!hasVehicle ? (
              noVehicleState(
                <Music className="h-8 w-8" />,
                t('media.selectVehicle', 'Select a vehicle to see what’s playing'),
              )
            ) : mediaQuery.isLoading && !latest ? (
              <div className="flex items-start gap-4 sm:gap-6">
                <div className="h-16 w-16 shrink-0 motion-safe:animate-pulse rounded-xl bg-[var(--surface-3)] sm:h-28 sm:w-28" aria-hidden="true" />
                <div className="flex-1 space-y-3 py-1">
                  <Skeleton width="60%" height={20} />
                  <Skeleton width="40%" height={14} />
                  <Skeleton width="30%" height={12} />
                </div>
              </div>
            ) : mediaState.fatal ? (
              <QueryError
                error={mediaQuery.error}
                onRetry={() => mediaQuery.refetch()}
                resourceName={t('media.resource', 'Media')}
              />
            ) : !latest ? (
              <EmptyState message={t('media.modernization.noSnapshot', 'No media snapshot available')}
                action={{ label: t('common.refresh', 'Refresh'), onClick: () => { void mediaQuery.refetch(); } }} />
            ) : (
              <div className="flex items-start gap-4 sm:gap-6">
                {/* Album-art placeholder */}
                <div
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-2)] sm:h-28 sm:w-28"
                  aria-hidden="true"
                >
                  <Music className="h-8 w-8 text-[var(--text-secondary)] sm:h-12 sm:w-12" />
                </div>

                {/* Track info */}
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Text as="p" size="lg" weight="bold" color="primary" className="break-words">
                      {latest?.now_playing_title || t('media.noTrack', 'No track')}
                    </Text>
                    <Badge variant={statusVariant(latest.playback_status ?? '')} dot>
                      {statusLabel(latest.playback_status ?? '', t)}
                    </Badge>
                  </div>

                  <Text as="p" size="sm" color="secondary" className="break-words">
                    {latest?.now_playing_artist || t('media.unknownArtist', 'Unknown artist')}
                    {latest?.now_playing_album ? ` — ${latest.now_playing_album}` : ''}
                  </Text>

                  {latest?.now_playing_station && (
                    <Text as="p" variant="caption" className="break-words">
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

                  {latest?.now_playing_duration != null || latest?.now_playing_elapsed != null ? (
                    <div
                      className="flex items-center gap-2 pt-1"
                      role={progress ? 'progressbar' : undefined}
                      aria-label={t('media.progress', 'Playback progress')}
                      aria-valuemin={progress ? 0 : undefined}
                      aria-valuemax={progress?.durationSec}
                      aria-valuenow={progress?.elapsedSec}
                    >
                      <Text as="span" variant="caption" className="tabular-nums">
                        {finiteReading(latest.now_playing_elapsed) ? fmtPlayTime(latest.now_playing_elapsed) : '—'}
                      </Text>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--surface-3)]">
                        <div
                          className="h-full rounded-full bg-[var(--theme-primary)] motion-safe:transition-all duration-slow"
                          style={{ width: `${progress?.percent ?? 0}%` }}
                        />
                      </div>
                      <Text as="span" variant="caption" className="tabular-nums">
                        {finiteReading(latest.now_playing_duration) ? fmtPlayTime(latest.now_playing_duration) : '—'}
                      </Text>
                    </div>
                  ) : null}
                  {!progress && (
                    <Caption>{t('media.modernization.progressUnknown', 'Playback progress is unavailable without a reported elapsed time and positive duration.')}</Caption>
                  )}
                </div>
              </div>
            )}
            </VehicleSourceContent>
          </LayoutCard>
          </MediaSlot> },
          { id: 'media-volume', size: 'half', content: <MediaSlot>
          {/* Volume gauge */}
          <LayoutCard title={t('media.volume', 'Volume')}>
            <VehicleSourceContent source={mediaSource} enabled={hasVehicle}
              label={t('media.volume', 'Volume')}>
            {!hasVehicle ? noVehicleState(
              <Volume2 className="h-8 w-8" />,
              t('media.selectVehicle', 'Select a vehicle to see what’s playing'),
            ) : mediaState.loading ? <Skeleton height={128} />
              : mediaState.fatal ? <QueryError error={mediaQuery.error} onRetry={() => mediaQuery.refetch()} />
              : !latest ? <EmptyState message={t('media.modernization.noSnapshot', 'No media snapshot available')}
                action={{ label: t('common.refresh', 'Refresh'), onClick: () => { void mediaQuery.refetch(); } }} />
              : <div className="flex flex-1 flex-col items-center justify-center gap-2 py-2">
              <LinearGauge
                value={latest?.audio_volume}
                max={finiteReading(latest.audio_volume_max) && latest.audio_volume_max > 0 ? latest.audio_volume_max : VOLUME_FALLBACK_MAX}
                label={t('media.volume', 'Volume')}
                unit=""
                tone="primary"
                size={128}
              />
              <Caption className="text-center">
                {t('media.volumeStep', 'Step')}:{' '}
                {finiteReading(latest?.audio_volume_increment)
                  ? fmtNumber(latest.audio_volume_increment)
                  : '—'}
              </Caption>
              <Caption>
                {t('media.modernization.reportedMaximum', 'Reported maximum')}: {formatVolumeLevel(latest.audio_volume_max)}
              </Caption>
              {(!finiteReading(latest.audio_volume_max) || latest.audio_volume_max <= 0) && (
                <Caption>{t('media.modernization.fallbackScale', 'No positive maximum reported; gauge uses the existing fallback scale of 11.')}</Caption>
              )}
            </div>}
            </VehicleSourceContent>
          </LayoutCard>
          </MediaSlot> },
        ]} />
        </section>
      </FadeIn>

      {/* ── Row 2 — KPI band ─────────────────────────────────── */}
      <FadeIn delay={0.05}>
        <div>
        <MediaStats
          historySource={historySource} mediaSource={mediaSource}
          filtered={filtered} history={historyQuery.data} latest={latest}
          hasVehicle={hasVehicle} historyLoading={historyQuery.isLoading}
          mediaLoading={mediaQuery.isLoading} historyError={historyQuery.error}
          mediaError={mediaQuery.error} start={start} end={end}
        />
        </div>
      </FadeIn>

      {/* ── Row 3 — Charts bento ─────────────────────────────── */}
      <FadeIn delay={0.1}>
        <CardGrid label={t('media.chartsSection', 'Media charts')} items={[
          { id: 'media-volume-history', size: 'half', content: <MediaSlot>
          {/* Volume over time — all finite source samples retained */}
          <section aria-label={t('media.volumeOverTime', 'Volume over time')}>
          <LayoutCard title={t('media.volumeOverTime', 'Volume over time')}>
            <VehicleSourceContent source={historySource} enabled={hasVehicle}
              label={t('media.volumeOverTime', 'Volume over time')}>
            {!hasVehicle ? (
              noVehicleState(
                <BarChart3 className="h-8 w-8" />,
                t('media.selectVehicleChart', 'Select a vehicle to view volume history'),
              )
            ) : historyState.loading ? (
              <Skeleton height={256} />
            ) : historyState.fatal ? (
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            ) : volumeChartData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no volume samples in the selected period */
                icon={<BarChart3 className="h-8 w-8" />}
                message={t('media.noVolumeData', 'No volume data for this period')}
              />
            ) : (
              <div className="h-56 sm:h-64 xl:h-72">
                {/* chart-a11y:no-table media volume time-series — continuous audio levels, not tabular */}
                <EmbeddedChart
                  title={t('media.volumeOverTime', 'Volume over time')}
                  ariaLabel={t('media.volumeAria', 'Media volume over time area chart')}
                  fluid
                >
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
                </EmbeddedChart>
              </div>
            )}
            </VehicleSourceContent>
          </LayoutCard>
          </section>
          </MediaSlot> },
          { id: 'media-source-distribution', size: 'half', content: <MediaSlot>
          {/* Source distribution */}
          <LayoutCard title={t('media.sourceDistribution', 'Source distribution')}>
            <VehicleSourceContent source={historySource} enabled={hasVehicle}
              label={t('media.sourceDistribution', 'Source distribution')}>
            {!hasVehicle ? (
              noVehicleState(
                <Disc3 className="h-8 w-8" />,
                t('media.selectVehicleSource', 'Select a vehicle to view sources'),
              )
            ) : historyState.loading ? (
              <Skeleton height={224} />
            ) : historyState.fatal ? (
              <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
            ) : sourceData.length === 0 ? (
              <EmptyState /* no-action: transient empty state — no source data in the selected period */
                icon={<Disc3 className="h-8 w-8" />}
                message={t('media.noSourceData', 'No source data available')}
              />
            ) : (
              <>
                {/* chart-a11y:no-table pie chart with dynamic source names — legend list below chart serves as accessible summary */}
                <div className="h-48 sm:h-56">
                  <EmbeddedChart
                    title={t('media.sourceDistribution', 'Source distribution')}
                    ariaLabel={t('media.sourceAria', 'Pie chart of media source distribution')}
                    fluid
                  >
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
                  </EmbeddedChart>
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
            </VehicleSourceContent>
          </LayoutCard>
          </MediaSlot> },
        ]} />
      </FadeIn>

      {/* ── Row 4 — Playback History (full-width detail band) ── */}
      <FadeIn delay={0.15}>
        <LayoutCard title={t('media.playbackHistory', 'Playback history')}
          actions={<Badge variant="neutral" size="sm">
              {hasVehicle && historyState.available ? fmtInt(filtered.length) : '—'} {t('media.records', 'records')}
            </Badge>}>
          <VehicleSourceContent source={historySource} enabled={hasVehicle}
            label={t('media.playbackHistory', 'Playback history')}>
          {!hasVehicle ? (
            noVehicleState(
              <Music className="h-8 w-8" />,
              t('media.selectVehicleHistory', 'Select a vehicle to view playback history'),
            )
          ) : historyState.loading ? (
            <Skeleton height={320} />
          ) : historyState.fatal ? (
            <QueryError error={historyQuery.error} onRetry={() => historyQuery.refetch()} />
          ) : sortedHistory.length === 0 ? (
            <EmptyState /* no-action: transient empty state — no playback history in the selected period */
              icon={<Music className="h-8 w-8" />}
              message={t('media.noHistory', 'No playback history for this period')}
            />
          ) : (
            <DataTable<MediaSnapshot>
              tableId="vehicle-systems:media-history"
              enableValueFilters
              filterData={history ?? []}
              columns={columns}
              mobileColumns={['now_playing_title', 'playback_status', 'created_at']}
              mobilePresentation={{
                variant: 'cards',
                roles: {
                  now_playing_title: 'title', playback_status: 'badge',
                  created_at: 'meta', now_playing_artist: 'meta',
                  playback_source: 'meta', audio_volume: 'primary',
                },
                displayValue: (row, key) => {
                  if (key === 'created_at') return formatDateTime(row.created_at);
                  if (key === 'audio_volume') return `${formatVolumeLevel(row.audio_volume)}/${formatVolumeLevel(row.audio_volume_max)}`;
                  if (key === 'playback_status') return statusLabel(row.playback_status ?? '', t);
                  const value = row[key as keyof MediaSnapshot];
                  return value != null && value !== '' ? value : '—';
                },
              }}
              caption={t('media.playbackHistory', 'Playback history')}
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
          </VehicleSourceContent>
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
