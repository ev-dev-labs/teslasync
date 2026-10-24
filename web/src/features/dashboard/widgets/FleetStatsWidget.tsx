import { useTranslation } from 'react-i18next';
import { combineDataStates } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { WidgetStatGrid, type StatGridItem } from './shared';

/** 1 mile = 1.609344 km exactly — restates Wh/km efficiency as Wh/mi. */
const KM_PER_MILE = 1.609344;
/** SI prefix: 1 km = 1000 m. Used to rebuild metres from the derived-SI km field. */
const METERS_PER_KM = 1000;

export default function FleetStatsWidget(_props: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const vehiclesQuery = useVehicles();
  const analyticsQuery = useFleetAnalytics(30);
  const { data: vehicles } = vehiclesQuery;
  const { data: analytics } = analyticsQuery;
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  const vehiclesState = useDataState({
    ...vehiclesQuery,
    data: vehicles ?? (vehiclesQuery.isLoading || vehiclesQuery.isPending || vehiclesQuery.isError ? undefined : null),
  });
  const analyticsState = useDataState({
    ...analyticsQuery,
    data: analytics ?? (analyticsQuery.isLoading || analyticsQuery.isPending || analyticsQuery.isError ? undefined : null),
  }, { provenance: 'historical' });
  const sources = [vehiclesState, analyticsState];
  const hasData = sources.some((source) => source.hasData);
  const refresh = () => {
    void vehiclesQuery.refetch?.();
    void analyticsQuery.refetch();
  };
  const combined = combineDataStates(sources);
  const dataState = {
    ...combined,
    fatalError: hasData ? null : sources.find((source) => source.fatalError)?.fatalError ?? null,
    data: hasData ? { vehicles, analytics } : undefined,
    hasData,
    retry: refresh,
  };
  const vehicleCount = vehicles == null ? null : vehicles.length;
  const stats: StatGridItem[] = [
    {
      label: t('fleet.size', 'Fleet size'),
      value: vehicleCount == null ? null : fmtInt(vehicleCount),
    },
    {
      label: t('fleet.distance', 'Distance (30d)'),
      value: isFiniteNumber(analytics?.total_distance_km)
        ? fmtNumber(toDistanceDisplay(analytics.total_distance_km), 0)
        : null,
      unit: distanceUnit,
    },
    {
      label: t('fleet.energy', 'Energy (30d)'),
      value: isFiniteNumber(analytics?.total_energy_kwh)
        ? fmtNumber(analytics.total_energy_kwh, 1)
        : null,
      unit: 'kWh',
    },
    {
      label: t('fleet.efficiency', 'Efficiency'),
      value: isFiniteNumber(analytics?.avg_efficiency_wh_km)
        ? fmtNumber(toEfficiencyDisplay(analytics.avg_efficiency_wh_km), 1)
        : null,
      unit: efficiencyUnit,
    },
  ];

  return (
    <WidgetShell
      title={t('widget.fleetStatsBar.title', 'Fleet stats')}
      dataState={hasData || vehiclesQuery.isLoading || analyticsQuery.isLoading || dataState.fatalError ? dataState : undefined}
      updatedAt={combined.updatedAt ?? 0}
      isFetching={sources.some((source) => source.isRefreshing)}
      isStale={sources.some((source) => source.status === 'stale')}
      isError={sources.some((source) => source.fatalError != null || source.refreshError != null)}
      onRefresh={refresh}
    >
      <section aria-label={t('widget.fleetStats.summary.title', 'Fleet operating totals')} data-testid="fleet-stats">
        <WidgetStatGrid stats={stats} cols={2} maxPerRow={2} />
      </section>
    </WidgetShell>
  );
}
