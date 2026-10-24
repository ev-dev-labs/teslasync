import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useRangeState } from '@/hooks/useRangeState';
import { WidgetStatGrid, type StatGridItem } from './shared';

/**
 * Convert a fleet-analytics `total_distance_km` value to the user's display
 * unit. `FleetAnalytics.total_distance_km` is SI **kilometres**, but the shared
 * `convertDistanceFromSI` expects **metres** — so the value is scaled to metres
 * first (the same meter-floor pattern used by `HeroGauges` and
 * `YearSummaryCard`). Passing kilometres straight through previously
 * under-reported fleet distance by 1000×. A non-finite payload collapses to 0
 * so the tile never renders "NaN".
 */
export function toDistanceDisplay(totalDistanceKm: number, to: DistanceUnitPref): number {
  if (!Number.isFinite(totalDistanceKm)) return 0;
  return convertDistanceFromSI(totalDistanceKm * 1000, to);
}

export default function FleetStatsBarWidget({ size }: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { startInstant, endInstantExclusive } = useRangeState({ defaultPresetId: '30d' });
  const vehiclesQuery = useVehicles();
  const analyticsQuery = useFleetAnalytics({ start: startInstant, end: endInstantExclusive });
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const {
    data: analytics,
    isLoading: analyticsLoading,
    error,
    isFetching: analyticsFetching,
    isStale: analyticsStale,
    isError: analyticsIsError,
    dataUpdatedAt: analyticsUpdatedAt,
    refetch: refetchAnalytics,
  } = analyticsQuery;
  const vehiclesState = useDataState(vehiclesQuery);
  const analyticsState = useDataState(analyticsQuery, { provenance: 'historical' });
  const combined = combineDataStates([vehiclesState, analyticsState]);
  const retained = vehicles !== undefined || analytics !== undefined;
  const refresh = () => {
    void vehiclesQuery.refetch?.();
    void refetchAnalytics();
  };
  const dataState = {
    ...combined,
    fatalError: retained ? null : analyticsState.fatalError ?? vehiclesState.fatalError,
    hasData: retained,
    data: retained ? { vehicles, analytics } : undefined,
    retry: refresh,
  };
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const isLoading = vehiclesLoading || analyticsLoading;
  const hasData = (vehicles != null && vehicles.length > 0) || analytics != null;
  const stats = useMemo<StatGridItem[]>(() => {
    const vehicleList = vehicles ?? [];
    const vehicleCount = vehicles == null ? null : vehicleList.length;
    const onlineCount = vehicles == null
      ? null
      : vehicleList.filter((vehicle) => vehicle.state === 'online').length;
    const asleepCount = vehicles == null
      ? null
      : vehicleList.filter((vehicle) => vehicle.state === 'asleep' || vehicle.state === 'offline').length;

    return [
      {
        label: t('widget.fleetStatsBar.vehicles', 'Vehicles'),
        value: vehicleCount == null ? null : fmtInt(vehicleCount),
      },
      {
        label: t('widget.fleetStatsBar.online', "online"),
        value: onlineCount == null ? null : fmtInt(onlineCount),
        sublabel: asleepCount != null && asleepCount > 0
          ? t('widget.fleetStatsBar.asleepCount', '{{count}} asleep/offline', { count: asleepCount })
          : undefined,
      },
      {
        label: t('widget.fleetStatsBar.distance30d', 'Distance (30d)'),
        value: isFiniteNumber(analytics?.total_distance_km)
          ? fmtNumber(toDistanceDisplay(analytics.total_distance_km, distanceUnit), 0)
          : null,
        unit: distanceUnit,
      },
      {
        label: t('widget.fleetStatsBar.energy30d', 'Energy (30d)'),
        value: isFiniteNumber(analytics?.total_energy_kwh)
          ? fmtNumber(analytics.total_energy_kwh, 1)
          : null,
        unit: 'kWh',
      },
    ];
  }, [vehicles, analytics, distanceUnit, t, fmtNumber, fmtInt]);

  return (
    <WidgetShell
      dataState={retained || isLoading || dataState.fatalError ? dataState : undefined}
      title={t('widget.fleetStatsBar.title', 'Fleet stats')}
      icon={<Car className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={analyticsUpdatedAt}
      isFetching={analyticsFetching}
      isStale={analyticsStale}
      isError={analyticsIsError}
      onRefresh={refresh}
    >
      {hasData ? (
        <section aria-label={t('widget.fleetStats.summary.title', 'Fleet operating totals')} data-testid="fleet-stats-bar">
          <WidgetStatGrid
            stats={stats}
            cols={size.cols >= 4 ? 4 : 2}
            maxPerRow={size.cols >= 4 ? 4 : 2}
          />
        </section>
      ) : (
        <EmptyState
          variant="informational"
          icon={<Car className="h-5 w-5" />}
          message={t('widget.fleetStatsBar.noData', 'No fleet data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
