import type { ReactElement } from 'react';

/**
 * Vehicle marker visual — a pulsing, glowing dot returned as a React element
 * and passed as the `icon` prop of the maps `<Marker>` (a react-map-gl /
 * MapLibre GL DOM overlay). No Leaflet: the previous `L.divIcon` HTML-string
 * factory is replaced by real JSX so the marker composes with the WebGL vector
 * map like every other overlay in this module. The default cyan matches the
 * app's neon accent; pass a color to theme the dot.
 *
 * The element is purely decorative (`aria-hidden`): when a marker is
 * interactive the maps `<Marker>` wraps this visual in a focusable ≥44px
 * button that carries the accessible label, so the icon needs no role or focus
 * handling of its own. `pointer-events-none` stops the dot from capturing touch
 * input, so a pinch / pan / two-finger rotate that lands on it falls through to
 * the MapLibre GL canvas and native map gestures keep working on touch devices.
 * Under `prefers-reduced-motion` the pulse resolves to a static halo instead of
 * animating.
 */
export function vehicleIcon(color = '#00f0ff'): ReactElement {
  return (
    <div className="pointer-events-none relative h-7 w-7" aria-hidden>
      <span
        className="absolute inset-0 rounded-full animate-ping motion-reduce:animate-none"
        style={{ backgroundColor: color, opacity: 0.25 }}
      />
      <span
        className="absolute inset-[5px] rounded-full border-2 border-white"
        style={{ backgroundColor: color, boxShadow: `0 0 10px ${color}` }}
      />
    </div>
  );
}
