import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin, Compass, Gauge, Clock, Home, Briefcase,
  Link2, Navigation, Route, Fence, LocateFixed, ExternalLink,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { VehicleSelect } from '@/components/forms';
import {
  GlassPanel, Badge, Button, DataTable, PanelTitle, Text, type Column,
} from '@/components/ui';
import { MetricCard, LiveIndicator, TimeStamp } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError, AlertBanner, LiveStaleDataBanner } from '@/components/feedback';
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
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography } from '@/lib/tokens';
import { request } from '@/api/client';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface LocationSnapshot {
  id: number;
  vehicle_id: number;
  located_at_home: boolean;
  located_at_work: boolean;
  locatedAtHome?: boolean;
  locatedAtWork?: boolean;
  homelink_nearby: boolean;
  active_route: boolean;
  destination_name: string;
  created_at: string;
}

/**
 * Shape returned by `GET /vehicles/{id}/positions`. The handler aliases
 * `ts → created_at` and `speed_mph → speed`; `odometer`, `power`,
 * `battery_level` and `elevation` are not currently emitted by the Fleet
 * Telemetry signal mappings, so they are optional and read null-safe.
 */
interface PositionRecord {
  id: number;
  vehicle_id: number;
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
  const { t } = useTranslation('maps');
  usePageTitle(t('mapOverview.pageTitle', 'Map Overview'));

  /* ---- unit prefs: format at the display boundary from SI ---- */
  const { formatSpeed, formatDistance } = useUnits();

  /* ---- vehicle selector: header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();
  // Map style lives in the URL so a satellite view can be shared.
  const [mapStyle, setMapStyle] = useUrlEnum<MapStyle>(
    'layer',
    ['dark', 'satellite', 'streets', 'terrain'] as const,
    'dark',
  );

  /* ---- queries ---- */
  const vehiclesQuery = useVehicles();
  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = vehiclesQuery;

  const selectedId = vehicleId != null ? String(vehicleId) : '';

  const latestQuery = useQuery<PositionRecord | null>({
    queryKey: ['position-latest', selectedId],
    queryFn: () =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=1`,
      ).then((arr) => arr?.[0] ?? null),
    enabled: selectedId !== '',
    refetchInterval: 15_000,
  });
  const { data: latest, isLoading: latestLoading, error: latestError } = latestQuery;

  const historyQuery = useQuery<PositionRecord[]>({
    queryKey: ['position-history', selectedId],
    queryFn: () =>
      request<PositionRecord[]>(
        `/vehicles/${selectedId}/positions?limit=50`,
      ),
    enabled: selectedId !== '',
  });
  const { data: history, isLoading: historyLoading, error: historyError } = historyQuery;

  const locationQuery = useQuery<LocationSnapshot>({
    queryKey: ['location-latest', selectedId],
    queryFn: () =>
      request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${selectedId}`,
      ),
    enabled: selectedId !== '',
  });
  const { data: locationDetails, isLoading: locationLoading, error: locationError } = locationQuery;

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
  const homelinkNearby = locationDetails?.homelink_nearby ?? false;

  const triLabel = (v: boolean | undefined): string =>
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
        header: t('mapOverview.colLat', 'Lat'),
        render: (r) => (
          <Text variant="code">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtNumber(r.latitude, 5) : '—'}
          </Text>
        ),
      },
      {
        key: 'longitude',
        header: t('mapOverview.colLon', 'Lon'),
        render: (r) => (
          <Text variant="code">
            {r.latitude !== 0 || r.longitude !== 0 ? fmtNumber(r.longitude, 5) : '—'}
          </Text>
        ),
      },
      {
        key: 'speed',
        header: t('mapOverview.colSpeed', 'Speed'),
        render: (r) => (
          <Text variant="bodySm">{formatSpeed(r.speed ?? null, { precision: 1 })}</Text>
        ),
      },
      {
        key: 'heading',
        header: t('mapOverview.colHeading', 'Heading'),
        render: (r) => (
          <Text variant="bodySm">{r.heading != null ? `${fmtNumber(r.heading, 0)}°` : '—'}</Text>
        ),
      },
    ],
    [t, formatSpeed],
  );

  // Defensive guard: only surface the "no vehicle" empty state once the fleet
  // has actually loaded and is genuinely empty. While vehicles are still
  // loading — or if the fleet request failed — fall through to PageContainer so
  // the user sees a proper loading spinner / error banner instead of a
  // misleading "set up TeslaSync" prompt.
  if (vehicleId == null && !vehiclesLoading && !vehiclesError) {
    return <NoVehicleSelected pageTitle={t('mapOverview.title', 'Map Overview')} />;
  }

  /* ---- render ---- */
  return (
    <PageContainer
      title={t('mapOverview.title', 'Map Overview')}
      subtitle={t(
        'mapOverview.subtitle',
        'Live vehicle location and recent history',
      )}
      loading={vehiclesLoading}
      error={vehiclesError as Error | null}
      query={latestQuery}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <VehicleSelect />
          <LiveIndicator variant="compact" />
        </div>
      }
    >
      <LiveStaleDataBanner />

      {/* GPS data warning — surfaces when the vehicle reports no fix. */}
      {latest && !hasValidLocation && (
        <AlertBanner variant="info">
          {t('mapOverview.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
        </AlertBanner>
      )}

      {/* 1 — KPI band: live vehicle status, full-width responsive metric grid. */}
      <FadeIn>
        <section
          aria-label={t('mapOverview.kpis', 'Vehicle status')}
          className="grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {latestLoading && !latest ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} height={92} className="rounded-xl" />
            ))
          ) : (
            <>
              <MetricCard
                label={t('mapOverview.currentSpeed', 'Current Speed')}
                value={formatSpeed(latest?.speed ?? null, { precision: 1 })}
                icon={<Gauge className="h-4 w-4" aria-hidden="true" />}
                color="cyan"
              />
              <MetricCard
                label={t('mapOverview.heading', 'Heading')}
                value={latest?.heading != null ? `${fmtNumber(latest.heading, 0)}°` : '—'}
                icon={<Compass className="h-4 w-4" aria-hidden="true" />}
                color="purple"
              />
              <MetricCard
                label={t('mapOverview.latLon', 'Lat / Lon')}
                value={hasValidLocation && latest ? `${fmtNumber(latest.latitude, 4)}, ${fmtNumber(latest.longitude, 4)}` : '—'}
                icon={<MapPin className="h-4 w-4" aria-hidden="true" />}
                color="green"
              />
              <MetricCard
                label={t('mapOverview.lastUpdated', 'Last Updated')}
                value={latest?.created_at ? formatDateTime(latest.created_at) : '—'}
                icon={<Clock className="h-4 w-4" aria-hidden="true" />}
                subtitle={t('mapOverview.autoRefresh', 'Auto-refreshes every 15 s')}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* 2 — Hero: live map spanning most of the width + side context column. */}
      <FadeIn delay={0.05}>
        <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
          {/* Live map — the hero visual. */}
          <GlassPanel
            role="region"
            aria-label={t('mapOverview.mapRegion', 'Live location map')}
            className="relative h-[380px] overflow-hidden sm:h-[460px] xl:col-span-2 xl:h-[600px]"
          >
            {latestLoading && !latest ? (
              <Skeleton height="100%" className="h-full w-full rounded-none" />
            ) : latestError ? (
              <div className="flex h-full items-center justify-center p-6">
                <QueryError error={latestError} onRetry={() => latestQuery.refetch()} />
              </div>
            ) : hasValidLocation && latest ? (
              <>
                <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
                <MapContainer
                  center={[latest.latitude, latest.longitude]}
                  zoom={15}
                  scrollWheelZoom
                  className="h-full w-full"
                >
                  <MapTileLayer style={mapStyle} />
                  <MapInvalidator />
                  <Marker position={[latest.latitude, latest.longitude]} icon={vehicleIcon()}>
                    <Popup>{vehicle?.display_name ?? t('mapOverview.vehicle', 'Vehicle')}</Popup>
                  </Marker>
                  {trailPositions.length > 1 && (
                    <Polyline positions={trailPositions} color="#00f0ff" weight={3} opacity={0.7} />
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
          </GlassPanel>

          {/* Side context: location status + quick links (fills the map height on xl). */}
          <div className="flex flex-col gap-4">
            <GlassPanel className="p-4 sm:p-5">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('mapOverview.locationDetails', 'Location Details')}
              </PanelTitle>
              {locationLoading ? (
                <Skeleton lines={4} height={20} />
              ) : locationError ? (
                <QueryError error={locationError} onRetry={() => locationQuery.refetch()} />
              ) : (latest || locationDetails) ? (
                <div className="space-y-3">
                  {/* Home */}
                  <StatusRow
                    icon={<Home className={cn('h-5 w-5', atHome ? 'text-emerald-400' : 'text-[var(--text-muted)]')} />}
                    label={t('mapOverview.atHome', 'At Home')}
                  >
                    <Badge variant={atHome === true ? 'success' : 'neutral'} size="sm" dot>
                      {triLabel(atHome)}
                    </Badge>
                  </StatusRow>

                  {/* Work */}
                  <StatusRow
                    icon={<Briefcase className={cn('h-5 w-5', atWork ? 'text-emerald-400' : 'text-[var(--text-muted)]')} />}
                    label={t('mapOverview.atWork', 'At Work')}
                  >
                    <Badge variant={atWork === true ? 'success' : 'neutral'} size="sm" dot>
                      {triLabel(atWork)}
                    </Badge>
                  </StatusRow>

                  {/* HomeLink nearby */}
                  <StatusRow
                    icon={<Link2 className={cn('h-5 w-5', homelinkNearby ? 'text-cyan-400' : 'text-[var(--text-muted)]')} />}
                    label={t('mapOverview.homelinkNearby', 'HomeLink Nearby')}
                  >
                    <Badge variant={homelinkNearby ? 'info' : 'neutral'} size="sm" dot>
                      {homelinkNearby ? t('mapOverview.yes', 'Yes') : t('mapOverview.no', 'No')}
                    </Badge>
                  </StatusRow>

                  {/* Odometer */}
                  <StatusRow
                    icon={<Navigation className="h-5 w-5 text-purple-400" />}
                    label={t('mapOverview.odometer', 'Odometer')}
                  >
                    <Text size="sm" weight="semibold" color="primary" className="tabular-nums">
                      {formatDistance(latest?.odometer ?? null)}
                    </Text>
                  </StatusRow>
                </div>
              ) : (
                <EmptyState /* no-action: transient empty state — no location data yet */
                  message={t('mapOverview.noLocation', 'No location data available yet')}
                />
              )}
            </GlassPanel>

            <GlassPanel className="p-4 sm:p-5 xl:flex-1">
              <PanelTitle className="mb-3 flex items-center gap-2">
                <ExternalLink className="h-4 w-4 text-cyan-300" aria-hidden="true" />
                {t('mapOverview.quickLinks', 'Quick Links')}
              </PanelTitle>
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  icon={<Route className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => { window.location.hash = '#/maps/navigation-route'; }}
                  className="min-h-11 w-full justify-start"
                >
                  {t('mapOverview.navRoute', 'Navigation Route')}
                </Button>
                <Button
                  variant="outline"
                  icon={<Fence className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => { window.location.hash = '#/maps/geofences'; }}
                  className="min-h-11 w-full justify-start"
                >
                  {t('mapOverview.geofences', 'Geofences')}
                </Button>
                <Button
                  variant="outline"
                  icon={<LocateFixed className="h-4 w-4" aria-hidden="true" />}
                  onClick={() => { window.location.hash = '#/maps/locations'; }}
                  className="min-h-11 w-full justify-start"
                >
                  {t('mapOverview.locations', 'Locations')}
                </Button>
              </div>
            </GlassPanel>
          </div>
        </section>
      </FadeIn>

      {/* 3 — Recent route playback: full-width band with an animated replay. */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Navigation className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('mapOverview.recentPlayback', 'Recent Route Playback')}
          </PanelTitle>
          {historyLoading ? (
            <Skeleton height={360} />
          ) : historyError ? (
            <QueryError error={historyError} onRetry={() => historyQuery.refetch()} />
          ) : playbackPoints.length > 1 ? (
            <RoutePlayback
              points={playbackPoints}
              height={360}
              ariaLabel={t('mapOverview.playbackLabel', 'Recent route playback map')}
            />
          ) : (
            <EmptyState /* no-action: transient empty state — not enough GPS points to replay */
              icon={<Navigation className="h-8 w-8" aria-hidden="true" />}
              message={t('mapOverview.noPlayback', 'Not enough GPS points to replay a route yet.')}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* 4 — Detail band: full-width recent location history table. */}
      <FadeIn delay={0.15}>
        <GlassPanel className="p-4 sm:p-5">
          <PanelTitle className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-cyan-300" aria-hidden="true" />
            {t('mapOverview.recentHistory', 'Recent Location History')}
          </PanelTitle>
          {historyLoading ? (
            <Skeleton lines={6} height={16} className="mt-2" />
          ) : historyError ? (
            <QueryError error={historyError} onRetry={() => historyQuery.refetch()} />
          ) : historyRows.length > 0 ? (
            <DataTable<PositionRecord>
              tableId="maps:overview-history"
              columns={historyColumns}
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
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
