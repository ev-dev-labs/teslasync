import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import {
  MapContainer,
  Polyline,
  CircleMarker,
  MapTileLayer,
  MapInvalidator,
  MapLayerSwitcher,
  AnimatedMarker,
  latLngBounds,
  useMap,
  type LatLngExpression,
  type MapStyle,
} from '@/components/maps';
import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { haversineDistance } from '@/lib/geo';
import type { DrivePosition } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Phase-45 / Prompt 26 — Trip-replay map                             */
/* ------------------------------------------------------------------ */

/**
 * Thin wrapper around the trip-replay leaflet map.
 *
 * Owns: speed-coloured polyline rendering, start/end pins, the animated
 * (or snap-on-reduced-motion) playhead marker, the layer switcher, and the
 * polyline `click` event channel that drives map → chart sync.
 *
 * The marker tracks `currentIndex` exclusively — there is no internal
 * playback state. The page above remains the single source of truth so
 * scrubber / chart cursor / map marker stay in lockstep.
 */
export interface TripReplayMapProps {
  positions: DrivePosition[];
  currentIndex: number;
  /** Called when the user clicks anywhere on the trip polyline. The
   *  receiver should call `controls.seekTo(index)` to drive the page. */
  onSeekToIndex: (index: number) => void;
  /** Snap to position instead of pan-animating when true. */
  reduceMotion?: boolean;
  /** Optional: bypass the internal layer-switcher state. */
  initialMapStyle?: MapStyle;
  className?: string;
  height?: number | string;
}

/* ── helpers ───────────────────────────────────────────────────── */

function speedColor(kmh: number): string {
  if (kmh < 30) return '#10b981';
  if (kmh < 60) return '#22d3ee';
  if (kmh < 100) return '#f59e0b';
  return '#ef4444';
}

function computeHeading(p1: DrivePosition, p2: DrivePosition): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(p2.longitude - p1.longitude);
  const y = Math.sin(dLon) * Math.cos(toRad(p2.latitude));
  const x =
    Math.cos(toRad(p1.latitude)) * Math.sin(toRad(p2.latitude)) -
    Math.sin(toRad(p1.latitude)) * Math.cos(toRad(p2.latitude)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Linear scan for the position closest (by haversine) to a given lat/lng.
 *  Trip-replay polylines top out around a few thousand samples — well
 *  within the budget for an O(n) scan on click. */
export function nearestSampleIndex(
  positions: DrivePosition[],
  lat: number,
  lng: number,
): number {
  if (positions.length === 0) return 0;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    const d = haversineDistance(positions[i].latitude, positions[i].longitude, lat, lng);
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function FitBounds({ trail }: { trail: LatLngExpression[] }) {
  const map = useMap();
  useMemo(() => {
    if (trail.length > 1) {
      const bounds = latLngBounds(
        trail.map((p) =>
          Array.isArray(p)
            ? ([p[0] as number, p[1] as number] as [number, number])
            : ([0, 0] as [number, number]),
        ),
      );
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40] });
    } else if (trail.length === 1) {
      map.setView(trail[0] as [number, number], 15);
    }
  }, [trail.length]);
  return null;
}

/* ── component ─────────────────────────────────────────────────── */

export function TripReplayMap({
  positions,
  currentIndex,
  onSeekToIndex,
  reduceMotion = false,
  initialMapStyle = 'dark',
  className,
  height = 450,
}: TripReplayMapProps) {
  const { t } = useTranslation();
  const [mapStyle, setMapStyle] = useState<MapStyle>(initialMapStyle);

  /* Trail derived from positions */
  const trail: LatLngExpression[] = useMemo(
    () => positions.map((p) => [p.latitude, p.longitude] as [number, number]),
    [positions],
  );
  const startPos = trail[0] as [number, number] | undefined;
  const endPos =
    trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;
  const centerPos: [number, number] = startPos ?? [47.6, -122.3];

  /* Speed-coloured segments */
  const speedSegments = useMemo(() => {
    const segs: { positions: LatLngExpression[]; color: string }[] = [];
    for (let i = 1; i < positions.length; i++) {
      const prev = positions[i - 1];
      const curr = positions[i];
      segs.push({
        positions: [
          [prev.latitude, prev.longitude],
          [curr.latitude, curr.longitude],
        ],
        color: speedColor(curr.speed ?? 0),
      });
    }
    return segs;
  }, [positions]);

  /* Heading angle for the playhead arrow */
  const heading = useMemo(() => {
    if (positions.length < 2) return 0;
    const next = currentIndex < positions.length - 1 ? currentIndex + 1 : currentIndex;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(positions[prev], positions[next]);
  }, [currentIndex, positions]);

  const currentPosition = positions[currentIndex] ?? null;

  /* Polyline click → nearest sample → seek */
  const handlePolylineClick = useCallback(
    (e: { latlng: { lat: number; lng: number } }) => {
      if (positions.length === 0) return;
      const idx = nearestSampleIndex(positions, e.latlng.lat, e.latlng.lng);
      onSeekToIndex(idx);
    },
    [positions, onSeekToIndex],
  );

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  return (
    <GlassPanel
      className={`relative overflow-hidden rounded-xl ${className ?? ''}`}
      style={{ height: heightStyle }}
      data-testid="trip-replay-map"
    >
      {positions.length > 0 ? (
        <MapContainer
          center={centerPos}
          zoom={13}
          className="h-full w-full z-0"
          scrollWheelZoom
          zoomControl={false}
          fadeAnimation={!reduceMotion}
          zoomAnimation={!reduceMotion}
          markerZoomAnimation={!reduceMotion}
        >
          <MapTileLayer style={mapStyle} />
          <MapInvalidator />
          <FitBounds trail={trail} />

          {/* Speed-coloured route — every segment receives the same click handler so
              a click anywhere on the trail snaps the playhead. */}
          {speedSegments.map((seg, i) => (
            <Polyline
              key={i}
              positions={seg.positions}
              pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }}
              eventHandlers={{ click: handlePolylineClick }}
            />
          ))}

          {startPos && (
            <CircleMarker
              center={startPos}
              radius={6}
              pathOptions={{
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 1,
                weight: 2,
              }}
            />
          )}

          {endPos && (
            <CircleMarker
              center={endPos}
              radius={6}
              pathOptions={{
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 1,
                weight: 2,
              }}
            />
          )}

          {/* Playhead marker — `AnimatedMarker` smoothly tracks the current
              sample. Under reduced motion we render a plain `CircleMarker`
              instead so the icon snaps without map pan animation. */}
          {currentPosition && !reduceMotion && (
            <AnimatedMarker
              position={[currentPosition.latitude, currentPosition.longitude]}
              heading={heading}
              color="#00b4d8"
            />
          )}
          {currentPosition && reduceMotion && (
            <CircleMarker
              center={[currentPosition.latitude, currentPosition.longitude]}
              radius={8}
              pathOptions={{
                color: '#00b4d8',
                fillColor: '#00b4d8',
                fillOpacity: 1,
                weight: 2,
              }}
            />
          )}

          <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
        </MapContainer>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<MapPin className="h-8 w-8" />}
          message={t(
            'replay.map.noPositions',
            'No position data available for this drive',
          )}
        />
      )}
    </GlassPanel>
  );
}
