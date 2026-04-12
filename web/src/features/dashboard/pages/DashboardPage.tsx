import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  RefreshCw, Bell, Radio, ArrowUpRight, Car, Activity,
  Route, BatteryCharging, Shield,
} from 'lucide-react';
import { request } from '@/api/client';
import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Button } from '@/components/ui/Button';
import { StatusPill } from '@/components/ui/StatusPill';
import { StatusBadge } from '@/components/data-display/StatusBadge';
import { Skeleton } from '@/components/feedback/Skeleton';
import { useSettings } from '@/hooks/useSettings';
import { useRealtimeEvents } from '@/hooks/useRealtimeEvents';
import { useVehicleLive } from '@/hooks/useVehicleLive';
import { usePageTitle } from '@/hooks/usePageTitle';
import { VehicleHero } from '../components/VehicleHero';
import { FleetStatsBar } from '../components/FleetStatsBar';
import { RecentActivity } from '../components/RecentActivity';
import { LiveTelemetry } from '../components/LiveTelemetry';
import { QuickNav } from '../components/QuickNav';
import type {
  Vehicle, VehicleState, FleetAnalytics, Alert,
  Drive, ChargingSession,
  MotorData, ClimateData, SecurityData, TirePressureData, MediaData, LocationData,
} from '../types';

export default function DashboardPage() {
  usePageTitle('Dashboard');
  const { t } = useTranslation('dashboard');
  const queryClient = useQueryClient();
  const {
    convertDistance, convertSpeed, convertTemp, convertEfficiency, convertPressure,
    isFahrenheit, distanceUnit, speedUnit, tempUnit, efficiencyUnit, pressureUnit,
  } = useSettings();

  /* ——— SSE real-time connection ——— */
  const { connected } = useRealtimeEvents({
    onVehicleUpdate: () => queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
    onFallbackToPolling: () => queryClient.invalidateQueries(),
  });

  /* ——— Core data queries ——— */
  const { data: vehicles, isLoading: vehiclesLoading } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });
  const { data: analytics } = useQuery({
    queryKey: ['fleet-analytics', '30'],
    queryFn: () => request<FleetAnalytics>('/analytics/fleet?days=30'),
  });
  const { data: alerts } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => request<Alert[]>('/alerts?limit=10'),
  });

  /* ——— Primary vehicle state ——— */
  const primaryVehicle = vehicles?.[0];
  const { data: primaryStateData, dataUpdatedAt } = useQuery({
    queryKey: ['vehicle-state', primaryVehicle?.id],
    queryFn: () => request<{ state: VehicleState }>(`/vehicles/${primaryVehicle!.id}/state`),
    enabled: !!primaryVehicle,
    refetchInterval: 30_000,
  });
  const primaryState = primaryStateData?.state ?? null;

  /* SSE live signals for firmware etc. */
  const { state: live } = useVehicleLive(primaryVehicle?.id);
  const firmwareVersion = live.version || live.swUpdateVersion || primaryState?.software_version || '—';

  /* ——— Recent drives & charges ——— */
  const { data: recentDrives } = useQuery({
    queryKey: ['drives', primaryVehicle?.id, 'recent-5'],
    queryFn: () => request<Drive[]>(`/drives?vehicle_id=${primaryVehicle!.id}&limit=5`),
    enabled: !!primaryVehicle,
  });
  const { data: recentCharges } = useQuery({
    queryKey: ['charging', primaryVehicle?.id, 'recent-5'],
    queryFn: () => request<ChargingSession[]>(`/charging?vehicle_id=${primaryVehicle!.id}&limit=5`),
    enabled: !!primaryVehicle,
  });

  /* ——— Other vehicles ——— */
  const otherVehicles = vehicles?.slice(1) ?? [];
  const { data: otherStates } = useQuery({
    queryKey: ['other-vehicle-states', otherVehicles.map((v) => v.id).sort()],
    queryFn: async () => {
      const entries = await Promise.all(
        otherVehicles.map(async (v) => {
          try { return [v.id, (await request<{ state: VehicleState }>(`/vehicles/${v.id}/state`)).state] as const; }
          catch { return [v.id, null] as const; }
        }),
      );
      return Object.fromEntries(entries) as Record<number, VehicleState | null>;
    },
    enabled: otherVehicles.length > 0,
  });

  /* ——— Live telemetry queries ——— */
  const telemetryOpts = { enabled: !!primaryVehicle, refetchInterval: 5_000, staleTime: 30_000 };
  const { data: motorData } = useQuery({ queryKey: ['motor-latest', primaryVehicle?.id], queryFn: () => request<MotorData>(`/motor/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });
  const { data: climateData } = useQuery({ queryKey: ['climate-latest', primaryVehicle?.id], queryFn: () => request<ClimateData>(`/climate/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });
  const { data: securityData } = useQuery({ queryKey: ['security-latest', primaryVehicle?.id], queryFn: () => request<SecurityData>(`/security/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });
  const { data: tireData } = useQuery({ queryKey: ['tire-latest', primaryVehicle?.id], queryFn: () => request<TirePressureData>(`/tire-pressure/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });
  const { data: mediaData } = useQuery({ queryKey: ['media-latest', primaryVehicle?.id], queryFn: () => request<MediaData>(`/media/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });
  const { data: locationData } = useQuery({ queryKey: ['location-latest', primaryVehicle?.id], queryFn: () => request<LocationData>(`/location-snapshots/latest?vehicle_id=${primaryVehicle!.id}`), ...telemetryOpts });

  /* ——— Derived values ——— */
  const onlineCount = vehicles?.filter((v) => v.state === 'online').length ?? 0;
  const unreadAlerts = alerts?.filter((a) => !a.is_read).length ?? 0;

  /* ——— Refresh logic ——— */
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const id = setInterval(() => setTick((t) => t + 1), 60_000); return () => clearInterval(id); }, []);

  const lastUpdatedLabel = dataUpdatedAt
    ? `Updated ${formatTimeAgo(new Date(dataUpdatedAt))}`
    : undefined;

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['vehicle-state'] }),
      queryClient.invalidateQueries({ queryKey: ['vehicles'] }),
      queryClient.invalidateQueries({ queryKey: ['fleet-analytics'] }),
      queryClient.invalidateQueries({ queryKey: ['drives'] }),
      queryClient.invalidateQueries({ queryKey: ['charging'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['motor-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['climate-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['security-latest'] }),
      queryClient.invalidateQueries({ queryKey: ['tire-latest'] }),
    ]);
    setIsRefreshing(false);
  };

  /* ——— Header actions ——— */
  const headerActions = (
    <div className="flex items-center gap-3">
      {lastUpdatedLabel && (
        <span className="text-[10px] text-[var(--text-muted)] hidden sm:inline">{lastUpdatedLabel}</span>
      )}
      <Button variant="ghost" size="sm" onClick={handleRefresh} loading={isRefreshing}>
        <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
      </Button>
      {unreadAlerts > 0 && (
        <Link to="/alerts" className="relative">
          <Bell className="h-5 w-5 text-[var(--text-secondary)] hover:text-neon-cyan transition-colors" />
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-neon-red text-[9px] font-bold text-[var(--text-primary)]">
            {unreadAlerts}
          </span>
        </Link>
      )}
      <StatusPill color={connected ? '#10b981' : '#6b7280'} pulse={connected}>
        <Radio className="h-3 w-3" />
        {connected ? 'LIVE' : 'OFFLINE'}
      </StatusPill>
    </div>
  );

  return (
    <PageContainer
      title={t('title', 'Command Center')}
      subtitle={t('subtitle', 'Real-time fleet intelligence and control')}
      loading={vehiclesLoading}
      empty={!vehiclesLoading && (vehicles ?? []).length === 0}
      emptyMessage={t('empty', 'No vehicles found. Connect your Tesla account to get started.')}
      actions={headerActions}
    >
      <div className="space-y-6">
        {vehiclesLoading ? (
          <LoadingSkeleton />
        ) : vehicles && vehicles.length > 0 ? (
          <>
            {/* Primary Vehicle Hero */}
            {primaryVehicle && (
              <VehicleHero
                vehicle={primaryVehicle}
                state={primaryState}
                firmwareVersion={firmwareVersion}
                convertDistance={convertDistance}
                convertSpeed={convertSpeed}
                convertTemp={convertTemp}
                isFahrenheit={isFahrenheit}
                distanceUnit={distanceUnit}
                speedUnit={speedUnit}
                tempUnit={tempUnit}
              />
            )}

            {/* Fleet Stats Bar */}
            <FleetStatsBar
              analytics={analytics}
              vehicleCount={vehicles.length}
              onlineCount={onlineCount}
              unreadAlerts={unreadAlerts}
              recentDrives={recentDrives}
              recentCharges={recentCharges}
              convertDistance={convertDistance}
              convertEfficiency={convertEfficiency}
              distanceUnit={distanceUnit}
              efficiencyUnit={efficiencyUnit}
            />

            {/* Activity + Charts Grid */}
            <RecentActivity
              recentDrives={recentDrives}
              recentCharges={recentCharges}
              analytics={analytics}
              convertDistance={convertDistance}
              convertEfficiency={convertEfficiency}
              distanceUnit={distanceUnit}
              efficiencyUnit={efficiencyUnit}
            />

            {/* Other Vehicles Strip */}
            {otherVehicles.length > 0 && (
              <OtherVehiclesStrip
                vehicles={otherVehicles}
                states={otherStates}
                convertDistance={convertDistance}
                convertTemp={convertTemp}
                distanceUnit={distanceUnit}
              />
            )}

            {/* Quick Navigation */}
            <QuickNav />

            {/* Live Telemetry */}
            <LiveTelemetry
              motorData={motorData}
              climateData={climateData}
              securityData={securityData}
              tireData={tireData}
              mediaData={mediaData}
              locationData={locationData}
              convertTemp={convertTemp}
              convertDistance={convertDistance}
              convertPressure={convertPressure}
              tempUnit={tempUnit}
              distanceUnit={distanceUnit}
              pressureUnit={pressureUnit}
            />
          </>
        ) : (
          <EmptyOnboarding />
        )}
      </div>
    </PageContainer>
  );
}

/* ——— Other Vehicles Strip ——— */
function OtherVehiclesStrip({ vehicles, states, convertDistance, convertTemp, distanceUnit }: {
  vehicles: Vehicle[];
  states: Record<number, VehicleState | null> | undefined;
  convertDistance: (km: number) => number;
  convertTemp: (c: number) => number;
  distanceUnit: string;
}) {
  const { t } = useTranslation('dashboard');
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-title flex items-center gap-2">
          <Car className="h-4 w-4 text-[var(--text-secondary)]" /> {t('other.title', 'Other Vehicles')}
        </h3>
        <Link to="/vehicles" className="text-xs text-[var(--text-muted)] hover:text-neon-cyan transition-colors flex items-center gap-1">
          {t('other.manage', 'Manage fleet')} <ArrowUpRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 scrollbar-thin">
        {vehicles.map((v) => {
          const s = states?.[v.id];
          return (
            <Link key={v.id} to={`/vehicles/${v.id}`} className="block group">
              <GlassPanel hover glow="cyan" className="p-3 sm:p-4 min-w-[180px] transition-all group-hover:scale-[1.02]">
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{v.display_name || v.vin}</p>
                    <StatusBadge status={v.state} size="sm" />
                  </div>
                </div>
                {s ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">{t('other.battery', 'Battery')}</p>
                      <p className="text-sm font-bold" style={{ color: s.battery_level > 50 ? '#10b981' : '#f59e0b' }}>{s.battery_level}%</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">{t('other.range', 'Range')}</p>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{Math.round(convertDistance(s.rated_range))} {distanceUnit}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[var(--text-muted)]">{t('other.temp', 'Temp')}</p>
                      <p className="text-sm font-bold text-[var(--text-primary)]">{s.inside_temp != null ? `${Math.round(convertTemp(s.inside_temp))}°` : '—'}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-600 text-center">{t('other.asleep', 'Asleep')}</p>
                )}
              </GlassPanel>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ——— Empty / Onboarding State ——— */
function EmptyOnboarding() {
  const { t } = useTranslation('dashboard');
  return (
    <GlassPanel className="p-12 text-center relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-neon-cyan/[0.02] via-transparent to-neon-purple/[0.02]" />
      <div className="relative">
        <h2 className="text-2xl font-bold text-[var(--text-primary)] mb-2">
          {t('onboarding.title', 'Welcome to TeslaSync')}
        </h2>
        <p className="text-[var(--text-secondary)] max-w-md mx-auto mb-8">
          {t('onboarding.desc', 'The next-generation Tesla fleet intelligence platform. Connect your Tesla account to start real-time monitoring, analytics, and vehicle control.')}
        </p>
        <Link to="/settings">
          <Button variant="primary">
            {t('onboarding.connect', 'Connect Tesla Account')} <ArrowUpRight className="h-4 w-4 ml-1 inline-block" />
          </Button>
        </Link>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl mx-auto">
          {[
            { icon: Activity, label: t('onboarding.tracking', 'Real-time Tracking'), color: '#00f0ff' },
            { icon: Route, label: t('onboarding.drives', 'Drive History'), color: '#a855f7' },
            { icon: BatteryCharging, label: t('onboarding.charging', 'Charge Analytics'), color: '#10b981' },
            { icon: Shield, label: t('onboarding.control', 'Vehicle Control'), color: '#ef4444' },
          ].map((f) => (
            <GlassPanel key={f.label} className="p-3 text-center">
              <f.icon className="h-6 w-6 mx-auto mb-2" style={{ color: f.color }} />
              <p className="text-xs font-medium text-gray-300">{f.label}</p>
            </GlassPanel>
          ))}
        </div>
      </div>
    </GlassPanel>
  );
}

/* ——— Loading Skeleton ——— */
function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-72" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28" />)}
      </div>
    </div>
  );
}

/* ——— Relative time helper ——— */
function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
