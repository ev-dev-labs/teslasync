import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface RouteEndpoint {
  /** Resolved street address or place name (preferred). */
  address?: string | null;
  /** Latitude in decimal degrees, used as fallback. */
  lat?: number | null;
  /** Longitude in decimal degrees, used as fallback. */
  lon?: number | null;
}

export interface RouteDisplayProps {
  start: RouteEndpoint;
  end?: RouteEndpoint;
  /**
   * Threshold (in metres) below which start≈end is considered a round trip
   * when only coordinates are available. Default 100 m.
   */
  roundTripThresholdM?: number;
  /**
   * Show the leading map-pin icon. Default `true`.
   */
  showIcon?: boolean;
  className?: string;
  /** Test hook. */
  testId?: string;
}

/** Haversine distance between two lat/lon pairs, in metres. */
function haversineMeters(
  aLat: number, aLon: number, bLat: number, bLon: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}

/**
 * Pretty-print a single endpoint. Prefers a resolved address; falls back
 * to a `📍 lat, lon` coord string; returns `null` when neither is
 * available so the caller can render a single placeholder.
 */
export function endpointLabel(endpoint: RouteEndpoint): string | null {
  const addr = endpoint.address?.trim();
  if (addr) return addr;
  if (endpoint.lat != null && endpoint.lon != null) {
    return `📍 ${endpoint.lat.toFixed(2)}, ${endpoint.lon.toFixed(2)}`;
  }
  return null;
}

/**
 * `RouteDisplay` — generic "From → To" / "↻ round trip" / "📍 single
 * location" / "No location data" line. Used by every history-style
 * row (Drives, Charging, Trips).
 *
 * Round-trip detection rules (in order):
 *   1. Both endpoints resolve to the same address text → round trip
 *   2. Coordinates within `roundTripThresholdM` metres → round trip
 *
 * For charging sessions where there's only a single location (the
 * charger), pass only `start`; the component renders just that line.
 */
export function RouteDisplay({
  start,
  end,
  roundTripThresholdM = 100,
  showIcon = true,
  className,
  testId,
}: RouteDisplayProps) {
  const { t } = useTranslation();
  const startLabel = endpointLabel(start);
  const endLabel = end ? endpointLabel(end) : null;
  const noLocation = t('route.noLocationData', 'No location data');

  const hasCoords = (e: RouteEndpoint | undefined): e is { lat: number; lon: number } =>
    !!e && e.lat != null && e.lon != null;

  // Treat as round trip if (a) caller passes only `start` AND it has
  // some representation, OR (b) start/end addresses match, OR
  // (c) coordinates are within the threshold and we have at least one
  // endpoint label to show.
  const addressesMatch = !!startLabel && !!endLabel && startLabel === endLabel;
  const coordsClose =
    hasCoords(start) && hasCoords(end) &&
    haversineMeters(start.lat, start.lon, end.lat, end.lon) < roundTripThresholdM;
  const isExplicitSingle = !end;
  const isRoundTrip =
    !!startLabel && (isExplicitSingle || addressesMatch || (coordsClose && !!startLabel));

  let body: React.ReactNode;
  if (!startLabel && !endLabel) {
    body = <span className="truncate opacity-60">{noLocation}</span>;
  } else if (isRoundTrip) {
    body = (
      <span className="truncate">
        {startLabel}
        {!isExplicitSingle && (
          <span className="opacity-60"> ↻ {t('route.roundTrip', 'round trip')}</span>
        )}
      </span>
    );
  } else {
    body = (
      <span className="truncate">
        {startLabel ?? noLocation} → {endLabel ?? noLocation}
      </span>
    );
  }

  return (
    <div
      data-testid={testId}
      className={cn(
        'text-[11px] text-[var(--text-secondary)] flex items-center gap-1 truncate',
        className,
      )}
    >
      {showIcon && <MapPin className="h-2.5 w-2.5 shrink-0 opacity-60" aria-hidden />}
      {body}
    </div>
  );
}
