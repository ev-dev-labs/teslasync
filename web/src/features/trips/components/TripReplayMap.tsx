import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Navigation2 } from 'lucide-react';
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
import { EmptyState, AlertBanner } from '@/components/feedback';
import {
  haversineDistance,
  hasMeaningfulRoute,
  firstValidIndex,
} from '@/lib/geo';
import type { DrivePosition } from '@/types/driving';

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

function FitBounds({ trail, fallbackCenter }: { trail: LatLngExpression[]; fallbackCenter?: [number, number] }) {
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
      /* `bounds.isValid()` reports true even for zero-extent rectangles built
       * from N identical coordinates. Without checking spread, leaflet zooms
       * to maxZoom and the user sees a single dot at street-corner zoom even
       * though they expected to see a route. Fall back to a hand-set view at
       * a recognisable zoom whenever the bbox collapses. */
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const spread = sw && ne
        ? Math.abs(ne.lat - sw.lat) + Math.abs(ne.lng - sw.lng)
        : 0;
      if (bounds.isValid() && spread > 1e-5) {
        map.fitBounds(bounds, { padding: [40, 40] });
      } else if (fallbackCenter) {
        map.setView(fallbackCenter, 15);
      }
    } else if (trail.length === 1) {
      map.setView(trail[0] as [number, number], 15);
    } else if (fallbackCenter) {
      map.setView(fallbackCenter, 15);
    }
  }, [trail.length, fallbackCenter?.[0], fallbackCenter?.[1]]);
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

  /* Stationary-GPS detection: positions exist but every recorded coord is
   * within ~10 m of the first. Surfaces a banner instead of a bogus polyline
   * full of zero-length segments collapsing to a single dot. */
  const hasRoute = useMemo(() => hasMeaningfulRoute(positions), [positions]);
  const anchorIdx = useMemo(() => firstValidIndex(positions), [positions]);
  const anchorPoint: [number, number] | undefined = useMemo(() => {
    if (anchorIdx < 0) return undefined;
    const p = positions[anchorIdx];
    return [p.latitude, p.longitude];
  }, [positions, anchorIdx]);

  /* Trail derived from positions — only built when we have a real route to
   * draw. Stationary case skips the speed segments entirely. */
  const trail: LatLngExpression[] = useMemo(
    () => (hasRoute ? positions.map((p) => [p.latitude, p.longitude] as [number, number]) : []),
    [positions, hasRoute],
  );
  const startPos = trail[0] as [number, number] | undefined;
  const endPos =
    trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;
  const centerPos: [number, number] = startPos ?? anchorPoint ?? [47.6, -122.3];

  /* Speed-coloured segments — only when we have a real route. */
  const speedSegments = useMemo(() => {
    if (!hasRoute) return [] as { positions: LatLngExpression[]; color: string }[];
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
  }, [positions, hasRoute]);

  /* Heading angle for the playhead arrow.
   *
   * `currentIndex` is owned by the page above and, during scrubber resets or
   * a positions swap, can transiently fall outside `[0, len-1]`. Clamp it
   * before indexing so an out-of-range value can't read `positions[undefined]`
   * and crash `computeHeading` — the playhead itself is null in that window,
   * so the exact angle is moot; not throwing is what matters. */
  const heading = useMemo(() => {
    if (!hasRoute || positions.length < 2) return 0;
    const clamped = Math.min(Math.max(currentIndex, 0), positions.length - 1);
    const next = clamped < positions.length - 1 ? clamped + 1 : clamped;
    const prev = next > 0 ? next - 1 : 0;
    const from = positions[prev];
    const to = positions[next];
    if (!from || !to) return 0;
    return computeHeading(from, to);
  }, [currentIndex, positions, hasRoute]);

  const currentPosition = hasRoute ? positions[currentIndex] ?? null : null;

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
      role="region"
      aria-label={t('replay.map.ariaLabel', 'Trip route map')}
      className={`relative overflow-hidden rounded-xl ${className ?? ''}`}
      style={{ height: heightStyle }}
      data-testid="trip-replay-map"
    >
      {positions.length > 0 ? (
        <>
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
            <FitBounds trail={trail} fallbackCenter={anchorPoint} />

            {/* Speed-coloured route — only when GPS varies. Stationary case
                renders a single anchor marker below instead. */}
            {hasRoute && speedSegments.map((seg, i) => (
              <Polyline
                key={i}
                positions={seg.positions}
                pathOptions={{ color: seg.color, weight: 4, opacity: 0.8 }}
                eventHandlers={{ click: handlePolylineClick }}
              />
            ))}

            {hasRoute && startPos && (
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

            {hasRoute && endPos && (
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

            {/* Single anchor marker for the stationary-GPS case so the user
                still sees where the drive happened. */}
            {!hasRoute && anchorPoint && (
              <CircleMarker
                center={anchorPoint}
                radius={8}
                pathOptions={{
                  color: '#22d3ee',
                  fillColor: '#22d3ee',
                  fillOpacity: 0.9,
                  weight: 2,
                }}
              />
            )}

            {/* Playhead marker — `AnimatedMarker` smoothly tracks the current
                sample. Under reduced motion we render a plain `CircleMarker`
                instead so the icon snaps without map pan animation. */}
            {hasRoute && currentPosition && !reduceMotion && (
              <AnimatedMarker
                position={[currentPosition.latitude, currentPosition.longitude]}
                heading={heading}
                color="#00b4d8"
              />
            )}
            {hasRoute && currentPosition && reduceMotion && (
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

          {/* Stationary-GPS banner — overlaid above the map so the route
              panel still feels like a map (not an empty state) but the user
              isn't left guessing why no polyline appears. Layer switcher sits
              at the bottom of the map so a top banner doesn't collide. */}
          {!hasRoute && (
            <div className="pointer-events-none absolute inset-x-3 top-3 z-[400]">
              <AlertBanner
                variant="info"
                icon={<Navigation2 className="h-4 w-4" />}
                title={t('replay.map.stationaryRouteTitle', 'Route can\'t be plotted')}
                className="pointer-events-auto"
              >
                {t(
                  'replay.map.stationaryRouteBody',
                  'Only one GPS coordinate was recorded for this drive, so the route can\'t be drawn. The trip statistics, speed, and elevation timeline above the scrubber are unaffected.',
                )}
              </AlertBanner>
            </div>
          )}
        </>
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
