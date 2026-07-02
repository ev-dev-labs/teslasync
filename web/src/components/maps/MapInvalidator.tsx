import { useEffect } from 'react';
import { useMap as useMapGL } from 'react-map-gl/maplibre';

/**
 * Side-effect-only helper that nudges MapLibre GL to re-measure its container
 * once, as soon as the underlying map instance becomes available.
 *
 * MapLibre already installs a `ResizeObserver` on its container (`trackResize`
 * defaults to `true`), so ongoing container, viewport and orientation changes —
 * including mobile rotate and on-screen-keyboard resizes — are tracked
 * automatically. This single explicit resize only covers the first-frame case
 * where a panel expands or animates into its final size before MapLibre's
 * observer has measured it, which would otherwise leave the WebGL canvas sized
 * to a stale (often zero-height) container until the next interaction.
 *
 * Renders nothing and takes no props, preserving the Leaflet-era external API so
 * the existing `<MapInvalidator />` call-sites across the feature domains
 * compose it unchanged. Must be rendered as a child of `<MapContainer>`, whose
 * react-map-gl context it reads.
 *
 * The raw react-map-gl `useMap()` hook is used deliberately here (rather than
 * the identity-stable `useMap()` facade re-exported from `./MapTileLayer`): the
 * effect must re-run the moment the map instance is created, and the facade
 * never changes identity, so it cannot signal readiness.
 */
export function MapInvalidator() {
  const { current: map } = useMapGL();

  useEffect(() => {
    if (!map) return;
    const timer = setTimeout(() => map.resize(), 100);
    return () => clearTimeout(timer);
  }, [map]);

  return null;
}
