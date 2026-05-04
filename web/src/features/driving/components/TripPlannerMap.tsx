import { useMemo } from 'react';
import { GlassPanel } from '@/components/ui';
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

export function TripPlannerMap({ origin, destination, legs, chargeStops }: TripPlannerMapProps) {
  const { t } = useTranslation();

  // Build polyline from legs
  const polylinePoints = useMemo(() => {
    if ((legs ?? []).length === 0 && origin && destination) {
      return [[origin.lat, origin.lng], [destination.lat, destination.lng]] as LatLngExpression[];
    }
    const points: LatLngExpression[] = [];
    for (const leg of legs ?? []) {
      if (points.length === 0) {
        points.push([leg.from.lat, leg.from.lng]);
      }
      points.push([leg.to.lat, leg.to.lng]);
    }
    return points;
  }, [legs, origin, destination]);

  // Map center and bounds
  const center = useMemo<LatLngExpression>(() => {
    if (origin && destination) {
      return [(origin.lat + destination.lat) / 2, (origin.lng + destination.lng) / 2];
    }
    if (origin) return [origin.lat, origin.lng];
    return [39.8283, -98.5795]; // center of US
  }, [origin, destination]);

  const zoom = useMemo(() => {
    if (!origin || !destination) return 5;
    const latDiff = Math.abs(origin.lat - destination.lat);
    const lngDiff = Math.abs(origin.lng - destination.lng);
    const maxDiff = Math.max(latDiff, lngDiff);
    if (maxDiff > 20) return 4;
    if (maxDiff > 10) return 5;
    if (maxDiff > 5) return 6;
    if (maxDiff > 2) return 7;
    return 9;
  }, [origin, destination]);

  const hasData = origin != null || destination != null;

  return (
    <GlassPanel className="p-0 overflow-hidden rounded-xl">
      {hasData ? (
        <div className="h-[400px] w-full">
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
                pathOptions={{ color: '#3b82f6', weight: 3, opacity: 0.8 }}
              />
            )}

            {/* Origin marker */}
            {origin && (
              <CircleMarker
                center={[origin.lat, origin.lng]}
                radius={8}
                pathOptions={{ color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9 }}
              >
                <Popup>
                  <span className="text-sm font-medium">{origin.name || t('tripPlanner.map.origin', 'Origin')}</span>
                </Popup>
              </CircleMarker>
            )}

            {/* Destination marker */}
            {destination && (
              <CircleMarker
                center={[destination.lat, destination.lng]}
                radius={8}
                pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9 }}
              >
                <Popup>
                  <span className="text-sm font-medium">{destination.name || t('tripPlanner.map.destination', 'Destination')}</span>
                </Popup>
              </CircleMarker>
            )}

            {/* Charge stop markers */}
            {(chargeStops ?? []).map((stop, idx) => (
              <CircleMarker
                key={`stop-${idx}`}
                center={[stop.location.lat, stop.location.lng]}
                radius={7}
                pathOptions={{ color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.9 }}
              >
                <Popup>
                  <div className="text-sm">
                    <p className="font-medium">{stop.name}</p>
                    <p className="text-[var(--text-muted)]">
                      {Math.round(stop.charge_from_soc)}% → {Math.round(stop.charge_to_soc)}%
                      ({Math.round(stop.charge_duration_min)} min)
                    </p>
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
