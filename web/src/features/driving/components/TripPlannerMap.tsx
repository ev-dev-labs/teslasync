import { useMemo } from 'react';
import { GlassPanel, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import {
  MapContainer, Polyline, Popup, CircleMarker,
  MapTileLayer,
  type LatLngExpression,
} from '@/components/maps';
import { useTranslation } from 'react-i18next';
import type { TripLocation, TripLeg, TripChargeStop } from '@/types/driving';

interface TripPlannerMapProps {
  origin: TripLocation | null;
  destination: TripLocation | null;
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}

// Geographic centre of the contiguous US — the neutral fallback view when no
// drawable geometry is available.
const DEFAULT_CENTER: LatLngExpression = [39.8283, -98.5795];
// Country-level zoom used whenever a bounding pair of points is not available.
const FALLBACK_ZOOM = 5;

// Static leaflet path styles hoisted to module scope so they are not
// re-allocated on every render (and never re-create marker layers in leaflet).
const ROUTE_PATH = { color: '#3b82f6', weight: 3, opacity: 0.8 };
const ORIGIN_PATH = { color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9 };
const DESTINATION_PATH = { color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 };
const CHARGE_STOP_PATH = { color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9 };

/**
 * A coordinate pair is usable by leaflet only when both components are finite
 * and within the WGS84 range. Guarding here keeps `NaN`/`Infinity`/out-of-range
 * values (which crash leaflet's projection math) out of the map center, the
 * polyline and every marker.
 */
export function isValidCoord(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === 'number' &&
    Number.isFinite(lat) &&
    Math.abs(lat) <= 90 &&
    typeof lng === 'number' &&
    Number.isFinite(lng) &&
    Math.abs(lng) <= 180
  );
}

export function TripPlannerMap({ origin, destination, legs, chargeStops }: TripPlannerMapProps) {
  const { t } = useTranslation();

  const validOrigin = useMemo(
    () => (origin && isValidCoord(origin.lat, origin.lng) ? origin : null),
    [origin],
  );
  const validDestination = useMemo(
    () => (destination && isValidCoord(destination.lat, destination.lng) ? destination : null),
    [destination],
  );

  // Only charge stops with a plottable location reach the map.
  const validChargeStops = useMemo(
    () => (chargeStops ?? []).filter((stop) => stop?.location && isValidCoord(stop.location.lat, stop.location.lng)),
    [chargeStops],
  );

  // Build the route polyline from valid legs, falling back to a direct
  // origin→destination line when no per-leg geometry is available.
  const polylinePoints = useMemo<LatLngExpression[]>(() => {
    const validLegs = (legs ?? []).filter(
      (leg) =>
        leg?.from &&
        leg?.to &&
        isValidCoord(leg.from.lat, leg.from.lng) &&
        isValidCoord(leg.to.lat, leg.to.lng),
    );

    if (validLegs.length === 0) {
      if (validOrigin && validDestination) {
        return [
          [validOrigin.lat, validOrigin.lng],
          [validDestination.lat, validDestination.lng],
        ];
      }
      return [];
    }

    const points: LatLngExpression[] = [];
    validLegs.forEach((leg, i) => {
      if (i === 0) points.push([leg.from.lat, leg.from.lng]);
      points.push([leg.to.lat, leg.to.lng]);
    });
    return points;
  }, [legs, validOrigin, validDestination]);

  // Map center and bounds
  const center = useMemo<LatLngExpression>(() => {
    if (validOrigin && validDestination) {
      return [
        (validOrigin.lat + validDestination.lat) / 2,
        (validOrigin.lng + validDestination.lng) / 2,
      ];
    }
    if (validOrigin) return [validOrigin.lat, validOrigin.lng];
    if (validDestination) return [validDestination.lat, validDestination.lng];
    if (polylinePoints.length > 0) return polylinePoints[0];
    return DEFAULT_CENTER;
  }, [validOrigin, validDestination, polylinePoints]);

  const zoom = useMemo(() => {
    if (!validOrigin || !validDestination) return FALLBACK_ZOOM;
    const latDiff = Math.abs(validOrigin.lat - validDestination.lat);
    const lngDiff = Math.abs(validOrigin.lng - validDestination.lng);
    const maxDiff = Math.max(latDiff, lngDiff);
    if (maxDiff > 20) return 4;
    if (maxDiff > 10) return 5;
    if (maxDiff > 5) return 6;
    if (maxDiff > 2) return 7;
    return 9;
  }, [validOrigin, validDestination]);

  const hasData = validOrigin != null || validDestination != null || polylinePoints.length >= 2;

  return (
    <GlassPanel className="p-0 overflow-hidden rounded-xl">
      {hasData ? (
        <div
          className="h-[400px] w-full"
          role="region"
          aria-label={t('tripPlanner.map.regionLabel', 'Trip route map')}
        >
          <MapContainer
            center={center}
            zoom={zoom}
            className="h-full w-full rounded-xl"
            scrollWheelZoom
          >
            <MapTileLayer style="dark" />

            {/* Route polyline */}
            {polylinePoints.length >= 2 && (
              <Polyline
                positions={polylinePoints}
                pathOptions={ROUTE_PATH}
              />
            )}

            {/* Origin marker */}
            {validOrigin && (
              <CircleMarker
                center={[validOrigin.lat, validOrigin.lng]}
                radius={8}
                pathOptions={ORIGIN_PATH}
              >
                <Popup>
                  <Text size="sm" weight="medium">{validOrigin.name || t('tripPlanner.map.origin', 'Origin')}</Text>
                </Popup>
              </CircleMarker>
            )}

            {/* Destination marker */}
            {validDestination && (
              <CircleMarker
                center={[validDestination.lat, validDestination.lng]}
                radius={8}
                pathOptions={DESTINATION_PATH}
              >
                <Popup>
                  <Text size="sm" weight="medium">{validDestination.name || t('tripPlanner.map.destination', 'Destination')}</Text>
                </Popup>
              </CircleMarker>
            )}

            {/* Charge stop markers */}
            {/* marker-cluster:no waypoints — trip-specific charge stops with low cardinality (typically <10), each annotates a unique semantic waypoint and clustering would obscure the route narrative. */}
            {validChargeStops.map((stop, idx) => (
              <CircleMarker
                key={`stop-${idx}`}
                center={[stop.location.lat, stop.location.lng]}
                radius={7}
                pathOptions={CHARGE_STOP_PATH}
              >
                <Popup>
                  <div className="text-sm">
                    <Text as="p" weight="medium">{stop.name || t('tripPlanner.map.chargeStop', 'Charge stop')}</Text>
                    <Text as="p" color="muted">
                      {t('tripPlanner.map.chargeSummary', '{{from}}% → {{to}}% ({{min}} min)', {
                        from: Math.round(stop.charge_from_soc ?? 0),
                        to: Math.round(stop.charge_to_soc ?? 0),
                        min: Math.round((stop.charge_duration_s ?? 0) / 60),
                      })}
                    </Text>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </MapContainer>
        </div>
      ) : (
        <div className="h-[400px] flex items-center justify-center">
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tripPlanner.map.empty', 'Enter origin and destination to see the route')} />
        </div>
      )}
    </GlassPanel>
  );
}
