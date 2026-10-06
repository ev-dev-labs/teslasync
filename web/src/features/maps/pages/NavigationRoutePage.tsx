import { useState, useMemo, useCallback, type ReactNode } from 'react';
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
  TrafficCone,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';

import {
  GlassPanel,
  Badge,
  Button,
  DataTable,
  Text,
  Caption,
  type Column,
} from '@/components/ui';
import { MetricCard, TimeStamp } from '@/components/data-display';
import {
  Skeleton,
  EmptyState,
  AlertBanner,
  QueryError,
  LiveStaleDataBanner,
} from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ChartLegend,
  ChartTooltip,
  ChartGradient,
  chartGrid,
  axisTick,
  chartMargin,
  AREA_DEFAULTS,
  CHART_COLORS,
  EmbeddedChart,
} from '@/components/charts';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { formatDateTime } from '@/lib/dateFormat';

import { convertSpeedFromSI, convertDistanceFromSI } from '@/lib/unitConversion';
import { request } from '@/api/client';
import {
  useVehicles,
  useLocationSnapshotLatest,
  useChargingTelemetryLatest,
} from '@/api/hooks/useVehicles';
import { normalizeGpsState } from '@/lib/signalCatalog';
import type { LocationSnapshot } from '@/api/types';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Helper: heading label                                              */
/* ------------------------------------------------------------------ */

function headingToCardinal(deg: number | null | undefined): string {
  if (deg == null || !Number.isFinite(deg)) return '—';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  /* Normalise into [0, 8) so the compass wraps correctly for any heading,
     including negative degrees (e.g. -45° == 315° == NW) — a bare `% 8`
     yields a negative index and an undefined direction. */
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return dirs[idx] ?? '—';
}

/* ------------------------------------------------------------------ */
/*  Sub-component: Location Status Card                                */
/* ------------------------------------------------------------------ */

interface LocationStatusCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  active: boolean;
}

function LocationStatusCard({ icon, label, value, active }: LocationStatusCardProps) {
  return (
    <GlassPanel
      className={cn('flex items-center gap-3 p-4', active && 'ring-1 ring-emerald-500/40')}
      glow={active ? 'green' : 'none'}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
          active
            ? 'bg-emerald-500/20 text-emerald-300'
            : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <Caption className="block break-words">{label}</Caption>
        <Text variant="body" as="span" className="block break-words font-semibold">
          {value}
        </Text>
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
  seconds: number;
  t: ReturnType<typeof useTranslation>['t'];
}

function TrafficDelayBadge({ seconds, t }: TrafficDelayBadgeProps) {
  const { formatDuration } = useUnits();
  const variant: 'success' | 'warning' | 'danger' =
    seconds < 300 ? 'success' : seconds <= 900 ? 'warning' : 'danger';

  return (
    <Badge variant={variant} size="sm" dot>
      {formatDuration(seconds)} {t('nav.delay', 'delay')}
    </Badge>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-component: label / value field (nav status panel)             */
/* ------------------------------------------------------------------ */

interface RouteFieldProps {
  label: string;
  children: ReactNode;
}

function RouteField({ label, children }: RouteFieldProps) {
  return (
    <div className="space-y-1">
      <Caption className="block">{label}</Caption>
      <Text variant="body" as="div" className="break-words font-medium">
        {children}
      </Text>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: waypoint builder + type                                   */
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
  const { fmtNumber, fmtScientificNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('nav.pageTitle', 'Navigation & route'));

  /* SI-floor display.
     /location-snapshots emits speed_mph (m/s SI alias) and miles_to_arrival
     (meters SI) — the legacy field names are kept for backward compat but
     values are SI canonical, converted at this display boundary via
     useUnits() + the SI converters in lib/unitConversion.ts. */
  const { unitPrefs, formatDuration } = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  /* ---- vehicle selector — header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();
  const vehiclesQuery = useVehicles();

  /* ---- latest snapshot ---- */
  const latestQuery = useLocationSnapshotLatest(vehicleId ?? 0, 15_000);
  const {
    data: latest,
    refetch: refetchLatest,
  } = latestQuery;
  const latestState = deriveDataState({ ...latestQuery, data: latest ?? undefined }, { provenance: 'live' });
  const latestLoading = latestQuery.isLoading && !latestState.hasData;
  const latestError = latestState.fatalError;

  /* ---- history ---- */
  const historyQuery = useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', vehicleId],
    queryFn: ({ signal }) =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${vehicleId}&limit=200`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
  const { data: history, refetch: refetchHistory } = historyQuery;
  const historyState = deriveDataState(historyQuery, { provenance: 'historical' });
  const historyLoading = historyQuery.isLoading && !historyState.hasData;
  const historyError = historyState.fatalError;

  /* ---- charging telemetry (for expected energy at arrival) ---- */
  const chargingQuery = useChargingTelemetryLatest(
    vehicleId ?? 0,
    15_000,
  );
  const chargingTelemetry = chargingQuery.data;

  /* ---- derived ---- */
  const hasActiveRoute = latest?.destination_name != null;
  const lat = latest?.latitude ?? null;
  const lon = latest?.longitude ?? null;
  const hasValidLocation =
    lat != null &&
    lon != null &&
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    (lat !== 0 || lon !== 0);

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

  /* ---- recent-destination table columns ---- */
  const destColumns: Column<typeof recentDestinations[number]>[] = useMemo(
    () => [
      { key: 'time', header: t('nav.col.time', 'Time'), render: (row) => <Caption className="whitespace-nowrap">{row.time}</Caption> },
      { key: 'destination', header: t('nav.col.destination', 'Destination'), render: (row) => <Text variant="body">{row.destination}</Text> },
      { key: 'distance', align: 'right', header: t('nav.col.distance', 'Distance'), render: (row) => <Caption>{fmtNumber(row.distance)} {distanceUnit}</Caption> },
      { key: 'eta', align: 'right', header: t('nav.col.eta', 'ETA'), render: (row) => <Caption>{fmtNumber(row.eta)} {t('nav.minutes', 'min')}</Caption> },
    ],
    [t, distanceUnit, fmtNumber],
  );

  /* ---- location-history table columns ---- */
  const historyColumns: Column<LocationSnapshot>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('nav.col.time', 'Time'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <TimeStamp value={row.created_at} className="whitespace-nowrap font-mono text-xs text-[var(--text-muted)]" />
        ),
      },
      {
        key: 'latitude',
        align: 'right',
        header: t('nav.col.lat', 'Lat'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text mono color="primary">
            {row.latitude != null && row.latitude !== 0 ? fmtScientificNumber(row.latitude, 6) : '—'}
          </Text>
        ),
      },
      {
        key: 'longitude',
        align: 'right',
        header: t('nav.col.lon', 'Lon'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text mono color="primary">
            {row.longitude != null && row.longitude !== 0 ? fmtScientificNumber(row.longitude, 6) : '—'}
          </Text>
        ),
      },
      {
        key: 'located_at_home',
        header: t('nav.col.home', 'Home'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text className={row.located_at_home ? 'text-emerald-300' : 'text-[var(--text-muted)]'}>
            {row.located_at_home === true
              ? t('common.yes', 'Yes')
              : row.located_at_home === false
                ? t('common.no', 'No')
                : '—'}
          </Text>
        ),
      },
      {
        key: 'located_at_work',
        header: t('nav.col.work', 'Work'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text className={row.located_at_work ? 'text-indigo-300' : 'text-[var(--text-muted)]'}>
            {row.located_at_work === true
              ? t('common.yes', 'Yes')
              : row.located_at_work === false
                ? t('common.no', 'No')
                : '—'}
          </Text>
        ),
      },
      {
        key: 'destination_name',
        header: t('nav.col.destination', 'Destination'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text color="primary" className="block max-w-[150px] truncate">
            {row.destination_name ?? '—'}
          </Text>
        ),
      },
    ],
    [t, fmtNumber, fmtScientificNumber],
  );

  /* ---- waypoint columns ---- */
  const waypointColumns: Column<Waypoint>[] = useMemo(
    () => [
      {
        key: 'name',
        header: t('nav.wp.name', 'Name'),
        filterValue: (row) => row.name,
        render: (row: Waypoint) => (
          <Text color="primary" className="flex items-center gap-2">
            {row.type === 'supercharger' ? (
              <Zap className="h-4 w-4 text-rose-300" aria-hidden="true" />
            ) : row.type === 'destination' ? (
              <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            ) : (
              <Route className="h-4 w-4 text-amber-300" aria-hidden="true" />
            )}
            {row.name}
          </Text>
        ),
      },
      {
        key: 'type',
        header: t('nav.wp.type', 'Type'),
        filterValue: (row) => row.type,
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
        align: 'right',
        header: t('nav.wp.distance', 'Distance'),
        filterValue: (row) => row.distance ?? null,
        filterValueLabel: (_value, row) => row.distance == null ? '—' : `${fmtNumber(convertDistanceFromSI(row.distance, distanceUnit))} ${distanceUnit}`,
        render: (row: Waypoint) => (
          <Text mono color="muted">
            {/* row.distance is meters SI from buildWaypoints; convert to user pref. */}
            {fmtNumber(convertDistanceFromSI(row.distance, distanceUnit))} {distanceUnit}
          </Text>
        ),
      },
    ],
    [t, distanceUnit, fmtNumber],
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

  /* ---- traffic-delay accent (dynamic, computed) ---- */
  const trafficDelaySec = latest?.route_traffic_delay_s ?? 0;
  const trafficDelayColor =
    trafficDelaySec === 0
      ? 'text-emerald-300'
      : trafficDelaySec <= 300
        ? 'text-amber-300'
        : 'text-rose-300';

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <PageLayout
      title={t('nav.pageTitle', 'Navigation & route')}
      subtitle={t('nav.subtitle', 'Live location tracking and navigation status')}
      query={latestQuery}
      dataSources={[
        { id: 'vehicles', label: t('geofences.vehicle', 'Vehicle'), query: vehiclesQuery },
        { id: 'navigation', label: t('nav.resource', 'Navigation'), query: latestQuery, enabled: vehicleId !== null },
        { id: 'history', label: t('nav.resourceHistory', 'Location history'), query: historyQuery, enabled: vehicleId !== null },
        { id: 'charging', label: t('nav.metric.energyAtArrival', 'Energy at arrival'), query: chargingQuery, enabled: vehicleId !== null },
      ]}
      secondaryActions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            onClick={handleRefresh}
          >
            {t('nav.refresh', 'Refresh')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-6">
        <LiveStaleDataBanner />

        {vehicleId === null ? (
          <GlassPanel className="p-4 sm:p-5">
            <EmptyState
              icon={<Navigation className="h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />}
              message={t('nav.noVehicle', 'Select a vehicle to view navigation and route data.')}
              actionTo={{ label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' }}
            />
          </GlassPanel>
        ) : (
          <>
            {/* ─────── 1. KPI band — Route Metrics ─────── */}
            <FadeIn>
              <section
                aria-label={t('nav.metricsAria', 'Route metrics')}
                className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
              >
                <MetricCard
                  label={t('nav.metric.distance', 'Distance')}
                  value={
                    hasActiveRoute
                      ? `${fmtNumber(convertDistanceFromSI(latest?.miles_to_arrival ?? 0, distanceUnit))} ${distanceUnit}`
                      : '—'
                  }
                  icon={<Route className="h-5 w-5" />}
                  color="cyan"
                />
                <MetricCard
                  label={t('nav.metric.eta', 'ETA')}
                  value={
                    hasActiveRoute
                      ? `${fmtNumber(latest?.minutes_to_arrival ?? 0)} ${t('nav.minutes', 'min')}`
                      : '—'
                  }
                  icon={<Clock className="h-5 w-5" />}
                  color="purple"
                />
                <MetricCard
                  label={t('nav.metric.trafficDelay', 'Traffic delay')}
                  value={
                    hasActiveRoute
                      ? formatDuration(latest?.route_traffic_delay_s ?? 0)
                      : '—'
                  }
                  icon={<TrafficCone className="h-5 w-5" />}
                  color="amber"
                />
                <MetricCard
                  label={t('nav.metric.avgSpeed', 'Avg speed')}
                  value={`${fmtNumber(avgSpeed)} ${speedUnit}`}
                  icon={<Gauge className="h-5 w-5" />}
                  color="green"
                />
                <MetricCard
                  label={t('nav.metric.energyAtArrival', 'Energy at arrival')}
                  value={
                    chargingTelemetry?.expected_energy_pct_at_arrival != null
                      ? `${fmtNumber(chargingTelemetry.expected_energy_pct_at_arrival)}%`
                      : '—'
                  }
                  icon={<BatteryCharging className="h-5 w-5" />}
                  color="green"
                />
              </section>
            </FadeIn>

            {/* ─────── 2. Navigation Status hero ─────── */}
            <FadeIn delay={0.05}>
              <section
                aria-label={t('nav.statusAria', 'Navigation status')}
                className="space-y-3 sm:space-y-4"
              >
                <LayoutCard
                  title={t('nav.status', 'Navigation status')}
                  actions={
                    <Badge variant={hasActiveRoute ? 'success' : 'neutral'} size="md" dot>
                      {hasActiveRoute
                        ? t('nav.active', 'Active')
                        : t('nav.inactive', 'Inactive')}
                    </Badge>
                  }
                >

                  <Caption className="mb-3 flex items-center gap-1.5">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    {t('nav.routeLastUpdated', 'Route last updated')}:{' '}
                    <Text variant="bodySm" as="span" className="font-medium text-[var(--text-secondary)]">
                      {latest?.route_last_updated
                        ? formatDateTime(latest.route_last_updated)
                        : '—'}
                    </Text>
                  </Caption>

                  {latestLoading ? (
                    <Skeleton lines={4} />
                  ) : latestError ? (
                    <QueryError
                      error={latestError}
                      onRetry={() => void refetchLatest()}
                      resourceName={t('nav.resource', 'Navigation')}
                    />
                  ) : latest && hasActiveRoute ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <RouteField label={t('nav.destination', 'Destination')}>
                        {latest.destination_name ?? '—'}
                      </RouteField>
                      <RouteField label={t('nav.eta', 'ETA')}>
                        {fmtNumber(latest.minutes_to_arrival ?? 0)} {t('nav.minutes', 'min')}
                      </RouteField>
                      <RouteField label={t('nav.distanceRemaining', 'Distance remaining')}>
                        {/* miles_to_arrival is meters SI; convert to user pref. */}
                        {fmtNumber(convertDistanceFromSI(latest.miles_to_arrival ?? 0, distanceUnit))}{' '}
                        {distanceUnit}
                      </RouteField>
                      <RouteField label={t('nav.trafficDelay', 'Traffic delay')}>
                        <TrafficDelayBadge
                          seconds={latest.route_traffic_delay_s ?? 0}
                          t={t}
                        />
                      </RouteField>
                    </div>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Navigation className="h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />}
                      message={t(
                        'nav.noActiveNav',
                        'No active navigation. Start a route in your vehicle to see details here.',
                      )}
                    />
                  )}
                </LayoutCard>

                {!hasValidLocation && latest && (
                  <AlertBanner variant="info">
                    {t('nav.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
                  </AlertBanner>
                )}
              </section>
            </FadeIn>

            {/* ─────── 3. Location Status Cards ─────── */}
            <FadeIn delay={0.1}>
              <section
                aria-label={t('nav.presenceAria', 'Location status')}
                className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-5"
              >
                <LocationStatusCard
                  icon={<MapPin className="h-5 w-5" />}
                  label={t('nav.currentLocation', 'Current location')}
                  value={
                    hasValidLocation
                      ? `${fmtScientificNumber(lat!, 4)}, ${fmtScientificNumber(lon!, 4)}`
                      : t('nav.locationUnavailable', 'Location unavailable')
                  }
                  active={hasValidLocation}
                />
                {(() => {
                  const fix = normalizeGpsState(latest?.gps_state);
                  return (
                    <LocationStatusCard
                      icon={<Satellite className="h-5 w-5" />}
                      label={t('nav.gpsFixQuality', 'GPS fix quality')}
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
                  label={t('nav.homeStatus', 'Home status')}
                  value={
                    latest?.located_at_home === true
                      ? t('nav.atHome', 'At home')
                      : latest?.located_at_home === false
                        ? latest?.homelink_nearby
                          ? t('nav.homelinkNearby', 'HomeLink nearby')
                          : t('nav.awayFromHome', 'Away')
                        : t('nav.unknown', 'Unknown')
                  }
                  active={latest?.located_at_home === true}
                />
                <LocationStatusCard
                  icon={<Briefcase className="h-5 w-5" />}
                  label={t('nav.workStatus', 'Work status')}
                  value={
                    latest?.located_at_work === true
                      ? t('nav.atWork', 'At work')
                      : latest?.located_at_work === false
                        ? t('nav.notAtWork', 'Away')
                        : t('nav.unknown', 'Unknown')
                  }
                  active={latest?.located_at_work === true}
                />
              </section>
            </FadeIn>

            {/* ─────── 4. Charts bento — Speed Profile + Presence ─────── */}
            <FadeIn delay={0.15}>
              <section
                aria-label={t('nav.chartsAria', 'Route charts')}
                className="grid grid-cols-1 gap-4 xl:grid-cols-2"
              >
                {/* Speed / distance profile */}
                <LayoutCard title={t('nav.speedProfile', 'Speed profile')}>
                  {historyLoading ? (
                    <Skeleton height={260} />
                  ) : historyError ? (
                    <QueryError
                      error={historyError}
                      onRetry={() => void refetchHistory()}
                      resourceName={t('nav.resourceHistory', 'Location history')}
                    />
                  ) : chartData.length === 0 ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<AlertTriangle className="h-8 w-8 text-[var(--text-muted)]" aria-hidden="true" />}
                      message={t(
                        'nav.noHistory',
                        'No location history available for this vehicle.',
                      )}
                    />
                  ) : (
                    // chart-a11y:no-table dense live location time-series — too many rows for meaningful accessibility table
                    <EmbeddedChart
                      chartKey="nav-speed-history"
                      title={t('nav.speedHistoryTitle', 'Speed & distance history')}
                      ariaLabel={t('nav.speedHistoryAria', 'Speed and distance-to-arrival area chart over time')}
                      height={260}
                      fluid={false}
                    >
                      {({ hiddenSeries }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={chartMargin}>
                            <defs>
                              <ChartGradient id="speedGrad" color={CHART_COLORS[0]} />
                              <ChartGradient id="odoGrad" color={CHART_COLORS[1]} opacity={0.15} />
                            </defs>
                            {chartGrid}
                            <XAxis
                              dataKey="time"
                              tick={axisTick}
                              tickFormatter={(v: string) => v.split(',').pop()?.trim() ?? v}
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
                                value: t('nav.chartDistanceV2', { defaultValue: 'Distance to arrival ({{unit}})', unit: distanceUnit }),
                                angle: 90,
                                position: 'insideRight',
                                style: { fill: 'var(--text-muted)', fontSize: 10 },
                              }}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            <ChartLegend verticalAlign="top" align="right" />
                            <Area
                              {...AREA_DEFAULTS}
                              yAxisId="speed"
                              dataKey="speed"
                              stroke={CHART_COLORS[0]}
                              fill="url(#speedGrad)"
                              name={t('nav.legendSpeedV2', { defaultValue: 'Speed ({{unit}})', unit: speedUnit })}
                              hide={hiddenSeries?.isHidden('speed') ?? false}
                            />
                            <Area
                              {...AREA_DEFAULTS}
                              yAxisId="odo"
                              dataKey="miles"
                              stroke={CHART_COLORS[1]}
                              fill="url(#odoGrad)"
                              strokeWidth={1.5}
                              name={t('nav.legendDistanceToArrivalV2', { defaultValue: 'Distance to arrival ({{unit}})', unit: distanceUnit })}
                              hide={hiddenSeries?.isHidden('miles') ?? false}
                            />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </EmbeddedChart>
                  )}
                </LayoutCard>

                {/* Home / Work presence */}
                <LayoutCard title={t('nav.presenceChart', 'Home / work presence')}>
                  {historyLoading ? (
                    <Skeleton height={260} />
                  ) : historyError ? (
                    <QueryError
                      error={historyError}
                      onRetry={() => void refetchHistory()}
                      resourceName={t('nav.resourceHistory', 'Location history')}
                    />
                  ) : presenceChartData.length === 0 ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      message={t('nav.noPresence', 'No presence history available.')}
                    />
                  ) : (
                    // chart-a11y:no-table dense presence time-series — binary on/off states over many timestamps, not tabular
                    <EmbeddedChart
                      chartKey="nav-home-work-presence"
                      title={t('nav.presenceChart', 'Home / work presence')}
                      ariaLabel={t('nav.presenceAria', 'Home, work, and HomeLink presence over time')}
                      height={260}
                      fluid={false}
                    >
                      {({ hiddenSeries }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={presenceChartData} margin={chartMargin}>
                            {chartGrid}
                            <XAxis dataKey="time" tick={axisTick} />
                            <YAxis
                              domain={[0, 1]}
                              ticks={[0, 1]}
                              tick={axisTick}
                              tickFormatter={(v: number) => (v === 1 ? t('common.yes', 'Yes') : t('common.no', 'No'))}
                            />
                            <Tooltip content={<ChartTooltip />} />
                            <ChartLegend verticalAlign="top" align="right" />
                            <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="home" name={t('nav.atHome', 'At home')} stroke={CHART_COLORS[1]} hide={hiddenSeries?.isHidden('home') ?? false} />
                            <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="work" name={t('nav.atWork', 'At work')} stroke={CHART_COLORS[3]} hide={hiddenSeries?.isHidden('work') ?? false} />
                            <Line {...AREA_DEFAULTS} type="stepAfter" dataKey="homelink" name={t('nav.homelinkNearby', 'HomeLink')} stroke={CHART_COLORS[4]} hide={hiddenSeries?.isHidden('homelink') ?? false} />
                          </LineChart>
                        </ResponsiveContainer>
                      )}
                    </EmbeddedChart>
                  )}
                </LayoutCard>
              </section>
            </FadeIn>

            {/* ─────── 5. Mid bento — Traffic delay + Waypoints + Recent destinations ─────── */}
            <FadeIn delay={0.2}>
              <section
                aria-label={t('nav.routeDetailAria', 'Route details')}
                className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
              >
                {/* Route Traffic Delay */}
                <LayoutCard title={t('nav.trafficDelayTitle', 'Route traffic delay')}>
                  {latestLoading ? (
                    <Skeleton height={64} />
                  ) : latestError ? (
                    <QueryError
                      error={latestError}
                      onRetry={() => void refetchLatest()}
                      resourceName={t('nav.resource', 'Navigation')}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <Text as="span" size="3xl" weight="bold" className={cn('tabular-nums', trafficDelayColor)}>
                        {formatDuration(latest?.route_traffic_delay_s ?? 0)}
                      </Text>
                      <TrafficDelayBadge
                        seconds={latest?.route_traffic_delay_s ?? 0}
                        t={t}
                      />
                    </div>
                  )}
                </LayoutCard>

                {/* Route Waypoints */}
                <LayoutCard title={t('nav.waypoints', 'Route waypoints')}>
                  {latestLoading ? (
                    <Skeleton lines={4} />
                  ) : latestError ? (
                    <QueryError
                      error={latestError}
                      onRetry={() => void refetchLatest()}
                      resourceName={t('nav.resource', 'Navigation')}
                    />
                  ) : !hasActiveRoute ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      message={t('navigation.noRoute', 'No active route selected')}
                    />
                  ) : waypoints.length > 0 ? (
                    <DataTable
                      tableId="maps:navigation-waypoints"
                      enableValueFilters
                      columns={waypointColumns}
                      mobileColumns={['name', 'type', 'distance']}
                      data={waypoints}
                      keyExtractor={(wp) => `${wp.name}-${wp.distance}`}
                      compact
                      pagination
                    />
                  ) : (
                    // no-action: waypoint details depend on metadata supplied by active navigation.
                    <EmptyState
                      icon={<Activity className="h-8 w-8 opacity-20" aria-hidden="true" />}
                      message={t(
                        'nav.noWaypoints',
                        'The active route does not include waypoint details.',
                      )}
                      description={t(
                        'nav.noWaypointsDescription',
                        'Stops appear here when vehicle navigation supplies waypoint metadata for the active route.',
                      )}
                      className="py-8"
                    />
                  )}
                </LayoutCard>

                {/* Recent Destinations */}
                <div className="min-w-0 md:col-span-2 xl:col-span-1">
                <LayoutCard title={t('nav.recentDestinations', 'Recent destinations')}>
                  {historyLoading ? (
                    <Skeleton lines={6} />
                  ) : historyError ? (
                    <QueryError
                      error={historyError}
                      onRetry={() => void refetchHistory()}
                      resourceName={t('nav.resourceHistory', 'Location history')}
                    />
                  ) : recentDestinations.length === 0 ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      message={t('nav.noDestinations', 'No destination history available.')}
                    />
                  ) : (
                    <DataTable
                      tableId="maps:navigation-recent-destinations"
                      columns={destColumns}
                      mobileColumns={['destination', 'distance', 'eta']}
                      data={recentDestinations}
                      keyExtractor={(row) => `${row.time}-${row.destination}`}
                      compact
                      pagination
                    />
                  )}
                </LayoutCard>
                </div>
              </section>
            </FadeIn>

            {/* ─────── 6. Location History table (full-width detail band) ─────── */}
            <FadeIn delay={0.25}>
              <section aria-label={t('nav.historyAria', 'Location history')}>
                <LayoutCard title={t('nav.locationHistory', 'Location history')}>
                  {historyLoading ? (
                    <Skeleton lines={8} />
                  ) : historyError ? (
                    <QueryError
                      error={historyError}
                      onRetry={() => void refetchHistory()}
                      resourceName={t('nav.resourceHistory', 'Location history')}
                    />
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
                      mobileColumns={['time', 'destination_name', 'located_at_home']}
                      data={sortedHistory}
                      keyExtractor={(row) => row.id}
                      sortKey={sortKey}
                      sortDir={sortDir}
                      onSort={handleSort}
                      compact
                      pagination
                    />
                  )}
                </LayoutCard>
              </section>
            </FadeIn>
          </>
        )}
      </div>
    </PageLayout>
  );
}
