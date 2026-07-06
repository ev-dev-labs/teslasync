import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetComparisonCard, type ComparisonMetric } from './shared';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, convertDistanceToSI } from '@/lib/unitConversion';

export default function WeeklyDigestWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch, } = useWeeklyDigest(String(id));

  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const isCompact = size.cols <= 1;

  const metrics = useMemo((): ComparisonMetric[] => {
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
        current: dist,
        previous: prevDist,
        formattedCurrent: fmtNumber(dist, 1),
        unit: distanceUnit,
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.drives', 'Drives'),
        current: drives,
        previous: prevDrives,
        formattedCurrent: fmtInt(drives),
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.energy', 'Energy'),
        current: energy,
        previous: prevEnergy,
        formattedCurrent: fmtNumber(energy, 1),
        unit: 'kWh',
        higherIsBetter: true,
      },
      {
        label: t('widget.weeklyDigest.efficiency', 'Efficiency'),
        current: eff,
        previous: prevEff,
        formattedCurrent: fmtNumber(eff, 0),
        unit: efficiencyUnit,
        higherIsBetter: false,
      },
    ];
  }, [data, distanceUnit, efficiencyUnit, t]);

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weeklyDigest.title', 'This Week')}
      icon={isCompact ? undefined : <CalendarDays className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error && !data ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {metrics.length > 0 ? (
        <WidgetComparisonCard metrics={metrics} compact={isCompact} />
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
