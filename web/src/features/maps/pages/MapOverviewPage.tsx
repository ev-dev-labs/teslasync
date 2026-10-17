import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin, Clock, Home, Briefcase,
  Link2, Navigation, Route, Fence, LocateFixed,
  Gauge, Compass, Info, Battery, Zap,
} from 'lucide-react';

import { PageLayout, LayoutCard } from '@/components/layout';
import { deriveDataState } from '@/api/dataState';

import {
  GlassPanel, Badge, DataTable, Text, IconButton, CopyButton, Drawer, PanelTitle, TabNav,
  type Column, type MobileDataTablePresentation,
} from '@/components/ui';
import { TripReplayReadout } from '@/features/trips/components/TripReplayReadout';
import { TimeStamp, FreshnessDotAuto } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, AlertBanner, LiveStaleDataBanner, DataSourceNotice, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  MapContainer, Marker, Popup, Polyline,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  RoutePlayback,
  vehicleIcon,
  type MapStyle,
  type PlaybackPoint,
} from '@/components/maps';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useUnits } from '@/hooks/useUnits';
import { useUrlEnum } from '@/hooks/useUrlState';
import { NoVehicleSelected } from '@/features/onboarding/components/NoVehicleSelected';

import { cn } from '@/lib/cn';
import { headingToCardinal } from '@/lib/heading';
import { typography } from '@/lib/tokens';
import { request } from '@/api/client';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useGuardedNavigate } from '@/hooks/useNavigationGuard';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationSnapshot {
  located_at_home?: boolean | null;
  located_at_work?: boolean | null;
  locatedAtHome?: boolean | null;
  locatedAtWork?: boolean | null;
  homelink_nearby?: boolean | null;
}

/**
 * Shape returned by `GET /vehicles/{id}/positions`. The handler aliases
 * `ts → created_at` and `speed_mph → speed`; `odometer`, `power`,
 * `battery_level` and `elevation` are not currently emitted by the Fleet
 * Telemetry signal mappings, so they are optional and read null-safe.
 */
interface PositionRecord {
  id: string;
  vehicle_id?: number;
  latitude: number;
  longitude: number;
  speed: number | null;
  power?: number | null;
  heading: number | null;
  elevation?: number | null;
  odometer?: number | null;
  battery_level?: number | null;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Local presentational helper                                        */
/* ------------------------------------------------------------------ */

/** One icon + label + trailing (badge/value) row inside Location Details. */
function StatusRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="shrink-0" aria-hidden="true">{icon}</span>
      <Text variant="bodySm" className="flex-1">{label}</Text>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapOverviewPage() {
  const { fmtScientificNumber, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('maps');
  const { formatDateTime, formatRelativeTime } = useDateFormat();
  const navigate = useGuardedNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);
  usePageTitle(t('mapOverview.pageTitle', 'Map overview'));

  /* ---- unit prefs: format at the display boundary from SI ---- */
  const { formatSpeed, formatDistance, formatPower } = useUnits();
  const { reduce } = useMotionPreference();

  /* ---- vehicle selector: header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();
  // Map style lives in the URL so a satellite view can be shared.
  const [mapStyle, setMapStyle] = useUrlEnum<MapStyle>(
    'layer',
    ['dark', 'satellite', 'streets', 'terrain'] as const,
    'dark',
  );
  // Hero mode lives in the URL for the same reason. Live shows the current
  // position; Recent route replays the 50-point history on the same surface.
  const [mode, setMode] = useUrlEnum<'live' | 'recent'>(
    'mode',
    ['live', 'recent'] as const,
    'live',
  );
  // Playback cursor observed from the shared RoutePlayback widget (Recent
  // mode only). The widget owns the clock; the panel only renders this.
  const [recentPosition, setRecentPosition] = useState<{ point: PlaybackPoint; index: number } | null>(null);

  /* ---- queries ---- */
  const vehiclesQuery = useVehicles();
  const {
    data: vehicles,
    isLoading: vehiclesLoading,
  } = vehiclesQuery;
  const vehiclesState = deriveDataState(vehiclesQuery);

  const selectedId = vehicleId != null ? String(vehicleId) : '';

  const latestQuery = useQuery<PositionRecord | null>({
    queryKey: ['position-latest', selectedId],
    queryFn: ({ signal }) =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=1`,
        { signal },
      ).then((arr) => arr?.[0] ?? null),
    enabled: selectedId !== '',
    refetchInterval: 15_000,
  });
  const { data: latest } = latestQuery;
  const latestState = deriveDataState(latestQuery, {
    provenance: 'historical',
    unavailable: latestQuery.isSuccess && latest == null,
  });
  const latestLoading = latestState.status === 'initial';
  const latestError = latestState.fatalError;

  const historyQuery = useQuery<PositionRecord[]>({
    queryKey: ['position-history', selectedId],
    queryFn: ({ signal }) =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=50`,
        { signal },
      ),
    enabled: selectedId !== '',
  });
  const { data: history } = historyQuery;
  const historyState = deriveDataState(historyQuery, {
    provenance: 'historical',
    unavailable: historyQuery.isSuccess && (history?.length ?? 0) === 0,
  });
  const historyLoading = historyState.status === 'initial';
  const historyError = historyState.fatalError;

  const locationQuery = useQuery<LocationSnapshot | null>({
    queryKey: ['location-latest', selectedId],
    queryFn: ({ signal }) =>
      request<LocationSnapshot | null>(
        `/location-snapshots/latest?vehicle_id=${selectedId}`,
        { signal },
      ),
    enabled: selectedId !== '',
  });
  const { data: locationDetails } = locationQuery;
  const locationState = deriveDataState(locationQuery, {
    provenance: 'unknown',
    unavailable: locationQuery.isSuccess && locationDetails == null,
  });
  const locationLoading = locationState.status === 'initial';
  const locationError = locationState.fatalError;

  /* ---- derived ---- */
  const historyRows = history ?? [];
  const hasValidLocation = !!latest
    && typeof latest.latitude === 'number'
    && typeof latest.longitude === 'number'
    && (latest.latitude !== 0 || latest.longitude !== 0);

  const trailPositions = useMemo(
    () => (history ?? [])
      .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && (s.latitude !== 0 || s.longitude !== 0))
      .map((s) => [s.latitude, s.longitude] as [number, number]),
    [history],
  );

  /* Time-ordered points for the optional `<RoutePlayback>` widget. The
     /positions endpoint returns most-recent-first, so we sort ascending. */
  const playbackPoints = useMemo<PlaybackPoint[]>(() => {
    const list = (history ?? [])
      .filter(
        (s) =>
          typeof s.latitude === 'number' &&
          typeof s.longitude === 'number' &&
          (s.latitude !== 0 || s.longitude !== 0) &&
          !!s.created_at,
      )
      .map((s) => ({
        lat: s.latitude,
        lng: s.longitude,
        timestamp: s.created_at,
        speed: s.speed ?? undefined,
        soc: s.battery_level ?? undefined,
        power: s.power ?? undefined,
      }));
    list.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    return list;
  }, [history]);

  const vehicle = vehicles?.find((v) => String(v.id) === selectedId);

  /* ---- location details (tri-state, null-safe) ---- */
  const atHome = locationDetails?.located_at_home ?? locationDetails?.locatedAtHome;
  const atWork = locationDetails?.located_at_work ?? locationDetails?.locatedAtWork;
  const homelinkNearby = locationDetails?.homelink_nearby;
  const briefScope = t('mapOverview.brief.scope', 'Selected vehicle · latest position only. Map trail and playback use a separate latest-50-position history request.');
  const coordinateLine = hasValidLocation && latest
    ? `${fmtScientificNumber(latest.latitude, 4)}, ${fmtScientificNumber(latest.longitude, 4)}`
    : null;
  const positionMapLabel = t('mapOverview.positionMap', 'Recorded location map');
  const sourceLine = `${positionMapLabel}: ${t('provenance.historical', 'Historical')}`;

  const triLabel = (v: boolean | null | undefined): string =>
    v === true ? t('mapOverview.yes', 'Yes')
      : v === false ? t('mapOverview.no', 'No')
        : t('mapOverview.unknown', 'Unknown');

  /* ---- history table columns ---- */
  const historyColumns: Column<PositionRecord>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('mapOverview.colTime', 'Time'),
        render: (r) => (
          <TimeStamp value={r.created_at} className={cn('whitespace-nowrap', typography.size.xs)} />
        ),
      },
      {
        key: 'latitude',
        align: 'right',
        header: t('mapOverview.colLat', 'Lat'),
        render: (r) => (
          <Text variant="code">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtScientificNumber(r.latitude, 5) : '—'}
          </Text>
        ),
      },
      {
        key: 'longitude',
        align: 'right',
        header: t('mapOverview.colLon', 'Lon'),
        render: (r) => (
          <Text variant="code">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtScientificNumber(r.longitude, 5) : '—'}
          </Text>
        ),
      },
      {
        key: 'speed',
        align: 'right',
        header: t('mapOverview.colSpeed', 'Speed'),
        render: (r) => (
          <Text variant="bodySm">{formatSpeed(r.speed ?? null)}</Text>
        ),
      },
      {
        key: 'heading',
        align: 'right',
        header: t('mapOverview.colHeading', 'Heading'),
        render: (r) => (
          <Text variant="bodySm">{r.heading != null ? `${fmtNumber(r.heading)}°` : '—'}</Text>
        ),
      },
    ],
    [t, formatSpeed, fmtNumber, fmtScientificNumber],
  );

  const historyMobilePresentation = useMemo<MobileDataTablePresentation<PositionRecord>>(
    () => ({
      variant: 'keyValue',
      roles: { time: 'title', speed: 'primary', heading: 'meta', latitude: 'hidden', longitude: 'hidden' },
      displayValue: (row, key) => {
        switch (key) {
          case 'time': return formatDateTime(row.created_at);
          case 'speed': return formatSpeed(row.speed ?? null);
          case 'heading': return row.heading != null ? `${fmtNumber(row.heading)}°` : '—';
          case 'latitude': return row.latitude !== 0 || row.longitude !== 0 ? fmtScientificNumber(row.latitude, 5) : null;
          case 'longitude': return row.latitude !== 0 || row.longitude !== 0 ? fmtScientificNumber(row.longitude, 5) : null;
          default: return null;
        }
      },
    }),
    [formatDateTime, formatSpeed, fmtNumber, fmtScientificNumber],
  );

  // An initial paused read has not established an empty fleet.
  if (vehicleId == null && vehiclesQuery.isSuccess && vehicles?.length === 0) {
    return <NoVehicleSelected pageTitle={t('mapOverview.title', 'Map overview')} />;
  }

  /* ---- render ---- */
  return (
    <PageLayout
      title={t('mapOverview.title', 'Map overview')}
      subtitle={t(
        'mapOverview.historicalSubtitle',
        'Latest recorded vehicle position and recent history',
      )}
      loading={vehiclesLoading && !latestState.hasData && !historyState.hasData && !locationState.hasData}
      error={!latestState.hasData && !historyState.hasData && !locationState.hasData ? vehiclesState.fatalError : null}
      query={latestQuery}
      dataSources={[
        { id: 'vehicles', label: t('mapOverview.vehicle', 'Vehicle'), query: vehiclesQuery },
        { id: 'latest-position', label: t('mapOverview.positionMap', 'Recorded location map'), query: latestQuery, enabled: selectedId !== '' },
        { id: 'position-history', label: t('mapOverview.recentHistory', 'Recent location history'), query: historyQuery, enabled: selectedId !== '' },
        { id: 'location-details', label: t('mapOverview.locationDetails', 'Location details'), query: locationQuery, enabled: selectedId !== '' },
      ]}
    >
      <LiveStaleDataBanner />

      {/* GPS data warning — surfaces when the vehicle reports no fix. */}
      {latest && !hasValidLocation && (
        <AlertBanner variant="info">
          {t('mapOverview.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
        </AlertBanner>
      )}

      {/* 1 — Hero: recorded position map + info panel in ONE surface (trip replay model). */}
      <FadeIn delay={0.05}>
        <GlassPanel className="overflow-hidden p-0">
          <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-4 py-2.5 sm:px-5">
            <TabNav
              tabs={[
                { key: 'live', label: t('mapOverview.modeLive', 'Live') },
                { key: 'recent', label: t('mapOverview.modeRecent', 'Recent route') },
              ]}
              active={mode}
              onChange={(key) => { if (key === 'live' || key === 'recent') setMode(key); }}
              ariaLabel={t('mapOverview.mapMode', 'Map mode')}
            />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,13fr)_minmax(300px,7fr)]" data-testid="map-overview-hero">
          {/* Recorded position map — the hero visual. */}
          {mode === 'live' ? (
          <div
            role="region"
            aria-label={positionMapLabel}
            className="relative h-[380px] overflow-hidden sm:h-[460px] lg:h-auto lg:min-h-[560px]"
          >
            {latestLoading && !latest ? (
              <>
                <DataSourceNotice sources={[{ id: 'latest-position', label: t('mapOverview.positionMap', 'Recorded location map'), query: latestQuery, enabled: selectedId !== '' }]} />
                <Skeleton height="100%" className="h-full w-full rounded-none" />
              </>
            ) : latestError ? (
              <div className="flex h-full items-center justify-center p-6">
                <QueryError error={latestError} onRetry={() => latestQuery.refetch()} />
              </div>
            ) : hasValidLocation && latest ? (
              <>
                <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
                <MapContainer
                  key={`position-map:${selectedId}`}
                  center={[latest.latitude, latest.longitude]}
                  zoom={15}
                  scrollWheelZoom
                  zoomAnimation={!reduce}
                  fadeAnimation={!reduce}
                  markerZoomAnimation={!reduce}
                  className="h-full w-full"
                >
                  <MapTileLayer style={mapStyle} />
                  <MapInvalidator />
                  <Marker position={[latest.latitude, latest.longitude]} icon={vehicleIcon()}>
                    <Popup>{vehicle?.display_name ?? t('mapOverview.vehicle', 'Vehicle')}</Popup>
                  </Marker>
                  {trailPositions.length > 1 && (
                    <Polyline positions={trailPositions} color="var(--semantic-info)" weight={3} opacity={0.7} />
                  )}
                </MapContainer>
              </>
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState /* no-action: transient empty state — surfaces when GPS data is missing */
                  icon={<MapPin className="h-8 w-8" aria-hidden="true" />}
                  message={t(
                    'mapOverview.noLocation',
                    'No GPS data available. Location data requires Fleet Telemetry streaming.',
                  )}
                />
              </div>
            )}
          </div>
          ) : (
          /* Recent route mode: the same surface replays the 50-point history.
             Fixed heights (not min-heights) so the bare playback frame fills
             the cell with the bar directly under the map at every width. */
          <div
            role="region"
            aria-label={positionMapLabel}
            className="relative flex h-[380px] flex-col overflow-hidden sm:h-[460px] lg:h-[560px]"
          >
            {historyLoading ? (
              <>
                <DataSourceNotice sources={[{ id: 'position-history', label: t('mapOverview.recentHistory', 'Recent location history'), query: historyQuery, enabled: selectedId !== '' }]} />
                <Skeleton height="100%" className="h-full w-full rounded-none" />
              </>
            ) : historyError ? (
              <div className="flex h-full items-center justify-center p-6">
                <QueryError error={historyError} onRetry={() => historyQuery.refetch()} />
              </div>
            ) : playbackPoints.length > 1 ? (
              <RoutePlayback
                key={`position-playback:${selectedId}`}
                bare
                points={playbackPoints}
                initialMapStyle={mapStyle}
                onPositionChange={(point, index) => setRecentPosition({ point, index })}
                ariaLabel={t('mapOverview.playbackLabel', 'Recent route playback map')}
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <EmptyState /* no-action: transient empty state — not enough GPS points to replay */
                  icon={<Navigation className="h-8 w-8" aria-hidden="true" />}
                  message={t('mapOverview.noPlayback', 'Not enough GPS points to replay a route yet.')}
                />
              </div>
            )}
          </div>
          )}

          {/* Info panel: latest observation, location status, coordinates —
              or the playback position's stats in Recent route mode. */}
          <section
            aria-label={mode === 'live'
              ? t('mapOverview.locationDetails', 'Location details')
              : t('mapOverview.playbackPosition', 'Playback position')}
            aria-busy={(mode === 'live' ? latestLoading : historyLoading) || undefined}
            className="flex min-w-0 flex-col gap-4 border-t border-[var(--border-subtle)] p-4 sm:p-5 lg:border-s lg:border-t-0"
          >
            <header className="flex min-w-0 flex-wrap items-center gap-2">
              <PanelTitle className="mb-0 min-w-0 flex-1">
                {mode === 'live'
                  ? t('mapOverview.locationDetails', 'Location details')
                  : t('mapOverview.playbackPosition', 'Playback position')}
              </PanelTitle>
              <div className="flex shrink-0 items-center gap-1.5">
                <IconButton icon={<Route className="h-4 w-4" aria-hidden="true" />} label={t('mapOverview.navRoute', 'Navigation route')} onClick={() => { void navigate('/navigation'); }} />
                <IconButton icon={<Fence className="h-4 w-4" aria-hidden="true" />} label={t('mapOverview.geofences', 'Geofences')} onClick={() => { void navigate('/geofences'); }} />
                <IconButton icon={<LocateFixed className="h-4 w-4" aria-hidden="true" />} label={t('mapOverview.locations', 'Locations')} onClick={() => { void navigate('/locations'); }} />
                <IconButton icon={<Info className="h-4 w-4" aria-hidden="true" />} label={t('mapOverview.details', 'Details')} onClick={() => setDetailsOpen(true)} />
                {mode === 'live' && (
                  <FreshnessDotAuto query={latestQuery} refreshIntervalMs={15_000} source={positionMapLabel} />
                )}
              </div>
            </header>
            {mode === 'live' ? (
            <>
            <StaleRefreshWarning state={latestState} label={positionMapLabel} />
            {latestLoading ? (
              <Skeleton lines={3} height={20} />
            ) : (
              <div className="space-y-3">
                <StatusRow
                  icon={<Gauge className={cn('h-5 w-5', typography.color.muted)} />}
                  label={t('mapOverview.observedSpeed', 'Observed speed')}
                >
                  <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                    {formatSpeed(latest?.speed ?? null)}
                  </Text>
                </StatusRow>
                <StatusRow
                  icon={<Compass className={cn('h-5 w-5', typography.color.muted)} />}
                  label={t('mapOverview.heading', 'Heading')}
                >
                  <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                    {latest?.heading != null
                      ? t('mapOverview.headingValue', '{{cardinal}} ({{degrees}}°)', {
                        cardinal: headingToCardinal(latest.heading),
                        degrees: Math.round(latest.heading),
                      })
                      : '—'}
                  </Text>
                </StatusRow>
                <StatusRow
                  icon={<Clock className={cn('h-5 w-5', typography.color.muted)} />}
                  label={t('mapOverview.lastObserved', 'Last observed')}
                >
                  {latest?.created_at ? (
                    <span className="text-right">
                      <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                        {formatDateTime(latest.created_at)}
                      </Text>{' '}
                      <Text as="span" variant="caption" color="muted" className="tabular-nums">
                        · {formatRelativeTime(latest.created_at)}
                      </Text>
                    </span>
                  ) : (
                    <Text size="sm" weight="semibold" color="primary">—</Text>
                  )}
                </StatusRow>
              </div>
            )}
            <div className="space-y-3">
                  <DataSourceNotice sources={[{ id: 'location-details', label: t('mapOverview.locationDetails', 'Location details'), query: locationQuery, enabled: selectedId !== '' }]} />
                  {locationLoading && <Skeleton lines={3} height={20} />}
                  {locationError && <QueryError error={locationError} onRetry={() => locationQuery.refetch()} />}
                  {/* Home */}
                  <StatusRow
                    icon={<Home className={cn('h-5 w-5', typography.color.muted)} />}
                    label={t('mapOverview.atHome', 'At home')}
                  >
                    <Badge variant={atHome === true ? 'success' : 'neutral'} size="sm" dot>
                      {triLabel(atHome)}
                    </Badge>
                  </StatusRow>

                  {/* Work */}
                  <StatusRow
                    icon={<Briefcase className={cn('h-5 w-5', typography.color.muted)} />}
                    label={t('mapOverview.atWork', 'At work')}
                  >
                    <Badge variant={atWork === true ? 'success' : 'neutral'} size="sm" dot>
                      {triLabel(atWork)}
                    </Badge>
                  </StatusRow>

                  {/* HomeLink nearby */}
                  <StatusRow
                    icon={<Link2 className={cn('h-5 w-5', typography.color.muted)} />}
                    label={t('mapOverview.homelinkNearby', 'HomeLink nearby')}
                  >
                    <Badge variant={homelinkNearby === true ? 'info' : 'neutral'} size="sm" dot>
                      {triLabel(homelinkNearby)}
                    </Badge>
                  </StatusRow>

                  {locationQuery.isSuccess && !locationDetails && !latest && (
                    <EmptyState /* no-action: transient empty state — no location data yet */
                      message={t('mapOverview.noLocation', 'No location data available yet')}
                    />
                  )}
            </div>
            {latestLoading ? (
              <Skeleton lines={2} height={20} />
            ) : (
              <div className="space-y-3">
                {/* Odometer */}
                <StatusRow
                  icon={<Navigation className={cn('h-5 w-5', typography.color.muted)} />}
                  label={t('mapOverview.odometer', 'Odometer')}
                >
                  <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                    {formatDistance(latest?.odometer ?? null)}
                  </Text>
                </StatusRow>
                <StatusRow
                  icon={<MapPin className={cn('h-5 w-5', typography.color.muted)} />}
                  label={t('mapOverview.coordinates', 'Coordinates')}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                      {coordinateLine ?? '—'}
                    </Text>
                    {coordinateLine && (
                      <CopyButton
                        iconOnly
                        text={coordinateLine}
                        label={t('mapOverview.copyCoordinates', 'Copy coordinates')}
                        title={t('mapOverview.copyCoordinates', 'Copy coordinates')}
                      />
                    )}
                  </span>
                </StatusRow>
              </div>
            )}
            </>
            ) : historyLoading ? (
              <Skeleton lines={4} height={20} />
            ) : historyError ? (
              <Text as="p" variant="bodySm" color="secondary">
                {t('mapOverview.recentRouteError', 'Recent route unavailable.')}
              </Text>
            ) : playbackPoints.length > 1 && recentPosition ? (
              <>
              <StaleRefreshWarning state={historyState} label={positionMapLabel} />
              <div className="grid grid-cols-2 gap-x-2">
                <TripReplayReadout
                  label={t('mapOverview.colTime', 'Time')}
                  value={formatDateTime(recentPosition.point.timestamp)}
                  icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                />
                <TripReplayReadout
                  label={t('mapOverview.playbackSpeed', 'Speed')}
                  value={formatSpeed(recentPosition.point.speed ?? null)}
                  icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
                />
                {recentPosition.point.soc != null && (
                  <TripReplayReadout
                    label={t('mapOverview.playbackBattery', 'Battery')}
                    value={`${fmtNumber(recentPosition.point.soc)}%`}
                    icon={<Battery className="h-4 w-4" aria-hidden="true" />}
                  />
                )}
                {recentPosition.point.power != null && (
                  <TripReplayReadout
                    label={t('mapOverview.playbackPower', 'Power')}
                    value={formatPower(recentPosition.point.power ?? null)}
                    icon={<Zap className="h-4 w-4" aria-hidden="true" />}
                  />
                )}
              </div>
              </>
            ) : playbackPoints.length > 1 ? (
              <Skeleton lines={4} height={20} />
            ) : (
              <EmptyState /* no-action: transient empty state — no recent route to replay */
                icon={<Navigation className="h-8 w-8" aria-hidden="true" />}
                message={t('mapOverview.noRecentRoute', 'No recent route to replay yet.')}
              />
            )}
          </section>
          </div>
        </GlassPanel>
      </FadeIn>
      <Drawer open={detailsOpen} onClose={() => setDetailsOpen(false)} title={t('mapOverview.sourcesTitle', 'Sources and method')}>
        <div className="space-y-3">
          <Text as="p" variant="bodySm" color="secondary">
            {t('mapOverview.brief.description', 'Reported motion and coordinates from the latest position; missing GPS is not a measured zero.')}
          </Text>
          <Text as="p" variant="bodySm" color="secondary">{briefScope}</Text>
          <Text as="p" variant="bodySm" color="secondary">
            {t('mapOverview.observationFreshness', 'Stored observation time. Polling every 15 s checks for positions, not whether this observation is current.')}
          </Text>
          <Text as="p" variant="bodySm" color="secondary">{sourceLine}</Text>
        </div>
      </Drawer>

      {/* 3 — Detail band: full-width recent location history table. */}
      <FadeIn delay={0.15}>
        <LayoutCard title={t('mapOverview.recentHistory', 'Recent location history')}>
          {historyLoading ? (
            <>
              <DataSourceNotice sources={[{ id: 'position-history', label: t('mapOverview.recentHistory', 'Recent location history'), query: historyQuery, enabled: selectedId !== '' }]} />
              <Skeleton lines={6} height={16} className="mt-2" />
            </>
          ) : historyError ? (
            <QueryError error={historyError} onRetry={() => historyQuery.refetch()} />
          ) : historyRows.length > 0 ? (
            <DataTable<PositionRecord>
              tableId="maps:overview-history"
              variant="embedded"
              columns={historyColumns}
              mobileColumns={['time', 'latitude', 'longitude', 'speed', 'heading']}
              mobilePresentation={historyMobilePresentation}
              data={historyRows}
              keyExtractor={(r) => r.id}
              emptyMessage={t('mapOverview.noHistory', 'No location history found.')}
              compact
              pagination
            />
          ) : (
            // no-action: location history appears automatically after valid GPS reports.
            <EmptyState
              icon={<Clock className="h-8 w-8" aria-hidden="true" />}
              message={t('mapOverview.noHistory', 'No location history found.')}
              description={t(
                'mapOverview.noHistoryDescription',
                'Location history appears after the selected vehicle reports valid GPS positions.',
              )}
            />
          )}
        </LayoutCard>
      </FadeIn>
    </PageLayout>
  );
}
