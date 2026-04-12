import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { request } from '@/api/client';
import { PageContainer } from '@/components/layout/PageContainer';
import { Grid } from '@/components/layout/Grid';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { StatCard } from '@/components/data-display/StatCard';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { Timeline } from '@/components/data-display/Timeline';
import { VehicleHeroCard } from '@/components/vehicles/VehicleHeroCard';

interface Vehicle {
  id: number;
  display_name: string;
  model: string;
  vin: string;
  state: string;
}

interface VehicleState {
  battery_level: number;
  rated_range: number;
  inside_temp: number;
  outside_temp: number;
  odometer: number;
  is_charging: boolean;
  is_locked: boolean;
  sentry_mode: boolean;
  software_version: string;
  power: number;
}

interface FleetAnalytics {
  total_vehicles: number;
  total_drives: number;
  total_charging_sessions: number;
  total_distance_km: number;
  total_energy_kwh: number;
  total_cost: number;
  avg_efficiency_wh_km: number;
  period_days: number;
}

interface Alert {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

interface DriveSession {
  id: number;
  start_address: string;
  end_address: string;
  distance_km: number;
  started_at: string;
}

interface ChargeSession {
  id: number;
  energy_added_kwh: number;
  cost: number;
  started_at: string;
}

export default function DashboardPage() {
  const { t } = useTranslation('dashboard');

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const primaryVehicle = vehicles?.[0];

  const { data: primaryStateData } = useQuery({
    queryKey: ['vehicle-state', primaryVehicle?.id],
    queryFn: () => request<{ state: VehicleState }>(`/vehicles/${primaryVehicle!.id}/state`),
    enabled: !!primaryVehicle,
    refetchInterval: 30_000,
  });
  const primaryState = primaryStateData?.state ?? null;

  const { data: analytics } = useQuery({
    queryKey: ['fleet-analytics', '30'],
    queryFn: () => request<FleetAnalytics>('/analytics/fleet?days=30'),
  });

  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => request<Alert[]>('/alerts?limit=5'),
  });

  const { data: recentDrives } = useQuery({
    queryKey: ['drives', primaryVehicle?.id, 'recent'],
    queryFn: () => request<DriveSession[]>(`/drives?vehicle_id=${primaryVehicle!.id}&limit=5`),
    enabled: !!primaryVehicle,
  });

  const { data: recentCharges } = useQuery({
    queryKey: ['charging', primaryVehicle?.id, 'recent'],
    queryFn: () => request<ChargeSession[]>(`/charging?vehicle_id=${primaryVehicle!.id}&limit=5`),
    enabled: !!primaryVehicle,
  });

  const onlineCount = (vehicles ?? []).filter((v) => v.state === 'online').length;
  const unreadAlerts = (alerts ?? []).filter((a) => !a.is_read).length;

  return (
    <PageContainer
      title={t('title', 'Command Center')}
      subtitle={t('subtitle', 'Real-time fleet intelligence and control')}
      loading={vehiclesLoading}
      empty={!vehiclesLoading && (vehicles ?? []).length === 0}
      emptyMessage={t('empty', 'No vehicles found. Connect your Tesla account to get started.')}
      actions={
        <div className="flex items-center gap-3">
          {unreadAlerts > 0 && (
            <Link to="/alerts">
              <Badge variant="danger" dot>{unreadAlerts} {t('alerts', 'alerts')}</Badge>
            </Link>
          )}
          <Badge variant={onlineCount > 0 ? 'success' : 'neutral'}>
            {onlineCount}/{(vehicles ?? []).length} {t('online', 'online')}
          </Badge>
        </div>
      }
    >
      {/* Primary Vehicle Hero Card */}
      {primaryVehicle && (
        <VehicleHeroCard vehicle={primaryVehicle} vehicleState={primaryState} />
      )}

      {/* Other Vehicles Strip */}
      {(vehicles ?? []).length > 1 && (
        <div className="mt-6">
          <h2 className="text-sm font-medium text-gray-400 mb-3">{t('otherVehicles', 'Other Vehicles')}</h2>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {(vehicles ?? []).slice(1).map((v) => (
              <Link key={v.id} to={`/vehicles/${v.id}`}>
                <GlassPanel hover glow="cyan" className="p-4 min-w-[200px]">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{v.display_name}</p>
                      <StatusBadge status={v.state} size="sm" />
                    </div>
                  </div>
                </GlassPanel>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Fleet Stats (30-day) */}
      <div className="mt-6">
        <h2 className="text-sm font-medium text-gray-400 mb-3">{t('fleetStats', 'Fleet Stats (30 days)')}</h2>
        <Grid cols={{ default: 2, lg: 4 }} gap={4}>
          <StatCard
            label={t('stats.distance', 'Distance')}
            value={Math.round((analytics?.total_distance_km ?? 0) * 0.621371)}
            unit="mi"
          />
          <StatCard
            label={t('stats.energy', 'Energy')}
            value={`${(analytics?.total_energy_kwh ?? 0).toFixed(1)}`}
            unit="kWh"
          />
          <StatCard
            label={t('stats.cost', 'Cost')}
            value={`$${(analytics?.total_cost ?? 0).toFixed(2)}`}
          />
          <StatCard
            label={t('stats.efficiency', 'Efficiency')}
            value={Math.round(analytics?.avg_efficiency_wh_km ?? 0)}
            unit="Wh/km"
          />
        </Grid>
      </div>

      {/* Activity Summary */}
      <Grid cols={{ default: 1, lg: 3 }} gap={4}>
        <StatCard label={t('stats.drives', 'Drives')} value={analytics?.total_drives ?? 0} />
        <StatCard label={t('stats.charges', 'Charges')} value={analytics?.total_charging_sessions ?? 0} />
        <StatCard
          label={t('stats.alerts', 'Unread Alerts')}
          value={unreadAlerts}
          trend={unreadAlerts > 0 ? { direction: 'up' as const, value: `${unreadAlerts} new` } : undefined}
        />
      </Grid>

      {/* Recent Activity */}
      <Grid cols={{ default: 1, lg: 2 }} gap={4}>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('recentDrives', 'Recent Drives')}</h3>
            <Link to="/drives" className="text-xs text-blue-400 hover:underline">{t('viewAll', 'View all')}</Link>
          </div>
          <Timeline
            items={(recentDrives ?? []).slice(0, 5).map((d) => ({
              title: `${d.start_address || 'Start'} → ${d.end_address || 'End'}`,
              subtitle: `${((d.distance_km ?? 0) * 0.621371).toFixed(1)} mi`,
              time: d.started_at ? new Date(d.started_at).toLocaleDateString() : '—',
              color: '#3b82f6',
            }))}
          />
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{t('recentCharges', 'Recent Charges')}</h3>
            <Link to="/charging" className="text-xs text-blue-400 hover:underline">{t('viewAll', 'View all')}</Link>
          </div>
          <Timeline
            items={(recentCharges ?? []).slice(0, 5).map((c) => ({
              title: `${(c.energy_added_kwh ?? 0).toFixed(1)} kWh`,
              subtitle: c.cost ? `$${(c.cost ?? 0).toFixed(2)}` : undefined,
              time: c.started_at ? new Date(c.started_at).toLocaleDateString() : '—',
              color: '#f59e0b',
            }))}
          />
        </Card>
      </Grid>
    </PageContainer>
  );
}
