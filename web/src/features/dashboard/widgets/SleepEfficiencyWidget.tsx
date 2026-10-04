import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';

import { WidgetGaugeHero } from './shared';
import type { GaugeHeroConfig, GaugeHeroStat } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, sumKnown } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetBigNumber, WidgetStatGrid } from './shared';
import { STATUS_COLORS } from '@/lib/colors';

function efficiencyColor(pct: number): string {
  if (pct > 95) return STATUS_COLORS.good;
  if (pct > 85) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
}

export default function SleepEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidate = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const id = Number.isSafeInteger(candidate) && Number(candidate) > 0 ? candidate : null;
  const idStr = id != null ? String(id) : null;

  const query = useSleepEfficiency(idStr);
  const {
    data,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const discoveryState = useDataState(vehiclesQuery);
  const sourceState = useDataState({
    ...query,
    data: data ?? (!id || (!isLoading && !query.isPending && !isError) ? null : undefined),
  }, {
    provenance: 'historical', unavailable: !data,
    partial: Boolean(data && (
      knownNumber(data.sleep_efficiency_pct) == null
      || knownNumber(data.sentry_off_drain_rate) == null
      || !Array.isArray(data.state_distribution)
      || !Array.isArray(data.recent_events)
    )),
  });
  const dataState = !id && vehicleId == null && discoveryState.status !== 'ok'
    ? discoveryState : sourceState;
  const refresh = () => {
    if (vehicleId == null) void vehiclesQuery.refetch?.();
    if (id) void refetch();
  };

  const isCompact = size.cols <= 1;

  const efficiencyPct = knownNumber(data?.sleep_efficiency_pct);

  const gauge = useMemo<GaugeHeroConfig>(() => ({
    value: efficiencyPct ?? 0,
    max: 100,
    label: isCompact ? '' : t('widget.sleepEfficiency.efficiency', 'Efficiency'),
    unit: '%',
    color: efficiencyPct != null ? efficiencyColor(efficiencyPct) : 'var(--text-muted)',
  }), [data, efficiencyPct, isCompact, t]);

  // Derive avg drain %/day from the sentry-off drain rate (%/hr)
  const drainRate = knownNumber(data?.sentry_off_drain_rate);
  const avgDrainPerDay = drainRate == null ? '—' : fmtNumber(drainRate * 24);

  const totalSleepHours = useMemo(() => {
    const dist = safeArray(data?.state_distribution);
    if (!Array.isArray(data?.state_distribution)) return null;
    const sleep = dist.filter((s) => s.state === 'asleep' || s.state === 'offline');
    const sleepMinutes = sleep.length === 0 ? 0 : sumKnown(sleep.map((s) => s.total_minutes));
    return sleepMinutes == null ? null : sleepMinutes / 60;
  }, [data]);

  const wakeEventsCount = Array.isArray(data?.recent_events) ? data.recent_events.length : null;

  const stats = useMemo<GaugeHeroStat[]>(() => [
    { label: t('widget.sleepEfficiency.avgDrain', 'Avg drain/day'), value: avgDrainPerDay, unit: '%' },
    { label: t('widget.sleepEfficiency.totalSleep', 'Total sleep'), value: totalSleepHours == null ? '—' : fmtNumber(totalSleepHours), unit: t('widget.sleepEfficiency.hours', 'h') },
    { label: t('widget.sleepEfficiency.wakeEvents', 'Wake events'), value: wakeEventsCount == null ? '—' : fmtInt(wakeEventsCount) },
  ], [avgDrainPerDay, totalSleepHours, wakeEventsCount, t, fmtNumber, fmtInt]);

  const hasData = data != null;

  return (
    <WidgetShell
      title={t('widget.sleepEfficiency.title', 'Sleep efficiency')}
      icon={isCompact ? undefined : <Moon className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      help={isCompact ? undefined : {
        i18nKey: 'help.sleepEfficiency.body',
        defaultValue:
          'Share of parked time the car spent in true low-power sleep (vs. idle/online). Higher is better — more sleep means less vampire drain and lower battery wear.',
      }}
      dataState={{ ...dataState, retry: refresh }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refresh}
    >
      {hasData ? (
        efficiencyPct != null ? <WidgetGaugeHero gauge={gauge} stats={stats} compact={isCompact} /> : (
          <div className="flex h-full flex-col justify-center gap-3">
            <WidgetBigNumber value={null} label={t('widget.sleepEfficiency.efficiency', 'Efficiency')} align="center" />
            {!isCompact && <WidgetStatGrid stats={stats} />}
          </div>
        )
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
