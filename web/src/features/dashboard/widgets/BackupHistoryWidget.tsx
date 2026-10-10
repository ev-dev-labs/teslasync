import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryFull, Zap } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useTeslaBackupHistory, useTeslaEnergySites } from '@/api/hooks/useEnergy';

import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { safeArray } from '@/lib/safeArray';
import { fmtInt as formatDurationNumber, isFiniteNumber } from '@/lib/numberFormat';
import { WidgetEventFeed } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';

/** Format seconds into human-readable duration (e.g. "2h 15m", "45m", "30s"). */
export function fmtDuration(seconds: number | null | undefined): string {
  if (!isFiniteNumber(seconds) || seconds < 0) return '—';
  // Round to whole seconds *before* the sub-minute check so a value like
  // 59.6s reads as "1m" rather than the nonsensical "60s".
  const total = Math.round(seconds);
  if (total < 60) return `${formatDurationNumber(total)}s`;
  const mins = Math.floor(total / 60);
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  if (hrs > 0) return remainMins > 0 ? `${formatDurationNumber(hrs)}h ${formatDurationNumber(remainMins)}m` : `${formatDurationNumber(hrs)}h`;
  return `${formatDurationNumber(mins)}m`;
}

/** 30 days ago in ISO date form (YYYY-MM-DD). */
export function thirtyDaysAgo(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

/** Parse an event timestamp to epoch ms, treating missing/invalid as 0. */
function toTime(ts?: string): number {
  const t = new Date(ts ?? 0).getTime();
  return Number.isFinite(t) ? t : 0;
}

export default function BackupHistoryWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateTime: fmtEventTime } = useDateFormat();

  // ── Energy sites (to get siteId) ──
  const sitesQuery = useTeslaEnergySites();
  const {
    data: sites,
    isLoading: sitesLoading,
    isFetching: sitesFetching,
    isStale: sitesStale,
    isError: sitesIsError,
    dataUpdatedAt: sitesUpdatedAt,
    refetch: refetchSites,
  } = sitesQuery;

  const rawSiteId = safeArray(sites)[0]?.energy_site_id;
  const siteId = rawSiteId != null && Number.isSafeInteger(rawSiteId) && rawSiteId > 0 ? rawSiteId : undefined;
  const sitesState = useDataState(sitesQuery);

  // ── Backup history (30 days) ──
  const since = useMemo(() => thirtyDaysAgo(), []);

  const eventsQuery = useTeslaBackupHistory(siteId, since);
  const {
    data: events,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsIsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = eventsQuery;
  const items = useMemo(() => safeArray(events), [events]);
  const eventsState = useDataState(eventsQuery, {
    partial: events !== undefined && (
      !Array.isArray(events) || items.some(event => !isFiniteNumber(event.duration_seconds) || event.duration_seconds < 0)
    ),
  });

  // ── Combined freshness props ──
  const isLoading = sitesLoading || (!!siteId && eventsLoading);
  const isFetching = sitesFetching || eventsFetching;
  const isStale = sitesStale || eventsStale;
  const isError = sitesIsError || eventsIsError;
  const updatedAt = eventsState.hasData && eventsUpdatedAt > 0
    ? Math.min(eventsUpdatedAt, sitesState.updatedAt ?? eventsUpdatedAt)
    : sitesUpdatedAt ?? 0;

  const handleRefresh = () => {
    void refetchSites();
    if (siteId) void refetchEvents();
  };
  const dataState = siteId ? {
    ...eventsState,
    status: eventsState.status === 'ok' && sitesState.refreshError ? 'partial' as const : eventsState.status,
    refreshError: eventsState.refreshError ?? sitesState.refreshError,
    retry: handleRefresh,
  } : sitesState;

  // ── Derived stats ──
  const totalOutages = items.length;

  const avgDurationSec = useMemo(() => {
    if (items.length === 0 || items.some(event => !isFiniteNumber(event.duration_seconds) || event.duration_seconds < 0)) return null;
    const totalSec = items.reduce((sum, ev) => sum + ev.duration_seconds, 0);
    return Number.isFinite(totalSec) ? totalSec / items.length : null;
  }, [items]);
  const emptyMessage = Array.isArray(events)
    ? t('widget.backupHistory.noEvents', 'No backup events in the last 30 days')
    : t('widget.emptyMessage', 'This widget has no qualifying data yet.');

  const isCompact = size.cols <= 1;
  const maxEvents = isCompact ? 3 : 10;

  const sortedItems = useMemo(
    () =>
      [...items]
        .sort((a, b) => toTime(b.timestamp) - toTime(a.timestamp))
        .slice(0, maxEvents),
    [items, maxEvents],
  );
  const feedItems = useMemo(() => sortedItems.map((event) => ({
    id: event.id,
    icon: <Zap aria-hidden className="h-3.5 w-3.5" />,
    title: t('widget.backupHistory.duration', 'Duration'),
    subtitle: isCompact ? undefined : `${t('widget.backupHistory.duration', 'Duration')}: ${fmtDuration(event.duration_seconds)}`,
    timestamp: event.timestamp ?? '',
    timeLabel: fmtEventTime(event.timestamp ?? ''),
    color: '#fbbf24',
    badges: <Badge variant="neutral">{fmtDuration(event.duration_seconds)}</Badge>,
    wrap: true,
  })), [sortedItems, isCompact, t, fmtEventTime]);

  // ── No energy sites linked ──
  if (!siteId && !isLoading) {
    return (
      <WidgetShell
        title={t('widget.backupHistory.title', 'Backup history')}
        loading={false}
        dataState={dataState}
        updatedAt={sitesUpdatedAt}
        isFetching={sitesFetching}
        isStale={sitesStale}
        isError={sitesIsError}
        onRefresh={() => refetchSites()}
      >
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryFull className="h-5 w-5" />}
          message={t('widget.backupHistory.noSite', 'No Tesla energy site linked')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  // ── One source summary for compact (1-col) and standard (2×4+) layouts ──
  // The metrics describe all returned events, never only the capped preview.
  // Empty history measures a zero count, but has no duration operands.
  // WidgetShell withholds this content during initial loading/fatal failure.
  return (
    <WidgetShell
      title={t('widget.backupHistory.title', 'Backup history')}
      icon={isCompact ? undefined : <BatteryFull className="h-3.5 w-3.5 text-emerald-400" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={updatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      <DashboardSourceBrief
        metrics={[
          { metricId: 'count', rawValue: Array.isArray(events) ? totalOutages : null, label: t('widget.backupHistory.outages30d', 'Outages (30d)'), description: t('widget.backupHistory.countDescription', 'Count of returned backup events; an absent or malformed event array is not zero.') },
          { metricId: 'duration', rawValue: avgDurationSec, label: t('widget.backupHistory.avgDuration', 'Avg duration'), description: t('widget.backupHistory.durationDescription', 'Mean of valid non-negative event durations in seconds; missing duration operands leave the mean unknown.'), display: { formatter: raw => ({ value: fmtDuration(Number(raw)), unit: '' }) } },
        ]}
        state={dataState} eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
        title={t('widget.backupHistory.summaryTitle', 'Backup event sources')}
        description={t('widget.backupHistory.summaryDescription', 'Energy-site discovery and backup events retain independent recovery; the recent-event feed is a capped presentation of returned history.')}
        scope={t('widget.backupHistory.summaryScope', 'Energy site {{siteId}}; history since {{since}}, no explicit exclusive end bound', { siteId, since })}
        loading={isLoading && !Array.isArray(events)} testId="backup-history-operational-brief"
      />
      {items.length === 0 && !isLoading ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryFull className="h-5 w-5" />}
          message={emptyMessage}
          className="py-4"
        />
      ) : (
        <div className="flex flex-col gap-3 h-full">

          {/* Event list */}
          <div className="flex-1 min-h-0">
            <WidgetEventFeed items={feedItems} compact={isCompact} order="source" maxItems={maxEvents} />
          </div>
        </div>
      )}
    </WidgetShell>
  );
}
