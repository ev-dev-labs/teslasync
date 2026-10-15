import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { MiniChart } from '@/components/charts';
import { SourceContent } from '@/components/layout';
import { Skeleton } from '@/components/feedback';
import { Caption } from '@/components/ui';
import { combineDataStates } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { isFiniteNumber } from '@/lib/numberFormat';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { DashboardSourceBrief } from '../components/operationalbrief-all/DashboardSourceBrief';
import { dashboardTokens } from '../lib/dashboardTokens';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive, ChargingSession } from '../types';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { sourcePresentation } from '../components/continuation-dashboard-3/sourcePresentation';

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

  const vehiclesState = useDataState({
    ...vehiclesQuery,
    data: vehicles ?? (vehiclesQuery.isLoading || vehiclesQuery.isPending || vehiclesQuery.isError ? undefined : null),
  });
  const analyticsState = useDataState({
    ...analyticsQuery,
    data: analytics ?? (analyticsQuery.isLoading || analyticsQuery.isPending || analyticsQuery.isError ? undefined : null),
  }, { provenance: 'historical' });
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
      metricId: 'count' as const,
      rawValue: vehicleCount,
      label: t('fleet.size', 'Fleet size'),
      value: vehicleCount == null ? null : fmtInt(vehicleCount),
      subtitle: onlineCount == null ? undefined : `${fmtInt(onlineCount)} ${t('fleet.online', 'online')}`,
      source: vehiclesState,
      hasContent: vehicles != null,
    },
    {
      metricId: 'distance' as const,
      rawValue: analytics?.total_distance_km == null ? null : analytics.total_distance_km * METERS_PER_KM,
      label: t('fleet.distance', 'Distance (30d)'),
      value: isFiniteNumber(analytics?.total_distance_km) ? fmtNumber(toDistanceDisplay(analytics.total_distance_km)) : null,
      unit: distanceUnit,
      trend: drivesQuery.data?.map((drive) => drive.distance_m).filter(isFiniteNumber).reverse(),
      trendSource: primaryId > 0 ? drivesState : null,
      trendLabel: t('widget.fleetStats.recentDrives', 'Recent drives'),
      color: '#22d3ee',
      source: analyticsState,
      hasContent: analytics != null,
    },
    {
      metricId: 'energy' as const,
      rawValue: analytics?.total_energy_kwh == null ? null : analytics.total_energy_kwh * 1000,
      label: t('fleet.energy', 'Energy (30d)'),
      value: isFiniteNumber(analytics?.total_energy_kwh) ? fmtNumber(analytics.total_energy_kwh) : null,
      unit: 'kWh',
      trend: chargesQuery.data?.map((charge) => charge.total_energy_added_wh).filter(isFiniteNumber).reverse(),
      trendSource: primaryId > 0 ? chargesState : null,
      trendLabel: t('widget.fleetStats.recentCharges', 'Recent charging sessions'),
      color: '#34d399',
      source: analyticsState,
      hasContent: analytics != null,
    },
    {
      metricId: 'efficiency' as const,
      rawValue: analytics?.avg_efficiency_wh_km == null ? null : analytics.avg_efficiency_wh_km / METERS_PER_KM,
      label: t('fleet.efficiency', 'Efficiency'),
      value: isFiniteNumber(analytics?.avg_efficiency_wh_km) ? fmtNumber(toEfficiencyDisplay(analytics.avg_efficiency_wh_km)) : null,
      unit: efficiencyUnit,
      subtitle: t('fleet.average', 'fleet average'),
      source: analyticsState,
      hasContent: analytics != null,
    },
    {
      metricId: 'count' as const,
      rawValue: null,
      label: t('fleet.alerts', 'Alerts'),
      value: null,
      subtitle: t('fleet.unread', 'unread'),
      source: null,
      hasContent: false,
    },
  ];
  const rawMetrics: readonly StatMetric[] = metrics.map((metric) => ({
    metricId: metric.metricId,
    rawValue: metric.rawValue,
    label: metric.label,
    description: metric.metricId === 'count'
      ? metric.source
        ? t('widget.fleetStats.summary.registryHelp', 'Returned registry count; online caption reflects registry state, not verified live telemetry.')
        : t('widget.fleetStats.summary.alertsHelp', 'Unread alert count has no connected source in this widget; unknown is not zero.')
      : t('widget.fleetStats.summary.analyticsHelp', 'Fleet-wide trailing 30-day analytics, normalized to canonical SI before display.'),
    display: { formatter: () => ({ value: metric.value ?? '—', unit: metric.unit ?? '' }) },
    context: <>
      {metric.subtitle && <Caption>{metric.subtitle}</Caption>}
      {metric.source && (
        <SourceContent
          state={sourcePresentation(metric.source, metric.hasContent)}
          label={metric.label}
          emptyMessage={t('common.noData', 'No data available')}
          emptyContent={<Caption>{t('common.noData', 'No data available')}</Caption>}
          errorMessage={t('widget.fleetStats.sourceError', 'Unable to load {{source}}', { source: metric.label })}
          error={metric.source.fatalError}
          errorRecovery={{ onRetry: metric.source.retry ?? undefined }}
        >{null}</SourceContent>
      )}
      {metric.trendSource && (
        <SourceContent
          state={sourcePresentation(metric.trendSource, (metric.trend?.length ?? 0) > 0)}
          label={metric.trendLabel}
          emptyMessage={t('common.noData', 'No data available')}
          errorMessage={t('widget.fleetStats.sourceError', 'Unable to load {{source}}', { source: metric.trendLabel })}
          error={metric.trendSource.fatalError}
          errorRecovery={{ onRetry: metric.trendSource.retry ?? undefined }}
          loadingContent={<Skeleton className="h-6 w-full" />}
          emptyContent={<Caption>{t('common.noData', 'No data available')}</Caption>}
        >
          {metric.trend && metric.trend.length > 0 ? (
            <div className={dashboardTokens.unit}>
              <MiniChart data={metric.trend} color={metric.color} height={24} width={60} />
            </div>
          ) : <Caption>{t('common.noData', 'No data available')}</Caption>}
        </SourceContent>
      )}
    </>,
  }));

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
      <DashboardSourceBrief
        metrics={rawMetrics}
        state={dataState}
        eyebrow={t('widget.fleetStats.summary.eyebrow', 'Independent fleet sources')}
        title={t('widget.fleetStats.summary.title', 'Fleet operating totals')}
        description={t('widget.fleetStats.summary.description', 'Registry counts and 30-day fleet analytics are independent from the first registered vehicle’s five recent drives and charging sessions. Those sparklines are not the fleet-wide analysis window; unread alerts have no source here.')}
        scope={t('widget.fleetStats.summary.scope', 'Fleet totals · first-vehicle recent series')}
        testId="fleet-stats-operational-brief"
      />
    </WidgetShell>
  );
}
