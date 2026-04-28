import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BatteryWarning } from 'lucide-react';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Sparkline } from '@/components/charts';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useVampireDrainStats, useVampireDrainEvents } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function drainColor(pctPerDay: number): string {
  if (pctPerDay < 1) return '#10b981';   // green
  if (pctPerDay < 3) return '#f59e0b';   // amber
  return '#ef4444';                       // red
}

function formatDuration(hours: number, t: (k: string, d: string) => string): string {
  if (hours < 1) return `${fmtNumber(hours * 60, 0)}${t('widget.vampireDrain.min', 'm')}`;
  return `${fmtNumber(hours, 1)}${t('widget.vampireDrain.hr', 'h')}`;
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

  const events = rawEvents ?? [];
  const isLoading = statsLoading || eventsLoading;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const avgDrainPctPerDay = (stats?.avg_drain_rate ?? 0) * 24;

  // Last 5 events for the standard list
  const recentEvents = useMemo(() => events.slice(0, 5), [events]);

  // Sparkline: daily drain rate from events (most recent 30)
  const sparklineData = useMemo(() => {
    if (events.length === 0) return [];
    return events
      .slice()
      .reverse()
      .map((e) => (e.drain_rate_pct_per_hour ?? 0) * 24);
  }, [events]);

  const updatedAt = Math.max(statsUpdatedAt ?? 0, eventsUpdatedAt ?? 0);

  const handleRefresh = () => {
    refetchStats();
    refetchEvents();
  };

  const hasData = stats != null || events.length > 0;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.vampireDrain.title', 'Vampire Drain')}
      icon={isCompact ? undefined : <BatteryWarning className="h-3.5 w-3.5 text-neon-amber" />}
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
              className="text-2xl font-bold"
              style={{ color: drainColor(avgDrainPctPerDay) }}
            >
              {fmtNumber(avgDrainPctPerDay, 1)}%
            </p>
            <p className="text-[10px] text-white/40">
              {t('widget.vampireDrain.perDay', '/day')}
            </p>
          </div>
        ) : (
          /* ── Standard / Wide ── */
          <div className="h-full flex flex-col gap-3 min-h-0">
            {/* Stat card row */}
            <StatCard
              label={t('widget.vampireDrain.avgDrain', 'Avg Drain')}
              value={`${fmtNumber(avgDrainPctPerDay, 1)}%/day`}
              icon={<BatteryWarning className="h-4 w-4" style={{ color: drainColor(avgDrainPctPerDay) }} />}
              sublabel={
                stats
                  ? t('widget.vampireDrain.eventCount', '{{count}} events · {{hours}}h total', {
                      count: stats.event_count ?? 0,
                      hours: fmtNumber(stats.total_hours ?? 0, 0),
                    })
                  : undefined
              }
            />

            {/* Wide: sparkline */}
            {isWide && sparklineData.length > 1 && (
              <div className="flex-shrink-0">
                <p className="text-[10px] text-white/40 mb-1">
                  {t('widget.vampireDrain.trend', 'Daily drain rate (last 30)')}
                </p>
                <Sparkline
                  data={sparklineData}
                  color={drainColor(avgDrainPctPerDay)}
                  width={260}
                  height={36}
                />
              </div>
            )}

            {/* Recent events list */}
            {recentEvents.length > 0 ? (
              <div className="flex-1 min-h-0 overflow-y-auto">
                <p className="text-[10px] text-white/40 uppercase tracking-wider mb-1">
                  {t('widget.vampireDrain.recent', 'Recent Events')}
                </p>
                <div className="flex flex-col gap-1.5">
                  {recentEvents.map((ev) => {
                    const drainDay = (ev.drain_rate_pct_per_hour ?? 0) * 24;
                    return (
                      <div
                        key={ev.id}
                        className="flex items-center justify-between text-xs gap-2 py-1 border-b border-white/[0.04] last:border-0"
                      >
                        <div className="flex flex-col min-w-0">
                          <span className="text-white/70 truncate">
                            {new Date(ev.start_date).toLocaleDateString()}
                          </span>
                          <span className="text-[10px] text-white/40">
                            {formatDuration(ev.duration_hours ?? 0, t)}
                            {ev.sentry_mode && ` · ${t('widget.vampireDrain.sentry', 'Sentry')}`}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-white/60">
                            {fmtNumber(ev.battery_lost ?? 0, 1)}%
                          </span>
                          <span
                            className="font-medium text-[11px]"
                            style={{ color: drainColor(drainDay) }}
                          >
                            {fmtNumber(drainDay, 1)}%/d
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-white/30 text-center py-2">
                {t('widget.vampireDrain.noEvents', 'No recent drain events')}
              </p>
            )}
          </div>
        )
      ) : (
        <EmptyState
          icon={<BatteryWarning className="h-5 w-5" />}
          message={t('widget.vampireDrain.noData', 'No vampire drain data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
