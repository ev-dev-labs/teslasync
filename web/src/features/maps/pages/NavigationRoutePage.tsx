import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  Navigation,
  MapPin,
  Home,
  Briefcase,
  Compass,
  Gauge,
  Clock,
  BatteryCharging,
  Route,
  Zap,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ChartTooltip,
  ChartGradient,
  chartGrid,
  axisTick,
  chartMargin,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationSnapshot {
  id: number;
  vehicle_id: number;
  latitude: number;
  longitude: number;
  heading: number;
  speed: number;
  odometer: number;
  destination_name: string;
  destination_location: string;
  destination_miles_remaining: number;
  destination_minutes_remaining: number;
  destination_traffic_minutes_delay: number;
  energy_at_arrival: number;
  located_at_home: boolean;
  located_at_work: boolean;
  homelink_nearby: boolean;
  active_route: boolean;
  created_at: string;
}

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

/* ------------------------------------------------------------------ */
/*  Helper: heading label                                              */
/* ------------------------------------------------------------------ */

function headingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8] ?? '—';
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Location Status Card                                */
/* ------------------------------------------------------------------ */

interface LocationStatusCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  active: boolean;
}

function LocationStatusCard({ icon, label, value, active }: LocationStatusCardProps) {
  return (
    <GlassPanel
      className={clsx('flex items-center gap-4 p-4', active && 'ring-1 ring-emerald-500/40')}
      glow={active ? 'green' : 'none'}
    >
      <span
        className={clsx(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          active
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-gray-500/20 text-gray-400',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-[var(--text-muted)]">{label}</span>
        <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">
          {value}
        </span>
      </span>
      <Badge variant={active ? 'success' : 'neutral'} size="sm">
        {active ? '✓' : '—'}
      </Badge>
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Traffic Delay Badge                                 */
/* ------------------------------------------------------------------ */

interface TrafficDelayBadgeProps {
  minutes: number;
  t: ReturnType<typeof useTranslation>['t'];
}

function TrafficDelayBadge({ minutes, t }: TrafficDelayBadgeProps) {
  const variant: 'success' | 'warning' | 'danger' =
    minutes < 5 ? 'success' : minutes <= 15 ? 'warning' : 'danger';

  return (
    <Badge variant={variant} size="sm" dot>
      {fmtNumber(minutes, 0)} {t('nav.minDelay', 'min delay')}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Waypoint row                                        */
/* ------------------------------------------------------------------ */

interface Waypoint {
  name: string;
  type: 'supercharger' | 'destination' | 'waypoint';
  distance: number;
}

function buildWaypoints(latest: LocationSnapshot): Waypoint[] {
  if (!latest.active_route || !latest.destination_name) return [];
  return [
    {
      name: latest.destination_name,
      type: 'destination',
      distance: latest.destination_miles_remaining,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function NavigationRoutePage() {
  const { t } = useTranslation();
  usePageTitle(t('nav.pageTitle', 'Navigation & Route'));

  /* ---- vehicle selector state ---- */
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | null>(null);

  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const vehicleId = selectedVehicleId ?? vehicles?.[0]?.id ?? null;

  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const handleVehicleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedVehicleId(Number(e.target.value));
    },
    [],
  );

  /* ---- latest snapshot ---- */
  const {
    data: latest,
    isLoading: latestLoading,
    refetch: refetchLatest,
  } = useQuery<LocationSnapshot>({
    queryKey: ['location-latest', vehicleId],
    queryFn: () =>
      request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${vehicleId}`,
      ),
    enabled: vehicleId !== null,
    refetchInterval: 15_000,
  });

  /* ---- history ---- */
  const {
    data: history,
    isLoading: historyLoading,
    refetch: refetchHistory,
  } = useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', vehicleId],
    queryFn: () =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${vehicleId}&limit=200`,
      ),
    enabled: vehicleId !== null,
  });

  /* ---- derived ---- */
  const isLoading = vehiclesLoading || latestLoading;
  const hasActiveRoute = latest?.active_route ?? false;

  const waypoints = useMemo(
    () => (latest ? buildWaypoints(latest) : []),
    [latest],
  );

  const chartData = useMemo(
    () =>
      [...(history ?? [])]
        .sort(
          (a, b) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
        )
        .map((s) => ({
          time: formatDateTime(s.created_at),
          speed: s.speed,
          odometer: s.odometer,
        })),
    [history],
  );

  /* ---- avg speed ---- */
  const avgSpeed = useMemo(() => {
    if (!history?.length) return 0;
    const total = history.reduce((sum, s) => sum + s.speed, 0);
    return total / history.length;
  }, [history]);

  /* ---- table columns ---- */
  const historyColumns: Column<LocationSnapshot>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('nav.col.time', 'Time'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="whitespace-nowrap text-xs font-mono text-[var(--text-muted)]">
            {formatDateTime(row.created_at)}
          </span>
        ),
      },
      {
        key: 'latitude',
        header: t('nav.col.lat', 'Lat'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="font-mono text-[var(--text-primary)]">
            {row.latitude.toFixed(6)}
          </span>
        ),
      },
      {
        key: 'longitude',
        header: t('nav.col.lon', 'Lon'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="font-mono text-[var(--text-primary)]">
            {row.longitude.toFixed(6)}
          </span>
        ),
      },
      {
        key: 'speed',
        header: t('nav.col.speed', 'Speed'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="text-[var(--text-primary)]">
            {fmtNumber(row.speed, 1)} mph
          </span>
        ),
      },
      {
        key: 'heading',
        header: t('nav.col.heading', 'Heading'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="text-[var(--text-primary)]">
            {fmtNumber(row.heading, 0)}° {headingToCardinal(row.heading)}
          </span>
        ),
      },
      {
        key: 'odometer',
        header: t('nav.col.odometer', 'Odometer'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="font-mono text-[var(--text-muted)]">
            {fmtNumber(row.odometer, 1)} mi
          </span>
        ),
      },
    ],
    [t],
  );

  /* ---- waypoint columns ---- */
  const waypointColumns: Column<Waypoint>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('nav.wp.name', 'Name'),
        render: (row: Waypoint) => (
          <span className="flex items-center gap-2 text-[var(--text-primary)]">
            {row.type === 'supercharger' ? (
              <Zap className="h-4 w-4 text-red-400" />
            ) : row.type === 'destination' ? (
              <MapPin className="h-4 w-4 text-neon-cyan" />
            ) : (
              <Route className="h-4 w-4 text-amber-400" />
            )}
            {row.name}
          </span>
        ),
      },
      {
        key: 'type',
        header: t('nav.wp.type', 'Type'),
        render: (row: Waypoint) => (
          <Badge
            variant={
              row.type === 'supercharger'
                ? 'danger'
                : row.type === 'destination'
                  ? 'info'
                  : 'neutral'
            }
            size="sm"
          >
            {row.type}
          </Badge>
        ),
      },
      {
        key: 'distance',
        header: t('nav.wp.distance', 'Distance'),
        render: (row: Waypoint) => (
          <span className="font-mono text-[var(--text-muted)]">
            {fmtNumber(row.distance, 1)} mi
          </span>
        ),
      },
    ],
    [t],
  );

  /* ---- sort state ---- */
  const [sortKey, setSortKey] = useState('time');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const handleSort = useCallback(
    (key: string) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortKey(key);
        setSortDir('asc');
      }
    },
    [sortKey],
  );

  const sortedHistory = useMemo(() => {
    const data = [...(history ?? [])];
    const accessor = (row: LocationSnapshot, key: string): number | string => {
      switch (key) {
        case 'time':
          return row.created_at;
        case 'latitude':
          return row.latitude;
        case 'longitude':
          return row.longitude;
        case 'speed':
          return row.speed;
        case 'heading':
          return row.heading;
        case 'odometer':
          return row.odometer;
        default:
          return '';
      }
    };
    data.sort((a, b) => {
      const aV = accessor(a, sortKey);
      const bV = accessor(b, sortKey);
      const cmp = aV < bV ? -1 : aV > bV ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return data;
  }, [history, sortKey, sortDir]);

  /* ---- refresh handler ---- */
  const handleRefresh = useCallback(() => {
    void refetchLatest();
    void refetchHistory();
  }, [refetchLatest, refetchHistory]);

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('nav.pageTitle', 'Navigation & Route')}
      subtitle={t('nav.subtitle', 'Live location tracking and navigation status')}
      loading={isLoading}
      error={vehiclesError as Error | null}
      empty={!vehicleId && !vehiclesLoading}
      emptyMessage={t('nav.noVehicles', 'No vehicles available.')}
      actions={
        <span className="flex items-center gap-3">
          <Select
            value={String(vehicleId ?? '')}
            onChange={handleVehicleChange}
            options={vehicleOptions}
            placeholder={t('nav.selectVehicle', 'Select vehicle')}
          />
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={handleRefresh}
          >
            {t('nav.refresh', 'Refresh')}
          </Button>
        </span>
      }
    >
      {vehicleId !== null && (
        <FadeIn>
          {/* ─────── Navigation Status Panel ─────── */}
          <GlassPanel className="mb-6 p-5" glow={hasActiveRoute ? 'cyan' : 'none'}>
            <span className="mb-4 flex items-center justify-between">
              <span className="flex items-center gap-2 text-lg font-semibold text-[var(--text-primary)]">
                <Navigation className="h-5 w-5" />
                {t('nav.status', 'Navigation Status')}
              </span>
              <Badge
                variant={hasActiveRoute ? 'success' : 'neutral'}
                size="md"
                dot
              >
                {hasActiveRoute
                  ? t('nav.active', 'Active')
                  : t('nav.inactive', 'Inactive')}
              </Badge>
            </span>

            {latestLoading ? (
              <Skeleton lines={4} />
            ) : latest && hasActiveRoute ? (
              <span className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.destination', 'Destination')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {latest.destination_name || '—'}
                  </span>
                  <span className="block text-xs text-[var(--text-muted)]">
                    {latest.destination_location || '—'}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.eta', 'ETA')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {fmtNumber(latest.destination_minutes_remaining, 0)}{' '}
                    {t('nav.minutes', 'min')}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.distanceRemaining', 'Distance Remaining')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {fmtNumber(latest.destination_miles_remaining, 1)}{' '}
                    {t('nav.mi', 'mi')}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.energyArrival', 'Energy at Arrival')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {fmtNumber(latest.energy_at_arrival, 0)}%
                  </span>
                  <TrafficDelayBadge
                    minutes={latest.destination_traffic_minutes_delay}
                    t={t}
                  />
                </span>
              </span>
            ) : (
              <EmptyState
                icon={<Navigation className="h-8 w-8 text-gray-400" />}
                message={t(
                  'nav.noActiveNav',
                  'No active navigation. Start a route in your vehicle to see details here.',
                )}
              />
            )}
          </GlassPanel>

          {/* ─────── Location Status Cards ─────── */}
          <FadeIn delay={0.1}>
            <span className="mb-6 grid gap-4 sm:grid-cols-3">
              <LocationStatusCard
                icon={<MapPin className="h-5 w-5" />}
                label={t('nav.currentLocation', 'Current Location')}
                value={
                  latest
                    ? `${latest.latitude.toFixed(4)}, ${latest.longitude.toFixed(4)} · ${headingToCardinal(latest.heading)} ${fmtNumber(latest.speed, 0)} mph`
                    : '—'
                }
                active={!!latest}
              />
              <LocationStatusCard
                icon={<Home className="h-5 w-5" />}
                label={t('nav.homeStatus', 'Home Status')}
                value={
                  latest?.located_at_home
                    ? t('nav.atHome', 'At Home')
                    : latest?.homelink_nearby
                      ? t('nav.homelinkNearby', 'HomeLink Nearby')
                      : t('nav.awayFromHome', 'Away')
                }
                active={latest?.located_at_home ?? false}
              />
              <LocationStatusCard
                icon={<Briefcase className="h-5 w-5" />}
                label={t('nav.workStatus', 'Work Status')}
                value={
                  latest?.located_at_work
                    ? t('nav.atWork', 'At Work')
                    : t('nav.notAtWork', 'Away')
                }
                active={latest?.located_at_work ?? false}
              />
            </span>
          </FadeIn>

          {/* ─────── Route Metrics ─────── */}
          <FadeIn delay={0.15}>
            <span className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard
                label={t('nav.metric.distance', 'Distance')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(latest?.destination_miles_remaining ?? 0, 1)} mi`
                    : '—'
                }
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('nav.metric.eta', 'ETA')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(latest?.destination_minutes_remaining ?? 0, 0)} min`
                    : '—'
                }
                icon={<Clock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('nav.metric.energyArrival', 'Energy at Arrival')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(latest?.energy_at_arrival ?? 0, 0)}%`
                    : '—'
                }
                icon={<BatteryCharging className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('nav.metric.avgSpeed', 'Avg Speed')}
                value={`${fmtNumber(avgSpeed, 1)} mph`}
                icon={<Gauge className="h-5 w-5" />}
                color="amber"
              />
            </span>
          </FadeIn>

          {/* ─────── Speed / Elevation Profile Chart ─────── */}
          <FadeIn delay={0.2}>
            <GlassPanel className="mb-6 p-5">
              <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Gauge className="h-4 w-4" />
                {t('nav.speedProfile', 'Speed Profile')}
              </span>

              {historyLoading ? (
                <Skeleton height={260} />
              ) : chartData.length === 0 ? (
                <EmptyState
                  icon={<AlertTriangle className="h-8 w-8 text-gray-400" />}
                  message={t(
                    'nav.noHistory',
                    'No location history available for this vehicle.',
                  )}
                />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={chartData} margin={chartMargin}>
                    <defs>
                      <ChartGradient id="speedGrad" color={CHART_COLORS[0]} />
                      <ChartGradient
                        id="odoGrad"
                        color={CHART_COLORS[1]}
                        opacity={0.15}
                      />
                    </defs>
                    {chartGrid}
                    <XAxis
                      dataKey="time"
                      tick={axisTick}
                      tickFormatter={(v: string) =>
                        v.split(',').pop()?.trim() ?? v
                      }
                    />
                    <YAxis
                      yAxisId="speed"
                      tick={axisTick}
                      label={{
                        value: t('nav.chartSpeed', 'Speed (mph)'),
                        angle: -90,
                        position: 'insideLeft',
                        style: { fill: 'var(--text-muted)', fontSize: 10 },
                      }}
                    />
                    <YAxis
                      yAxisId="odo"
                      orientation="right"
                      tick={axisTick}
                      label={{
                        value: t('nav.chartOdometer', 'Odometer (mi)'),
                        angle: 90,
                        position: 'insideRight',
                        style: { fill: 'var(--text-muted)', fontSize: 10 },
                      }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend
                      verticalAlign="top"
                      height={28}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    <Area
                      yAxisId="speed"
                      type="monotone"
                      dataKey="speed"
                      stroke={CHART_COLORS[0]}
                      fill="url(#speedGrad)"
                      strokeWidth={2}
                      name={t('nav.legendSpeed', 'Speed (mph)')}
                    />
                    <Area
                      yAxisId="odo"
                      type="monotone"
                      dataKey="odometer"
                      stroke={CHART_COLORS[1]}
                      fill="url(#odoGrad)"
                      strokeWidth={1.5}
                      name={t('nav.legendOdometer', 'Odometer (mi)')}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ─────── Waypoints / Supercharger List ─────── */}
          {hasActiveRoute && waypoints.length > 0 && (
            <FadeIn delay={0.25}>
              <GlassPanel className="mb-6 p-5">
                <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Zap className="h-4 w-4" />
                  {t('nav.waypoints', 'Route Waypoints')}
                </span>
                <DataTable
                  columns={waypointColumns}
                  data={waypoints}
                  keyExtractor={(wp) => `${wp.name}-${wp.distance}`}
                  compact
                />
              </GlassPanel>
            </FadeIn>
          )}

          {/* ─────── Location History Table ─────── */}
          <FadeIn delay={0.3}>
            <GlassPanel className="p-5">
              <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Compass className="h-4 w-4" />
                {t('nav.locationHistory', 'Location History')}
              </span>

              {historyLoading ? (
                <Skeleton lines={8} />
              ) : !sortedHistory.length ? (
                <EmptyState
                  message={t(
                    'nav.noSnapshots',
                    'No location snapshots recorded yet.',
                  )}
                />
              ) : (
                <DataTable
                  columns={historyColumns}
                  data={sortedHistory}
                  keyExtractor={(row) => row.id}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  compact
                />
              )}
            </GlassPanel>
          </FadeIn>
        </FadeIn>
      )}
    </PageContainer>
  );
}
