import { useEffect, useRef } from 'react';
import { Marker, useMap } from 'react-leaflet';
import L from 'leaflet';

interface AnimatedMarkerProps {
  position: [number, number];
  heading?: number;
  color?: string;
}

/** Custom car icon rendered as a pulsing CSS circle with optional heading arrow. */
function createCarIcon(color: string, heading?: number): L.DivIcon {
  const rotation = heading != null ? `transform:rotate(${heading}deg)` : '';
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `
      <div style="width:24px;height:24px;position:relative">
        <div style="
          position:absolute;inset:0;border-radius:50%;
          background:${color};opacity:0.3;
          animation:replay-pulse 1.5s ease-in-out infinite;
        "></div>
        <div style="
          position:absolute;inset:4px;border-radius:50%;
          background:${color};border:2px solid white;
          box-shadow:0 0 8px ${color};
          ${rotation}
        "></div>
      </div>
    `,
  });
}

/**
 * Animated map marker that smoothly transitions between positions.
 *
 * Uses Leaflet's `setLatLng` for positioning (Leaflet owns the transform)
 * and an inner child for heading rotation (no transform conflict).
 */
export function AnimatedMarker({ position, heading, color = '#00b4d8' }: AnimatedMarkerProps) {
  const markerRef = useRef<L.Marker | null>(null);
  const map = useMap();

  // Smoothly update position without re-mounting
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const target = L.latLng(position[0], position[1]);
    marker.setLatLng(target);
    marker.setIcon(createCarIcon(color, heading));

    // Keep marker in view (but don't reset zoom)
    if (!map.getBounds().contains(target)) {
      map.panTo(target, { animate: true, duration: 0.3 });
    }
  }, [position, heading, color, map]);

  return (
    <Marker
      ref={markerRef}
      position={position}
      icon={createCarIcon(color, heading)}
    />
  );
}
