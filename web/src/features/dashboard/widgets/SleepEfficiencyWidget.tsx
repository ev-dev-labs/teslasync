import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSleepEfficiency } from '@/api/hooks/useEnergy';

import { WidgetGaugeHero } from './shared';
import type { GaugeHeroConfig } from './shared';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber, sumKnown } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetBigNumber } from './shared';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { STATUS_COLORS } from '@/lib/colors';

function efficiencyColor(pct: number): string {
  if (pct > 95) return STATUS_COLORS.good;
  if (pct > 85) return STATUS_COLORS.warning;
  return STATUS_COLORS.critical;
}

export default function SleepEfficiencyWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
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
    value: efficiencyPct,
    preserveReadingAndScale: true,
    max: 100,
    label: isCompact ? '' : t('widget.sleepEfficiency.efficiency', 'Efficiency'),
    unit: '%',
    color: efficiencyPct != null ? efficiencyColor(efficiencyPct) : 'var(--text-muted)',
  }), [data, efficiencyPct, isCompact, t]);

  // Derive avg drain %/day from the sentry-off drain rate (%/hr)
  const drainRate = knownNumber(data?.sentry_off_drain_rate);

  const totalSleepHours = useMemo(() => {
    const dist = safeArray(data?.state_distribution);
    if (!Array.isArray(data?.state_distribution)) return null;
    const sleep = dist.filter((s) => s.state === 'asleep' || s.state === 'offline');
    const sleepMinutes = sleep.length === 0 ? 0 : sumKnown(sleep.map((s) => s.total_minutes));
    return sleepMinutes == null ? null : sleepMinutes / 60;
  }, [data]);

  const wakeEventsCount = Array.isArray(data?.recent_events) ? data.recent_events.length : null;

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
      {!isCompact && <DashboardSourceBrief
        metrics={[
          { metricId: 'rate', rawValue: drainRate == null ? null : drainRate / 3600, label: t('widget.sleepEfficiency.avgDrain', 'Avg drain/day'), description: t('widget.sleepEfficiency.drainDescription', 'Sentry-off drain rate normalized to percentage points per second; daily display preserves the existing 24-hour estimate.'), display: { formatter: raw => ({ value: fmtNumber(Number(raw) * 86400), unit: '%' }) } },
          { metricId: 'duration', rawValue: totalSleepHours == null ? null : totalSleepHours * 3600, label: t('widget.sleepEfficiency.totalSleep', 'Total sleep'), description: t('widget.sleepEfficiency.sleepDescription', 'Returned asleep and offline state durations in canonical seconds; absent state distribution remains unknown.'), display: { formatter: raw => ({ value: fmtNumber(Number(raw) / 3600), unit: t('widget.sleepEfficiency.hours', 'h') }) } },
          { metricId: 'count', rawValue: wakeEventsCount, label: t('widget.sleepEfficiency.wakeEvents', 'Wake events'), description: t('widget.sleepEfficiency.eventsDescription', 'Number of returned recent events, not a certified full-window wake count.') },
        ]}
        state={dataState} eyebrow={t('dashboard.summary.eyebrow', 'Source summary')}
        title={t('widget.sleepEfficiency.summaryTitle', 'Sleep source quantities')}
        description={t('widget.sleepEfficiency.summaryDescription', 'The efficiency gauge retains its measured percentage; supporting durations, drain estimate and recent-event sample keep their source limitations.')}
        scope={t('widget.sleepEfficiency.summaryScope', 'Vehicle {{vehicleId}}; returned historical distribution and recent sample, exact bounds unknown', { vehicleId: id ?? '—' })}
        loading={isLoading && !data} testId="sleep-efficiency-operational-brief"
      />}
      {hasData ? (
        efficiencyPct != null ? <WidgetGaugeHero gauge={gauge} compact={isCompact} /> : (
          <div className="flex h-full flex-col justify-center gap-3">
            <WidgetBigNumber value={null} label={t('widget.sleepEfficiency.efficiency', 'Efficiency')} align="center" />
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
