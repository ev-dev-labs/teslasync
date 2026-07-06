import { useEffect, useMemo, useRef } from 'react';
import { Marker, useMap } from 'react-leaflet';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';

import { useMotionPreference } from '@/hooks/useMotionPreference';

interface AnimatedMarkerProps {
  position: [number, number];
  heading?: number;
  color?: string;
  /**
   * Accessible name announced by screen readers for this marker. Defaults to a
   * translated "Vehicle position" label — the marker is otherwise an unlabeled
   * decorative icon with no accessible name.
   */
  ariaLabel?: string;
}

/**
 * Custom car icon rendered as a pulsing CSS circle with an optional heading arrow.
 *
 * The `@keyframes replay-pulse` used by the pulse ring is NOT declared in the
 * global stylesheet, so it is embedded inline here (mirrors `vehicleIcon.ts`).
 * Without it the ring renders static instead of pulsing. Leaflet swaps the
 * marker's icon DOM on `setIcon`, so at most one `<style>` block exists per
 * marker at a time — no unbounded accumulation.
 */
function createCarIcon(color: string, heading: number | undefined, label: string): L.DivIcon {
  const rotation =
    heading != null && Number.isFinite(heading) ? `transform:rotate(${heading}deg);` : '';
  return L.divIcon({
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    html: `
      <div role="img" aria-label="${label}" style="width:24px;height:24px;position:relative">
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
      <style>
        @keyframes replay-pulse {
          0%, 100% { transform: scale(1); opacity: 0.3; }
          50% { transform: scale(1.6); opacity: 0; }
        }
      </style>
    `,
  });
}

/**
 * Animated map marker that smoothly transitions between positions.
 *
 * Uses Leaflet's `setLatLng` for positioning (Leaflet owns the transform)
 * and an inner child for heading rotation (no transform conflict). Honors
 * `prefers-reduced-motion`: the recentering pan snaps instantly instead of
 * animating when reduced motion is requested.
 */
export function AnimatedMarker({
  position,
  heading,
  color = '#00b4d8',
  ariaLabel,
}: AnimatedMarkerProps) {
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const markerRef = useRef<L.Marker | null>(null);
  const map = useMap();

  const label = ariaLabel ?? t('maps.animatedMarker.label', 'Vehicle position');

  // Rebuild the icon only when its inputs change — avoids allocating a fresh
  // DivIcon (and re-running Leaflet's icon swap) on every parent re-render.
  const icon = useMemo(() => createCarIcon(color, heading, label), [color, heading, label]);

  // Smoothly update position without re-mounting.
  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;

    const [lat, lng] = position ?? [];
    // Guard against missing / NaN GPS fixes (common in Tesla telemetry gaps) —
    // feeding a non-finite LatLng to Leaflet corrupts the map viewport.
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const target = L.latLng(lat, lng);
    marker.setLatLng(target);
    marker.setIcon(icon);

    // Keep marker in view (but don't reset zoom).
    if (!map.getBounds().contains(target)) {
      map.panTo(target, { animate: !reduce, duration: reduce ? 0 : 0.3 });
    }
  }, [position, icon, map, reduce]);

  return <Marker ref={markerRef} position={position} icon={icon} />;
}
