import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';
import { useCompareWindow } from '@/hooks/useCompareWindow';

import { WidgetShell } from './WidgetShell';
import { WidgetComparisonCard, type ComparisonMetric } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

const unknownMetricValue = null as unknown as number;

export default function WeeklyDigestWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { previousLabel } = useCompareWindow('week');
  const vehiclesQuery = useVehicles();
  const id = vehicleId ?? vehiclesQuery.data?.[0]?.id;
  const idStr = id != null && Number.isSafeInteger(id) && id > 0 ? String(id) : '';

  const query = useWeeklyDigest(idStr);
  const source = idStr ? query : vehiclesQuery;
  const {
    isLoading, isFetching, isStale, isError, dataUpdatedAt, } = source;
  const data = idStr ? query.data : undefined;
  const digestState = useDataState(query, { provenance: 'historical' });
  const discoveryState = useDataState(vehiclesQuery);
  const dataState = idStr ? digestState : discoveryState;

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;

  const metrics = useMemo((): ComparisonMetric[] => {
    if (!data) return [];

    const toDistance = (km: number) =>
      convertDistanceFromSI(convertDistanceToSI(km, 'km'), distanceUnit);
    const dist = toDistance(data.distanceKm ?? 0);
    const prevDist = toDistance(data.prevDistanceKm ?? 0);

    const kmPerDisplayUnit = convertDistanceFromSI(convertDistanceToSI(1, distanceUnit), 'km');
    const eff = (data.efficiency ?? 0) * kmPerDisplayUnit;
    const prevEff = (data.prevEfficiency ?? 0) * kmPerDisplayUnit;

    const energy = isFiniteNumber(data.energyWh) ? data.energyWh / 1000 : null;
    const prevEnergy = isFiniteNumber(data.prevEnergyWh) ? data.prevEnergyWh / 1000 : null;

    const drives = data.drives ?? 0;
    const prevDrives = data.prevDrives ?? 0;

    return [
      {
        label: t('widget.weeklyDigest.distance', 'Distance'),
        current: isFiniteNumber(data.distanceKm) ? dist : unknownMetricValue,
        previous: isFiniteNumber(data.prevDistanceKm) ? prevDist : unknownMetricValue,
        formattedCurrent: isFiniteNumber(data.distanceKm) ? fmtNumber(dist, 0) : '—',
        formattedPrevious: isFiniteNumber(data.prevDistanceKm) ? `${fmtNumber(prevDist, 0)} ${distanceUnit}` : undefined,
        unit: distanceUnit,
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'percent',
      },
      {
        label: t('widget.weeklyDigest.drives', 'Drives'),
        current: isFiniteNumber(data.drives) ? drives : unknownMetricValue,
        previous: isFiniteNumber(data.prevDrives) ? prevDrives : unknownMetricValue,
        formattedCurrent: isFiniteNumber(data.drives) ? fmtInt(drives) : '—',
        formattedPrevious: isFiniteNumber(data.prevDrives) ? fmtInt(prevDrives) : undefined,
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'absolute',
      },
      {
        label: t('widget.weeklyDigest.energy', 'Energy'),
        current: energy ?? unknownMetricValue,
        previous: prevEnergy ?? unknownMetricValue,
        formattedCurrent: energy != null ? fmtNumber(energy, 1) : '—',
        formattedPrevious: prevEnergy != null ? `${fmtNumber(prevEnergy, 1)} kWh` : undefined,
        unit: 'kWh',
        higherIsBetter: true,
        tone: 'neutral',
        deltaDisplay: 'percent',
      },
      {
        label: t('widget.weeklyDigest.efficiency', 'Efficiency'),
        current: isFiniteNumber(data.efficiency) ? eff : unknownMetricValue,
        previous: isFiniteNumber(data.prevEfficiency) ? prevEff : unknownMetricValue,
        formattedCurrent: isFiniteNumber(data.efficiency) ? fmtNumber(eff, 0) : '—',
        formattedPrevious: isFiniteNumber(data.prevEfficiency) ? `${fmtNumber(prevEff, 0)} ${efficiencyUnit}` : undefined,
        unit: efficiencyUnit,
        higherIsBetter: false,
        tone: 'good',
        deltaDisplay: 'percent',
      },
    ];
  }, [data, distanceUnit, efficiencyUnit, t, fmtNumber, fmtInt]);

  const sourceMetrics: ComparisonMetric[] = metrics.length > 0 ? metrics : [
    { label: t('widget.weeklyDigest.distance', 'Distance'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: distanceUnit, higherIsBetter: true },
    { label: t('widget.weeklyDigest.drives', 'Drives'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', higherIsBetter: true },
    { label: t('widget.weeklyDigest.energy', 'Energy'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: 'kWh', higherIsBetter: true },
    { label: t('widget.weeklyDigest.efficiency', 'Efficiency'), current: unknownMetricValue, previous: unknownMetricValue, formattedCurrent: '—', unit: efficiencyUnit, higherIsBetter: false },
  ];

  const handleRefresh = useCallback(() => {
    if (idStr) {
      void query.refetch();
    } else {
      void vehiclesQuery.refetch?.();
    }
  }, [idStr, query.refetch, vehiclesQuery.refetch]);

  return (
    <WidgetShell
      dataState={dataState.hasData || isLoading || source.isPending || dataState.fatalError || dataState.isRefreshBlocked ? dataState : undefined}
      title={t('widget.weeklyDigest.title', 'This week')}
      icon={isCompact ? undefined : <CalendarDays className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {data && metrics.length > 0 ? (
        <WidgetComparisonCard
          metrics={sourceMetrics}
          compact={isCompact}
          previousLabel={previousLabel}
          emptyMessage={t('widget.weeklyDigest.noData', 'No weekly data yet')}
        />
      ) : !isLoading ? (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<CalendarDays className="h-5 w-5" />}
          message={t('widget.weeklyDigest.noData', 'No weekly data yet')}
          className="py-4"
        />
      ) : null}
    </WidgetShell>
  );
}
