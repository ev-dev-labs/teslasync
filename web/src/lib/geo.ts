/**
 * Haversine formula — calculates the great-circle distance between two
 * latitude/longitude points on Earth.
 *
 * @returns Distance in **meters**.
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Minimum separation (meters) between two GPS samples for the route to be
 *  considered "meaningfully spatial". Below this, points are treated as a
 *  single cluster — typical parked-car GPS jitter is well under 5 m, and
 *  even a slow crawl moves the car ≥ 10 m within one sampling interval. */
export const MIN_MEANINGFUL_ROUTE_METERS = 10;

/** Coordinate carrier shape — accepts any object with `latitude`/`longitude`
 *  number fields so the helper works with `DrivePosition`, position bags
 *  from telemetry, or ad-hoc `{latitude, longitude}` literals. */
export interface LatLngLike {
  latitude: number;
  longitude: number;
}

/** True iff `(lat, lng)` is finite, non-zero, and within valid global bounds.
 *  `(0, 0)` is rejected — it's the canonical Tesla "GPS not yet fixed"
 *  placeholder and would otherwise drag the map to the Gulf of Guinea. */
export function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

/** True iff `positions` contains at least two valid coordinates separated by
 *  ≥ {@link MIN_MEANINGFUL_ROUTE_METERS}. Used by trip-replay / drive-detail
 *  maps to decide whether they have a real route to plot or only a single
 *  cluster (e.g. Fleet Telemetry recorded a stationary GPS during the drive,
 *  so 64 odometer/speed samples but one frozen lat/lng).
 *
 *  Short-circuits on the first sample beyond the threshold — O(n) worst case
 *  for fully-stationary input, but typically O(few) for any real drive. */
export function hasMeaningfulRoute(positions: readonly LatLngLike[]): boolean {
  let anchorIdx = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (isValidLatLng(p.latitude, p.longitude)) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return false;
  const anchor = positions[anchorIdx];
  for (let i = anchorIdx + 1; i < positions.length; i++) {
    const p = positions[i];
    if (!isValidLatLng(p.latitude, p.longitude)) continue;
    const d = haversineDistance(
      anchor.latitude,
      anchor.longitude,
      p.latitude,
      p.longitude,
    );
    if (d >= MIN_MEANINGFUL_ROUTE_METERS) return true;
  }
  return false;
}

/** Returns the index of the first valid coordinate in `positions`, or -1 if
 *  none exists. Pairs with {@link hasMeaningfulRoute} so callers can render a
 *  single representative marker at the cluster centre when no real route is
 *  available. */
export function firstValidIndex(positions: readonly LatLngLike[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) return i;
  }
  return -1;
}
