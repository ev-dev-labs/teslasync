import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFormatting } from '@/hooks/useFormatting';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { WidgetBigNumber, WidgetComparisonCard, type ComparisonMetric } from './shared';
import { isFiniteNumber } from '@/lib/numberFormat';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';

export default function WeeklySummaryCardWidget({ vehicleId, size }: WidgetProps) {
  const packId = usePackPresentation();
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const candidateId = vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const id = typeof candidateId === 'number' && Number.isSafeInteger(candidateId) && candidateId > 0
    ? candidateId : undefined;

  const query = useWeeklyDigest(id != null ? String(id) : '');
  const { data, isLoading, refetch } = query;
  const digestState = useDataState(query);
  const vehiclesState = useDataState(vehiclesQuery);
  const resolvingVehicle = id == null && data === undefined;
  const state = resolvingVehicle ? vehiclesState : digestState;
  const retry = resolvingVehicle ? vehiclesQuery.refetch : refetch;
  const freshnessQuery = resolvingVehicle ? vehiclesQuery : query;
  const shellProps = {
    title: t('widget.weeklySummary.title', 'Weekly summary'),
    loading: isLoading || (resolvingVehicle && vehiclesQuery.isLoading),
    dataState: data === undefined && !isLoading && !query.isError ? undefined : state,
    updatedAt: freshnessQuery.dataUpdatedAt,
    isFetching: freshnessQuery.isFetching,
    isStale: freshnessQuery.isStale,
    isError: freshnessQuery.isError,
    onRefresh: () => { void retry() },
  };
  const { unitPrefs } = useUnits();
  const { formatCurrency } = useFormatting();

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';
  const unknown = null as unknown as number;

  const metrics = useMemo(() => {
    if (!data) return null;
    const distance = isFiniteNumber(data.distanceKm)
      ? convertDistanceFromSI(convertDistanceToSI(data.distanceKm, 'km'), distanceUnit) : null;
    const prevDistance = isFiniteNumber(data.prevDistanceKm)
      ? convertDistanceFromSI(convertDistanceToSI(data.prevDistanceKm, 'km'), distanceUnit) : null;
    const energy = isFiniteNumber(data.energyWh) ? data.energyWh / 1000 : null;
    const prevEnergy = isFiniteNumber(data.prevEnergyWh) ? data.prevEnergyWh / 1000 : null;
    const kmPerDisplayUnit = convertDistanceFromSI(convertDistanceToSI(1, distanceUnit), 'km');
    const efficiency = isFiniteNumber(data.efficiency) ? data.efficiency * kmPerDisplayUnit : null;
    const prevEfficiency = isFiniteNumber(data.prevEfficiency) ? data.prevEfficiency * kmPerDisplayUnit : null;
    const cost = isFiniteNumber(data.cost) ? data.cost : null;
    const prevCost = isFiniteNumber(data.prevCost) ? data.prevCost : null;

    return [
      {
        label: t('widget.weeklySummary.distance', 'Distance'),
        current: distance ?? unknown,
        previous: prevDistance ?? unknown,
        formattedCurrent: distance != null ? fmtNumber(distance) : '—',
        formattedPrevious: prevDistance != null ? `${fmtNumber(prevDistance)} ${distanceUnit}` : undefined,
        unit: distanceUnit,
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklySummary.energy', 'Energy'),
        current: energy ?? unknown,
        previous: prevEnergy ?? unknown,
        formattedCurrent: energy != null ? fmtNumber(energy) : '—',
        formattedPrevious: prevEnergy != null ? `${fmtNumber(prevEnergy)} kWh` : undefined,
        unit: 'kWh',
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklySummary.cost', 'Cost'),
        current: cost ?? unknown,
        previous: prevCost ?? unknown,
        formattedCurrent: cost != null ? formatCurrency(cost) : '—',
        formattedPrevious: prevCost != null ? formatCurrency(prevCost) : undefined,
        higherIsBetter: false,
      },
      {
        label: t('widget.weeklySummary.efficiency', 'Efficiency'),
        current: efficiency ?? unknown,
        previous: prevEfficiency ?? unknown,
        formattedCurrent: efficiency != null ? fmtNumber(efficiency) : '—',
        formattedPrevious: prevEfficiency != null ? `${fmtNumber(prevEfficiency)} ${efficiencyUnit}` : undefined,
        unit: efficiencyUnit,
        higherIsBetter: false,
      },
    ] satisfies ComparisonMetric[];
  }, [data, distanceUnit, efficiencyUnit, fmtNumber, formatCurrency, t]);

  const isCompact = size.cols <= 1;
  const distanceMetric = metrics?.[0];
  const currentDistance = distanceMetric && isFiniteNumber(distanceMetric.current) ? distanceMetric.current : null;
  const previousDistance = distanceMetric && isFiniteNumber(distanceMetric.previous) ? distanceMetric.previous : null;
  const distanceMax = Math.max(0, currentDistance ?? 0, previousDistance ?? 0);
  const periods = [
    { id: 'previous', label: t('widget.comparison.previousLabel', 'Last week'), value: previousDistance,
      formatted: distanceMetric?.formattedPrevious ?? '—', color: 'var(--text-secondary)' },
    { id: 'current', label: t('widget.weeklySummary.thisWeek', 'this week'), value: currentDistance,
      formatted: currentDistance != null ? `${distanceMetric?.formattedCurrent} ${distanceUnit}` : '—',
      color: 'var(--theme-primary)' },
  ];
  const comparison = metrics ? (
    <WidgetComparisonCard
      metrics={metrics}
      compact={isCompact}
      emptyMessage={t('widget.weeklySummary.noData', 'No weekly data')}
    />
  ) : !isLoading ? (
    <EmptyState
      variant="informational"
      icon={<CalendarDays className="h-5 w-5" />}
      message={t('widget.weeklySummary.noData', 'No weekly data')}
      className="py-4"
    />
  ) : null;

  return (
    <WidgetShell
      icon={isCompact ? undefined : <CalendarDays className="h-3.5 w-3.5 text-theme-accent" />}
      {...shellProps}
    >
      <InstrumentPresentation
        family="bars"
        compact={isCompact}
        icon={<CalendarDays />}
        headline={<WidgetBigNumber value={currentDistance != null ? distanceMetric?.formattedCurrent : null}
          unit={distanceUnit} label={t('dashboardWidgets.analytics.weeklySummary.distanceThisWeek', 'Distance this week')}
          animated={false} />}
        context={<Caption>{t('dashboardWidgets.analytics.weeklySummary.periodComparison', 'This week vs last week')}</Caption>}
        instrument={
          <div className="min-w-0 space-y-3">
            {periods.map(period => (
              <MetricBar key={period.id} label={period.label} value={period.value}
                max={distanceMax} color={period.color} sublabel={period.formatted}
                fill={packId === 'v7' ? 'segmented' : 'solid'}
                size={packId === 'v3' ? 'slim' : 'default'} />
            ))}
          </div>
        }
        details={comparison}
      >
        {comparison}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
