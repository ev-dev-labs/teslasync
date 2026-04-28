import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car, Wifi, Route, Zap } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetStatGrid, type StatGridItem } from './shared';
import type { WidgetProps } from './types';

export default function FleetStatsBarWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles, isLoading: vehiclesLoading } = useVehicles();
  const { data: analytics, isLoading: analyticsLoading, error, isFetching: analyticsFetching, isStale: analyticsStale, isError: analyticsIsError, dataUpdatedAt: analyticsUpdatedAt, refetch: refetchAnalytics } = useFleetAnalytics(30);
  const { convertDistance, distanceUnit } = useSettings();

  const isLoading = vehiclesLoading || analyticsLoading;

  const stats = useMemo(() => {
    const vehicleCount = vehicles?.length ?? 0;
    const onlineCount = vehicles?.filter((v) => v.state === 'online').length ?? 0;
    const totalDistance = convertDistance(analytics?.total_distance_km ?? 0);
    const totalEnergy = analytics?.total_energy_kwh ?? 0;
    return { vehicleCount, onlineCount, totalDistance, totalEnergy };
  }, [vehicles, analytics, convertDistance]);

  const isCompact = size.rows < 2;

  const hasData = (vehicles && vehicles.length > 0) || analytics;

  const items = useMemo<StatGridItem[]>(() => {
    const onlinePct =
      stats.vehicleCount > 0
        ? `${fmtNumber((stats.onlineCount / stats.vehicleCount) * 100, 0)}%`
        : undefined;

    return [
      {
        label: t('widget.fleetStatsBar.vehicles', 'Vehicles'),
        value: stats.vehicleCount,
        icon: <Car className="h-3.5 w-3.5" />,
        trendValue: `${stats.onlineCount} ${t('widget.fleetStatsBar.online', 'online')}`,
      },
      {
        label: t('widget.fleetStatsBar.onlineNow', 'Online Now'),
        value: stats.onlineCount,
        icon: <Wifi className="h-3.5 w-3.5" />,
        trendValue: onlinePct,
      },
      {
        label: t('widget.fleetStatsBar.distance30d', 'Distance (30d)'),
        value: fmtNumber(stats.totalDistance, 1),
        unit: distanceUnit,
        icon: <Route className="h-3.5 w-3.5" />,
      },
      {
        label: t('widget.fleetStatsBar.energy30d', 'Energy (30d)'),
        value: fmtNumber(stats.totalEnergy, 1),
        unit: 'kWh',
        icon: <Zap className="h-3.5 w-3.5" />,
      },
    ];
  }, [stats, t, distanceUnit]);

  return (
    <WidgetShell
      title={t('widget.fleetStatsBar.title', 'Fleet Stats')}
      icon={<Car className="h-3.5 w-3.5 text-cyan-400" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={analyticsUpdatedAt}
      isFetching={analyticsFetching}
      isStale={analyticsStale}
      isError={analyticsIsError}
      onRefresh={() => refetchAnalytics()}
    >
      {hasData ? (
        <WidgetStatGrid stats={items} compact={isCompact} cols={4} />
      ) : (
        <EmptyState
          icon={<Car className="h-5 w-5" />}
          message={t('widget.fleetStatsBar.noData', 'No fleet data available')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
