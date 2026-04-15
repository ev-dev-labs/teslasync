import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  MapPin, Compass, Gauge, Clock, Home, Briefcase,
  Link2, Navigation, Route, Fence, LocateFixed, AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, type SelectOption, DataTable, type Column } from '@/components/ui';
import { MetricCard } from '@/components/data-display';
import { Skeleton, EmptyState, AlertBanner } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import {
  MapContainer, Marker, Popup, Polyline,
  MapTileLayer, MapInvalidator, MapLayerSwitcher,
  type MapStyle,
} from '@/components/maps';

import { useVehicles } from '@/api/hooks/useVehicles';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateTime } from '@/lib/dateFormat';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { getErrorMessage } from '@/lib/errorMessage';
import { request } from '@/api/client';
import 'leaflet/dist/leaflet.css';

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
  located_at_home: boolean;
  located_at_work: boolean;
  locatedAtHome?: boolean;
  locatedAtWork?: boolean;
  homelink_nearby: boolean;
  active_route: boolean;
  destination_name: string;
  created_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function headingToCardinal(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8] ?? '—';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function MapOverviewPage() {
  const { t } = useTranslation('maps');
  usePageTitle(t('mapOverview.pageTitle', 'Map Overview'));

  /* ---- vehicle selector state ---- */
  const [vehicleId, setVehicleId] = useState('');
  const [mapStyle, setMapStyle] = useState<MapStyle>('dark');

  /* ---- queries ---- */
  const {
    data: vehicles,
    isLoading: vehiclesLoading,
    error: vehiclesError,
  } = useVehicles();

  const selectedId = vehicleId || String(vehicles?.[0]?.id ?? '');

  const vehicleOptions: SelectOption[] = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const {
    data: latest,
    isLoading: latestLoading,
    error: latestError,
  } = useQuery<LocationSnapshot>({
    queryKey: ['location-latest', selectedId],
    queryFn: () =>
      request<LocationSnapshot>(
        `/location-snapshots/latest?vehicle_id=${selectedId}`,
      ),
    enabled: selectedId !== '',
    refetchInterval: 15_000,
  });

  const {
    data: history,
    isLoading: historyLoading,
    error: historyError,
  } = useQuery<LocationSnapshot[]>({
    queryKey: ['location-history', selectedId],
    queryFn: () =>
      request<LocationSnapshot[]>(
        `/location-snapshots?vehicle_id=${selectedId}&limit=50`,
      ),
    enabled: selectedId !== '',
  });

  /* ---- derived ---- */
  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = vehiclesLoading || latestLoading;
  const hasVehicles = (vehicles?.length ?? 0) > 0;
  const hasValidLocation = latest != null
    && typeof latest.latitude === 'number'
    && typeof latest.longitude === 'number'
    && (latest.latitude !== 0 || latest.longitude !== 0);

  const trailPositions = useMemo(
    () => (history ?? [])
      .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && (s.latitude !== 0 || s.longitude !== 0))
      .map((s) => [s.latitude, s.longitude] as [number, number]),
    [history],
  );

  const vehicle = vehicles?.find((v) => String(v.id) === selectedId);

  /* ---- history table columns ---- */
  const historyColumns: Column<LocationSnapshot>[] = useMemo(
    () => [
      {
        key: 'time',
        header: t('mapOverview.colTime', 'Time'),
        render: (r) => (
          <span className="text-xs whitespace-nowrap">
            {formatDateTime(r.created_at)}
          </span>
        ),
      },
      {
        key: 'latitude',
        header: t('mapOverview.colLat', 'Lat'),
        render: (r) => (
          <span className="font-mono text-xs">
            {typeof r.latitude === 'number' && typeof r.longitude === 'number' && (r.latitude !== 0 || r.longitude !== 0) ? fmtNumber(r.latitude, 5) : '—'}
          </span>
        ),
      },
      {
        key: 'longitude',
        header: t('mapOverview.colLon', 'Lon'),
        render: (r) => (
          <span className="font-mono text-xs">
            {typeof r.latitude === 'number' && typeof r.longitude === 'number' && (r.latitude !== 0 || r.longitude !== 0) ? fmtNumber(r.longitude, 5) : '—'}
          </span>
        ),
      },
      {
        key: 'speed',
        header: t('mapOverview.colSpeed', 'Speed'),
        render: (r) => (
          <span className="text-xs">
            {fmtNumber(r.speed, 1)} {t('mapOverview.speedUnit', 'mph')}
          </span>
        ),
      },
      {
        key: 'heading',
        header: t('mapOverview.colHeading', 'Heading'),
        render: (r) => (
          <span className="text-xs">
            {fmtNumber(r.heading, 0)}° {headingToCardinal(r.heading)}
          </span>
        ),
      },
    ],
    [t],
  );

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
      actions={
        hasVehicles ? (
          <Select
            label={t('mapOverview.vehicleLabel', 'Vehicle')}
            options={vehicleOptions}
            value={selectedId}
            onChange={(e) => setVehicleId(e.target.value)}
            placeholder={t('mapOverview.vehiclePlaceholder', 'Select vehicle')}
          />
        ) : undefined
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ---- GPS data warning ---- */}
      {!hasValidLocation && latest && (
        <AlertBanner variant="info">
          {t('mapOverview.noGps', 'GPS coordinates not available. Location data requires Fleet Telemetry HTTP streaming.')}
        </AlertBanner>
      )}

      {/* ---- Map ---- */}
      <FadeIn>
        <GlassPanel className="relative overflow-hidden h-[400px]">
          {hasValidLocation ? (
            <>
              <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
              <MapContainer
                center={[latest!.latitude, latest!.longitude]}
                zoom={15}
                scrollWheelZoom
                className="h-full w-full"
              >
                <MapTileLayer style={mapStyle} />
                <MapInvalidator />
                <Marker position={[latest!.latitude, latest!.longitude]}>
                  <Popup>{vehicle?.display_name ?? t('mapOverview.vehicle', 'Vehicle')}</Popup>
                </Marker>
                {trailPositions.length > 1 && (
                  <Polyline positions={trailPositions} color="#00f0ff" weight={3} opacity={0.7} />
                )}
              </MapContainer>
            </>
          ) : (
            <EmptyState
              icon={<MapPin className="h-8 w-8" />}
              message={t(
                'mapOverview.noLocation',
                'No GPS data available. Location data requires Fleet Telemetry streaming.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Vehicle status metric cards ---- */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={88} className="rounded-xl" />
          ))}
        </div>
      ) : latest ? (
        <FadeIn delay={0.05}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MetricCard
              label={t('mapOverview.currentSpeed', 'Current Speed')}
              value={`${fmtNumber(latest.speed, 1)} ${t('mapOverview.speedUnit', 'mph')}`}
              icon={<Gauge className="h-4 w-4" />}
              color="cyan"
            />
            <MetricCard
              label={t('mapOverview.heading', 'Heading')}
              value={`${fmtNumber(latest.heading, 0)}° ${headingToCardinal(latest.heading)}`}
              icon={<Compass className="h-4 w-4" />}
              color="purple"
            />
            <MetricCard
              label={t('mapOverview.latLon', 'Lat / Lon')}
              value={hasValidLocation ? `${fmtNumber(latest!.latitude, 4)}, ${fmtNumber(latest!.longitude, 4)}` : '—'}
              icon={<MapPin className="h-4 w-4" />}
              color="green"
            />
            <MetricCard
              label={t('mapOverview.lastUpdated', 'Last Updated')}
              value={formatDateTime(latest.created_at)}
              icon={<Clock className="h-4 w-4" />}
              subtitle={t('mapOverview.autoRefresh', 'Auto-refreshes every 15 s')}
            />
          </div>
        </FadeIn>
      ) : null}

      {/* ---- Location details ---- */}
      <FadeIn delay={0.1}>
        <GlassPanel className="p-5">
          <span className="mb-4 block text-sm font-semibold text-[var(--text-primary)]">
            {t('mapOverview.locationDetails', 'Location Details')}
          </span>
          {latest ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Home */}
              <div className="flex items-center gap-3">
                <Home
                  className={cn(
                    'h-5 w-5',
                    (latest?.located_at_home ?? latest?.locatedAtHome) ? 'text-emerald-400' : 'text-gray-500',
                  )}
                />
                <span className="flex-1 text-sm text-[var(--text-secondary)]">
                  {t('mapOverview.atHome', 'At Home')}
                </span>
                <Badge
                  variant={(latest?.located_at_home ?? latest?.locatedAtHome) === true ? 'success' : 'neutral'}
                  size="sm"
                  dot
                >
                  {(latest?.located_at_home ?? latest?.locatedAtHome) === true
                    ? t('mapOverview.yes', 'Yes')
                    : (latest?.located_at_home ?? latest?.locatedAtHome) === false
                      ? t('mapOverview.no', 'No')
                      : t('mapOverview.unknown', 'Unknown')}
                </Badge>
              </div>

              {/* Work */}
              <div className="flex items-center gap-3">
                <Briefcase
                  className={cn(
                    'h-5 w-5',
                    (latest?.located_at_work ?? latest?.locatedAtWork) ? 'text-emerald-400' : 'text-gray-500',
                  )}
                />
                <span className="flex-1 text-sm text-[var(--text-secondary)]">
                  {t('mapOverview.atWork', 'At Work')}
                </span>
                <Badge
                  variant={(latest?.located_at_work ?? latest?.locatedAtWork) === true ? 'success' : 'neutral'}
                  size="sm"
                  dot
                >
                  {(latest?.located_at_work ?? latest?.locatedAtWork) === true
                    ? t('mapOverview.yes', 'Yes')
                    : (latest?.located_at_work ?? latest?.locatedAtWork) === false
                      ? t('mapOverview.no', 'No')
                      : t('mapOverview.unknown', 'Unknown')}
                </Badge>
              </div>

              {/* HomeLink nearby */}
              <div className="flex items-center gap-3">
                <Link2
                  className={cn(
                    'h-5 w-5',
                    latest.homelink_nearby ? 'text-cyan-400' : 'text-gray-500',
                  )}
                />
                <span className="flex-1 text-sm text-[var(--text-secondary)]">
                  {t('mapOverview.homelinkNearby', 'HomeLink Nearby')}
                </span>
                <Badge
                  variant={latest.homelink_nearby ? 'info' : 'neutral'}
                  size="sm"
                  dot
                >
                  {latest.homelink_nearby
                    ? t('mapOverview.yes', 'Yes')
                    : t('mapOverview.no', 'No')}
                </Badge>
              </div>

              {/* Odometer */}
              <div className="flex items-center gap-3">
                <Navigation className="h-5 w-5 text-purple-400" />
                <span className="flex-1 text-sm text-[var(--text-secondary)]">
                  {t('mapOverview.odometer', 'Odometer')}
                </span>
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  {fmtNumber(latest.odometer, 1)}{' '}
                  {t('mapOverview.distanceUnit', 'mi')}
                </span>
              </div>
            </div>
          ) : (
            <EmptyState message={t('mapOverview.noLocation', 'No location data available yet')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Quick links ---- */}
      <FadeIn delay={0.15}>
        <GlassPanel className="flex flex-wrap gap-3 p-4">
          <span className="w-full text-xs font-medium text-[var(--text-muted)]">
            {t('mapOverview.quickLinks', 'Quick Links')}
          </span>
          <Button
            variant="outline"
            size="sm"
            icon={<Route className="h-4 w-4" />}
            onClick={() => {
              window.location.hash = '#/maps/navigation-route';
            }}
          >
            {t('mapOverview.navRoute', 'Navigation Route')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<Fence className="h-4 w-4" />}
            onClick={() => {
              window.location.hash = '#/maps/geofences';
            }}
          >
            {t('mapOverview.geofences', 'Geofences')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            icon={<LocateFixed className="h-4 w-4" />}
            onClick={() => {
              window.location.hash = '#/maps/locations';
            }}
          >
            {t('mapOverview.locations', 'Locations')}
          </Button>
        </GlassPanel>
      </FadeIn>

      {/* ---- Recent location history table ---- */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-5">
          <span className="mb-4 block text-sm font-semibold text-[var(--text-primary)]">
            {t('mapOverview.recentHistory', 'Recent Location History')}
          </span>

          {historyLoading ? (
            <Skeleton lines={6} height={16} className="mt-2" />
          ) : history && history.length > 0 ? (
            <DataTable<LocationSnapshot>
              columns={historyColumns}
              data={history}
              keyExtractor={(r) => r.id}
              emptyMessage={t(
                'mapOverview.noHistory',
                'No location history found.',
              )}
              compact
              pagination
            />
          ) : (
            <EmptyState
              icon={<Clock className="h-8 w-8" />}
              message={t(
                'mapOverview.noHistory',
                'No location history found.',
              )}
            />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
