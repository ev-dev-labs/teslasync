import {Glyph} from '../../../../components/icons/Glyph';
// Native parity port of web/src/features/trips/components/TripReplayMap.tsx.
//
// The web component is a thin wrapper around the trip-replay Leaflet map. It is
// a *controlled* map — it owns no playback state; the page above is the single
// source of truth and feeds `currentIndex`, while the map reports clicks back
// through `onSeekToIndex`. It renders: a speed-coloured polyline, start/end
// circle pins, an animated (or snap-on-reduced-motion) playhead marker, a layer
// switcher, and a stationary-GPS banner / no-positions empty state.
//
// Everything that is pure geometry/derivation logic is ported verbatim; the
// browser-only pieces are mapped to native-safe equivalents (documented in the
// parity sidecar):
//
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     `useNativeTranslationFallback()` t() shim returns the English fallback copy
//     verbatim so every i18n key (`replay.map.stationaryRouteTitle`,
//     `replay.map.stationaryRouteBody`, `replay.map.noPositions`) is preserved
//     (same precedent as the RoutePlayback / LocationMapWidget ports).
//   - lucide-react `MapPin` / `Navigation2` become decorative native glyphs.
//   - Leaflet (`MapContainer`/`Polyline`/`CircleMarker`/`MapTileLayer`/
//     `MapInvalidator`/`AnimatedMarker`/`useMap`/`latLngBounds`) and the internal
//     `FitBounds` (`map.fitBounds`/`map.setView`) are browser-only. They are
//     replaced by a native projected route canvas: GPS lat/lng are normalised to
//     a 0..1 box (the projection always fits the trail, exactly what `FitBounds`
//     did) and the polyline is drawn as rotated, speed-coloured segment Views,
//     the start/end as circle markers, the stationary anchor as a single dot,
//     and the current position as a pulsing playhead — the same View-projection
//     approach used by the existing native RoutePlayback port. `center`/`zoom`/
//     `scrollWheelZoom`/`MapInvalidator`'s tile-resize hack have no native
//     analogue and are dropped.
//   - The Leaflet polyline `click` event (web → chart sync) has no native
//     analogue, so the canvas is made tappable: a tap is un-projected back to
//     lat/lng, fed through the ported `nearestSampleIndex`, and reported via
//     `onSeekToIndex` — preserving the exact seek channel.
//   - `MapLayerSwitcher` + the `MapStyle` union are preserved as a native
//     style-chip row (anchored to the bottom of the map, matching the web
//     comment so the top banner doesn't collide) that tints the canvas backdrop,
//     keeping the `mapStyle` state and `initialMapStyle` prop meaningful.
//   - `GlassPanel` / `EmptyState` map to the native shared components; the
//     `AlertBanner` info banner is inlined as a native variant-tinted banner.
//   - The Tailwind `className` merge is web-only: `className` is kept on props
//     for source compatibility but ignored on native (destructured `_className`);
//     `height` is applied to the panel directly (the web `style={{height}}`).

import React, {useCallback, useMemo, useState} from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';

import {EmptyState} from '../../../../components/feedback/EmptyState';
import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../../theme/tokens';

/* ── Types ─────────────────────────────────────────────────────────────────── */

/** Mirror of the web `MapStyle` union (re-exported through `@/components/maps`). */
export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

/** Mirror of the web `DrivePosition` (`@/types/driving`) — ported faithfully so
 *  the public prop shape is preserved. The map only reads latitude/longitude/
 *  speed, but the full shape is kept for type parity. */
export interface DrivePosition {
  latitude: number;
  longitude: number;
  speed: number | null;
  power: number | null;
  batteryLevel: number;
  timestamp: string;
  createdAt?: string;
  created_at?: string;
  insideTemp: number | null;
  outsideTemp: number | null;
  idealRange: number | null;
  ratedRange: number | null;
  odometer: number | null;
  elevation: number | null;
  fanStatus: number | null;
  isClimateOn: boolean | null;
}

export interface TripReplayMapProps {
  positions: DrivePosition[];
  currentIndex: number;
  /** Called when the user taps the trip route. The receiver should call
   *  `controls.seekTo(index)` to drive the page. */
  onSeekToIndex: (index: number) => void;
  /** Snap to position instead of pan-animating when true. */
  reduceMotion?: boolean;
  /** Optional: bypass the internal layer-switcher state. */
  initialMapStyle?: MapStyle;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  height?: number | string;
}

type NativeTFunction = (key: string, fallback: string) => string;

/* ── Constants ─────────────────────────────────────────────────────────────── */

const START_COLOR = '#10b981';
const END_COLOR = '#ef4444';
const ANCHOR_COLOR = '#22d3ee';
const PLAYHEAD_COLOR = '#00b4d8';
const SEGMENT_HEIGHT = 4;
/** Cap on drawn polyline vertices — native View segments, not an SVG path. */
const MAX_TRAIL_SEGMENTS = 120;

const ICON_MAP_PIN = '\u{1F4CD}'; // lucide MapPin
const ICON_NAVIGATION = '\u{1F9ED}'; // lucide Navigation2

/* ── i18n fallback shim (web react-i18next is unavailable in native) ──────────── */

/**
 * react-i18next `useTranslation` is unavailable in native parity; this shim
 * returns the English fallback copy verbatim while preserving the i18n keys.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

/* ── helpers (ported verbatim from the source) ────────────────────────────────── */

function speedColor(kmh: number): string {
  if (kmh < 30) {
    return '#10b981';
  }
  if (kmh < 60) {
    return '#22d3ee';
  }
  if (kmh < 100) {
    return '#f59e0b';
  }
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

function haversineDistance(
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

const MIN_MEANINGFUL_ROUTE_METERS = 10;

/** True iff `(lat, lng)` is finite, non-zero, and within valid global bounds.
 *  `(0, 0)` is rejected — the canonical Tesla "GPS not yet fixed" placeholder. */
function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return false;
  }
  if (lat === 0 && lng === 0) {
    return false;
  }
  if (lat < -90 || lat > 90) {
    return false;
  }
  if (lng < -180 || lng > 180) {
    return false;
  }
  return true;
}

/** True iff `positions` contains at least two valid coordinates separated by
 *  ≥ MIN_MEANINGFUL_ROUTE_METERS. Ported from web `@/lib/geo`. */
function hasMeaningfulRoute(positions: DrivePosition[]): boolean {
  let anchorIdx = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (isValidLatLng(p.latitude, p.longitude)) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) {
    return false;
  }
  const anchor = positions[anchorIdx];
  for (let i = anchorIdx + 1; i < positions.length; i++) {
    const p = positions[i];
    if (!isValidLatLng(p.latitude, p.longitude)) {
      continue;
    }
    const d = haversineDistance(
      anchor.latitude,
      anchor.longitude,
      p.latitude,
      p.longitude,
    );
    if (d >= MIN_MEANINGFUL_ROUTE_METERS) {
      return true;
    }
  }
  return false;
}

/** Index of the first valid coordinate, or -1. Ported from web `@/lib/geo`. */
function firstValidIndex(positions: DrivePosition[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) {
      return i;
    }
  }
  return -1;
}

/** Linear scan for the position closest (by haversine) to a given lat/lng.
 *  Trip-replay polylines top out around a few thousand samples — well within
 *  the budget for an O(n) scan on click. */
export function nearestSampleIndex(
  positions: DrivePosition[],
  lat: number,
  lng: number,
): number {
  if (positions.length === 0) {
    return 0;
  }
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < positions.length; i++) {
    const d = haversineDistance(
      positions[i].latitude,
      positions[i].longitude,
      lat,
      lng,
    );
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function resolveHeight(height: number | string): DimensionValue {
  if (typeof height === 'number') {
    return height;
  }
  const trimmed = height.trim();
  if (trimmed.endsWith('%')) {
    return trimmed as DimensionValue;
  }
  const px = parseFloat(trimmed);
  return Number.isFinite(px) ? px : 450;
}

/* ── Native map projection (replaces Leaflet fitBounds / setView) ──────────────── */

interface TrailBounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeBounds(trail: [number, number][]): TrailBounds | null {
  if (trail.length === 0) {
    return null;
  }
  return trail.reduce<TrailBounds>(
    (bounds, [lat, lng]) => ({
      minLat: Math.min(bounds.minLat, lat),
      maxLat: Math.max(bounds.maxLat, lat),
      minLng: Math.min(bounds.minLng, lng),
      maxLng: Math.max(bounds.maxLng, lng),
    }),
    {
      minLat: trail[0][0],
      maxLat: trail[0][0],
      minLng: trail[0][1],
      maxLng: trail[0][1],
    },
  );
}

function normalize(value: number, min: number, max: number): number {
  const span = max - min;
  if (!Number.isFinite(span) || Math.abs(span) < Number.EPSILON) {
    return 0.5;
  }
  return clamp01((value - min) / span);
}

function projectLatLng(
  lat: number,
  lng: number,
  bounds: TrailBounds,
): ProjectedPoint {
  return {
    x: normalize(lng, bounds.minLng, bounds.maxLng),
    // Latitude grows north → invert so larger lat sits toward the top.
    y: 1 - normalize(lat, bounds.minLat, bounds.maxLat),
  };
}

/** Inverse of `projectLatLng` — maps a 0..1 canvas point back to lat/lng so a
 *  tap can be resolved to the nearest GPS sample (Leaflet polyline `click`). */
function unprojectLatLng(
  nx: number,
  ny: number,
  bounds: TrailBounds,
): {lat: number; lng: number} {
  const lng = bounds.minLng + clamp01(nx) * (bounds.maxLng - bounds.minLng);
  const lat = bounds.minLat + (1 - clamp01(ny)) * (bounds.maxLat - bounds.minLat);
  return {lat, lng};
}

/** Even-stride sample of indices so very long trails stay within `max`. */
function sampleIndices(length: number, max: number): number[] {
  if (length <= max || max < 2) {
    return Array.from({length}, (_unused, i) => i);
  }
  const lastIndex = length - 1;
  const interval = lastIndex / (max - 1);
  const indices: number[] = [];
  let previous = -1;
  for (let i = 0; i < max; i += 1) {
    const next = i === max - 1 ? lastIndex : Math.round(i * interval);
    if (next !== previous) {
      indices.push(next);
      previous = next;
    }
  }
  return indices;
}

interface ColoredProjectedPoint extends ProjectedPoint {
  /** speed-colour of the point (the destination colour of its inbound segment). */
  color: string;
}

interface TrailSegment {
  id: string;
  left: number;
  top: number;
  width: number;
  angleRad: number;
  color: string;
}

function buildSegments(
  points: ColoredProjectedPoint[],
  width: number,
  height: number,
): TrailSegment[] {
  if (width <= 0 || height <= 0 || points.length < 2) {
    return [];
  }
  return points.slice(1).flatMap((point, index) => {
    const prev = points[index];
    const startX = prev.x * width;
    const startY = prev.y * height;
    const endX = point.x * width;
    const endY = point.y * height;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const length = Math.hypot(deltaX, deltaY);
    if (length < 1) {
      return [];
    }
    return [
      {
        id: `${index}:${prev.x.toFixed(4)}:${prev.y.toFixed(4)}`,
        left: (startX + endX) / 2 - length / 2,
        top: (startY + endY) / 2 - SEGMENT_HEIGHT / 2,
        width: length,
        angleRad: Math.atan2(deltaY, deltaX),
        // Segment colour mirrors the web `speedColor(curr.speed)` where `curr`
        // is the later of the two points in the pair.
        color: point.color,
      },
    ];
  });
}

/* ── Component ─────────────────────────────────────────────────────────────── */

/**
 * Thin wrapper around the trip-replay map. Owns: speed-coloured polyline,
 * start/end pins, the (reduced-motion-aware) playhead marker, the layer
 * switcher, and the tap → nearest-sample → seek channel that drives map → chart
 * sync. The marker tracks `currentIndex` exclusively — there is no internal
 * playback state; the page above remains the single source of truth.
 */
export function TripReplayMap({
  positions,
  currentIndex,
  onSeekToIndex,
  reduceMotion = false,
  initialMapStyle = 'dark',
  className: _className,
  height = 450,
}: TripReplayMapProps) {
  const t = useNativeTranslationFallback();
  const [mapStyle, setMapStyle] = useState<MapStyle>(initialMapStyle);

  /* Stationary-GPS detection: positions exist but every recorded coord is within
   * ~10 m of the first. Surfaces a banner instead of a bogus single-dot route. */
  const hasRoute = useMemo(() => hasMeaningfulRoute(positions), [positions]);
  const anchorIdx = useMemo(() => firstValidIndex(positions), [positions]);

  /* Trail derived from positions — only built when we have a real route to draw.
   * Stationary case skips the speed segments entirely. */
  const trail = useMemo<[number, number][]>(
    () =>
      hasRoute
        ? positions
            .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
            .map(p => [p.latitude, p.longitude] as [number, number])
        : [],
    [positions, hasRoute],
  );
  const startPos = trail[0] as [number, number] | undefined;
  const endPos =
    trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;

  const bounds = useMemo(() => computeBounds(trail), [trail]);

  /* Speed-coloured segments — only when we have a real route. Sampled to stay
   * within MAX_TRAIL_SEGMENTS native View vertices. */
  const speedSegmentPoints = useMemo<ColoredProjectedPoint[]>(() => {
    if (!hasRoute || !bounds) {
      return [];
    }
    return sampleIndices(positions.length, MAX_TRAIL_SEGMENTS).map(i => {
      const p = positions[i];
      return {
        ...projectLatLng(p.latitude, p.longitude, bounds),
        color: speedColor(p.speed ?? 0),
      };
    });
  }, [positions, hasRoute, bounds]);

  /* Heading angle for the playhead arrow */
  const heading = useMemo(() => {
    if (!hasRoute || positions.length < 2) {
      return 0;
    }
    const next =
      currentIndex < positions.length - 1 ? currentIndex + 1 : currentIndex;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(positions[prev], positions[next]);
  }, [currentIndex, positions, hasRoute]);

  const currentPosition = hasRoute ? positions[currentIndex] ?? null : null;
  const markerPos = useMemo<ProjectedPoint | null>(() => {
    if (
      !bounds ||
      !currentPosition ||
      !Number.isFinite(currentPosition.latitude) ||
      !Number.isFinite(currentPosition.longitude)
    ) {
      return null;
    }
    return projectLatLng(currentPosition.latitude, currentPosition.longitude, bounds);
  }, [bounds, currentPosition]);

  const projectedStart = useMemo<ProjectedPoint | null>(
    () => (bounds && startPos ? projectLatLng(startPos[0], startPos[1], bounds) : null),
    [bounds, startPos],
  );
  const projectedEnd = useMemo<ProjectedPoint | null>(
    () => (bounds && endPos ? projectLatLng(endPos[0], endPos[1], bounds) : null),
    [bounds, endPos],
  );

  /* Tap → un-project → nearest sample → seek (replaces the Leaflet polyline
   * `click` event channel). */
  const handleSeekAtPoint = useCallback(
    (nx: number, ny: number) => {
      if (!bounds || positions.length === 0) {
        return;
      }
      const {lat, lng} = unprojectLatLng(nx, ny, bounds);
      const idx = nearestSampleIndex(positions, lat, lng);
      onSeekToIndex(idx);
    },
    [bounds, positions, onSeekToIndex],
  );

  const panelHeight = resolveHeight(height);

  return (
    <GlassPanel style={[styles.panel, {height: panelHeight}]} testID="trip-replay-map">
      {positions.length > 0 ? (
        <View style={styles.mapArea}>
          <MapCanvas
            mapStyle={mapStyle}
            hasRoute={hasRoute}
            segmentPoints={speedSegmentPoints}
            projectedStart={projectedStart}
            projectedEnd={projectedEnd}
            markerPos={markerPos}
            heading={heading}
            reduceMotion={reduceMotion}
            showAnchor={!hasRoute && anchorIdx >= 0}
            onSeekAtPoint={hasRoute ? handleSeekAtPoint : undefined}
          />

          {/* Layer switcher anchored to the bottom of the map so the top banner
              doesn't collide with it. */}
          <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />

          {/* Stationary-GPS banner — overlaid at the top of the map so the panel
              still feels like a map (not an empty state) but the user isn't left
              guessing why no polyline appears. */}
          {!hasRoute && (
            <View pointerEvents="box-none" style={styles.bannerWrap}>
              <AlertBanner
                variant="info"
                icon={<Glyph glyph={ICON_NAVIGATION} style={styles.bannerIcon} />}
                title={t('replay.map.stationaryRouteTitle', "Route can't be plotted")}>
                {t(
                  'replay.map.stationaryRouteBody',
                  "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The trip statistics, speed, and elevation timeline above the scrubber are unaffected.",
                )}
              </AlertBanner>
            </View>
          )}
        </View>
      ) : (
        <EmptyState
          /* no-action: transient empty state — surfaces when source data is
             missing; no specific recovery action available */
          title={ICON_MAP_PIN}
          message={t(
            'replay.map.noPositions',
            'No position data available for this drive',
          )}
        />
      )}
    </GlassPanel>
  );
}

/* ── Native route canvas (replaces the Leaflet MapContainer subtree) ───────────── */

interface MapCanvasProps {
  mapStyle: MapStyle;
  hasRoute: boolean;
  segmentPoints: ColoredProjectedPoint[];
  projectedStart: ProjectedPoint | null;
  projectedEnd: ProjectedPoint | null;
  markerPos: ProjectedPoint | null;
  heading: number;
  reduceMotion: boolean;
  showAnchor: boolean;
  onSeekAtPoint?: (nx: number, ny: number) => void;
}

const MAP_BACKDROPS: Record<MapStyle, string> = {
  dark: 'rgba(8, 14, 26, 0.9)',
  satellite: 'rgba(11, 24, 18, 0.9)',
  streets: 'rgba(20, 24, 33, 0.9)',
  terrain: 'rgba(18, 26, 16, 0.9)',
};

const MAP_GRID_LINES = [20, 40, 60, 80];

function MapCanvas({
  mapStyle,
  hasRoute,
  segmentPoints,
  projectedStart,
  projectedEnd,
  markerPos,
  heading,
  reduceMotion,
  showAnchor,
  onSeekAtPoint,
}: MapCanvasProps) {
  const [size, setSize] = useState({width: 0, height: 0});
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setSize(prev =>
      prev.width === width && prev.height === height ? prev : {width, height},
    );
  }, []);

  const segments = useMemo(
    () => buildSegments(segmentPoints, size.width, size.height),
    [segmentPoints, size.width, size.height],
  );

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      if (!onSeekAtPoint || size.width <= 0 || size.height <= 0) {
        return;
      }
      onSeekAtPoint(
        event.nativeEvent.locationX / size.width,
        event.nativeEvent.locationY / size.height,
      );
    },
    [onSeekAtPoint, size.width, size.height],
  );

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="Trip replay route map"
      onLayout={handleLayout}
      style={[styles.canvas, {backgroundColor: MAP_BACKDROPS[mapStyle]}]}>
      <View pointerEvents="none" style={styles.gridLayer}>
        {MAP_GRID_LINES.map(line => (
          <React.Fragment key={line}>
            <View style={[styles.gridLineV, {left: `${line}%` as DimensionValue}]} />
            <View style={[styles.gridLineH, {top: `${line}%` as DimensionValue}]} />
          </React.Fragment>
        ))}
      </View>

      <View pointerEvents="none" style={styles.plot}>
        {hasRoute &&
          segments.map(segment => (
            <View
              key={segment.id}
              style={[
                styles.trailSegment,
                {
                  backgroundColor: segment.color,
                  left: segment.left,
                  top: segment.top,
                  width: segment.width,
                  transform: [{rotate: `${segment.angleRad}rad`}],
                },
              ]}
            />
          ))}

        {hasRoute && projectedStart ? (
          <Endpoint point={projectedStart} color={START_COLOR} radius={6} />
        ) : null}

        {hasRoute && projectedEnd ? (
          <Endpoint point={projectedEnd} color={END_COLOR} radius={6} />
        ) : null}

        {/* Single anchor marker for the stationary-GPS case so the user still
            sees where the drive happened (web centers the map on the anchor). */}
        {showAnchor ? (
          <Endpoint point={{x: 0.5, y: 0.5}} color={ANCHOR_COLOR} radius={8} />
        ) : null}

        {/* Playhead marker — tracks `currentIndex`. Under reduced motion the
            pulse + heading arrow are dropped so the dot snaps without animation. */}
        {hasRoute && markerPos ? (
          <PlayheadMarker
            point={markerPos}
            color={PLAYHEAD_COLOR}
            heading={heading}
            reduceMotion={reduceMotion}
          />
        ) : null}
      </View>

      {onSeekAtPoint ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Seek to tapped position on the route"
          onPress={handlePress}
          style={StyleSheet.absoluteFill}
        />
      ) : null}
    </View>
  );
}

/* ── Endpoint / anchor circle marker (replaces Leaflet CircleMarker) ──────────── */

interface EndpointProps {
  point: ProjectedPoint;
  color: string;
  radius: number;
}

function Endpoint({point, color, radius}: EndpointProps) {
  const diameter = radius * 2;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.endpointMarker,
        {
          left: `${point.x * 100}%` as DimensionValue,
          top: `${point.y * 100}%` as DimensionValue,
          marginLeft: -radius,
          marginTop: -radius,
        },
      ]}>
      <View
        style={{
          width: diameter,
          height: diameter,
          borderRadius: radius,
          backgroundColor: color,
          borderColor: colors.background,
          borderWidth: 2,
        }}
      />
    </View>
  );
}

/* ── Playhead marker (replaces the Leaflet AnimatedMarker DivIcon) ────────────── */

interface PlayheadMarkerProps {
  point: ProjectedPoint;
  color: string;
  heading: number;
  reduceMotion: boolean;
}

function PlayheadMarker({point, color, heading, reduceMotion}: PlayheadMarkerProps) {
  const pulse = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0);
      return;
    }
    pulse.setValue(0);
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 750,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, reduceMotion]);

  const pulseStyle = {
    opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.3, 0]}),
    transform: [
      {scale: pulse.interpolate({inputRange: [0, 1], outputRange: [0.8, 1.8]})},
    ],
  };

  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        {
          left: `${point.x * 100}%` as DimensionValue,
          top: `${point.y * 100}%` as DimensionValue,
        },
      ]}>
      {!reduceMotion ? (
        <Animated.View
          style={[styles.markerPulse, {backgroundColor: color}, pulseStyle]}
        />
      ) : null}
      <View style={[styles.markerCore, {backgroundColor: color}]}>
        {!reduceMotion ? (
          <AppText
            allowFontScaling={false}
            importantForAccessibility="no"
            style={[styles.markerHeading, {transform: [{rotate: `${heading}deg`}]}]}>
            ▲
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/* ── Map layer switcher (replaces the Leaflet MapLayerSwitcher) ────────────────── */

const MAP_STYLES: MapStyle[] = ['dark', 'satellite', 'streets', 'terrain'];

interface MapLayerSwitcherProps {
  current: MapStyle;
  onChange: (style: MapStyle) => void;
}

function MapLayerSwitcher({current, onChange}: MapLayerSwitcherProps) {
  return (
    <View style={styles.layerSwitcher}>
      {MAP_STYLES.map(option => {
        const active = option === current;
        return (
          <Pressable
            key={option}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            accessibilityLabel={option}
            onPress={() => onChange(option)}
            style={({pressed}) => [
              styles.layerChip,
              active && styles.layerChipActive,
              pressed && styles.layerChipPressed,
            ]}>
            <AppText
              variant="caption"
              weight={active ? 'semibold' : 'regular'}
              style={active ? styles.layerChipTextActive : styles.layerChipText}>
              {option}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/* ── Decorative glyph (lucide-react stand-in) ─────────────────────────────────── */

function GlyphLegacyUnused({glyph, style}: {glyph: string; style?: StyleProp<TextStyle>}) {
  return (
    <AppText allowFontScaling={false} importantForAccessibility="no" style={style}>
      {glyph}
    </AppText>
  );
}

/* ── Inlined AlertBanner (replaces web @/components/feedback AlertBanner) ───────── */

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

const ALERT_VARIANTS: Record<
  AlertVariant,
  {border: string; bg: string; title: string; body: string}
> = {
  info: {
    border: colors.borderAccent,
    bg: colors.accentSoft,
    title: colors.accent,
    body: colors.textSecondary,
  },
  success: {
    border: colors.successBorder,
    bg: colors.successSurface,
    title: colors.success,
    body: colors.textSecondary,
  },
  warning: {
    border: colors.warningBorder,
    bg: colors.warningSurface,
    title: colors.warning,
    body: colors.textSecondary,
  },
  danger: {
    border: colors.dangerBorder,
    bg: colors.dangerSurface,
    title: colors.danger,
    body: colors.textSecondary,
  },
};

interface AlertBannerProps {
  variant: AlertVariant;
  title?: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

function AlertBanner({variant, title, icon, children}: AlertBannerProps) {
  const v = ALERT_VARIANTS[variant];
  return (
    <View style={[styles.alert, {borderColor: v.border, backgroundColor: v.bg}]}>
      {icon ? <View style={styles.alertIconWrap}>{icon}</View> : null}
      <View style={styles.alertContent}>
        {title ? (
          <AppText weight="semibold" style={[styles.alertTitle, {color: v.title}]}>
            {title}
          </AppText>
        ) : null}
        <AppText style={[styles.alertText, {color: v.body}]}>{children}</AppText>
      </View>
    </View>
  );
}

/* ── Styles ────────────────────────────────────────────────────────────────── */

const styles = StyleSheet.create({
  alert: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  alertContent: {
    flex: 1,
    minWidth: 0,
  },
  alertIconWrap: {
    paddingTop: 1,
  },
  alertText: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  alertTitle: {
    fontSize: 14,
    lineHeight: 18,
  },
  bannerIcon: {
    color: colors.accent,
    fontSize: 14,
    lineHeight: 18,
  },
  bannerWrap: {
    left: spacing.md,
    position: 'absolute',
    right: spacing.md,
    top: spacing.md,
    zIndex: 20,
  },
  canvas: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  endpointMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
  },
  gridLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  gridLineH: {
    backgroundColor: colors.border,
    height: 1,
    left: 0,
    opacity: 0.5,
    position: 'absolute',
    right: 0,
  },
  gridLineV: {
    backgroundColor: colors.border,
    bottom: 0,
    opacity: 0.5,
    position: 'absolute',
    top: 0,
    width: 1,
  },
  layerChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  layerChipActive: {
    backgroundColor: colors.surfaceSelected,
    borderColor: colors.borderAccent,
  },
  layerChipPressed: {
    opacity: 0.7,
  },
  layerChipText: {
    color: colors.textSecondary,
    textTransform: 'capitalize',
  },
  layerChipTextActive: {
    color: colors.accent,
    textTransform: 'capitalize',
  },
  layerSwitcher: {
    bottom: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    left: spacing.sm,
    position: 'absolute',
    zIndex: 10,
  },
  mapArea: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
    width: '100%',
  },
  marker: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    marginLeft: -12,
    marginTop: -12,
    position: 'absolute',
    width: 24,
  },
  markerCore: {
    alignItems: 'center',
    borderColor: '#ffffff',
    borderRadius: 8,
    borderWidth: 2,
    height: 16,
    justifyContent: 'center',
    width: 16,
  },
  markerHeading: {
    color: '#ffffff',
    fontSize: 8,
    lineHeight: 10,
  },
  markerPulse: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 12,
  },
  panel: {
    overflow: 'hidden',
  },
  plot: {
    ...StyleSheet.absoluteFillObject,
  },
  trailSegment: {
    borderRadius: SEGMENT_HEIGHT / 2,
    height: SEGMENT_HEIGHT,
    position: 'absolute',
  },
});
