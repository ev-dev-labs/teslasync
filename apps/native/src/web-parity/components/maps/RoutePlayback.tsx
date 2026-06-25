// Native parity port of web/src/components/maps/RoutePlayback.tsx.
//
// The web component is a self-contained Leaflet route-playback widget: an
// interactive map with a polyline of GPS points, a pulsing animated car marker
// that follows a play/pause/seek/speed timeline, start/end circle markers, an
// inline metric chip, and a bottom `<PlaybackControls>` bar. Everything that is
// pure timeline logic is ported verbatim; the browser-only pieces are mapped to
// native-safe equivalents:
//
//   - react-i18next `useTranslation` is unavailable in native parity; a local
//     `useNativeTranslationFallback()` t() shim returns the English fallback copy
//     verbatim so every i18n key (`maps.routePlayback.empty`,
//     `maps.routePlayback.mapLabel`, the `replay.controls.*` button labels) is
//     preserved (same precedent as the ChartExportMenu / VehiclePicker ports).
//   - `useMotionPreference().reduce` (framer-motion's `prefers-reduced-motion`)
//     becomes a native `useReduceMotion()` backed by `AccessibilityInfo`
//     (`isReduceMotionEnabled` + `reduceMotionChanged`). `reduce` keeps the same
//     meaning: when set, the marker pulse loop is disabled and the marker snaps
//     to position without an entrance animation — mirroring the web
//     `fadeAnimation`/`zoomAnimation`/`markerZoomAnimation` = `!reduce` gating.
//   - Leaflet (`MapContainer`/`Polyline`/`CircleMarker`/`MapTileLayer`/
//     `MapInvalidator`/`AnimatedMarker`/`useMap`/`latLngBounds`) and the internal
//     `FitTrail` (`map.fitBounds`/`map.setView`) are browser-only. They are
//     replaced by a native projected route canvas: GPS lat/lng are normalised to
//     a 0..1 box (the projection always fits the trail, which is exactly what
//     `FitTrail` did) and the polyline is drawn as rotated segment Views, the
//     start/end as circle markers, and the current position as a pulsing marker —
//     the same View-projection approach used by the existing native
//     `MapRouteSummary` primitive. `center`/`zoom`/`scrollWheelZoom` and
//     `MapInvalidator`'s tile-resize hack have no native analogue and are dropped.
//   - `MapLayerSwitcher` + the `MapStyle` union are preserved as a native
//     style-chip row that tints the canvas backdrop, keeping the `mapStyle`
//     state, `initialMapStyle`, and `showLayerSwitcher` props meaningful.
//   - The lucide `MapPin` (empty state) and `Flag` (metric chip) icons become
//     native glyphs.
//   - `fmtNumber` from `@/lib/numberFormat` becomes `fmt` from the ported native
//     `../charts/chartUtils` (identical min=max fraction-digit formatting).
//   - The web `<PlaybackControls>` sibling (a separate 397-line component not yet
//     ported) is represented inline by a native control bar that preserves its
//     exact public contract used here — `isPlaying`, `speed`, `progress`,
//     `elapsed`, `total`, `onPlay`, `onPause`, `onStop`, `onSpeedChange`,
//     `onSeek` — with a tap-to-seek scrubber (onLayout width + touch `locationX`).
//   - The Tailwind `cn(...)`/`className` merge is web-only: `className` is kept on
//     props for source compatibility but ignored on native (destructured as
//     `_className`); a `style` override is added instead.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {EmptyState} from '../../../components/feedback/EmptyState';
import {AppText} from '../../../components/ui/AppText';
import {GlassPanel} from '../../../components/ui/GlassPanel';
import {colors, spacing} from '../../../theme/tokens';
import {fmt} from '../charts/chartUtils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Mirror of the web `MapStyle` union (re-exported through the maps index). */
export type MapStyle = 'dark' | 'satellite' | 'streets' | 'terrain';

/** Mirror of `ReplaySpeed` from web `@/hooks/useTripReplay`. */
type ReplaySpeed = 1 | 10 | 25 | 50 | 100;

export interface PlaybackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Optional metric values surfaced via onPositionChange. */
  speed?: number;
  soc?: number;
  power?: number;
}

export interface RoutePlaybackProps {
  /** Time-ordered GPS positions with timestamps and optional metrics. */
  points: PlaybackPoint[];
  /** Auto-play on mount. Default false. */
  autoPlay?: boolean;
  /**
   * Callback fired when scrub position changes — pages can sync charts
   * (e.g. move a `<TimeMarker>` cursor on a recharts axis).
   */
  onPositionChange?: (point: PlaybackPoint, index: number) => void;
  /** Visible map height. Default 400. */
  height?: number | string;
  /** Initial map style. Default 'dark'. */
  initialMapStyle?: MapStyle;
  /** Show the floating tile-layer switcher. Default true. */
  showLayerSwitcher?: boolean;
  /** Render the inline playback controls below the map. Default true. */
  showControls?: boolean;
  /** Trail polyline color. Default '#22d3ee'. */
  trailColor?: string;
  /** Animated marker color. Default '#00b4d8'. */
  markerColor?: string;
  /** Accessibility label for the map landmark. */
  ariaLabel?: string;
  /** Web Tailwind override retained for source compatibility; ignored on native. */
  className?: string;
  /** Native style override for the outer panel. */
  style?: StyleProp<ViewStyle>;
  /** Empty-state message override when `points` is empty. */
  emptyMessage?: string;
}

type NativeTFunction = (key: string, fallback: string) => string;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TICK_MS = 50;
const SPEEDS: ReplaySpeed[] = [1, 10, 25, 50, 100];

const START_COLOR = '#10b981';
const END_COLOR = '#ef4444';
const SEGMENT_HEIGHT = 4;
/** Cap on drawn polyline vertices — native View segments, not an SVG path. */
const MAX_TRAIL_SEGMENTS = 96;

/**
 * react-i18next `useTranslation` is unavailable in native parity; this shim
 * returns the English fallback copy verbatim while preserving the i18n keys.
 */
function useNativeTranslationFallback(): NativeTFunction {
  return useCallback((_key: string, fallback: string) => fallback, []);
}

function buildOffsets(points: PlaybackPoint[]): number[] {
  if (points.length === 0) {
    return [];
  }
  const t0 = new Date(points[0].timestamp).getTime();
  return points.map(p => {
    const t = new Date(p.timestamp).getTime();
    if (Number.isNaN(t)) {
      return 0;
    }
    return t - t0;
  });
}

function indexAtTime(offsets: number[], target: number): number {
  if (offsets.length === 0) {
    return 0;
  }
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] < target) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0 && target - offsets[lo - 1] < offsets[lo] - target) {
    return lo - 1;
  }
  return lo;
}

function computeHeading(a: PlaybackPoint, b: PlaybackPoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(b.lng - a.lng);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function fmtDuration(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
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
  return Number.isFinite(px) ? px : 400;
}

/* ------------------------------------------------------------------ */
/*  Native map projection (replaces Leaflet fitBounds / setView)       */
/* ------------------------------------------------------------------ */

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
  return Math.max(0, Math.min(1, (value - min) / span));
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

/** Even-stride sample so very long trails stay within MAX_TRAIL_SEGMENTS. */
function sampleTrail(
  trail: [number, number][],
  maxPoints: number,
): [number, number][] {
  if (trail.length <= maxPoints || maxPoints < 2) {
    return trail;
  }
  const lastIndex = trail.length - 1;
  const interval = lastIndex / (maxPoints - 1);
  const sampled: [number, number][] = [];
  let previousIndex = -1;
  for (let i = 0; i < maxPoints; i += 1) {
    const next = i === maxPoints - 1 ? lastIndex : Math.round(i * interval);
    if (next !== previousIndex) {
      sampled.push(trail[next]);
      previousIndex = next;
    }
  }
  return sampled;
}

interface TrailSegment {
  id: string;
  left: number;
  top: number;
  width: number;
  angleRad: number;
}

function buildSegments(
  projected: ProjectedPoint[],
  width: number,
  height: number,
): TrailSegment[] {
  if (width <= 0 || height <= 0 || projected.length < 2) {
    return [];
  }
  return projected.slice(1).flatMap((point, index) => {
    const prev = projected[index];
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
      },
    ];
  });
}

/* ------------------------------------------------------------------ */
/*  Reduced-motion (replaces useMotionPreference)                      */
/* ------------------------------------------------------------------ */

function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let cancelled = false;

    AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      if (!cancelled) {
        setReduceMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      setReduceMotion,
    );

    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduceMotion;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Self-contained route-playback widget — renders a native route canvas with a
 * polyline of GPS points, an animated marker, and a bottom playback control bar.
 *
 * Honors the device reduce-motion setting: when reduced motion is requested the
 * marker is positioned without a pulse animation.
 */
export function RoutePlayback({
  points,
  autoPlay = false,
  onPositionChange,
  height = 400,
  initialMapStyle = 'dark',
  showLayerSwitcher = true,
  showControls = true,
  trailColor = '#22d3ee',
  markerColor = '#00b4d8',
  ariaLabel,
  className: _className,
  style,
  emptyMessage,
}: RoutePlaybackProps) {
  const t = useNativeTranslationFallback();
  const reduce = useReduceMotion();
  const [mapStyle, setMapStyle] = useState<MapStyle>(initialMapStyle);

  /* ── Memoized derived data ────────────────────────────────────── */
  const offsets = useMemo(() => buildOffsets(points), [points]);
  const totalMs = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
  const trail = useMemo<[number, number][]>(
    () =>
      points
        .filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map(p => [p.lat, p.lng] as [number, number]),
    [points],
  );
  const startPos = trail[0] as [number, number] | undefined;
  const endPos =
    trail.length > 1 ? (trail[trail.length - 1] as [number, number]) : undefined;

  const bounds = useMemo(() => computeBounds(trail), [trail]);
  const sampledTrail = useMemo(
    () => sampleTrail(trail, MAX_TRAIL_SEGMENTS),
    [trail],
  );
  const projectedTrail = useMemo<ProjectedPoint[]>(
    () =>
      bounds
        ? sampledTrail.map(([lat, lng]) => projectLatLng(lat, lng, bounds))
        : [],
    [bounds, sampledTrail],
  );

  /* ── Playback state ───────────────────────────────────────────── */
  const [isPlaying, setIsPlaying] = useState(autoPlay && points.length > 1);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const speedRef = useRef<ReplaySpeed>(1);
  const offsetsRef = useRef<number[]>(offsets);
  const totalRef = useRef<number>(totalMs);

  // Stable callback ref so we can fire onPositionChange without re-creating
  // the playback interval on every parent render.
  const onChangeRef = useRef(onPositionChange);
  useEffect(() => {
    onChangeRef.current = onPositionChange;
  }, [onPositionChange]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    offsetsRef.current = offsets;
    totalRef.current = totalMs;
    // If the new dataset is shorter than the current cursor, clamp it.
    if (currentIndex >= offsets.length) {
      const last = Math.max(0, offsets.length - 1);
      setCurrentIndex(last);
      elapsedRef.current = offsets[last] ?? 0;
    }
  }, [offsets, totalMs, currentIndex]);

  // Fire onPositionChange whenever the cursor moves.
  useEffect(() => {
    const point = points[currentIndex];
    if (point) {
      onChangeRef.current?.(point, currentIndex);
    }
  }, [currentIndex, points]);

  const tick = useCallback(() => {
    const list = offsetsRef.current;
    const total = totalRef.current;
    if (list.length === 0 || total === 0) {
      return;
    }
    elapsedRef.current += TICK_MS * speedRef.current;
    if (elapsedRef.current >= total) {
      elapsedRef.current = total;
      setCurrentIndex(list.length - 1);
      setIsPlaying(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }
    setCurrentIndex(indexAtTime(list, elapsedRef.current));
  }, []);

  useEffect(() => {
    if (isPlaying) {
      intervalRef.current = setInterval(tick, TICK_MS);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, tick]);

  /* ── Controls ─────────────────────────────────────────────────── */
  const play = useCallback(() => {
    if (points.length < 2) {
      return;
    }
    if (totalRef.current > 0 && elapsedRef.current >= totalRef.current) {
      elapsedRef.current = 0;
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, [points.length]);

  const pause = useCallback(() => setIsPlaying(false), []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    elapsedRef.current = 0;
    setCurrentIndex(0);
  }, []);

  const seekToProgress = useCallback((progress: number) => {
    const total = totalRef.current;
    const list = offsetsRef.current;
    const targetMs = Math.max(0, Math.min(1, progress)) * total;
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(list, targetMs));
  }, []);

  const cycleSpeed = useCallback((next: ReplaySpeed) => {
    const safeNext = SPEEDS.includes(next) ? next : 1;
    setSpeed(safeNext);
  }, []);

  /* ── Marker heading ───────────────────────────────────────────── */
  const heading = useMemo(() => {
    if (points.length < 2) {
      return 0;
    }
    const next =
      currentIndex < points.length - 1 ? currentIndex + 1 : currentIndex;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(points[prev], points[next]);
  }, [points, currentIndex]);

  const cp = points[currentIndex];
  const markerPos = useMemo<ProjectedPoint | null>(() => {
    if (!bounds || !cp || !Number.isFinite(cp.lat) || !Number.isFinite(cp.lng)) {
      return null;
    }
    return projectLatLng(cp.lat, cp.lng, bounds);
  }, [bounds, cp]);

  /* ── Empty state ──────────────────────────────────────────────── */
  if (trail.length === 0) {
    return (
      <GlassPanel style={[styles.panel, style]}>
        <EmptyState
          title="📍"
          message={
            emptyMessage ??
            t('maps.routePlayback.empty', 'No GPS points to replay for this route.')
          }
        />
      </GlassPanel>
    );
  }

  const progress = totalMs > 0 ? Math.min(elapsedRef.current / totalMs, 1) : 0;
  const canvasHeight = resolveHeight(height);

  return (
    <GlassPanel style={[styles.panel, style]}>
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          ariaLabel ?? t('maps.routePlayback.mapLabel', 'Route playback map')
        }
        style={[styles.mapArea, {height: canvasHeight}]}>
        <RouteCanvas
          mapStyle={mapStyle}
          trailColor={trailColor}
          markerColor={markerColor}
          projectedTrail={projectedTrail}
          startPos={startPos}
          endPos={endPos}
          bounds={bounds}
          markerPos={markerPos}
          heading={heading}
          reduce={reduce}
        />

        {showLayerSwitcher ? (
          <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
        ) : null}

        {/* Inline metric chip — top-right. */}
        {cp ? (
          <View pointerEvents="none" style={styles.metricChip}>
            <AppText style={styles.metricFlag}>⚑</AppText>
            <AppText style={styles.metricMono}>
              {currentIndex + 1}/{points.length}
            </AppText>
            {cp.speed != null ? (
              <AppText style={styles.metricSecondary}>
                {fmt(cp.speed, 1)} km/h
              </AppText>
            ) : null}
            {cp.soc != null ? (
              <AppText style={styles.metricSoc}>{fmt(cp.soc, 0)}%</AppText>
            ) : null}
          </View>
        ) : null}
      </View>

      {showControls ? (
        <View style={styles.controlsWrap}>
          <PlaybackControls
            isPlaying={isPlaying}
            speed={speed}
            progress={progress}
            elapsed={fmtDuration(elapsedRef.current)}
            total={fmtDuration(totalMs)}
            onPlay={play}
            onPause={pause}
            onStop={stop}
            onSpeedChange={cycleSpeed}
            onSeek={seekToProgress}
            t={t}
          />
        </View>
      ) : null}
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Native route canvas (replaces the Leaflet MapContainer subtree)    */
/* ------------------------------------------------------------------ */

interface RouteCanvasProps {
  mapStyle: MapStyle;
  trailColor: string;
  markerColor: string;
  projectedTrail: ProjectedPoint[];
  startPos: [number, number] | undefined;
  endPos: [number, number] | undefined;
  bounds: TrailBounds | null;
  markerPos: ProjectedPoint | null;
  heading: number;
  reduce: boolean;
}

const MAP_BACKDROPS: Record<MapStyle, string> = {
  dark: 'rgba(8, 14, 26, 0.9)',
  satellite: 'rgba(11, 24, 18, 0.9)',
  streets: 'rgba(20, 24, 33, 0.9)',
  terrain: 'rgba(18, 26, 16, 0.9)',
};

const MAP_GRID_LINES = [20, 40, 60, 80];

function RouteCanvas({
  mapStyle,
  trailColor,
  markerColor,
  projectedTrail,
  startPos,
  endPos,
  bounds,
  markerPos,
  heading,
  reduce,
}: RouteCanvasProps) {
  const [size, setSize] = useState({width: 0, height: 0});
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const {width, height} = event.nativeEvent.layout;
    setSize(prev =>
      prev.width === width && prev.height === height ? prev : {width, height},
    );
  }, []);

  const segments = useMemo(
    () => buildSegments(projectedTrail, size.width, size.height),
    [projectedTrail, size.width, size.height],
  );

  const projectedStart = useMemo(
    () =>
      bounds && startPos
        ? projectLatLng(startPos[0], startPos[1], bounds)
        : null,
    [bounds, startPos],
  );
  const projectedEnd = useMemo(
    () => (bounds && endPos ? projectLatLng(endPos[0], endPos[1], bounds) : null),
    [bounds, endPos],
  );

  return (
    <View
      onLayout={handleLayout}
      style={[styles.canvas, {backgroundColor: MAP_BACKDROPS[mapStyle]}]}>
      <View pointerEvents="none" style={styles.gridLayer}>
        {MAP_GRID_LINES.map(line => (
          <React.Fragment key={line}>
            <View
              style={[styles.gridLineV, {left: `${line}%` as DimensionValue}]}
            />
            <View
              style={[styles.gridLineH, {top: `${line}%` as DimensionValue}]}
            />
          </React.Fragment>
        ))}
      </View>

      <View pointerEvents="none" style={styles.plot}>
        {segments.map(segment => (
          <View
            key={segment.id}
            style={[
              styles.trailSegment,
              {
                backgroundColor: trailColor,
                left: segment.left,
                top: segment.top,
                width: segment.width,
                transform: [{rotate: `${segment.angleRad}rad`}],
              },
            ]}
          />
        ))}

        {projectedStart ? (
          <View
            style={[
              styles.endpointMarker,
              {
                left: `${projectedStart.x * 100}%` as DimensionValue,
                top: `${projectedStart.y * 100}%` as DimensionValue,
              },
            ]}>
            <View style={[styles.endpointDot, {backgroundColor: START_COLOR}]} />
          </View>
        ) : null}

        {projectedEnd ? (
          <View
            style={[
              styles.endpointMarker,
              {
                left: `${projectedEnd.x * 100}%` as DimensionValue,
                top: `${projectedEnd.y * 100}%` as DimensionValue,
              },
            ]}>
            <View style={[styles.endpointDot, {backgroundColor: END_COLOR}]} />
          </View>
        ) : null}

        {markerPos ? (
          <AnimatedMarker
            x={markerPos.x}
            y={markerPos.y}
            color={markerColor}
            heading={heading}
            reduce={reduce}
          />
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Animated marker (replaces the Leaflet AnimatedMarker DivIcon)      */
/* ------------------------------------------------------------------ */

interface AnimatedMarkerProps {
  x: number;
  y: number;
  color: string;
  heading: number;
  reduce: boolean;
}

function AnimatedMarker({x, y, color, heading, reduce}: AnimatedMarkerProps) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
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
  }, [pulse, reduce]);

  const pulseStyle = {
    opacity: pulse.interpolate({inputRange: [0, 1], outputRange: [0.3, 0]}),
    transform: [
      {
        scale: pulse.interpolate({inputRange: [0, 1], outputRange: [0.8, 1.8]}),
      },
    ],
  };

  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        {
          left: `${x * 100}%` as DimensionValue,
          top: `${y * 100}%` as DimensionValue,
        },
      ]}>
      <Animated.View
        style={[styles.markerPulse, {backgroundColor: color}, pulseStyle]}
      />
      <View style={[styles.markerCore, {backgroundColor: color}]}>
        <AppText
          style={[
            styles.markerHeading,
            {transform: [{rotate: `${heading}deg`}]},
          ]}>
          ▲
        </AppText>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Map layer switcher (replaces the Leaflet MapLayerSwitcher)         */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Playback controls (inline native parity for <PlaybackControls>)    */
/* ------------------------------------------------------------------ */

interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  /** 0..1 normalized playback position. */
  progress: number;
  /** Pre-formatted elapsed time (e.g. "1:23"). */
  elapsed: string;
  /** Pre-formatted total time (e.g. "5:10"). */
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  t: NativeTFunction;
}

function nextSpeed(speed: ReplaySpeed): ReplaySpeed {
  const index = SPEEDS.indexOf(speed);
  return SPEEDS[(index + 1) % SPEEDS.length];
}

function PlaybackControls({
  isPlaying,
  speed,
  progress,
  elapsed,
  total,
  onPlay,
  onPause,
  onStop,
  onSpeedChange,
  onSeek,
  t,
}: PlaybackControlsProps) {
  const trackWidthRef = useRef(0);
  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    trackWidthRef.current = event.nativeEvent.layout.width;
  }, []);
  const handleSeek = useCallback(
    (event: GestureResponderEvent) => {
      const width = trackWidthRef.current;
      if (width <= 0) {
        return;
      }
      onSeek(Math.max(0, Math.min(1, event.nativeEvent.locationX / width)));
    },
    [onSeek],
  );

  return (
    <View style={styles.controls}>
      <ControlButton
        glyph="⏮"
        label={t('replay.controls.reset', 'Reset')}
        onPress={onStop}
      />
      <ControlButton
        glyph={isPlaying ? '⏸' : '▶'}
        label={
          isPlaying
            ? t('replay.controls.pause', 'Pause')
            : t('replay.controls.play', 'Play')
        }
        onPress={isPlaying ? onPause : onPlay}
      />
      <ControlButton
        glyph="◼"
        label={t('replay.controls.stop', 'Stop')}
        onPress={onStop}
      />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('replay.controls.speed', 'Playback speed')}
        onPress={() => onSpeedChange(nextSpeed(speed))}
        style={({pressed}) => [styles.speedChip, pressed && styles.controlPressed]}>
        <AppText variant="caption" weight="semibold" style={styles.speedText}>
          {speed}×
        </AppText>
      </Pressable>

      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel={t('replay.controls.scrub', 'Seek')}
        accessibilityValue={{now: Math.round(progress * 100), min: 0, max: 100}}
        onLayout={handleTrackLayout}
        onPress={handleSeek}
        style={styles.scrubTrack}>
        <View style={styles.scrubBase} />
        <View
          pointerEvents="none"
          style={[
            styles.scrubFill,
            {width: `${Math.min(progress, 1) * 100}%` as DimensionValue},
          ]}
        />
        <View
          pointerEvents="none"
          style={[
            styles.scrubThumb,
            {left: `${Math.min(progress, 1) * 100}%` as DimensionValue},
          ]}
        />
      </Pressable>

      <AppText style={styles.timeText}>
        {elapsed} / {total}
      </AppText>
    </View>
  );
}

interface ControlButtonProps {
  glyph: string;
  label: string;
  onPress: () => void;
}

function ControlButton({glyph, label, onPress}: ControlButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({pressed}) => [styles.controlButton, pressed && styles.controlPressed]}>
      <AppText style={styles.controlGlyph}>{glyph}</AppText>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  canvas: {
    flex: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  controlButton: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  controlGlyph: {
    color: colors.textPrimary,
    fontSize: 14,
    lineHeight: 18,
  },
  controlPressed: {
    opacity: 0.7,
  },
  controls: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  controlsWrap: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    padding: spacing.md,
  },
  endpointDot: {
    borderColor: colors.background,
    borderRadius: 7,
    borderWidth: 2,
    height: 14,
    width: 14,
  },
  endpointMarker: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -7,
    marginTop: -7,
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
    flexDirection: 'row',
    gap: spacing.xs,
    left: spacing.sm,
    position: 'absolute',
    top: spacing.sm,
  },
  mapArea: {
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
  metricChip: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    position: 'absolute',
    right: spacing.sm,
    top: spacing.sm,
  },
  metricFlag: {
    color: '#67e8f9',
    fontSize: 11,
    lineHeight: 14,
  },
  metricMono: {
    color: colors.textPrimary,
    fontSize: 11,
    lineHeight: 14,
  },
  metricSecondary: {
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  metricSoc: {
    color: '#6ee7b7',
    fontSize: 11,
    lineHeight: 14,
  },
  panel: {
    overflow: 'hidden',
  },
  plot: {
    ...StyleSheet.absoluteFillObject,
  },
  scrubBase: {
    backgroundColor: colors.border,
    borderRadius: 999,
    height: 4,
    width: '100%',
  },
  scrubFill: {
    backgroundColor: colors.accent,
    borderRadius: 999,
    height: 4,
    left: 0,
    position: 'absolute',
  },
  scrubThumb: {
    backgroundColor: colors.accent,
    borderRadius: 6,
    height: 12,
    marginLeft: -6,
    marginTop: -6,
    position: 'absolute',
    top: '50%',
    width: 12,
  },
  scrubTrack: {
    flexBasis: 120,
    flexGrow: 1,
    flexShrink: 1,
    justifyContent: 'center',
    minHeight: 24,
  },
  speedChip: {
    alignItems: 'center',
    borderColor: colors.border,
    borderRadius: 10,
    borderWidth: 1,
    height: 36,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  speedText: {
    color: colors.textPrimary,
  },
  timeText: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 16,
    marginLeft: 'auto',
    textAlign: 'right',
  },
  trailSegment: {
    borderRadius: 999,
    height: SEGMENT_HEIGHT,
    opacity: 0.85,
    position: 'absolute',
  },
});
