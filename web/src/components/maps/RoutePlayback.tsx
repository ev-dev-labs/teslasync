import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin, Flag } from 'lucide-react';

import { GlassPanel } from '@/components/ui/GlassPanel';
import { Text } from '@/components/ui/Typography';
import { PlaybackControls } from '@/components/data-display/PlaybackControls';
import { EmptyState } from '@/components/feedback/EmptyState';
import { useMotionPreference } from '@/hooks/useMotionPreference';
import { useA11ySummary } from '@/hooks/useA11ySummary';
import { VisuallyHidden } from '@/components/a11y/VisuallyHidden';
import { cn } from '@/lib/cn';
import { useUnits } from '@/hooks/useUnits';
import { chartTokens } from '@/lib/tokens';
import { resolveMapRendererColor } from '@/lib/colors';


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
  type MapStyle,
} from './index';
import type { ReplaySpeed } from '@/hooks/useTripReplay';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface PlaybackPoint {
  lat: number;
  lng: number;
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Optional SI speed (m/s), state of charge (%), and power (W), surfaced unchanged via onPositionChange. */
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
  /** Visible map height in CSS units. Default 400. */
  height?: number | string;
  /** Initial map style. Default 'dark'. */
  initialMapStyle?: MapStyle;
  /** Show the floating tile-layer switcher. Default true. */
  showLayerSwitcher?: boolean;
  /** Render the inline playback controls below the map. Default true. */
  showControls?: boolean;
  /** Trail polyline color. Defaults to the first existing chart series. */
  trailColor?: string;
  /** Animated DOM marker color. Defaults to the semantic info role. */
  markerColor?: string;
  /** aria-label for the map application landmark. */
  ariaLabel?: string;
  /** Optional className applied to the outer container. */
  className?: string;
  /** Empty-state message override when `points` is empty. */
  emptyMessage?: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const TICK_MS = 50;
const SPEEDS: ReplaySpeed[] = [1, 10, 25, 50, 100];

function buildOffsets(points: PlaybackPoint[]): number[] {
  if (points.length === 0) return [];
  const t0 = new Date(points[0].timestamp).getTime();
  return points.map((p) => {
    const t = new Date(p.timestamp).getTime();
    if (Number.isNaN(t)) return 0;
    return t - t0;
  });
}

function indexAtTime(offsets: number[], target: number): number {
  if (offsets.length === 0) return 0;
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] < target) lo = mid + 1;
    else hi = mid;
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

/* ------------------------------------------------------------------ */
/*  Internal map fitter                                                */
/* ------------------------------------------------------------------ */

function FitTrail({ trail }: { trail: [number, number][] }) {
  const map = useMap();
  // A11Y-08: Leaflet's `fitBounds` / `setView` animate the camera by
  // default. A pan-and-zoom across a whole drive is exactly the kind of
  // large-area movement that triggers vestibular symptoms, and it is not
  // covered by the CSS reduced-motion block because Leaflet drives the
  // transform imperatively. Jump instead of gliding when asked to.
  const { reduce } = useMotionPreference();
  useEffect(() => {
    const options = reduce ? { animate: false, duration: 0 } : {};
    if (trail.length > 1) {
      const bounds = latLngBounds(trail);
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], ...options });
    } else if (trail.length === 1) {
      map.setView(trail[0], 15, options);
    }
    // Only re-fit when the trail length actually changes.
  }, [map, trail.length, reduce]);
  return null;
}

function MapPaintContext({ onContext }: { onContext: (context: HTMLElement) => void }) {
  const map = useMap();
  useEffect(() => {
    onContext(map.getContainer());
  }, [map, onContext]);
  return null;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Self-contained route-playback widget — renders an interactive map with
 * a polyline of GPS points, animated marker, and bottom playback controls.
 *
 * Honors `prefers-reduced-motion`: when reduced motion is requested, the
 * marker is positioned without map pan animation and tile transitions.
 */
export function RoutePlayback({
  points,
  autoPlay = false,
  onPositionChange,
  height = 400,
  initialMapStyle = 'dark',
  showLayerSwitcher = true,
  showControls = true,
  trailColor = chartTokens.series[0],
  markerColor = 'var(--semantic-info)',
  ariaLabel,
  className,
  emptyMessage,
}: RoutePlaybackProps) {
  const { fmtNumber } = useNumberFormatting();
  const { formatSpeed } = useUnits();
  const { t } = useTranslation();
  const { reduce } = useMotionPreference();
  const { describeRoute } = useA11ySummary();
  const routeSummaryId = useId();
  const [mapStyle, setMapStyle] = useState<MapStyle>(initialMapStyle);
  const [paintContext, setPaintContext] = useState<HTMLElement | null>(null);
  const [paint, setPaint] = useState<{
    trail: string | null; start: string | null; end: string | null;
  }>({ trail: null, start: null, end: null });

  useEffect(() => {
    if (!paintContext) return;
    const refresh = () => {
      const resolve = (input: string, fallback: string) =>
        resolveMapRendererColor(input, paintContext) ??
        (input !== fallback ? resolveMapRendererColor(fallback, paintContext) : null);
      const next = {
        trail: resolve(trailColor, chartTokens.series[0]),
        start: resolveMapRendererColor(chartTokens.series[1], paintContext),
        end: resolveMapRendererColor(chartTokens.series[3], paintContext),
      };
      setPaint((previous) =>
        previous.trail === next.trail && previous.start === next.start && previous.end === next.end
          ? previous : next);
    };
    refresh();
    const view = paintContext.ownerDocument.defaultView;
    const observer = view?.MutationObserver ? new view.MutationObserver(refresh) : null;
    // Observe inherited theme roles, not probe children or Leaflet transforms.
    for (let node: HTMLElement | null = paintContext; node; node = node.parentElement) {
      observer?.observe(node, {
        attributes: true, attributeFilter: ['class', 'style', 'data-theme', 'data-mode'],
      });
    }
    const media = ['(prefers-color-scheme: dark)', '(forced-colors: active)']
      .map((query) => view?.matchMedia?.(query));
    media.forEach((query) => query?.addEventListener('change', refresh));
    return () => {
      observer?.disconnect();
      media.forEach((query) => query?.removeEventListener('change', refresh));
    };
  }, [paintContext, trailColor]);

  /* ── Memoized derived data ────────────────────────────────────── */
  const offsets = useMemo(() => buildOffsets(points), [points]);
  const totalMs = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
  const trail = useMemo<[number, number][]>(
    () =>
      points
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
        .map((p): [number, number] => [p.lat, p.lng]),
    [points],
  );
  const startPos = trail[0];
  const endPos = trail.length > 1 ? trail[trail.length - 1] : undefined;
  const centerPos: [number, number] = startPos ?? [0, 0];

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
    if (point) onChangeRef.current?.(point, currentIndex);
  }, [currentIndex, points]);

  const tick = useCallback(() => {
    const list = offsetsRef.current;
    const total = totalRef.current;
    if (list.length === 0 || total === 0) return;
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
    if (points.length < 2) return;
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
    if (points.length < 2) return 0;
    const next = currentIndex < points.length - 1 ? currentIndex + 1 : currentIndex;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(points[prev], points[next]);
  }, [points, currentIndex]);

  const cp = points[currentIndex];

  /* ── Empty state ──────────────────────────────────────────────── */
  if (trail.length === 0) {
    return (
      <GlassPanel className={cn('overflow-hidden', className)}>
        <EmptyState /* no-action: route playback has no fallback when telemetry has no GPS points */
          icon={<MapPin className="h-8 w-8" />}
          message={
            emptyMessage ??
            t('maps.routePlayback.empty', 'No GPS points to replay for this route.')
          }
        />
      </GlassPanel>
    );
  }

  const progress = totalMs > 0 ? Math.min(elapsedRef.current / totalMs, 1) : 0;
  const heightStyle = typeof height === 'number' ? `${height}px` : height;
  const routeSummary = describeRoute({
    pointCount: trail.length,
    duration: fmtDuration(totalMs),
  });

  return (
    <GlassPanel className={cn('overflow-hidden', className)}>
      <div
        className="relative w-full"
        style={{ height: heightStyle }}
        role="application"
        aria-label={ariaLabel ?? t('maps.routePlayback.mapLabel', 'Route playback map')}
        aria-describedby={routeSummaryId}
      >
        {/* A11Y-10: a Leaflet route is an SVG path plus markers — to a
            screen reader it is literally nothing. This one sentence is
            the entire non-visual representation of the drive, so it
            carries the endpoints, the length, and the sample count. */}
        <VisuallyHidden id={routeSummaryId}>{routeSummary}</VisuallyHidden>
        {showLayerSwitcher && (
          <MapLayerSwitcher current={mapStyle} onChange={setMapStyle} />
        )}
        <MapContainer
          center={centerPos}
          zoom={trail.length > 1 ? 13 : 15}
          scrollWheelZoom
          className="h-full w-full"
          fadeAnimation={!reduce}
          zoomAnimation={!reduce}
          markerZoomAnimation={!reduce}
        >
          <MapTileLayer style={mapStyle} />
          <MapInvalidator />
          <FitTrail trail={trail} />
          <MapPaintContext onContext={setPaintContext} />
          {paint.trail && <Polyline
            positions={trail}
            pathOptions={{ color: paint.trail, weight: 4, opacity: 0.8 }}
          />}
          {startPos && paint.start && (
            <CircleMarker
              center={startPos}
              radius={7}
              pathOptions={{
                color: paint.start,
                fillColor: paint.start,
                fillOpacity: 1,
                weight: 2,
              }}
            />
          )}
          {endPos && paint.end && (
            <CircleMarker
              center={endPos}
              radius={7}
              pathOptions={{
                color: paint.end,
                fillColor: paint.end,
                fillOpacity: 1,
                weight: 2,
              }}
            />
          )}
          {cp && (
            <AnimatedMarker
              position={[cp.lat, cp.lng]}
              heading={heading}
              color={markerColor}
            />
          )}
        </MapContainer>
        {(!paint.trail || !paint.start || (endPos && !paint.end)) && (
          <div role="status" data-map-paint="unresolved" className="absolute bottom-2 left-2 z-map-control rounded-lg bg-[var(--panel-bg)] px-3 py-1.5">
            <Text variant="caption">
              {t('maps.routePlayback.mapLabel', 'Route playback map')}: {t('common.unavailable', 'Unavailable')}
            </Text>
          </div>
        )}

        {/* Inline metric chip — top-right. */}
        {cp && (
          <div className="pointer-events-none absolute right-2 top-2 z-map-control flex items-center gap-2 rounded-lg border border-[var(--border-default)] bg-[var(--panel-bg)] px-3 py-1.5">
            <Flag className="h-3 w-3 text-[var(--text-secondary)]" aria-hidden="true" />
            <Text variant="caption" mono>
              {currentIndex + 1}/{points.length}
            </Text>
            {cp.speed != null && (
              <Text variant="caption" mono>{formatSpeed(cp.speed)}</Text>
            )}
            {cp.soc != null && (
              <Text variant="caption" mono>{fmtNumber(cp.soc)}%</Text>
            )}
          </div>
        )}
      </div>

      {showControls && (
        <div className="border-t border-[var(--border-default)] p-3">
          <PlaybackControls
            framed={false}
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
          />
        </div>
      )}
    </GlassPanel>
  );
}
