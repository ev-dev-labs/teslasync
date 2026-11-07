import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Crosshair } from 'lucide-react';
import { Badge, Caption, MetricValue } from '@/components/ui';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { Circle, Marker, vehicleIcon } from '@/components/maps';
import { useGeofences } from '@/api/hooks/useLocations';
import { useVehicleState, useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetMapView } from './shared';
import type { WidgetProps } from './types';
import { useDataState, useCombinedDataState } from '@/hooks/useDataState';
import { TELEMETRY_STALE_AFTER_MS } from '@/hooks/useTelemetryFreshness';
import { WidgetDetailCard, type DetailEntry } from './shared';
import { CHART_SEMANTIC, CHART_NEUTRAL } from '@/lib/colors';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import { usePackPresentation } from './designPacks/PackBoundary';

/** Haversine distance in meters between two lat/lon points */
export function haversineMeters(
  lat1: number, lon1: number,
  lat2: number, lon2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface FenceStatus {
  id: string;
  name: string;
  radius: number | null;
  latitude: number;
  longitude: number;
  enabled: boolean;
  inside: boolean;
  distanceM: number;
  validMap: boolean;
}

export default function GeofenceWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const enhanced = usePackPresentation() !== 'classic';

  const { data: vehicles } = useVehicles();
  const id = vehicleId ?? vehicles?.[0]?.id ?? 0;

  const stateQuery = useVehicleState(id);
  const {
    data: stateData,
    isLoading: stateLoading,
    isFetching: stateFetching,
    isStale: stateStale,
    isError: stateIsError,
    dataUpdatedAt: stateUpdatedAt,
    refetch: stateRefetch,
  } = stateQuery;

  const fenceQuery = useGeofences();
  const {
    data: geofences,
    isLoading: fenceLoading,
    isFetching: fenceFetching,
    isStale: fenceStale,
    isError: fenceIsError,
    dataUpdatedAt: fenceUpdatedAt,
    refetch: fenceRefetch,
  } = fenceQuery;
  const stateTrust = useDataState(stateQuery);
  const fenceTrust = useDataState({
    ...fenceQuery,
    data: fenceIsError && (!Array.isArray(geofences) || geofences.length === 0) ? undefined : geofences,
  });
  const dataState = useCombinedDataState([stateTrust, fenceTrust]);

  const isLoading = stateLoading || fenceLoading;
  const isFetching = stateFetching || fenceFetching;
  const isStale = stateStale || fenceStale;
  const isError = stateIsError || fenceIsError;
  const updatedAt = Math.max(stateUpdatedAt ?? 0, fenceUpdatedAt ?? 0);
  // Both sources feed every layout (the compact zone badge is derived from the
  // geofence list AND the vehicle position), so a manual refresh must refetch
  // both — refetching state alone left a failed geofence fetch un-retried.
  const onRefresh = useCallback(() => {
    stateRefetch();
    fenceRefetch();
  }, [stateRefetch, fenceRefetch]);

  const state = stateData?.state;
  const vLat = state?.latitude ?? 0;
  const vLon = state?.longitude ?? 0;
  const hasCoords = state?.latitude != null && state.longitude != null &&
    Number.isFinite(vLat) && Number.isFinite(vLon) &&
    Math.abs(vLat) <= 90 && Math.abs(vLon) <= 180 && (vLat !== 0 || vLon !== 0);

  const fences: FenceStatus[] = useMemo(() => {
    const raw = Array.isArray(geofences) ? geofences : [];
    return raw.filter((g) => g != null).map((g) => {
      const gLat = g.latitude ?? 0;
      const gLon = g.longitude ?? 0;
      const radius = g.radius != null && Number.isFinite(g.radius) && g.radius >= 0 ? g.radius : null;
      const validMap = g.latitude != null && g.longitude != null && Number.isFinite(gLat) &&
        Number.isFinite(gLon) && Math.abs(gLat) <= 90 && Math.abs(gLon) <= 180 && radius != null;
      const dist = hasCoords && validMap
        ? haversineMeters(vLat, vLon, gLat, gLon)
        : Infinity;
      return {
        id: g.id,
        name: g.name ?? '—',
        radius,
        latitude: gLat,
        longitude: gLon,
        enabled: g.enabled ?? true,
        inside: radius != null && dist <= radius,
        distanceM: dist,
        validMap,
      };
    });
  }, [geofences, vLat, vLon, hasCoords]);

  const currentZone = useMemo(
    () => fences.find((f) => f.inside && f.enabled),
    [fences],
  );
  const isCompact = size.cols <= 1;
  const isEmpty = fences.length === 0;
  const markerIcon = useMemo(() => vehicleIcon(), []);
  const observedAge = stateData?.observedAt != null && Number.isFinite(stateData.observedAt)
    ? Date.now() - stateData.observedAt : null;
  const membershipConfirmed = stateData?.live === true && stateData.freshness === 'fresh' &&
    observedAge != null && observedAge >= 0 && observedAge <= TELEMETRY_STALE_AFTER_MS &&
    stateData.verifiedFields?.includes('latitude') && stateData.verifiedFields.includes('longitude') &&
    stateTrust.status === 'ok' && fenceTrust.status === 'ok' && !isStale;
  const canResolveZone = hasCoords && Array.isArray(geofences) &&
    !stateTrust.fatalError && !fenceTrust.fatalError &&
    fences.every((fence) => !fence.enabled || fence.validMap);
  const outside = canResolveZone && fences.some((fence) => fence.enabled) && !currentZone;
  const reportedLabel = t('dashboardWidgets.maps.geofence.lastReported', 'Last reported membership');
  const stateFeedback = (
    <>
      <StaleRefreshWarning state={stateTrust} />
      {stateTrust.fatalError && <QueryError error={stateTrust.fatalError} onRetry={stateTrust.retry ?? undefined} />}
    </>
  );
  const fenceError = fenceTrust.fatalError
    ? <QueryError error={fenceTrust.fatalError} onRetry={() => { void fenceRefetch(); }} />
    : null;
  const membershipContext = (
    <>
      {stateFeedback}
      <StaleRefreshWarning state={fenceTrust} />
      {hasCoords && !membershipConfirmed && (
        <Caption as="p">{t('dashboardWidgets.maps.geofence.currentUnconfirmed', 'Current membership is unconfirmed')}</Caption>
      )}
    </>
  );

  const shellProps = {
    title: t('widget.geofence.title', 'Geofence status'),
    loading: isLoading,
    dataState: { ...dataState, retry: onRefresh, data: stateData ?? geofences, hasData: stateData != null || fences.length > 0 },
    updatedAt,
    isFetching,
    isStale,
    isError,
    onRefresh,
  };

  // ─── Compact layout (1×2) ───
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <InstrumentPresentation family="map" compact
          icon={<Crosshair aria-hidden="true" />}
          headline={
            <div className="flex min-w-0 flex-col gap-2">
              <Caption>{reportedLabel}</Caption>
              <Badge variant={currentZone && membershipConfirmed ? 'success' : 'neutral'} size="sm">
                {currentZone?.name ?? (canResolveZone ? t('widget.geofence.noZone', 'No zone') : '—')}
              </Badge>
            </div>
          }
          context={<>{membershipContext}{fenceError}</>}
        >
          <div className="flex h-full flex-col items-center justify-center gap-1 min-h-[44px]">
            <Crosshair aria-hidden="true" className="h-5 w-5 text-theme-accent" />
            {currentZone ? (
              <Badge variant="success" size="sm">
                {currentZone.name}
              </Badge>
            ) : (
              <Badge variant="neutral" size="sm">
                {hasCoords && Array.isArray(geofences) && !fenceTrust.fatalError ? t('widget.geofence.noZone', 'No zone') : '—'}
              </Badge>
            )}
          </div>
        </InstrumentPresentation>
      </WidgetShell>
    );
  }

  // ─── Standard layout (2×4) ───
  const showMap = hasCoords && size.rows >= 3;
  const fenceFeedback = fenceError ?? (fenceLoading && isEmpty ? (
    <Skeleton className="h-24" />
  ) : isEmpty ? (
    <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
      icon={<Crosshair aria-hidden="true" className="h-5 w-5" />}
      message={enhanced && !Array.isArray(geofences)
        ? t('dashboardWidgets.maps.geofence.unavailable', 'Geofence configuration unavailable')
        : t('widget.geofence.noFences', 'No geofences configured')}
      className="py-4"
    />
  ) : null);
  const mapSection = (
    <div className="flex flex-1 min-h-0 flex-col">
      <WidgetMapView
        center={[vLat, vLon]}
        zoom={12}
        compact={false}
        isEmpty={!hasCoords}
        emptyMessage={t('widget.mapView.noData', 'No location data available')}
      >
        {fences.filter((f) => f.validMap).map((f) => (
          <Circle
            key={f.id}
            center={[f.latitude, f.longitude]}
            radius={f.radius ?? 0}
            pathOptions={{
              color: f.inside && (!enhanced || (f.enabled && membershipConfirmed)) ? CHART_SEMANTIC.vehicle.online : CHART_NEUTRAL,
              fillColor: f.inside && (!enhanced || (f.enabled && membershipConfirmed)) ? CHART_SEMANTIC.vehicle.online : CHART_NEUTRAL,
              fillOpacity: 0.15,
              weight: 2,
            }}
          />
        ))}
        <Marker
          position={[vLat, vLon]}
          icon={markerIcon}
          title={t('maps.animatedMarker.label', 'Vehicle position', { ns: 'translation' })}
        />
      </WidgetMapView>
    </div>
  );
  const fenceList = (
    <div className={enhanced ? 'flex-1 min-h-0 overflow-y-auto py-2' : 'flex-1 min-h-0 overflow-y-auto px-4 py-2'}>
      <WidgetDetailCard
        entries={fences.map((fence): DetailEntry => {
          const status = !fence.enabled
            ? t('widget.geofence.disabled', 'Disabled')
            : fence.inside
              ? t('widget.geofence.inside', 'Inside')
              : hasCoords && fence.validMap
                ? t('widget.geofence.outside', 'Outside')
                : null;
          const success = fence.enabled && fence.inside && (!enhanced || membershipConfirmed);
          return {
            id: fence.id,
            label: fence.name,
            value: status ? '' : '—',
            status: success ? 'success' : 'neutral',
            badge: status ? { text: status, variant: success ? 'success' : 'neutral' } : undefined,
          };
        })}
        emptyMessage={t('widget.geofence.noFences', 'No geofences configured')}
        emptyIcon={<Crosshair aria-hidden="true" className="h-5 w-5" />}
      />
    </div>
  );

  return (
    <WidgetShell
      icon={<Crosshair aria-hidden="true" className="h-3.5 w-3.5 text-theme-accent" />}
      noPadding={showMap && !enhanced}
      {...shellProps}
    >
      <InstrumentPresentation family="map"
        icon={<Crosshair aria-hidden="true" />}
        headline={
          <div className="min-w-0 space-y-1">
            <Caption>{reportedLabel}</Caption>
            <MetricValue>{currentZone ? t('widget.geofence.inside', 'Inside') : outside ? t('widget.geofence.outside', 'Outside') : '—'}</MetricValue>
            <Caption>{currentZone?.name ?? (outside ? t('widget.geofence.noZone', 'No zone') : '—')}</Caption>
          </div>
        }
        context={membershipContext}
        instrument={size.rows >= 3 ? mapSection : undefined}
        details={fenceFeedback ?? fenceList}
      >
        {stateFeedback}
        {fenceFeedback ?? (
          <div className={showMap ? 'flex flex-1 min-h-0 flex-col' : 'flex h-full flex-col'}>
            {/* Map section */}
            {showMap && mapSection}
            {/* Fence list */}
            {fenceList}
          </div>
        )}
      </InstrumentPresentation>
    </WidgetShell>
  );
}
