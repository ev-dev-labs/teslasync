import { useQuery } from '@tanstack/react-query';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useFleetAnalytics } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { request } from '@/api/client';
import { FleetStatsBar } from '../components/FleetStatsBar';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';
import type { Drive, ChargingSession } from '../types';
import { convertDistanceFromSI } from '@/lib/unitConversion';

export default function FleetStatsWidget(_props: WidgetProps) {
  const { data: vehicles } = useVehicles();
  const { data: analytics, isFetching: analyticsFetching, isStale: analyticsStale, isError: analyticsError, dataUpdatedAt: analyticsUpdatedAt, refetch: refetchAnalytics } = useFleetAnalytics(30);
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const toEfficiencyDisplay = (whPerKm: number) => unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;

  const primaryId = vehicles?.[0]?.id ?? 0;
  const { data: recentDrives } = useQuery({
    queryKey: ['drives', primaryId, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${primaryId}&limit=5`),
    enabled: primaryId > 0,
  });
  const { data: recentCharges } = useQuery({
    queryKey: ['charging', primaryId, 'recent-5'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${primaryId}&limit=5`),
    enabled: primaryId > 0,
  });

  const vehicleCount = vehicles?.length ?? 0;
  const onlineCount = vehicles?.filter((v) => v.state === 'online').length ?? 0;

  return (
    <WidgetShell noPadding updatedAt={analyticsUpdatedAt} isFetching={analyticsFetching} isStale={analyticsStale} isError={analyticsError} onRefresh={() => refetchAnalytics()}>
      <FleetStatsBar
        analytics={analytics as Parameters<typeof FleetStatsBar>[0]['analytics']}
        vehicleCount={vehicleCount}
        onlineCount={onlineCount}
        unreadAlerts={0}
        recentDrives={recentDrives as Parameters<typeof FleetStatsBar>[0]['recentDrives']}
        recentCharges={recentCharges as Parameters<typeof FleetStatsBar>[0]['recentCharges']}
        toDistanceDisplay={toDistanceDisplay}
        toEfficiencyDisplay={toEfficiencyDisplay}
        distanceUnit={distanceUnit}
        efficiencyUnit={efficiencyUnit}
      />
    </WidgetShell>
  );
}
