import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MiniChart } from '@/components/charts';
import { combineDataStates } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { WidgetBigNumber } from './shared';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive, ChargingSession } from '../types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

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
  // analytics.total_distance_km is a derived-SI convenience already expressed in
  // kilometres (the backend computes it as DistanceM / 1000). Reconstruct true SI
  // metres before the SI→display converter — otherwise the tile is off by the
  // 1000× km→m prefix (1,000 km would render as "1 km" / "0.62 mi").
  const toDistanceDisplay = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;

  const primaryId = vehicles?.[0]?.id ?? 0;
  const drivesQuery = useQuery({
    queryKey: ['drives', primaryId, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${primaryId}&limit=5`),
    enabled: primaryId > 0,
  });
  const chargesQuery = useQuery({
    queryKey: ['charging', primaryId, 'recent-5'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${primaryId}&limit=5`),
    enabled: primaryId > 0,
  });

  const vehiclesState = useDataState(vehiclesQuery);
  const analyticsState = useDataState(analyticsQuery, { provenance: 'historical' });
  const drivesState = useDataState(drivesQuery, { provenance: 'historical' });
  const chargesState = useDataState(chargesQuery, { provenance: 'historical' });
  const sources = primaryId > 0
    ? [vehiclesState, analyticsState, drivesState, chargesState]
    : [vehiclesState, analyticsState];
  const hasData = sources.some((source) => source.hasData);
  const refresh = () => {
    void vehiclesQuery.refetch?.();
    void analyticsQuery.refetch();
    if (primaryId > 0) {
      void drivesQuery.refetch();
      void chargesQuery.refetch();
    }
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
  const onlineCount = vehicles == null ? null : vehicles.filter((v) => v.state === 'online').length;
  const metrics = [
    {
      label: t('fleet.size', 'Fleet size'),
      value: vehicleCount == null ? null : fmtInt(vehicleCount),
      subtitle: onlineCount == null ? undefined : `${fmtInt(onlineCount)} ${t('fleet.online', 'online')}`,
    },
    {
      label: t('fleet.distance', 'Distance (30d)'),
      value: isFiniteNumber(analytics?.total_distance_km) ? fmtNumber(toDistanceDisplay(analytics.total_distance_km)) : null,
      unit: distanceUnit,
      trend: drivesQuery.data?.map((drive) => drive.distance_m).filter(isFiniteNumber).reverse(),
      color: '#22d3ee',
    },
    {
      label: t('fleet.energy', 'Energy (30d)'),
      value: isFiniteNumber(analytics?.total_energy_kwh) ? fmtNumber(analytics.total_energy_kwh) : null,
      unit: 'kWh',
      trend: chargesQuery.data?.map((charge) => charge.total_energy_added_wh).filter(isFiniteNumber).reverse(),
      color: '#34d399',
    },
    {
      label: t('fleet.efficiency', 'Efficiency'),
      value: isFiniteNumber(analytics?.avg_efficiency_wh_km) ? fmtNumber(toEfficiencyDisplay(analytics.avg_efficiency_wh_km)) : null,
      unit: efficiencyUnit,
      subtitle: t('fleet.average', 'fleet average'),
    },
    {
      label: t('fleet.alerts', 'Alerts'),
      value: null,
      subtitle: t('fleet.unread', 'unread'),
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
      <div className="grid min-w-0 grid-cols-1 gap-3 @xs:grid-cols-2 @sm:grid-cols-3 @lg:grid-cols-5">
        {metrics.map((metric) => (
          <div key={metric.label} role="group" aria-label={metric.label} className="flex min-w-0 flex-col gap-2">
            <WidgetBigNumber
              label={metric.label}
              value={metric.value}
              unit={metric.unit}
              subtitle={metric.subtitle}
              size="secondary"
            />
            {metric.trend && metric.trend.length > 0 && (
              <div className={dashboardTokens.unit}>
                <MiniChart data={metric.trend} color={metric.color} height={24} width={60} />
              </div>
            )}
          </div>
        ))}
      </div>
    </WidgetShell>
  );
}
