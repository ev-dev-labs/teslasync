import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { RadialGauge } from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

function efficiencyColor(pct: number): string {
  if (pct > 95) return '#10b981';  // green
  if (pct > 85) return '#f59e0b';  // amber
  return '#ef4444';                // red
}

export default function SleepEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? null;
  const idStr = id != null ? String(id) : null;

  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSleepEfficiency(idStr);

  const isCompact = size.cols <= 1;

  const efficiencyPct = data?.sleep_efficiency_pct ?? 0;
  const color = useMemo(() => (data ? efficiencyColor(efficiencyPct) : '#374151'), [data, efficiencyPct]);

  // Derive avg drain kWh/day from the sentry-off drain rate (assumed %/hr)
  const avgDrainPerDay = fmtNumber((data?.sentry_off_drain_rate ?? 0) * 24, 2);

  // Total sleep hours from state_distribution
  const totalSleepHours = useMemo(() => {
    const dist = data?.state_distribution ?? [];
    const sleepMinutes = dist
      .filter((s) => s.state === 'asleep' || s.state === 'offline')
      .reduce((sum, s) => sum + (s.total_minutes ?? 0), 0);
    return sleepMinutes / 60;
  }, [data]);

  // Wake events from recent_events
  const wakeEventsCount = (data?.recent_events ?? []).length;

  const gaugeSize = isCompact ? 90 : 130;
  const hasData = data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.sleepEfficiency.title', 'Sleep Efficiency')}
      icon={isCompact ? undefined : <Moon className="h-3.5 w-3.5 text-indigo-400" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact (1×2): RadialGauge only ── */
          <div className="h-full flex flex-col items-center justify-center min-h-[44px]">
            <RadialGauge
              value={efficiencyPct}
              max={100}
              label=""
              unit="%"
              color={color}
              size={gaugeSize}
            />
            <p className="text-[10px] text-white/40 mt-1">
              {t('widget.sleepEfficiency.label', 'Sleep')}
            </p>
          </div>
        ) : (
          /* ── Standard (2×4): Gauge + stat cards ── */
          <div className="h-full flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-center">
              <RadialGauge
                value={efficiencyPct}
                max={100}
                label={t('widget.sleepEfficiency.efficiency', 'Efficiency')}
                unit="%"
                color={color}
                size={gaugeSize}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 min-h-0">
              <StatCard
                label={t('widget.sleepEfficiency.avgDrain', 'Avg Drain/Day')}
                value={avgDrainPerDay}
                unit="%"
              />
              <StatCard
                label={t('widget.sleepEfficiency.totalSleep', 'Total Sleep')}
                value={fmtNumber(totalSleepHours, 0)}
                unit={t('widget.sleepEfficiency.hours', 'h')}
              />
              <StatCard
                label={t('widget.sleepEfficiency.wakeEvents', 'Wake Events')}
                value={wakeEventsCount}
              />
            </div>
          </div>
        )
      ) : (
        <EmptyState
          icon={<Moon className="h-5 w-5" />}
          message={t('widget.sleepEfficiency.noData', 'No sleep efficiency data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
