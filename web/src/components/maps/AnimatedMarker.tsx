import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Marker, useMap } from 'react-map-gl/maplibre';

interface AnimatedMarkerProps {
  position: [number, number];
  heading?: number;
  color?: string;
}

/** Car marker icon: a pulsing CSS dot with an optional heading rotation. */
function CarIcon({ color, heading }: { color: string; heading?: number }) {
  return (
    <div className="relative h-6 w-6" aria-hidden>
      <span
        className="absolute inset-0 rounded-full animate-ping"
        style={{ backgroundColor: color, opacity: 0.3 }}
      />
      <span
        className="absolute inset-[4px] rounded-full border-2 border-white"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 8px ${color}`,
          transform: heading != null ? `rotate(${heading}deg)` : undefined,
        }}
      />
    </div>
  );
}

/** Fraction of the remaining distance closed each animation frame. */
const EASE = 0.3;
/** Below this coordinate delta the marker snaps to the target and the loop idles. */
const EPSILON = 1e-7;

/**
 * Decorative markers must not swallow touch input. With `pointer-events: none`
 * a pinch / drag / two-finger rotate that lands on the car icon still reaches
 * the MapLibre GL canvas beneath it, so native map gestures keep working on
 * touch devices. Hoisted to a stable reference so react-map-gl only re-applies
 * the style once instead of on every animation frame.
 */
const NON_INTERACTIVE: CSSProperties = { pointerEvents: 'none' };

/**
 * Map marker that smoothly tracks a moving position on MapLibre GL.
 *
 * Rendered as a native react-map-gl `<Marker>` (WebGL vector map, no Leaflet).
 * Each animation frame eases the *currently displayed* coordinate toward the
 * latest `position` (never a stale origin), so rapid updates or timeline
 * scrubbing converge smoothly to the newest point with a small bounded lag and
 * no rubber-band snap-back. The marker is kept in view (without changing zoom)
 * by panning when it leaves the current viewport — MapLibre honours
 * `prefers-reduced-motion` for that camera move automatically.
 */
export function AnimatedMarker({ position, heading, color = '#00b4d8' }: AnimatedMarkerProps) {
  const [pos, setPos] = useState<[number, number]>(position);
  const targetRef = useRef<[number, number]>(position);
  const posRef = useRef<[number, number]>(position);
  const rafRef = useRef<number | null>(null);
  const { current: map } = useMap();

  useEffect(() => {
    targetRef.current = position;

    if (rafRef.current == null) {
      const step = () => {
        const [clat, clng] = posRef.current;
        const [tlat, tlng] = targetRef.current;
        const nlat = clat + (tlat - clat) * EASE;
        const nlng = clng + (tlng - clng) * EASE;
        const done = Math.abs(tlat - nlat) < EPSILON && Math.abs(tlng - nlng) < EPSILON;
        const next: [number, number] = done ? [tlat, tlng] : [nlat, nlng];
        posRef.current = next;
        setPos(next);
        rafRef.current = done ? null : requestAnimationFrame(step);
      };
      rafRef.current = requestAnimationFrame(step);
    }

    if (map) {
      const [lat, lng] = position;
      const lngLat: [number, number] = [lng, lat];
      if (!map.getBounds().contains(lngLat)) {
        map.panTo(lngLat, { duration: 300 });
      }
    }
  }, [position, map]);

  useEffect(
    () => () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const [lat, lng] = pos;
  return (
    <Marker longitude={lng} latitude={lat} anchor="center" style={NON_INTERACTIVE}>
      <CarIcon color={color} heading={heading} />
    </Marker>
  );
}
