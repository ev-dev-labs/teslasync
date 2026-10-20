import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { Sparkline } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVampireDrainStats, useVampireDrainEvents, useVampireDrainWatch } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, knownNumber } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { STATUS_COLORS } from '@/lib/colors';
import { WidgetBigNumber } from './shared';
import type { StatMetric } from '@/components/data-display';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { dashboardTokens } from '../lib/dashboardTokens';

/**
 * Idle-drain severity colour ramp (hex, for inline SVG/icon fills):
 * `<1%/day` green, `1–3%/day` amber, `>=3%/day` red. A non-finite input is
 * shown with an unknown tone, never a reassuring healthy color.
 */
export function drainColor(pctPerDay: number): string {
  if (!Number.isFinite(pctPerDay)) return 'var(--text-muted)';
  if (pctPerDay < 1) return STATUS_COLORS.good;
  if (pctPerDay < 3) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
}

/**
 * Compact idle-duration label: sub-hour spans render as whole minutes ("30m"),
 * longer spans as fractional hours ("2.5h"). Invalid inputs remain unknown.
 */
export function formatDuration(
  hours: number,
  t: (k: string, d: string) => string,
  format = fmtNumber,
): string {
  if (!Number.isFinite(hours) || hours < 0) return '—';
  if (hours < 1) return `${format(hours * 60)}${t('widget.vampireDrain.min', 'm')}`;
  return `${format(hours)}${t('widget.vampireDrain.hr', 'h')}`;
}

export default function VampireDrainWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt, precision: displayPrecision, locale: displayLocale } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? candidate : null;
  const idStr = id != null ? String(id) : null;

  const statsQuery = useVampireDrainStats(idStr);
  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
    refetch: refetchStats,
  } = statsQuery;

  const eventsQuery = useVampireDrainEvents(idStr, 30);
  const {
    data: rawEvents,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    refetch: refetchEvents,
  } = eventsQuery;

  // Stable reference so the `eventItems` / `sparklineData` memos only recompute
  // when the underlying query data actually changes (a bare `?? []` would mint
  // a fresh empty array every render).
  const events = useMemo(() => safeArray(rawEvents), [rawEvents]);
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const avgDrainPctPerDay = stats?.avg_drain_pct_per_day ?? null;
  const measuredAverage =
    avgDrainPctPerDay != null
    && Number.isFinite(avgDrainPctPerDay)
    && (stats?.event_count ?? 0) > 0
      ? avgDrainPctPerDay
      : null;

  // Map drain events → EventFeedItem[] for shared feed
  const eventItems: EventFeedItem[] = useMemo(
    () =>
      events.map((ev) => {
        const drainDay = knownNumber(ev.drain_pct_per_day);
        const drain = knownNumber(ev.drain_pct);
        const hours = knownNumber(ev.duration_hours);
        return {
          id: ev.started_at,
          icon: <BatteryWarning className="h-3.5 w-3.5" style={{ color: drainColor(drainDay ?? NaN) }} />,
          title: `${drain == null ? '—' : fmtNumber(drain)}% · ${hours == null ? '—' : formatDuration(hours, t, fmtNumber)}`,
          subtitle: `${drainDay == null ? '—' : fmtNumber(drainDay)}%/${t('widget.vampireDrain.perDay', '/day').replace('/', '')}`,
          timestamp: ev.started_at,
          color: drainColor(drainDay ?? NaN),
          severity: drainDay != null && drainDay >= 3 ? 'critical' as const : drainDay != null && drainDay >= 1 ? 'warning' as const : 'info' as const,
          wrap: true,
        };
      }),
    [events, t, fmtNumber, displayPrecision, displayLocale],
  );

  // Sparkline: daily drain rate from events (most recent 30)
  const sparklineData = useMemo(() => {
    if (events.length === 0) return [];
    return events
      .slice()
      .reverse()
      .map((e) => knownNumber(e.drain_pct_per_day))
      .filter((value): value is number => value != null);
  }, [events]);

  const watchQuery = useVampireDrainWatch(idStr);
  const {
    data: watch,
    isFetching: watchFetching,
    isStale: watchStale,
    isError: watchError,
    refetch: refetchWatch,
  } = watchQuery;
  const discoveryState = useDataState(vehiclesQuery);
  const statsState = useDataState({
    ...statsQuery,
    data: stats ?? (!id || (!statsLoading && !statsQuery.isPending && !statsError) ? null : undefined),
  }, { provenance: 'historical', unavailable: !stats });
  const eventsState = useDataState({
    ...eventsQuery,
    data: rawEvents ?? (!id || (!eventsLoading && !eventsQuery.isPending && !eventsError) ? null : undefined),
  }, { provenance: 'historical', unavailable: events.length === 0 });
  const watchState = useDataState({
    ...watchQuery,
    data: watch ?? (!id || (!watchQuery.isLoading && !watchQuery.isPending && !watchError) ? null : undefined),
  }, { provenance: 'inferred', unavailable: !watch });
  const sources = !id && vehicleId == null && discoveryState.status !== 'ok'
    ? [discoveryState] : [statsState, eventsState, watchState];
  const combined = combineDataStates(sources);

  const handleRefresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) {
      void refetchStats();
      void refetchEvents();
      void refetchWatch();
    }
  };

  const hasMeasuredAverage = measuredAverage != null;
  const hasData = hasMeasuredAverage || events.length > 0 || watch != null;
  const failure = sources.find((source) => source.fatalError)?.fatalError ?? null;
  const dataState = {
    ...combined, data: { stats, events, watch }, hasData,
    status: !hasData && failure ? 'initialFailure' as const
      : !hasData && sources.some((source) => source.status === 'initial') ? 'initial' as const
        : hasData && sources.some((source) => source.status === 'unavailable') ? 'partial' as const : combined.status,
    fatalError: !hasData ? failure : null,
    refreshError: hasData ? combined.refreshError ?? failure : null,
    retry: handleRefresh,
  };
  const sparklineColorRate =
    measuredAverage
    ?? (sparklineData.length > 0
      ? sparklineData.reduce((sum, value) => sum + value, 0) / sparklineData.length
      : NaN);
  const averageMetrics: StatMetric[] = [{
    metricId: 'rate', occurrenceId: 'vampire-average-drain', rawValue: measuredAverage,
    label: t('widget.vampireDrain.avgDrain', 'Avg drain'),
    description: t('widget.vampireDrain.averageSource', 'Observed battery percentage-point loss per day; a positive event population is required before the average is treated as measured.'),
    display: { formatter: raw => ({ value: `${fmtNumber(raw)}%/day`, unit: '' }) },
    context: t('widget.vampireDrain.averagePopulation', 'Aggregate event count: {{count}} · observed hours: {{hours}}. The separately loaded event feed is limited to 30 rows.', {
      replace: {
        count: knownNumber(stats?.event_count) == null ? '—' : fmtInt(stats?.event_count),
        hours: knownNumber(stats?.total_observed_hours) == null ? '—' : fmtNumber(stats?.total_observed_hours),
      },
    }),
  }];

  return (
    <WidgetShell
      title={t('widget.vampireDrain.title', 'Vampire drain')}
      icon={isCompact ? undefined : <BatteryWarning className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.vampireDrain.body',
        defaultValue:
          'Battery percentage lost per day while the vehicle is parked and not charging, derived from observed parked windows.',
      }}
      dataState={dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={statsFetching || eventsFetching || watchFetching}
      isStale={statsStale || eventsStale || watchStale}
      isError={statsError || eventsError || watchError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact (1×2): single stat ── */
          <WidgetBigNumber
            align="center"
            value={hasMeasuredAverage ? `${fmtNumber(measuredAverage)}%` : null}
            subtitle={hasMeasuredAverage
                ? t('widget.vampireDrain.perDay', '/day')
                : t('widget.vampireDrain.averageUnavailable', 'Average unavailable')}
          />
        ) : (
          /* ── Standard / Wide ── */
          <div className="h-full flex flex-col gap-3 min-h-0">
            {/* Stat card row */}
            <DashboardSourceBrief metrics={averageMetrics} state={statsState}
              eyebrow={t('widget.summaryEyebrow', 'Dashboard source summary')}
              title={t('widget.vampireDrain.summaryTitle', 'Observed parked-drain average')}
              description={t('widget.vampireDrain.summaryDescription', 'The statistical average, event history and inferred watchdog are independent sources; the retained chart and event feed do not prove complete recording.')}
              scope={t('widget.vampireDrain.summaryScope', 'Vehicle {{id}} · returned parked-window statistics; exact aggregate recording bounds are not supplied.', { id: id ?? '—' })}
              testId="dashboard-vampire-drain-brief" />
            <p className={dashboardTokens.metricLabel}>
              {
                stats
                  ? t('widget.vampireDrain.eventCount', '{{formattedCount}} events · {{hours}}h total', {
                      count: knownNumber(stats.event_count) ?? undefined,
                      formattedCount: knownNumber(stats.event_count) == null ? '—' : fmtInt(stats.event_count),
                      hours: knownNumber(stats.total_observed_hours) == null ? '—' : fmtNumber(stats.total_observed_hours),
                    })
                  : undefined
              }
            </p>

            {/* Watchdog status strip */}
            {watch && (
              <div
                className="flex items-center gap-2 px-1 py-2"
                role="status"
                aria-label={t('widget.vampireDrain.watchStatus', 'Drain watchdog status')}
              >
                <span
                  className="h-2 w-2 flex-shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      watch.status === 'alert' ? STATUS_COLORS.critical : watch.status === 'watch' ? STATUS_COLORS.warning : watch.status === 'ok' ? STATUS_COLORS.good : 'var(--text-muted)',
                  }}
                  aria-hidden="true"
                />
                <p className={dashboardTokens.metricLabel}>
                  {watch.status !== 'ok' && watch.status !== 'alert' && watch.status !== 'watch' ? '—' : watch.status === 'ok'
                    ? t('widget.vampireDrain.watchOk', 'Watchdog: drain healthy')
                    : t('widget.vampireDrain.watchBreach', 'Watchdog: {{streak}} breach streak · {{rec}}', {
                        streak: watch.breach_streak,
                        rec: watch.recommendation,
                      })}
                </p>
              </div>
            )}

            {/* Wide: sparkline */}
            {isWide && sparklineData.length > 1 && (
              <div className="flex-shrink-0">
                <p className={dashboardTokens.metricLabel}>
                  {t('widget.vampireDrain.trend', 'Daily drain rate (last 30)')}
                </p>
                <Sparkline
                  data={sparklineData}
                  color={drainColor(sparklineColorRate)}
                  width={260}
                  height={36}
                />
              </div>
            )}

            {/* Recent events feed */}
            <WidgetEventFeed
              items={eventItems}
              maxItems={5}
              emptyMessage={t('widget.vampireDrain.noEvents', 'No recent drain events')}
              emptyIcon={<BatteryWarning className="h-4 w-4" />}
            />
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<BatteryWarning className="h-5 w-5" />}
          message={t('widget.vampireDrain.noData', 'No vampire drain data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
