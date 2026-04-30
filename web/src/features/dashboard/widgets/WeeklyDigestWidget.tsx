import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useWeeklyDigest } from '@/api/hooks/useAnalytics';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { UNITS } from '@/lib/constants';
import { WidgetShell } from './WidgetShell';
import { WidgetComparisonCard, type ComparisonMetric } from './shared';
import type { WidgetProps } from './types';

export default function WeeklyDigestWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const {
    data,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useWeeklyDigest(String(id));

  const {
    convertDistance,
    convertEfficiency,
    distanceUnit,
    efficiencyUnit,
  } = useSettings();

  const isCompact = size.cols <= 1;

  const metrics = useMemo((): ComparisonMetric[] => {
    if (!data) return [];

    const distMi = (data.distanceKm ?? 0) * UNITS.KM_TO_MI;
    const prevDistMi = (data.prevDistanceKm ?? 0) * UNITS.KM_TO_MI;
    const dist = convertDistance(distMi);
    const prevDist = convertDistance(prevDistMi);

    // Efficiency stored as Wh/km → convert to Wh/mi for convertEfficiency
    const effWhMi = (data.efficiency ?? 0) * UNITS.MI_TO_KM;
    const prevEffWhMi = (data.prevEfficiency ?? 0) * UNITS.MI_TO_KM;
    const eff = convertEfficiency(effWhMi);
    const prevEff = convertEfficiency(prevEffWhMi);

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
  }, [data, convertDistance, convertEfficiency, distanceUnit, efficiencyUnit, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.weeklyDigest.title', 'This Week')}
      icon={isCompact ? undefined : <CalendarDays className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {metrics.length > 0 ? (
        <WidgetComparisonCard metrics={metrics} compact={isCompact} />
      ) : (
        <EmptyState
          icon={<CalendarDays className="h-5 w-5" />}
          message={t('widget.weeklyDigest.noData', 'No weekly data yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
