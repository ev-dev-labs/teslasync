import { useState, useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { neonColorMap } from '@/lib/tokens';
import {
  Navigation,
  MapPin,
  Route,
  Zap,
  AlertTriangle,
  RefreshCw,
  Activity,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';

import { GlassPanel, Badge, DataTable, Text, Caption, MetricValue, Icon, type Column, IconButton } from '@/components/ui';
import { TimeStamp } from '@/components/data-display';
import { MapsOperationalBrief } from '../components/operationalbrief-all/MapsOperationalBrief';
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
import { useDateFormat } from '@/hooks/useDateFormat';

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

/* ------------------------------------------------------------------ */
/*  Sub-component: Traffic Delay Badge                                 */
/* ------------------------------------------------------------------ */

interface TrafficDelayBadgeProps {
  seconds: number | null | undefined;
  t: ReturnType<typeof useTranslation>['t'];
}

function trafficDelayVariant(seconds: number | null | undefined) {
  return seconds == null || !Number.isFinite(seconds) ? 'neutral'
    : seconds < 300 ? 'success' : seconds <= 900 ? 'warning' : 'danger';
}

function TrafficDelayBadge({ seconds, t }: TrafficDelayBadgeProps) {
  const { formatDuration } = useUnits();
  if (seconds == null || !Number.isFinite(seconds)) {
    return <Badge variant="neutral" size="sm">{t('nav.unknown', 'Unknown')}</Badge>;
  }
  return (
    <Badge variant={trafficDelayVariant(seconds)} size="sm" dot>
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

function InitialSourceContent({ paused, label, children }: { paused: boolean; label: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={label} aria-live="polite">
      {paused
        ? <Caption>{t('dataSources.status.paused', 'Refresh paused')}</Caption>
        : children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Helper: waypoint builder + type                                   */
/* ------------------------------------------------------------------ */

interface Waypoint {
  name: string;
  type: 'supercharger' | 'destination' | 'waypoint';
  distance: number | null;
}

function buildWaypoints(latest: LocationSnapshot): Waypoint[] {
  const destName = latest.destination_name;
  if (!destName) return [];
  return [
    {
      name: destName,
      type: 'destination',
      distance: latest.miles_to_arrival ?? null,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

// Keep this page-owned read local until a shared API-hook owner is assigned.
function useNavigationLocationHistory(vehicleId: number | null) {
  return useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', vehicleId],
    queryFn: ({ signal }) =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${vehicleId}&limit=200`,
        { signal },
      ),
    enabled: vehicleId !== null,
  });
}

export default function NavigationRoutePage() {
  const { fmtNumber, fmtScientificNumber } = useNumberFormatting();
  const { formatDateTime } = useDateFormat();
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
  const vehiclesState = deriveDataState(vehiclesQuery);

  /* ---- latest snapshot ---- */
  const latestQuery = useLocationSnapshotLatest(vehicleId ?? 0, 15_000);
  const {
    data: latest,
    refetch: refetchLatest,
  } = latestQuery;
  const latestState = deriveDataState({ ...latestQuery, data: latest ?? undefined }, { provenance: 'live' });
  const latestLoading = latestState.status === 'initial' && !latestQuery.isSuccess;
  const latestError = latestState.fatalError;

  /* ---- history ---- */
  const historyQuery = useNavigationLocationHistory(vehicleId);
  const { data: history, refetch: refetchHistory } = historyQuery;
  const historyState = deriveDataState(historyQuery, { provenance: 'historical', unavailable: history?.length === 0 });
  const historyLoading = historyState.status === 'initial';
  const historyError = historyState.fatalError;

  /* ---- charging telemetry (for expected energy at arrival) ---- */
  const chargingQuery = useChargingTelemetryLatest(
    vehicleId ?? 0,
    15_000,
  );
  const chargingTelemetry = chargingQuery.data;
  const chargingState = deriveDataState(chargingQuery, { provenance: 'live', unavailable: chargingTelemetry === null });

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
          speed: s.speed_mph == null ? null : convertSpeedFromSI(s.speed_mph, speedUnit),
          /* miles_to_arrival is meters SI; convert to user pref. */
          miles: s.miles_to_arrival == null ? null : convertDistanceFromSI(s.miles_to_arrival, distanceUnit),
        })),
    [history, speedUnit, distanceUnit, formatDateTime],
  );

  /* ---- average measured speed in SI ---- */
  const avgSpeed = useMemo(() => {
    if (!history?.length) return null;
    /* speed_mph is m/s SI; average in SI then convert at the boundary. */
    const speedsMps = history
      .map((s) => s.speed_mph)
      .filter((v): v is number => v != null && v > 0);
    if (!speedsMps.length) return history.some((s) => s.speed_mph != null) ? 0 : null;
    const avgMps = speedsMps.reduce((a, b) => a + b, 0) / speedsMps.length;
    return avgMps;
  }, [history]);

  /* ---- recent destinations (unique, from history with active routes) ---- */
  const recentDestinations = useMemo(() => {
    if (!history?.length) return [];
    const seen = new Set<string>();
    const result: { createdAt: string; time: string; destination: string; distance: number | null; eta: number | null }[] = [];
    for (const s of history) {
      const name = s.destination_name;
      if (!name || seen.has(name)) continue;
      seen.add(name);
      result.push({
        createdAt: s.created_at,
        time: formatDateTime(s.created_at),
        destination: name,
        /* miles_to_arrival is meters SI; convert to user pref. */
        distance: s.miles_to_arrival == null ? null : convertDistanceFromSI(s.miles_to_arrival, distanceUnit),
        eta: s.minutes_to_arrival ?? null,
      });
    }
    return result.slice(0, 20);
  }, [history, distanceUnit, formatDateTime]);

  /* ---- presence chart (home / work over time) ---- */
  const presenceChartData = useMemo(() => {
    if (!history?.length) return [];
    return [...history]
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((s) => ({
        time: formatDateTime(s.created_at),
        home: s.located_at_home == null ? null : s.located_at_home ? 1 : 0,
        work: s.located_at_work == null ? null : s.located_at_work ? 1 : 0,
        homelink: s.homelink_nearby == null ? null : s.homelink_nearby ? 1 : 0,
      }));
  }, [history, formatDateTime]);

  /* ---- recent-destination table columns ---- */
  const destColumns: Column<typeof recentDestinations[number]>[] = useMemo(
    () => [
      { key: 'time', header: t('nav.col.time', 'Time'), render: (row) => <Caption className="whitespace-nowrap">{row.time}</Caption> },
      { key: 'destination', header: t('nav.col.destination', 'Destination'), render: (row) => <Text variant="body">{row.destination}</Text> },
      { key: 'distance', align: 'right', header: t('nav.col.distance', 'Distance'), render: (row) => <Caption>{row.distance == null ? '—' : `${fmtNumber(row.distance)} ${distanceUnit}`}</Caption> },
      { key: 'eta', align: 'right', header: t('nav.col.eta', 'ETA'), render: (row) => <Caption>{row.eta == null ? '—' : `${fmtNumber(row.eta)} ${t('nav.minutes', 'min')}`}</Caption> },
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
          <Text variant="caption" mono><TimeStamp value={row.created_at} className="whitespace-nowrap" /></Text>
        ),
      },
      {
        key: 'latitude',
        align: 'right',
        header: t('nav.col.lat', 'Lat'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text mono color="primary">
            {row.latitude != null ? fmtScientificNumber(row.latitude, 6) : '—'}
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
            {row.longitude != null ? fmtScientificNumber(row.longitude, 6) : '—'}
          </Text>
        ),
      },
      {
        key: 'located_at_home',
        header: t('nav.col.home', 'Home'),
        sortable: true,
        render: (row: LocationSnapshot) => (
          <Text color="secondary">
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
          <Text color="secondary">
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
          <Text color="primary" className="block break-words">
            {row.destination_name ?? '—'}
          </Text>
        ),
      },
    ],
    [t, fmtScientificNumber],
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
              <Icon icon={Zap} />
            ) : row.type === 'destination' ? (
              <Icon icon={MapPin} />
            ) : (
              <Icon icon={Route} />
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
            {t(`nav.wp.kind.${row.type}`, row.type === 'supercharger' ? 'Supercharger' : row.type === 'destination' ? 'Destination' : 'Waypoint')}
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
            {row.distance == null ? '—' : `${fmtNumber(convertDistanceFromSI(row.distance, distanceUnit))} ${distanceUnit}`}
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
  const refetchCharging = chargingQuery.refetch;
  const handleRefresh = useCallback(() => {
    void refetchLatest();
    void refetchHistory();
    void refetchCharging();
  }, [refetchLatest, refetchHistory, refetchCharging]);

  /* ---- traffic-delay accent (dynamic, computed) ---- */
  const trafficDelaySec = hasActiveRoute ? latest?.route_traffic_delay_s : undefined;
  const trafficDelayColor = {
    neutral: neonColorMap.neutral.text,
    success: neonColorMap.green.text,
    warning: neonColorMap.amber.text,
    danger: neonColorMap.red.text,
  }[trafficDelayVariant(trafficDelaySec)];
  const routeScope = t('nav.brief.scope', 'Selected vehicle · current route snapshot, latest 200 location snapshots, and independent arrival-energy telemetry; no common source window.');
  const routeMetrics = [
    { metricId: 'distance', occurrenceId: 'navigation-distance', rawValue: hasActiveRoute ? latest?.miles_to_arrival : null, label: t('nav.metric.distance', 'Distance'), description: t('nav.brief.distance', 'Remaining route distance, reported in meters.'), display: { formatter: (raw: number) => ({ value: fmtNumber(convertDistanceFromSI(raw, distanceUnit)), unit: distanceUnit }) } },
    { metricId: 'duration', occurrenceId: 'navigation-eta', rawValue: hasActiveRoute && latest?.minutes_to_arrival != null ? latest.minutes_to_arrival * 60 : null, label: t('nav.metric.eta', 'ETA'), description: t('nav.brief.eta', 'Source ETA is in minutes; bridged as seconds and displayed in the original minute denomination.'), display: { formatter: (raw: number) => ({ value: fmtNumber(raw / 60), unit: t('nav.minutes', 'min') }) } },
    { metricId: 'duration', occurrenceId: 'navigation-delay', rawValue: hasActiveRoute ? latest?.route_traffic_delay_s : null, label: t('nav.metric.trafficDelay', 'Traffic delay'), description: t('nav.brief.delay', 'Current route traffic delay in seconds; unknown differs from measured no delay.'), display: { formatter: (raw: number) => ({ value: formatDuration(raw), unit: '' }) } },
    { metricId: 'speed', occurrenceId: 'navigation-average', rawValue: avgSpeed, label: t('nav.metric.avgSpeed', 'Avg speed'), description: t('nav.brief.average', 'Mean of positive measured speeds in the latest 200 snapshots; measured stationary history yields zero, unmeasured history stays unknown.'), display: { formatter: (raw: number) => ({ value: fmtNumber(convertSpeedFromSI(raw, speedUnit)), unit: speedUnit }) } },
    { metricId: 'percent', occurrenceId: 'navigation-arrival', rawValue: chargingTelemetry?.expected_energy_pct_at_arrival, label: t('nav.metric.energyAtArrival', 'Energy at arrival'), description: t('nav.brief.arrival', 'Expected arrival percentage comes from independent charging telemetry, not a calculation from the route history.'), display: { formatter: (raw: number) => ({ value: `${fmtNumber(raw)}%`, unit: '' }) } },
  ] as const;
  const fix = normalizeGpsState(latest?.gps_state);
  const coordinateCaption = hasValidLocation
    ? `${fmtScientificNumber(lat!, 4)}, ${fmtScientificNumber(lon!, 4)}`
    : t('nav.locationUnavailable', 'Location unavailable');
  const presenceScope = t('nav.brief.presenceScope', 'Selected vehicle · latest location snapshot. False is a reported away state; missing presence is unknown.');
  const presenceMetrics = [
    { metricId: 'number', occurrenceId: 'navigation-latitude', rawValue: hasValidLocation ? lat : null, label: t('nav.col.latitude', 'Lat'), description: t('nav.currentLocation', 'Current location'), context: coordinateCaption, display: { formatter: (raw: number) => ({ value: fmtScientificNumber(raw, 4), unit: '' }) } },
    { metricId: 'number', occurrenceId: 'navigation-longitude', rawValue: hasValidLocation ? lon : null, label: t('nav.col.longitude', 'Lon'), description: t('nav.currentLocation', 'Current location'), display: { formatter: (raw: number) => ({ value: fmtScientificNumber(raw, 4), unit: '' }) } },
    { metricId: 'status', occurrenceId: 'navigation-gps', rawValue: latest?.gps_state != null ? t(`nav.gpsState.${fix}`, { defaultValue: fix }) : null, label: t('nav.gpsFixQuality', 'GPS fix quality'), description: presenceScope },
    { metricId: 'number', occurrenceId: 'navigation-heading', rawValue: latest?.heading, missingReason: t('nav.unknown', 'Unknown'), label: t('nav.heading', 'Heading'), description: t('nav.brief.heading', 'Cardinal direction and rounded degrees retain the reported heading.'), display: { formatter: (raw: number) => ({ value: t('nav.headingValue', '{{cardinal}} ({{degrees}}°)', { cardinal: headingToCardinal(raw), degrees: Math.round(raw) }), unit: '' }) } },
    { metricId: 'status', occurrenceId: 'navigation-home', rawValue: latest?.located_at_home === true ? t('nav.atHome', 'At home') : latest?.located_at_home === false ? latest?.homelink_nearby ? t('nav.homelinkNearby', 'HomeLink nearby') : t('nav.awayFromHome', 'Away') : null, label: t('nav.homeStatus', 'Home status'), description: presenceScope },
    { metricId: 'status', occurrenceId: 'navigation-work', rawValue: latest?.located_at_work === true ? t('nav.atWork', 'At work') : latest?.located_at_work === false ? t('nav.notAtWork', 'Away') : null, label: t('nav.workStatus', 'Work status'), description: presenceScope },
  ] as const;

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
          <IconButton icon={<Icon icon={RefreshCw} />} label={t('nav.refresh', 'Refresh')} onClick={handleRefresh} />
        </div>
      }
    >
      <div className="space-y-4 sm:space-y-6">
        <LiveStaleDataBanner />

        {vehicleId === null ? (
          <GlassPanel className="p-4 sm:p-5">
            {vehiclesState.status === 'initial' ? (
              <InitialSourceContent paused={vehiclesState.isRefreshBlocked} label={t('geofences.vehicle', 'Vehicle')}>
                <Skeleton lines={4} />
              </InitialSourceContent>
            ) : vehiclesState.fatalError ? (
              <QueryError
                error={vehiclesState.fatalError}
                onRetry={() => void vehiclesQuery.refetch()}
                resourceName={t('geofences.vehicle', 'Vehicle')}
              />
            ) : <EmptyState
              icon={<Icon icon={Navigation} size="xl" className="text-[var(--text-muted)]" />}
              message={t('nav.noVehicle', 'Select a vehicle to view navigation and route data.')}
              actionTo={{ label: t('nav.manageVehicles', 'Manage vehicles'), to: '/vehicles' }}
            />}
          </GlassPanel>
        ) : (
          <>
            {/* ─────── 1. KPI band — Route Metrics ─────── */}
            <FadeIn>
              <MapsOperationalBrief
                title={t('nav.metricsAria', 'Route metrics')}
                description={t('nav.brief.description', 'Route distance, ETA and delay remain separate from history-derived speed and projected arrival energy.')}
                scope={routeScope}
                metrics={routeMetrics}
                sources={[{ label: t('nav.resource', 'Navigation'), state: latestState }, { label: t('nav.resourceHistory', 'Location history'), state: historyState }, { label: t('nav.metric.energyAtArrival', 'Energy at arrival'), state: chargingState }]}
                loading={latestLoading && !historyState.hasData && !chargingState.hasData}
                onRetry={chargingQuery.error && chargingTelemetry == null ? () => void chargingQuery.refetch() : undefined}
              />
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
                      {latestLoading
                        ? latestState.isRefreshBlocked
                          ? t('nav.unknown', 'Unknown')
                          : t('common.loading', 'Loading...')
                        : latestError
                          ? t('common.error', 'Error')
                          : latest == null
                            ? t('nav.unknown', 'Unknown')
                            : hasActiveRoute
                              ? t('nav.active', 'Active')
                              : t('nav.inactive', 'Inactive')}
                    </Badge>
                  }
                >

                  <Caption className="mb-3 flex items-center gap-1.5">
                    <Icon icon={RefreshCw} size="xs" />
                    {t('nav.routeLastUpdated', 'Route last updated')}:{' '}
                    <Text variant="bodySm" as="span" className="font-medium text-[var(--text-secondary)]">
                      {latest?.route_last_updated
                        ? formatDateTime(latest.route_last_updated)
                        : '—'}
                    </Text>
                  </Caption>

                  {latestLoading ? (
                    <InitialSourceContent paused={latestState.isRefreshBlocked} label={t('nav.resource', 'Navigation')}>
                      <Skeleton lines={4} />
                    </InitialSourceContent>
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
                        {latest.minutes_to_arrival == null ? '—' : `${fmtNumber(latest.minutes_to_arrival)} ${t('nav.minutes', 'min')}`}
                      </RouteField>
                      <RouteField label={t('nav.distanceRemaining', 'Distance remaining')}>
                        {/* miles_to_arrival is meters SI; convert to user pref. */}
                        {latest.miles_to_arrival == null ? '—' : `${fmtNumber(convertDistanceFromSI(latest.miles_to_arrival, distanceUnit))} ${distanceUnit}`}
                      </RouteField>
                      <RouteField label={t('nav.trafficDelay', 'Traffic delay')}>
                        <TrafficDelayBadge
                          seconds={latest.route_traffic_delay_s}
                          t={t}
                        />
                      </RouteField>
                    </div>
                  ) : (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Icon icon={Navigation} size="xl" className="text-[var(--text-muted)]" />}
                      message={latest == null
                        ? t('nav.locationUnavailable', 'Location unavailable')
                        : t(
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
              <MapsOperationalBrief
                title={t('nav.presenceAria', 'Location status')}
                description={t('nav.brief.presenceDescription', 'GPS, heading and reported home/work presence retain their own known and missing states.')}
                scope={presenceScope}
                metrics={presenceMetrics}
                sources={[{ label: t('nav.resource', 'Navigation'), state: latestState }]}
                loading={latestLoading}
              />
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
                    <InitialSourceContent paused={historyState.isRefreshBlocked} label={t('nav.resourceHistory', 'Location history')}>
                      <Skeleton height={260} />
                    </InitialSourceContent>
                  ) : historyError ? (
                    <QueryError
                      error={historyError}
                      onRetry={() => void refetchHistory()}
                      resourceName={t('nav.resourceHistory', 'Location history')}
                    />
                  ) : chartData.length === 0 ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      icon={<Icon icon={AlertTriangle} size="xl" className="text-[var(--text-muted)]" />}
                      message={t(
                        'nav.noHistory',
                        'No location history available for this vehicle.',
                      )}
                    />
                  ) : (
                    <EmbeddedChart
                      chartKey="nav-speed-history"
                      title={t('nav.speedHistoryTitle', 'Speed & distance history')}
                      ariaLabel={t('nav.speedHistoryAria', 'Speed and distance-to-arrival area chart over time')}
                      height={260}
                      fluid={false}
                      data={chartData}
                      dataColumns={[
                        { key: 'time', label: t('nav.col.time', 'Time') },
                        { key: 'speed', label: t('nav.chartSpeedV2', { defaultValue: 'Speed ({{unit}})', unit: speedUnit }), format: (value) => typeof value === 'number' ? `${fmtNumber(value)} ${speedUnit}` : '—' },
                        { key: 'miles', label: t('nav.chartDistanceV2', { defaultValue: 'Distance to arrival ({{unit}})', unit: distanceUnit }), format: (value) => typeof value === 'number' ? `${fmtNumber(value)} ${distanceUnit}` : '—' },
                      ]}
                    >
                      {({ hiddenSeries }) => (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={chartData} margin={chartMargin}>
                            <defs>
                              <ChartGradient id="speedGrad" color={CHART_COLORS[0]} opacity={0.08} />
                              <ChartGradient id="odoGrad" color={CHART_COLORS[1]} opacity={0.08} />
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
                              strokeWidth={2}
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
                              strokeWidth={1}
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
                    <InitialSourceContent paused={historyState.isRefreshBlocked} label={t('nav.resourceHistory', 'Location history')}>
                      <Skeleton height={260} />
                    </InitialSourceContent>
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
                    <EmbeddedChart
                      chartKey="nav-home-work-presence"
                      title={t('nav.presenceChart', 'Home / work presence')}
                      ariaLabel={t('nav.presenceAria', 'Home, work, and HomeLink presence over time')}
                      height={260}
                      fluid={false}
                      data={presenceChartData}
                      dataColumns={[
                        { key: 'time', label: t('nav.col.time', 'Time') },
                        ...[
                          { key: 'home', label: t('nav.atHome', 'At home') },
                          { key: 'work', label: t('nav.atWork', 'At work') },
                          { key: 'homelink', label: t('nav.homelinkNearby', 'HomeLink') },
                        ].map((column) => ({
                          ...column,
                          format: (value: unknown) => value === 1 ? t('common.yes', 'Yes') : value === 0 ? t('common.no', 'No') : '—',
                        })),
                      ]}
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
                    <InitialSourceContent paused={latestState.isRefreshBlocked} label={t('nav.resource', 'Navigation')}>
                      <Skeleton height={64} />
                    </InitialSourceContent>
                  ) : latestError ? (
                    <QueryError
                      error={latestError}
                      onRetry={() => void refetchLatest()}
                      resourceName={t('nav.resource', 'Navigation')}
                    />
                  ) : latest && !hasActiveRoute ? (
                    <EmptyState /* no-action: route delay requires an active vehicle navigation route. */
                      message={t('navigation.noRoute', 'No active route selected')}
                    />
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <MetricValue as="span" className={trafficDelayColor}>
                        {trafficDelaySec == null || !Number.isFinite(trafficDelaySec) ? '—' : formatDuration(trafficDelaySec)}
                      </MetricValue>
                      <TrafficDelayBadge
                        seconds={trafficDelaySec}
                        t={t}
                      />
                    </div>
                  )}
                </LayoutCard>

                {/* Route Waypoints */}
                <LayoutCard title={t('nav.waypoints', 'Route waypoints')}>
                  {latestLoading ? (
                    <InitialSourceContent paused={latestState.isRefreshBlocked} label={t('nav.resource', 'Navigation')}>
                      <Skeleton lines={4} />
                    </InitialSourceContent>
                  ) : latestError ? (
                    <QueryError
                      error={latestError}
                      onRetry={() => void refetchLatest()}
                      resourceName={t('nav.resource', 'Navigation')}
                    />
                  ) : !hasActiveRoute ? (
                    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
                      message={latest == null
                        ? t('nav.unknown', 'Unknown')
                        : t('navigation.noRoute', 'No active route selected')}
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
                      icon={<Icon icon={Activity} size="xl" className="text-[var(--text-muted)]" />}
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
                    <InitialSourceContent paused={historyState.isRefreshBlocked} label={t('nav.resourceHistory', 'Location history')}>
                      <Skeleton lines={6} />
                    </InitialSourceContent>
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
                      mobilePresentation={{
                        roles: { destination: 'title', distance: 'primary', eta: 'meta', time: 'meta' },
                        displayValue: (row, key) => key === 'destination' ? row.destination
                          : key === 'time' ? row.time
                            : key === 'distance' ? row.distance == null ? '—' : `${fmtNumber(row.distance)} ${distanceUnit}`
                              : key === 'eta' ? row.eta == null ? '—' : `${fmtNumber(row.eta)} ${t('nav.minutes', 'min')}` : undefined,
                      }}
                      data={recentDestinations}
                      keyExtractor={(row) => `${row.createdAt}-${row.destination}`}
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
                    <InitialSourceContent paused={historyState.isRefreshBlocked} label={t('nav.resourceHistory', 'Location history')}>
                      <Skeleton lines={8} />
                    </InitialSourceContent>
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
                      mobilePresentation={{
                        roles: { destination_name: 'title', time: 'primary', latitude: 'meta', longitude: 'meta', located_at_home: 'meta', located_at_work: 'meta' },
                        displayValue: (row, key) => {
                          if (key === 'time') return formatDateTime(row.created_at);
                          if (key === 'destination_name') return row.destination_name ?? '—';
                          if (key === 'latitude' || key === 'longitude') {
                            const value = row[key];
                            return value != null ? fmtScientificNumber(value, 6) : '—';
                          }
                          if (key === 'located_at_home' || key === 'located_at_work') {
                            return row[key] === true ? t('common.yes', 'Yes') : row[key] === false ? t('common.no', 'No') : '—';
                          }
                          return undefined;
                        },
                      }}
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
