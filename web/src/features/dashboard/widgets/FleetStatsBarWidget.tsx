import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';

import { WidgetShell } from './WidgetShell';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import type { WidgetProps } from './types';
import { convertDistanceFromSI, type DistanceUnitPref } from '@/lib/unitConversion';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates } from '@/api/dataState';

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

export default function FleetStatsBarWidget(_props: WidgetProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const vehiclesQuery = useVehicles();
  const analyticsQuery = useFleetAnalytics(30);
  const { data: vehicles, isLoading: vehiclesLoading } = vehiclesQuery;
  const { data: analytics, isLoading: analyticsLoading, error, isFetching: analyticsFetching, isStale: analyticsStale, isError: analyticsIsError, dataUpdatedAt: analyticsUpdatedAt, refetch: refetchAnalytics } = analyticsQuery;
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

  const stats = useMemo(() => {
    const vehicleList = vehicles ?? [];
    const vehicleCount = vehicleList.length;
    const onlineCount = vehicleList.filter((v) => v.state === 'online').length;
    const totalDistance = toDistanceDisplay(analytics?.total_distance_km ?? 0, distanceUnit);
    const totalEnergy = analytics?.total_energy_kwh ?? 0;
    return { vehicleCount, onlineCount, totalDistance, totalEnergy };
  }, [vehicles, analytics, distanceUnit]);

  const hasData = (vehicles && vehicles.length > 0) || analytics;

  const items = useMemo<StatMetric[]>(() => {
    const onlinePct =
      stats.vehicleCount > 0
        ? `${fmtNumber((stats.onlineCount / stats.vehicleCount) * 100)}%`
        : undefined;

    return [
      {
        label: t('widget.fleetStatsBar.vehicles', 'Vehicles'),
        metricId: 'count',
        rawValue: vehicles == null ? null : stats.vehicleCount,
        description: t('widget.fleetStatsBar.summary.vehiclesHelp', 'Count from the returned vehicle registry, not the 30-day analytics rollup.'),
        context: vehicles == null ? undefined : `${fmtInt(stats.onlineCount)} ${t('widget.fleetStatsBar.online', 'online')}`,
      },
      {
        label: t('widget.fleetStatsBar.onlineNow', 'Online now'),
        metricId: 'count',
        rawValue: vehicles == null ? null : stats.onlineCount,
        description: t('widget.fleetStatsBar.summary.onlineHelp', 'Registry entries whose state is online; not verified live-state coverage.'),
        context: onlinePct,
      },
      {
        label: t('widget.fleetStatsBar.distance30d', 'Distance (30d)'),
        metricId: 'distance',
        rawValue: analytics?.total_distance_km == null ? null : analytics.total_distance_km * 1000,
        description: t('widget.fleetStatsBar.summary.distanceHelp', 'Fleet-wide trailing 30-day distance; source kilometres normalized to metres.'),
        display: { formatter: raw => ({ value: fmtNumber(toDistanceDisplay(raw / 1000, distanceUnit)), unit: distanceUnit }) },
      },
      {
        label: t('widget.fleetStatsBar.energy30d', 'Energy (30d)'),
        metricId: 'energy',
        rawValue: analytics?.total_energy_kwh == null ? null : analytics.total_energy_kwh * 1000,
        description: t('widget.fleetStatsBar.summary.energyHelp', 'Fleet-wide trailing 30-day energy; source kilowatt-hours normalized to watt-hours, retaining the source kWh display.'),
        display: { formatter: raw => ({ value: fmtNumber(raw / 1000), unit: 'kWh' }) },
      },
    ];
  }, [stats, vehicles, analytics, t, distanceUnit, fmtNumber, fmtInt]);

  return (
    <WidgetShell
      dataState={retained || isLoading || dataState.fatalError ? dataState : undefined}
      title={t('widget.fleetStatsBar.title', 'Fleet stats')}
      icon={<Car className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={analyticsUpdatedAt}
      isFetching={analyticsFetching}
      isStale={analyticsStale}
      isError={analyticsIsError}
      onRefresh={refresh}
    >
      {hasData ? (
        <DashboardSourceBrief
          metrics={items}
          state={dataState}
          eyebrow={t('widget.fleetStatsBar.summary.eyebrow', 'Fleet sources')}
          title={t('widget.fleetStatsBar.summary.title', 'Fleet summary')}
          description={t('widget.fleetStatsBar.summary.description', 'Current registry counts and trailing 30-day analytics have independent sources and windows. Exact analytics bounds and coverage are not supplied.')}
          scope={t('widget.fleetStatsBar.summary.scope', 'Fleet-wide · registry snapshot / 30-day analytics')}
          testId="fleet-stats-bar-operational-brief"
        />
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Car className="h-5 w-5" />}
          message={t('widget.fleetStatsBar.noData', 'No fleet data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
