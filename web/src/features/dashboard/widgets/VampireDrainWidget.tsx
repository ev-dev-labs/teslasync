import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Sparkline } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVampireDrainStats, useVampireDrainEvents } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed, type EventFeedItem } from './shared';
import type { WidgetProps } from './types';

/**
 * Idle-drain severity colour ramp (hex, for inline SVG/icon fills):
 * `<1%/day` green, `1–3%/day` amber, `>=3%/day` red. A non-finite input is
 * treated as 0 so it renders "safe" green rather than falsely alarming red.
 */
export function drainColor(pctPerDay: number): string {
  const p = Number.isFinite(pctPerDay) ? pctPerDay : 0;
  if (p < 1) return '#10b981';   // green
  if (p < 3) return '#f59e0b';   // amber
  return '#ef4444';               // red
}

/**
 * Compact idle-duration label: sub-hour spans render as whole minutes ("30m"),
 * longer spans as fractional hours ("2.5h"). Non-finite or negative inputs
 * coalesce to "0m" so a malformed duration never leaks "NaNm" / "-30m".
 */
export function formatDuration(hours: number, t: (k: string, d: string) => string): string {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 0;
  if (h < 1) return `${fmtNumber(h * 60, 0)}${t('widget.vampireDrain.min', 'm')}`;
  return `${fmtNumber(h, 1)}${t('widget.vampireDrain.hr', 'h')}`;
}

export default function VampireDrainWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data: stats,
    isLoading: statsLoading,
    isFetching: statsFetching,
    isStale: statsStale,
    isError: statsError,
    dataUpdatedAt: statsUpdatedAt,
    refetch: refetchStats,
  } = useVampireDrainStats(idStr);

  const {
    data: rawEvents,
    isLoading: eventsLoading,
    isFetching: eventsFetching,
    isStale: eventsStale,
    isError: eventsError,
    dataUpdatedAt: eventsUpdatedAt,
    refetch: refetchEvents,
  } = useVampireDrainEvents(idStr, 30);

  // Stable reference so the `eventItems` / `sparklineData` memos only recompute
  // when the underlying query data actually changes (a bare `?? []` would mint
  // a fresh empty array every render).
  const events = useMemo(() => rawEvents ?? [], [rawEvents]);
  const isLoading = statsLoading || eventsLoading;
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
        const drainDay = ev.drain_pct_per_day ?? 0;
        return {
          id: ev.started_at,
          icon: <BatteryWarning className="h-3.5 w-3.5" style={{ color: drainColor(drainDay) }} />,
          title: `${fmtNumber(ev.drain_pct ?? 0, 1)}% · ${formatDuration(ev.duration_hours ?? 0, t)}`,
          subtitle: `${fmtNumber(drainDay, 1)}%/${t('widget.vampireDrain.perDay', '/day').replace('/', '')}`,
          timestamp: ev.started_at,
          color: drainColor(drainDay),
          severity: drainDay >= 3 ? 'critical' as const : drainDay >= 1 ? 'warning' as const : 'info' as const,
        };
      }),
    [events, t],
  );

  // Sparkline: daily drain rate from events (most recent 30)
  const sparklineData = useMemo(() => {
    if (events.length === 0) return [];
    return events
      .slice()
      .reverse()
      .map((e) => e.drain_pct_per_day ?? 0);
  }, [events]);

  const updatedAt = Math.max(statsUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchStats();
    refetchEvents();
  };

  const hasMeasuredAverage = measuredAverage != null;
  const hasData = hasMeasuredAverage || events.length > 0;
  const sparklineColorRate =
    measuredAverage
    ?? (sparklineData.length > 0
      ? sparklineData.reduce((sum, value) => sum + value, 0) / sparklineData.length
      : 0);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vampireDrain.title', 'Vampire Drain')}
      icon={isCompact ? undefined : <BatteryWarning className="h-3.5 w-3.5 text-neon-amber" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.vampireDrain.body',
        defaultValue:
          'Battery percentage lost per day while the vehicle is parked and not charging, derived from observed parked windows.',
      }}
      loading={isLoading}
      updatedAt={updatedAt}
      isFetching={statsFetching || eventsFetching}
      isStale={statsStale || eventsStale}
      isError={statsError || eventsError}
      onRefresh={handleRefresh}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact (1×2): single stat ── */
          <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
            <p
              className={cn(
                'text-2xl font-bold',
                !hasMeasuredAverage && 'text-[var(--text-muted)]',
              )}
              style={hasMeasuredAverage ? { color: drainColor(measuredAverage) } : undefined}
            >
              {hasMeasuredAverage ? `${fmtNumber(measuredAverage, 1)}%` : '—'}
            </p>
            <p className="text-2xs text-[var(--text-muted)]">
              {hasMeasuredAverage
                ? t('widget.vampireDrain.perDay', '/day')
                : t('widget.vampireDrain.averageUnavailable', 'Average unavailable')}
            </p>
          </div>
        ) : (
          /* ── Standard / Wide ── */
          <div className="h-full flex flex-col gap-3 min-h-0">
            {/* Stat card row */}
            <StatCard
              label={t('widget.vampireDrain.avgDrain', 'Avg Drain')}
              value={hasMeasuredAverage ? `${fmtNumber(measuredAverage, 1)}%/day` : '—'}
              icon={<BatteryWarning className="h-4 w-4" style={{ color: drainColor(sparklineColorRate) }} />}
              sublabel={
                stats
                  ? t('widget.vampireDrain.eventCount', '{{count}} events · {{hours}}h total', {
                      count: stats.event_count ?? 0,
                      hours: fmtNumber(stats.total_observed_hours ?? 0, 0),
                    })
                  : undefined
              }
            />

            {/* Wide: sparkline */}
            {isWide && sparklineData.length > 1 && (
              <div className="flex-shrink-0">
                <p className="text-2xs text-[var(--text-muted)] mb-1">
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
