export interface PlaceGeoSiteSession {
  start_place?: string | null;
  start_lat?: number | null;
  start_lng?: number | null;
}

export function normalizePlaceGeoSite(
  session: PlaceGeoSiteSession,
): { key: string; label: string } | null {
  const place = session.start_place?.trim();
  if (place != null && place.length > 0) {
    return { key: `place:${place.toLowerCase()}`, label: place };
  }

  const lat = typeof session.start_lat === 'number' && Number.isFinite(session.start_lat)
    ? session.start_lat
    : null;
  const lng = typeof session.start_lng === 'number' && Number.isFinite(session.start_lng)
    ? session.start_lng
    : null;
  if (lat == null || lng == null) return null;

  const roundedLat = Math.round(lat * 100) / 100;
  const roundedLng = Math.round(lng * 100) / 100;
  const latLabel = roundedLat.toFixed(2);
  const lngLabel = roundedLng.toFixed(2);

  return {
    key: `geo:${latLabel},${lngLabel}`,
    label: `${latLabel}, ${lngLabel}`,
  };
}
