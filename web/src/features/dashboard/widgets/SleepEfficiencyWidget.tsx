import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetGaugeHero } from './shared';
import type { GaugeHeroConfig, GaugeHeroStat } from './shared';
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
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSleepEfficiency(idStr);

  const isCompact = size.cols <= 1;

  const efficiencyPct = data?.sleep_efficiency_pct ?? 0;

  const gauge = useMemo<GaugeHeroConfig>(() => ({
    value: efficiencyPct,
    max: 100,
    label: isCompact ? '' : t('widget.sleepEfficiency.efficiency', 'Efficiency'),
    unit: '%',
    color: data ? efficiencyColor(efficiencyPct) : '#374151',
  }), [data, efficiencyPct, isCompact, t]);

  // Derive avg drain %/day from the sentry-off drain rate (%/hr)
  const avgDrainPerDay = fmtNumber((data?.sentry_off_drain_rate ?? 0) * 24, 2);

  const totalSleepHours = useMemo(() => {
    const dist = data?.state_distribution ?? [];
    const sleepMinutes = dist
      .filter((s) => s.state === 'asleep' || s.state === 'offline')
      .reduce((sum, s) => sum + (s.total_minutes ?? 0), 0);
    return sleepMinutes / 60;
  }, [data]);

  const wakeEventsCount = (data?.recent_events ?? []).length;

  const stats = useMemo<GaugeHeroStat[]>(() => [
    { label: t('widget.sleepEfficiency.avgDrain', 'Avg Drain/Day'), value: avgDrainPerDay, unit: '%' },
    { label: t('widget.sleepEfficiency.totalSleep', 'Total Sleep'), value: fmtNumber(totalSleepHours, 0), unit: t('widget.sleepEfficiency.hours', 'h') },
    { label: t('widget.sleepEfficiency.wakeEvents', 'Wake Events'), value: wakeEventsCount },
  ], [avgDrainPerDay, totalSleepHours, wakeEventsCount, t]);

  const hasData = data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.sleepEfficiency.title', 'Sleep Efficiency')}
      icon={isCompact ? undefined : <Moon className="h-3.5 w-3.5 text-indigo-400" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.sleepEfficiency.body',
        defaultValue:
          'Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is better — more sleep means less vampire drain and lower battery wear.',
      }}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasData ? (
        <WidgetGaugeHero gauge={gauge} stats={stats} compact={isCompact} />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Moon className="h-5 w-5" />}
          message={t('widget.sleepEfficiency.noData', 'No sleep efficiency data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
