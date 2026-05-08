import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  Navigation,
  MapPin,
  Home,
  Briefcase,
  Satellite,
  Compass,
  Gauge,
  Clock,
  BatteryCharging,
  Route,
  Zap,
  AlertTriangle,
  RefreshCw,
  Activity,
  TrendingUp,
  TrafficCone,
  AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { LiveIndicator } from '@/components/data-display/LiveIndicator';
import { TimeStamp } from '@/components/data-display';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { LiveStaleDataBanner } from '@/components/feedback/LiveStaleDataBanner';
import { FadeIn } from '@/components/motion/FadeIn';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
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
  AREA_DEFAULTS,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { CHART_COLORS } from '@/lib/colors';
import { getErrorMessage } from '@/lib/errorMessage';
import { convertSpeedFromSI, convertDistanceFromSI } from '@/lib/unitConversion';
import { request } from '@/api/client';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { normalizeGpsState } from '@/lib/signalCatalog';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationSnapshot {
  id: number;
  vehicle_id?: number;
  // Position & GPS (from signal_log pivot)
  latitude?: number;
  longitude?: number;
  heading?: number;
  gps_state?: string;
  elevation_m?: number;
  speed_mph?: number;
  // Navigation & route
  destination_name?: string;
  miles_to_arrival?: number;
  minutes_to_arrival?: number;
  route_traffic_delay_min?: number;
  route_last_updated?: string;
  // Destination/origin coords (Latest only — from unpacked compounds)
  destination_lat?: number;
  destination_lon?: number;
  origin_lat?: number;
  origin_lon?: number;
  // Presence
  located_at_home?: boolean;
  located_at_work?: boolean;
  located_at_favorite?: boolean;
  homelink_nearby?: boolean;
  // Timestamps
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

function headingToCardinal(deg: number | null | undefined): string {
  if (deg == null) return '—';
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
      className={cn('flex items-center gap-4 p-4', active && 'ring-1 ring-emerald-500/40')}
      glow={active ? 'green' : 'none'}
    >
      <span
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          active
            ? 'bg-emerald-500/20 text-emerald-400'
            : 'bg-gray-500/20 text-[var(--text-muted)]',
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
  const destName = latest.destination_name;
  if (!destName) return [];
  return [
    {
      name: destName,
      type: 'destination',
      distance: latest.miles_to_arrival ?? 0,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function NavigationRoutePage() {
  const { t } = useTranslation();
  usePageTitle(t('nav.pageTitle', 'Navigation & Route'));
  /* Phase-43/0027: SI-floor display.
     /location-snapshots emits speed_mph (m/s SI alias) and miles_to_arrival
     (meters SI) — the legacy field names are kept for backward compat but
     values are SI canonical. Pre-existing legacy bug: useSettings.toDistanceDisplay
     was treating the meters value as miles, producing 1609x inflated output. */
  const { unitPrefs } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  /* ---- vehicle selector — Phase 40 / Prompt 16: header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();

  const {
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useQuery<Vehicle[]>({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  /* ---- latest snapshot ---- */
  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
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
    error: historyError,
    refetch: refetchHistory,
  } = useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', vehicleId],
    queryFn: () =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${vehicleId}&limit=200`,
      ),
    enabled: vehicleId !== null,
  });

  /* ---- charging telemetry (for expected energy at arrival) ---- */
  const { data: chargingTelemetry } = useChargingTelemetryLatest(
    vehicleId ?? 0,
    15_000,
  );

  /* ---- derived ---- */
  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = vehiclesLoading || latestLoading;
  const hasActiveRoute = latest?.destination_name != null;
  const lat = latest?.latitude ?? null;
  const lon = latest?.longitude ?? null;
  const hasValidLocation = lat != null && lon != null
    && typeof lat === 'number' && typeof lon === 'number'
    && (lat !== 0 || lon !== 0);

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
          /* speed_mph is m/s SI; convert to user pref for chart axis. */
          speed: convertSpeedFromSI(s.speed_mph ?? 0, speedUnit),
          /* miles_to_arrival is meters SI; convert to user pref. */
          miles: convertDistanceFromSI(s.miles_to_arrival ?? 0, distanceUnit),
        })),
    [history, speedUnit, distanceUnit],
  );

  /* ---- avg speed (display units) ---- */
  const avgSpeed = useMemo(() => {
    if (!history?.length) return 0;
    /* speed_mph is m/s SI; average in SI then convert at the boundary. */
    const speedsMps = history
      .map((s) => s.speed_mph)
      .filter((v): v is number => v != null && v > 0);
    if (!speedsMps.length) return 0;
    const avgMps = speedsMps.reduce((a, b) => a + b, 0) / speedsMps.length;
    return convertSpeedFromSI(avgMps, speedUnit);
  }, [history, speedUnit]);

  /* ---- recent destinations (unique, from history with active routes) ---- */
  const recentDestinations = useMemo(() => {
    if (!history?.length) return [];
    const seen = new Set<string>();
    const result: { time: string; destination: string; distance: number; eta: number }[] = [];
    for (const s of history) {
      const name = s.destination_name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push({
        time: formatDateTime(s.created_at),
        destination: name,
        /* miles_to_arrival is meters SI; convert to user pref. */
        distance: convertDistanceFromSI(s.miles_to_arrival ?? 0, distanceUnit),
        eta: s.minutes_to_arrival ?? 0,
      });
    }
    return result.slice(0, 20);
  }, [history, distanceUnit]);

  /* ---- presence chart (home / work over time) ---- */
  const presenceChartData = useMemo(() => {
    if (!history?.length) return [];
    return [...history]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((s) => ({
        time: formatDateTime(s.created_at),
        home: s.located_at_home ? 1 : 0,
        work: s.located_at_work ? 1 : 0,
        homelink: s.homelink_nearby ? 1 : 0,
      }));
  }, [history]);

  /* ---- destination table columns ---- */
  const destColumns: Column<typeof recentDestinations[number]>[] = useMemo(
    () => [
      { key: 'time', header: t('nav.col.time', 'Time'), render: (row) => <span className="text-xs text-[var(--text-muted)] whitespace-nowrap">{row.time}</span> },
      { key: 'destination', header: t('nav.col.destination', 'Destination'), render: (row) => <span className="text-sm text-[var(--text-primary)]">{row.destination}</span> },
      { key: 'distance', header: t('nav.col.distance', 'Distance'), render: (row) => <span className="text-xs text-[var(--text-muted)]">{fmtNumber(row.distance, 1)} {distanceUnit}</span> },
      { key: 'eta', header: t('nav.col.eta', 'ETA'), render: (row) => <span className="text-xs text-[var(--text-muted)]">{fmtNumber(row.eta, 0)} min</span> },
    ],
    [t, distanceUnit],
  );

  /* ---- table columns ---- */
  const historyColumns: Column<LocationSnapshot>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('nav.col.time', 'Time'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <TimeStamp value={row.created_at} className="whitespace-nowrap text-xs font-mono text-[var(--text-muted)]" />
        ),
      },
      {
        key: 'latitude',
        header: t('nav.col.lat', 'Lat'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="font-mono text-[var(--text-primary)]">
            {row.latitude != null && row.latitude !== 0 ? fmtNumber(row.latitude, 6) : '—'}
          </span>
        ),
      },
      {
        key: 'longitude',
        header: t('nav.col.lon', 'Lon'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="font-mono text-[var(--text-primary)]">
            {row.longitude != null && row.longitude !== 0 ? fmtNumber(row.longitude, 6) : '—'}
          </span>
        ),
      },
      {
        key: 'located_at_home',
        header: t('nav.col.home', 'Home'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className={row.located_at_home ? 'text-green-400' : 'text-[var(--text-muted)]'}>
            {row.located_at_home === true ? 'Yes' : row.located_at_home === false ? 'No' : '—'}
          </span>
        ),
      },
      {
        key: 'located_at_work',
        header: t('nav.col.work', 'Work'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className={row.located_at_work ? 'text-blue-400' : 'text-[var(--text-muted)]'}>
            {row.located_at_work === true ? 'Yes' : row.located_at_work === false ? 'No' : '—'}
          </span>
        ),
      },
      {
        key: 'destination_name',
        header: t('nav.col.destination', 'Destination'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <span className="text-[var(--text-primary)] truncate max-w-[150px] block">
            {row.destination_name ?? '—'}
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
            {/* row.distance is meters SI from buildWaypoints; convert to user pref. */}
            {fmtNumber(convertDistanceFromSI(row.distance, distanceUnit), 1)} {distanceUnit}
          </span>
        ),
      },
    ],
    [t, distanceUnit],
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
          return row.latitude ?? 0;
        case 'longitude':
          return row.longitude ?? 0;
        case 'located_at_home':
          return row.located_at_home ? 1 : 0;
        case 'located_at_work':
          return row.located_at_work ? 1 : 0;
        case 'destination_name':
          return row.destination_name ?? '';
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
      actions={
        <span className="flex items-center gap-3">
          <LiveIndicator variant="compact" />
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
      <LiveStaleDataBanner />
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

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

            <span className="mb-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
              <RefreshCw className="h-3 w-3" />
              {t('nav.routeLastUpdated', 'Route last updated')}:{' '}
              <span className="font-medium text-[var(--text-secondary)]">
                {latest?.route_last_updated
                  ? formatDateTime(latest.route_last_updated)
                  : '—'}
              </span>
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
                    {latest.destination_name ?? '—'}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.eta', 'ETA')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {fmtNumber(latest.minutes_to_arrival ?? 0, 0)}{' '}
                    {t('nav.minutes', 'min')}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.distanceRemaining', 'Distance Remaining')}
                  </span>
                  <span className="block text-sm font-medium text-[var(--text-primary)]">
                    {/* miles_to_arrival is meters SI; convert to user pref. */}
                    {fmtNumber(convertDistanceFromSI(latest.miles_to_arrival ?? 0, distanceUnit), 1)}{' '}
                    {distanceUnit}
                  </span>
                </span>

                <span className="space-y-1">
                  <span className="block text-xs text-[var(--text-muted)]">
                    {t('nav.trafficDelay', 'Traffic Delay')}
                  </span>
                  <TrafficDelayBadge
                    minutes={latest.route_traffic_delay_min ?? 0}
                    t={t}
                  />
                </span>
              </span>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                icon={<Navigation className="h-8 w-8 text-[var(--text-muted)]" />}
                message={t(
                  'nav.noActiveNav',
                  'No active navigation. Start a route in your vehicle to see details here.',
                )}
              />
            )}
          </GlassPanel>

          {/* ─────── GPS Warning Banner ─────── */}
          {!hasValidLocation && latest && (
            <AlertBanner variant="info" className="mb-4">
              {t('nav.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
            </AlertBanner>
          )}

          {/* ─────── Location Status Cards ─────── */}
          <FadeIn delay={0.1}>
            <span className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <LocationStatusCard
                icon={<MapPin className="h-5 w-5" />}
                label={t('nav.currentLocation', 'Current Location')}
                value={
                  hasValidLocation
                    ? `${fmtNumber(lat!, 4)}, ${fmtNumber(lon!, 4)}`
                    : t('nav.locationUnavailable', 'Location unavailable')
                }
                active={hasValidLocation}
              />
              {(() => {
                const fix = normalizeGpsState(latest?.gps_state);
                return (
                  <LocationStatusCard
                    icon={<Satellite className="h-5 w-5" />}
                    label={t('nav.gpsFixQuality', 'GPS Fix Quality')}
                    value={t(`nav.gpsState.${fix}`, { defaultValue: fix })}
                    active={fix === 'locked'}
                  />
                );
              })()}
              <LocationStatusCard
                icon={<Compass className="h-5 w-5" />}
                label={t('nav.heading', 'Heading')}
                value={
                  latest?.heading != null
                    ? t('nav.headingValue', {
                        defaultValue: '{{cardinal}} ({{degrees}}°)',
                        cardinal: headingToCardinal(latest.heading),
                        degrees: Math.round(latest.heading),
                      })
                    : t('nav.unknown', 'Unknown')
                }
                active={latest?.heading != null}
              />
              <LocationStatusCard
                icon={<Home className="h-5 w-5" />}
                label={t('nav.homeStatus', 'Home Status')}
                value={
                  latest?.located_at_home === true
                    ? t('nav.atHome', 'At Home')
                    : latest?.located_at_home === false
                      ? latest?.homelink_nearby
                        ? t('nav.homelinkNearby', 'HomeLink Nearby')
                        : t('nav.awayFromHome', 'Away')
                      : t('nav.unknown', 'Unknown')
                }
                active={latest?.located_at_home === true}
              />
              <LocationStatusCard
                icon={<Briefcase className="h-5 w-5" />}
                label={t('nav.workStatus', 'Work Status')}
                value={
                  latest?.located_at_work === true
                    ? t('nav.atWork', 'At Work')
                    : latest?.located_at_work === false
                      ? t('nav.notAtWork', 'Away')
                      : t('nav.unknown', 'Unknown')
                }
                active={latest?.located_at_work === true}
              />
            </span>
          </FadeIn>

          {/* ─────── Route Metrics ─────── */}
          <FadeIn delay={0.15}>
            <span className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard
                label={t('nav.metric.distance', 'Distance')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(convertDistanceFromSI(latest?.miles_to_arrival ?? 0, distanceUnit), 1)} ${distanceUnit}`
                    : '—'
                }
                icon={<Route className="h-5 w-5" />}
                color="cyan"
              />
              <MetricCard
                label={t('nav.metric.eta', 'ETA')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(latest?.minutes_to_arrival ?? 0, 0)} min`
                    : '—'
                }
                icon={<Clock className="h-5 w-5" />}
                color="purple"
              />
              <MetricCard
                label={t('nav.metric.trafficDelay', 'Traffic Delay')}
                value={
                  hasActiveRoute
                    ? `${fmtNumber(latest?.route_traffic_delay_min ?? 0, 0)} min`
                    : '—'
                }
                icon={<BatteryCharging className="h-5 w-5" />}
                color="green"
              />
              <MetricCard
                label={t('nav.metric.avgSpeed', 'Avg Speed')}
                value={`${fmtNumber(avgSpeed, 1)} ${speedUnit}`}
                icon={<Gauge className="h-5 w-5" />}
                color="amber"
              />
              <MetricCard
                label={t(
                  'nav.metric.energyAtArrival',
                  'Energy at Arrival',
                )}
                value={
                  chargingTelemetry?.expected_energy_pct_at_arrival != null
                    ? `${fmtNumber(chargingTelemetry.expected_energy_pct_at_arrival, 0)}%`
                    : '—'
                }
                icon={<BatteryCharging className="h-5 w-5" />}
                color="green"
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
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  icon={<AlertTriangle className="h-8 w-8 text-[var(--text-muted)]" />}
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
                        value: t('nav.chartSpeedV2', { defaultValue: 'Speed ({{unit}})', unit: speedUnit }),
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
                        value: t('nav.chartDistanceV2', { defaultValue: 'Distance to Arrival ({{unit}})', unit: distanceUnit }),
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
                      {...AREA_DEFAULTS}
                      yAxisId="speed"
                      dataKey="speed"
                      stroke={CHART_COLORS[0]}
                      fill="url(#speedGrad)"
                      name={t('nav.legendSpeedV2', { defaultValue: 'Speed ({{unit}})', unit: speedUnit })}
                    />
                    <Area
                      {...AREA_DEFAULTS}
                      yAxisId="odo"
                      dataKey="miles"
                      stroke={CHART_COLORS[1]}
                      fill="url(#odoGrad)"
                      strokeWidth={1.5}
                      name={t('nav.legendDistanceToArrivalV2', { defaultValue: 'Distance to Arrival ({{unit}})', unit: distanceUnit })}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ─────── Waypoints / Supercharger List ─────── */}
          <FadeIn delay={0.25}>
            {hasActiveRoute ? (
              <GlassPanel className="mb-6 p-5">
                <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                  <Zap className="h-4 w-4" />
                  {t('nav.waypoints', 'Route Waypoints')}
                </span>
                {waypoints.length > 0 ? (
                  <DataTable
                    tableId="maps:navigation-waypoints"
                    columns={waypointColumns}
                    data={waypoints}
                    keyExtractor={(wp) => `${wp.name}-${wp.distance}`}
                    compact
                    pagination
                  />
                ) : (
                  <EmptyState
                    icon={<Activity className="h-8 w-8 opacity-20" />}
                    message={t('common.noData', 'No data available')}
                    className="py-8"
                  />
                )}
              </GlassPanel>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('navigation.noRoute', 'No active route selected')} />
            )}
          </FadeIn>

          {/* ─────── Route Traffic Delay ─────── */}
          <FadeIn delay={0.22}>
            <GlassPanel className="mb-6 p-5">
              <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <TrafficCone className="h-4 w-4 text-amber-400" />
                {t('nav.trafficDelay', 'Route Traffic Delay')}
              </span>
              {latestLoading ? (
                <Skeleton height={64} />
              ) : (
                <div className="flex items-center gap-4">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={cn(
                        'text-3xl font-bold',
                        (latest?.route_traffic_delay_min ?? 0) === 0
                          ? 'text-green-400'
                          : (latest?.route_traffic_delay_min ?? 0) <= 5
                            ? 'text-amber-400'
                            : 'text-red-400',
                      )}
                    >
                      {latest?.route_traffic_delay_min ?? 0}
                    </span>
                    <span className="text-sm text-[var(--text-muted)]">{t('nav.min', 'min')}</span>
                  </div>
                  <TrafficDelayBadge
                    minutes={latest?.route_traffic_delay_min ?? 0}
                    t={t}
                  />
                </div>
              )}
            </GlassPanel>
          </FadeIn>

          {/* ─────── Recent Destinations ─────── */}
          <FadeIn delay={0.25}>
            <GlassPanel className="mb-6 p-5">
              <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <Clock className="h-4 w-4 text-cyan-400" />
                {t('nav.recentDestinations', 'Recent Destinations')}
              </span>
              {historyLoading ? (
                <Skeleton lines={6} />
              ) : recentDestinations.length === 0 ? (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('nav.noDestinations', 'No destination history available.')} />
              ) : (
                <DataTable
                  tableId="maps:navigation-recent-destinations"
                  columns={destColumns}
                  data={recentDestinations}
                  keyExtractor={(row) => `${row.time}-${row.destination}`}
                  compact
                  pagination
                />
              )}
            </GlassPanel>
          </FadeIn>

          {/* ─────── Home / Work Presence Chart ─────── */}
          <FadeIn delay={0.28}>
            <GlassPanel className="mb-6 p-5">
              <span className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                {t('nav.presenceChart', 'Home / Work Presence')}
              </span>
              {historyLoading ? (
                <Skeleton height={300} />
              ) : presenceChartData.length === 0 ? (
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('nav.noPresence', 'No presence history available.')} />
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={presenceChartData} margin={chartMargin}>
                    {chartGrid}
                    <XAxis dataKey="time" tick={axisTick} />
                    <YAxis
                      domain={[0, 1]}
                      ticks={[0, 1]}
                      tick={axisTick}
                      tickFormatter={(v: number) => (v === 1 ? 'Yes' : 'No')}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="home" name={t('nav.atHome', 'At Home')} stroke={CHART_COLORS[1]} />
                    <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="work" name={t('nav.atWork', 'At Work')} stroke={CHART_COLORS[3]} />
                    <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="homelink" name={t('nav.homelinkNearby', 'HomeLink')} stroke={CHART_COLORS[4]} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </GlassPanel>
          </FadeIn>

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
                <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                  message={t(
                    'nav.noSnapshots',
                    'No location snapshots recorded yet.',
                  )}
                />
              ) : (
                <DataTable
                  tableId="maps:navigation-location-history"
                  columns={historyColumns}
                  data={sortedHistory}
                  keyExtractor={(row) => row.id}
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onSort={handleSort}
                  compact
                  pagination
                />
              )}
            </GlassPanel>
          </FadeIn>
        </FadeIn>
      )}
    </PageContainer>
  );
}
