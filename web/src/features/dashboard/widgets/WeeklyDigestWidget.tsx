import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { useDataState } from '@/hooks/useDataState';

import { WidgetShell } from './WidgetShell';
import { WidgetComparisonCard, WidgetStatGrid, type ComparisonMetric } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';

type DigestMetric = Omit<ComparisonMetric, 'current' | 'previous'> & {
  current: number | null;
  previous: number | null;
};

export default function WeeklyDigestWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
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

  const metrics = useMemo((): DigestMetric[] => {
    if (!data) return [];

    // distanceKm arrives in kilometres — lift to SI metres first, then to the
    // user's display unit. convertDistanceFromSI expects metres, so feeding it
    // km-or-miles directly (the previous behaviour) skewed distance ~1609×.
    const toDistance = (km: number) =>
      convertDistanceFromSI(convertDistanceToSI(km, 'km'), distanceUnit);
    const dist = toDistance(data.distanceKm ?? 0);
    const prevDist = toDistance(data.prevDistanceKm ?? 0);

    // efficiency arrives in Wh/km. One display distance-unit spans this many
    // kilometres (1 for km, 1.609344 for mi), so Wh per display-unit is
    // Wh/km × that span — derived via the lib, never a hardcoded mile factor.
    const kmPerDisplayUnit = convertDistanceFromSI(convertDistanceToSI(1, distanceUnit), 'km');
    const eff = (data.efficiency ?? 0) * kmPerDisplayUnit;
    const prevEff = (data.prevEfficiency ?? 0) * kmPerDisplayUnit;

    const energy = data.energyKwh ?? 0;
    const prevEnergy = data.prevEnergyKwh ?? 0;

    const drives = data.drives ?? 0;
    const prevDrives = data.prevDrives ?? 0;

    return [
      {
        label: t('widget.weeklyDigest.distance', 'Distance'),
        current: isFiniteNumber(data.distanceKm) ? dist : null,
        previous: isFiniteNumber(data.prevDistanceKm) ? prevDist : null,
        formattedCurrent: isFiniteNumber(data.distanceKm) ? fmtNumber(dist) : '—',
        unit: distanceUnit,
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.drives', 'Drives'),
        current: isFiniteNumber(data.drives) ? drives : null,
        previous: isFiniteNumber(data.prevDrives) ? prevDrives : null,
        formattedCurrent: isFiniteNumber(data.drives) ? fmtInt(drives) : '—',
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.energy', 'Energy'),
        current: isFiniteNumber(data.energyKwh) ? energy : null,
        previous: isFiniteNumber(data.prevEnergyKwh) ? prevEnergy : null,
        formattedCurrent: isFiniteNumber(data.energyKwh) ? fmtNumber(energy) : '—',
        unit: 'kWh',
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.efficiency', 'Efficiency'),
        current: isFiniteNumber(data.efficiency) ? eff : null,
        previous: isFiniteNumber(data.prevEfficiency) ? prevEff : null,
        formattedCurrent: isFiniteNumber(data.efficiency) ? fmtNumber(eff) : '—',
        unit: efficiencyUnit,
        higherIsBetter: false,
      },
    ];
  }, [data, distanceUnit, efficiencyUnit, t, fmtNumber, fmtInt]);

  const visibleMetrics = isCompact ? metrics.slice(0, 2) : metrics;
  const comparable = visibleMetrics.filter((metric): metric is ComparisonMetric =>
    metric.current != null && metric.previous != null);
  const unmeasured = visibleMetrics.filter((metric) =>
    metric.current == null || metric.previous == null);

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
      {metrics.length > 0 ? (
        <div className="min-w-0">
          {comparable.length > 0 && <WidgetComparisonCard metrics={comparable} />}
          {unmeasured.length > 0 && (
            <WidgetStatGrid stats={unmeasured.map((metric) => ({
              label: metric.label,
              value: metric.current == null ? null : metric.formattedCurrent,
              unit: metric.unit,
            }))} compact />
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<CalendarDays className="h-5 w-5" />}
          message={t('widget.weeklyDigest.noData', 'No weekly data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
