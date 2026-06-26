// Native parity port of web/src/features/trips/pages/TripReplayPage.tsx.
//
// The web page is the Trips > Trip Replay surface: a `PageContainer` (title +
// drive subtitle + a "Back to Drive" action) whose body threads a single
// source of truth — `replay.currentIndex` from `useTripReplay` — through six
// stacked sections: the route map, the playback scrubber, the current-position
// stats bar, the elevation profile, the speed+power timeline, and the drive
// summary. This port reproduces the identical data reads, state, SI->display
// unit handling, i18n key/fallback intent, and the same ordered sections using
// React Native primitives instead of DOM / Leaflet / Recharts / framer-motion /
// react-router / web UI components (contract rule 4).
//
// Behaviour preserved verbatim:
//   * `useDrive(id ?? '')` (API path `/drives/{id}`) via the ported hook.
//   * `telemetryByTs` / `nearestTelemetry` binary-search merge, the `positions`
//     normalize+merge memo (including the `<V,>` `pick` generic and the
//     lat/lon !== 0 filter), `useTripReplay(positions)`, `handleSeekToIndex`,
//     `replayMarkers`/`scrubberMarkers`, the restore/persist deep-link effects,
//     `elevationData`, `timelineData`, `getPreviewAt`, `speedSparkData`,
//     `activeMarker`/`cardHighlight`, `cp`, and the drive-summary derivations
//     (`distanceM`/`durationS`/`distanceUserUnit`/`efficiency`).
//   * The SI display converters convertDistance/Speed/TempFromSI (backend is
//     SI: meters, m/s, °C), the geo helpers, the replay-marker engine, the
//     `useTripReplay` time-based clock, `fmtDuration`/`fmtDriveTime`, and the
//     number/date formatters — all inlined verbatim (no native ports exist).
//   * Every i18n key + English fallback and every section, in the same order.
//
// Platform dependency swaps (each documented in the parity sidecar):
//   * react-router `useParams<{id}>` -> optional `id` prop; `<Link>` /
//     navigation -> optional `onNavigate(to)` prop (Incident/Explore port
//     convention).
//   * `useSearchParams` `?at=&play=` deep-link -> `initialReplayParams` restore
//     prop + debounced `onReplayParamsChange` sink (no URL on native); the
//     restore-once + 300ms-debounced persist logic is preserved verbatim.
//   * `useUnits` -> `useNativeUnits` (same distance/speed/temperature prefs
//     derived from the ported `useSettings()`).
//   * `useMotionPreference` (framer `prefers-reduced-motion`) ->
//     `useNativeMotionPreference` backed by RN `AccessibilityInfo`.
//   * `usePageTitle` -> no-op (no document.title; header still renders title).
//   * `PageContainer`/`GlassPanel`/`Button`/`StatCard`/`MetricCard`/
//     `EmptyState`/`FadeIn`/`Stagger*`/`PlaybackControls`/`Sparkline`/
//     `ElevationProfile`/`TripReplayMap`/`TripReplayCharts` -> native
//     re-implementations in this file or the ported native chart components.
//   * The Leaflet route map, the Recharts cursor-synced timeline, framer
//     entrance motion, keyboard shortcuts, and pointer hover previews are
//     browser-only; native-safe equivalents render explicit state instead.

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type DimensionValue,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {
  SemanticIcon,
  type SemanticIconName,
} from '../../../../components/icons/SemanticIcon';
import {colors, spacing} from '../../../../theme/tokens';
import {ChartContainer} from '../../../components/charts/ChartContainer';
import {Sparkline} from '../../../components/charts/Sparkline';
import {
  ElevationProfile,
  type ElevationDataPoint,
} from '../../../components/charts/ElevationProfile';
import {useDrive, type DrivePosition} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';

/* ================================================================== */
/*  i18n + page-title shims                                            */
/* ================================================================== */

// react-i18next swap: the page calls `t(key, fallback)` with no interpolation
// vars, so the native shim returns the English fallback.
type NativeT = (key: string, fallback: string) => string;

function useNativeT(): NativeT {
  return useMemo<NativeT>(() => (_key, fallback) => fallback, []);
}

// Native no-op for the web `usePageTitle` (which set document.title). There is
// no document on native; the page header still renders the title.
function useNativePageTitle(_title: string): void {
  // Intentionally empty — see note above.
}

/* ================================================================== */
/*  Unit conversion (inlined from @/lib/unitConversion)               */
/* ================================================================== */

type DistanceUnitPref = 'km' | 'mi' | 'ft';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';

const METERS_PER_MILE = 1609.344;
const METERS_PER_KM = 1000;
const METERS_PER_FOOT = 0.3048;
const SECONDS_PER_HOUR = 3600;

// Convert distance from SI meters to the user's display unit.
function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
    case 'ft':
      return meters / METERS_PER_FOOT;
  }
}

// Convert speed from SI meters-per-second to the user's display unit.
function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

// Convert temperature from SI Celsius to the user's display unit.
function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

/* ================================================================== */
/*  useUnits swap (derive prefs from useSettings)                     */
/* ================================================================== */

interface UnitPrefs {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
}

// Mirror of `useUnits().unitPrefs` resolved from `useSettings()`: distance/speed
// follow `unit_of_length` ('mi' -> mi/mph, else km/km·h⁻¹) and temperature
// follows `unit_of_temp` ('F' -> °F, else °C). Web defaults apply when settings
// are absent.
function useNativeUnits(): {unitPrefs: UnitPrefs} {
  const {data: settings} = useSettings();
  return useMemo<{unitPrefs: UnitPrefs}>(() => {
    const distance: DistanceUnitPref =
      settings?.unit_of_length === 'mi' ? 'mi' : 'km';
    const speed: SpeedUnitPref =
      settings?.unit_of_length === 'mi' ? 'mph' : 'km/h';
    const temperature: TemperatureUnitPref =
      settings?.unit_of_temp === 'F' ? '°F' : '°C';
    return {unitPrefs: {distance, speed, temperature}};
  }, [settings]);
}

/* ================================================================== */
/*  Number + date formatting (inlined from @/lib/numberFormat,        */
/*  @/lib/dateFormat)                                                  */
/* ================================================================== */

// Safe number extraction — returns 0 for nullish/NaN (matches web safeNumber).
function safeNumber(v: unknown): number {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

// Locale-aware number formatter. The web default precision is the global
// `_globalPrecision` (2); native uses the same 2 default with 'en-US' for
// determinism (no settings-driven global precision surface here).
function fmtNumber(v: unknown, decimals = 2): string {
  try {
    return safeNumber(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return String(safeNumber(v));
  }
}

// Integer with locale separators (matches web fmtInt = fmtNumber(v, 0)).
function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// Date only: "Apr 4, 2026" (web formatDate). '—' for null/invalid input.
function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  try {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/* ================================================================== */
/*  Geo helpers (inlined from @/lib/geo)                              */
/* ================================================================== */

interface LatLngLike {
  latitude: number;
  longitude: number;
}

// Haversine — great-circle distance between two lat/lon points, in meters.
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MIN_MEANINGFUL_ROUTE_METERS = 10;

// True iff (lat,lng) is finite, non-zero, and within valid global bounds.
function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}

// True iff positions contains at least two valid coordinates separated by
// >= MIN_MEANINGFUL_ROUTE_METERS.
function hasMeaningfulRoute(positions: readonly LatLngLike[]): boolean {
  let anchorIdx = -1;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    if (isValidLatLng(p.latitude, p.longitude)) {
      anchorIdx = i;
      break;
    }
  }
  if (anchorIdx < 0) return false;
  const anchor = positions[anchorIdx];
  for (let i = anchorIdx + 1; i < positions.length; i++) {
    const p = positions[i];
    if (!isValidLatLng(p.latitude, p.longitude)) continue;
    const d = haversineDistance(
      anchor.latitude,
      anchor.longitude,
      p.latitude,
      p.longitude,
    );
    if (d >= MIN_MEANINGFUL_ROUTE_METERS) return true;
  }
  return false;
}

// Index of the first valid coordinate, or -1 if none.
function firstValidIndex(positions: readonly LatLngLike[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) return i;
  }
  return -1;
}

/* ================================================================== */
/*  Replay markers (inlined from features/driving/lib/replayMarkers)   */
/* ================================================================== */

type ReplayMarkerKind =
  | 'start'
  | 'stop'
  | 'charge-start'
  | 'charge-stop'
  | 'fast-segment'
  | 'regen-peak'
  | 'low-soc'
  | 'event';

interface ReplayMarker {
  at: number;
  kind: ReplayMarkerKind;
  label?: string;
  href?: string;
  count?: number;
}

const MIN_CHARGE_MS = 30_000;
const MIN_FAST_SEG_MS = 10_000;
const REGEN_THRESHOLD_KW = 0;
const LOW_SOC_PCT = 20;
const FAST_PERCENTILE = 0.95;
const REGEN_PEAK_PERCENTILE = 0.95;
const MAX_MARKERS = 25;
const CLUSTER_DISTANCE = 0.04;

function safePercentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (rank - lower) * (sorted[upper] - sorted[lower]);
}

function kindLabel(kind: ReplayMarkerKind): string {
  switch (kind) {
    case 'fast-segment':
      return 'fast segments';
    case 'regen-peak':
      return 'regen peaks';
    case 'charge-start':
      return 'charge starts';
    case 'charge-stop':
      return 'charge stops';
    case 'low-soc':
      return 'low SoC';
    default:
      return kind;
  }
}

function collapseBucket(
  bucket: ReplayMarker[],
  kind: ReplayMarkerKind,
): ReplayMarker {
  if (bucket.length === 1) return bucket[0];
  const midAt = bucket.reduce((sum, m) => sum + m.at, 0) / bucket.length;
  return {
    at: midAt,
    kind,
    count: bucket.length,
    label: `${bucket.length} ${kindLabel(kind)}`,
  };
}

function clusterAdjacent(
  markers: ReplayMarker[],
  kind: ReplayMarkerKind,
): ReplayMarker[] {
  const sameKind = markers
    .filter(m => m.kind === kind)
    .sort((a, b) => a.at - b.at);
  if (sameKind.length <= MAX_MARKERS) return sameKind;
  const clustered: ReplayMarker[] = [];
  let bucket: ReplayMarker[] = [];
  for (const m of sameKind) {
    if (
      bucket.length === 0 ||
      m.at - bucket[bucket.length - 1].at <= CLUSTER_DISTANCE
    ) {
      bucket.push(m);
    } else {
      clustered.push(collapseBucket(bucket, kind));
      bucket = [m];
    }
  }
  if (bucket.length > 0) clustered.push(collapseBucket(bucket, kind));
  return clustered;
}

// Compute timeline markers from a sequence of trip positions. Pure function.
function computeReplayMarkers(positions: DrivePosition[]): ReplayMarker[] {
  if (positions.length === 0) return [];

  const t0 = new Date(positions[0].timestamp).getTime();
  const tEnd = new Date(positions[positions.length - 1].timestamp).getTime();
  const totalMs = tEnd - t0;

  if (positions.length < 2 || totalMs <= 0) {
    const out: ReplayMarker[] = [{at: 0, kind: 'start', label: 'Start'}];
    if (positions.length > 1) out.push({at: 1, kind: 'stop', label: 'End'});
    return out;
  }

  const normalize = (i: number): number => {
    const t = new Date(positions[i].timestamp).getTime() - t0;
    if (!Number.isFinite(t) || totalMs === 0) return 0;
    return Math.max(0, Math.min(1, t / totalMs));
  };

  const markers: ReplayMarker[] = [
    {at: 0, kind: 'start', label: 'Start'},
    {at: 1, kind: 'stop', label: 'End'},
  ];

  let chargeStartIdx: number | null = null;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const isChargingNow = p.power != null && p.power < REGEN_THRESHOLD_KW;
    if (isChargingNow && chargeStartIdx === null) {
      chargeStartIdx = i;
    } else if (!isChargingNow && chargeStartIdx !== null) {
      const startTs = new Date(positions[chargeStartIdx].timestamp).getTime();
      const endTs = new Date(positions[i - 1].timestamp).getTime();
      if (endTs - startTs >= MIN_CHARGE_MS) {
        markers.push({
          at: normalize(chargeStartIdx),
          kind: 'charge-start',
          label: 'Charge start',
        });
        markers.push({
          at: normalize(i - 1),
          kind: 'charge-stop',
          label: 'Charge stop',
        });
      }
      chargeStartIdx = null;
    }
  }
  if (chargeStartIdx !== null) {
    const startTs = new Date(positions[chargeStartIdx].timestamp).getTime();
    const endTs = new Date(
      positions[positions.length - 1].timestamp,
    ).getTime();
    if (endTs - startTs >= MIN_CHARGE_MS) {
      markers.push({
        at: normalize(chargeStartIdx),
        kind: 'charge-start',
        label: 'Charge start',
      });
      markers.push({
        at: normalize(positions.length - 1),
        kind: 'charge-stop',
        label: 'Charge stop',
      });
    }
  }

  const speeds = positions.map(p => p.speed ?? 0).filter(s => s > 0);
  if (speeds.length > 0) {
    const fastThreshold = safePercentile(speeds, FAST_PERCENTILE);
    let fastStartIdx: number | null = null;
    const fastSegMidpoints: number[] = [];
    for (let i = 0; i < positions.length; i++) {
      const s = positions[i].speed ?? 0;
      const isFastNow = s > fastThreshold;
      if (isFastNow && fastStartIdx === null) {
        fastStartIdx = i;
      } else if (!isFastNow && fastStartIdx !== null) {
        const startTs = new Date(positions[fastStartIdx].timestamp).getTime();
        const endTs = new Date(positions[i - 1].timestamp).getTime();
        if (endTs - startTs >= MIN_FAST_SEG_MS) {
          fastSegMidpoints.push(
            (normalize(fastStartIdx) + normalize(i - 1)) / 2,
          );
        }
        fastStartIdx = null;
      }
    }
    if (fastStartIdx !== null) {
      const startTs = new Date(positions[fastStartIdx].timestamp).getTime();
      const endTs = new Date(
        positions[positions.length - 1].timestamp,
      ).getTime();
      if (endTs - startTs >= MIN_FAST_SEG_MS) {
        fastSegMidpoints.push(
          (normalize(fastStartIdx) + normalize(positions.length - 1)) / 2,
        );
      }
    }
    for (const mid of fastSegMidpoints) {
      markers.push({at: mid, kind: 'fast-segment', label: 'Fast segment'});
    }
  }

  const regenPowers = positions
    .map(p => p.power)
    .filter((pw): pw is number => pw != null && pw < REGEN_THRESHOLD_KW)
    .map(pw => -pw);
  if (regenPowers.length > 0) {
    const regenThreshold = safePercentile(regenPowers, REGEN_PEAK_PERCENTILE);
    for (let i = 0; i < positions.length; i++) {
      const pw = positions[i].power;
      if (pw != null && -pw >= regenThreshold && pw < REGEN_THRESHOLD_KW) {
        markers.push({at: normalize(i), kind: 'regen-peak', label: 'Regen peak'});
      }
    }
  }

  for (let i = 0; i < positions.length; i++) {
    const soc = positions[i].batteryLevel;
    if (soc != null && soc < LOW_SOC_PCT) {
      markers.push({
        at: normalize(i),
        kind: 'low-soc',
        label: `Battery <${LOW_SOC_PCT}%`,
      });
      break;
    }
  }

  const clusterKinds: ReplayMarkerKind[] = ['fast-segment', 'regen-peak'];
  const out: ReplayMarker[] = [];
  const handled = new Set<ReplayMarkerKind>();
  for (const k of clusterKinds) {
    out.push(...clusterAdjacent(markers, k));
    handled.add(k);
  }
  for (const m of markers) {
    if (!handled.has(m.kind)) out.push(m);
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

// Lookup the marker (if any) closest to a normalized playhead position.
function nearestMarker(
  markers: ReplayMarker[],
  at: number,
  tolerance = 0.02,
): ReplayMarker | null {
  let best: ReplayMarker | null = null;
  let bestDist = Infinity;
  for (const m of markers) {
    const d = Math.abs(m.at - at);
    if (d <= tolerance && d < bestDist) {
      best = m;
      bestDist = d;
    }
  }
  return best;
}

/* ================================================================== */
/*  useTripReplay (inlined from @/hooks/useTripReplay)                 */
/* ================================================================== */

type ReplaySpeed = 1 | 10 | 25 | 50 | 100;
const REPLAY_SPEEDS: readonly ReplaySpeed[] = [1, 10, 25, 50, 100] as const;

interface ReplayState {
  isPlaying: boolean;
  speed: ReplaySpeed;
  currentIndex: number;
  progress: number;
  currentPosition: DrivePosition | null;
  elapsedTime: number;
  totalTime: number;
}

interface ReplayControls {
  play: () => void;
  pause: () => void;
  stop: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
  setSpeedRelative: (delta: number) => void;
  seekTo: (index: number) => void;
  seekToProgress: (progress: number) => void;
  seekBy: (deltaSeconds: number) => void;
  stepFrame: (delta: number) => void;
}

// Parse position timestamps into ms-since-drive-start offsets.
function buildTimeline(positions: DrivePosition[]): number[] {
  if (positions.length === 0) return [];
  let t0 = NaN;
  for (const p of positions) {
    const t = new Date(p.timestamp).getTime();
    if (Number.isFinite(t)) {
      t0 = t;
      break;
    }
  }
  if (!Number.isFinite(t0)) return [];
  return positions.map(p => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) ? t - t0 : 0;
  });
}

// Binary-search for the index whose offset is closest to `target`.
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

const TICK_MS = 50;

function useTripReplay(
  positions: DrivePosition[],
): [ReplayState, ReplayControls] {
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);
  const [currentIndex, setCurrentIndex] = useState(0);

  const offsetsRef = useRef<number[]>([]);
  const totalTimeRef = useRef(0);

  useEffect(() => {
    const offsets = buildTimeline(positions);
    offsetsRef.current = offsets;
    totalTimeRef.current = offsets.length > 0 ? offsets[offsets.length - 1] : 0;
  }, [positions]);

  const elapsedRef = useRef(0);
  const speedRef = useRef<ReplaySpeed>(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const tick = useCallback(() => {
    const offsets = offsetsRef.current;
    const total = totalTimeRef.current;
    if (offsets.length === 0 || total === 0) return;

    elapsedRef.current += TICK_MS * speedRef.current;

    if (elapsedRef.current >= total) {
      elapsedRef.current = total;
      setCurrentIndex(offsets.length - 1);
      setIsPlaying(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setCurrentIndex(indexAtTime(offsets, elapsedRef.current));
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

  const play = useCallback(() => {
    const total = totalTimeRef.current;
    if (total > 0 && elapsedRef.current >= total) {
      elapsedRef.current = 0;
      setCurrentIndex(0);
    }
    setIsPlaying(true);
  }, []);

  const pause = useCallback(() => setIsPlaying(false), []);

  const stop = useCallback(() => {
    setIsPlaying(false);
    elapsedRef.current = 0;
    setCurrentIndex(0);
  }, []);

  const setSpeed = useCallback((s: ReplaySpeed) => {
    setSpeedState(s);
  }, []);

  const setSpeedRelative = useCallback((delta: number) => {
    setSpeedState(prev => {
      const idx = REPLAY_SPEEDS.indexOf(prev);
      const safeIdx = idx === -1 ? 0 : idx;
      const nextIdx = Math.max(
        0,
        Math.min(REPLAY_SPEEDS.length - 1, safeIdx + delta),
      );
      return REPLAY_SPEEDS[nextIdx];
    });
  }, []);

  const seekTo = useCallback((index: number) => {
    const offsets = offsetsRef.current;
    const clamped = Math.max(0, Math.min(index, offsets.length - 1));
    elapsedRef.current = offsets[clamped] ?? 0;
    setCurrentIndex(clamped);
  }, []);

  const seekToProgress = useCallback((progress: number) => {
    const total = totalTimeRef.current;
    const offsets = offsetsRef.current;
    const targetMs = Math.max(0, Math.min(1, progress)) * total;
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(offsets, targetMs));
  }, []);

  const seekBy = useCallback((deltaSeconds: number) => {
    const total = totalTimeRef.current;
    const offsets = offsetsRef.current;
    if (total <= 0 || offsets.length === 0) return;
    const targetMs = Math.max(
      0,
      Math.min(total, elapsedRef.current + deltaSeconds * 1000),
    );
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(offsets, targetMs));
  }, []);

  const stepFrame = useCallback((delta: number) => {
    const offsets = offsetsRef.current;
    if (offsets.length === 0) return;
    setCurrentIndex(prev => {
      const next = Math.max(0, Math.min(offsets.length - 1, prev + delta));
      elapsedRef.current = offsets[next] ?? 0;
      return next;
    });
  }, []);

  const totalTime = totalTimeRef.current;
  const progress = totalTime > 0 ? elapsedRef.current / totalTime : 0;
  const currentPosition = positions[currentIndex] ?? null;

  return [
    {
      isPlaying,
      speed,
      currentIndex,
      progress: Math.min(progress, 1),
      currentPosition,
      elapsedTime: elapsedRef.current,
      totalTime,
    },
    {
      play,
      pause,
      stop,
      setSpeed,
      setSpeedRelative,
      seekTo,
      seekToProgress,
      seekBy,
      stepFrame,
    },
  ];
}

/* ================================================================== */
/*  useMotionPreference swap (RN AccessibilityInfo)                   */
/* ================================================================== */

// Native equivalent of the framer-motion `prefers-reduced-motion` wrapper.
function useNativeMotionPreference(defaultMs = 250): {
  reduce: boolean;
  durationMs: number;
} {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => {
        if (mounted) setReduce(value);
      })
      .catch(() => {
        // No reduced-motion signal available — default to false.
      });
    const sub = AccessibilityInfo.addEventListener(
      'reduceMotionChanged',
      value => setReduce(value),
    );
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return {reduce, durationMs: reduce ? 0 : defaultMs};
}

/* ================================================================== */
/*  Page-local helpers (from source)                                  */
/* ================================================================== */

// Format ms duration as "HH:MM:SS" or "MM:SS". Non-finite/negative collapses
// to "00:00" so an upstream data bug surfaces as a placeholder.
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Format drive duration in minutes as "Xh Ym".
function fmtDriveTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Speed-bucket colour (from TripReplayMap.speedColor), used by the native map
// summary legend / current-position dot.
function speedColor(kmh: number): string {
  if (kmh < 30) return '#10b981';
  if (kmh < 60) return '#22d3ee';
  if (kmh < 100) return '#f59e0b';
  return '#ef4444';
}

// Initial-bearing between two positions (from TripReplayMap.computeHeading).
function computeHeading(p1: DrivePosition, p2: DrivePosition): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const dLon = toRad(p2.longitude - p1.longitude);
  const y = Math.sin(dLon) * Math.cos(toRad(p2.latitude));
  const x =
    Math.cos(toRad(p1.latitude)) * Math.sin(toRad(p2.latitude)) -
    Math.sin(toRad(p1.latitude)) *
      Math.cos(toRad(p2.latitude)) *
      Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Colour per replay-marker kind for the native scrubber ticks.
function markerColor(kind: ReplayMarkerKind): string {
  switch (kind) {
    case 'start':
      return '#10b981';
    case 'stop':
      return '#ef4444';
    case 'charge-start':
    case 'charge-stop':
      return '#22d3ee';
    case 'fast-segment':
      return '#f59e0b';
    case 'regen-peak':
      return '#34d399';
    case 'low-soc':
      return '#fb7185';
    default:
      return colors.textMuted;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/* ================================================================== */
/*  Shared prop types (mirror web data-display / charts)              */
/* ================================================================== */

interface TimelineMarker {
  at: number;
  kind: ReplayMarkerKind;
  label?: string;
  count?: number;
}

interface TimelinePreviewPoint {
  at: number;
  speed?: string;
  power?: string;
  soc?: string;
  elevation?: string;
}

interface TripReplayChartPoint {
  index: number;
  time: number;
  speed: number;
  power: number;
}

/* ================================================================== */
/*  PageContainer (native ScrollView layout)                          */
/* ================================================================== */

// `<PageContainer title subtitle loading error actions>` -> native scroll
// layout. `loading` shows a spinner; `error` shows the message; otherwise the
// children render (mirrors the web precedence). The web `breadcrumbLabels`
// drove a router breadcrumb trail that has no native analogue (omitted).
function PageContainer({
  title,
  subtitle,
  loading,
  error,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <AppText variant="display" weight="bold">
            {title}
          </AppText>
          {subtitle ? (
            <AppText tone="muted" style={styles.subtitle}>
              {subtitle}
            </AppText>
          ) : null}
        </View>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <AppText tone="danger">{error.message}</AppText>
        </View>
      ) : (
        <View style={styles.body}>{children}</View>
      )}
    </ScrollView>
  );
}

/* ================================================================== */
/*  Motion wrappers (framer-motion swap — static on native)           */
/* ================================================================== */

// FadeIn / StaggerContainer / StaggerItem replace framer-motion entrance
// animations; on native they render their children statically (the `delay`
// prop is accepted for API parity and ignored).
function FadeIn({
  children,
  style,
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={style}>{children}</View>;
}

function StaggerContainer({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.grid, style]}>{children}</View>;
}

function StaggerItem({children}: {children: ReactNode}) {
  return <View style={styles.gridItem}>{children}</View>;
}

/* ================================================================== */
/*  Stat / Metric cards (web data-display swap)                       */
/* ================================================================== */

function StatCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: SemanticIconName;
}) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statHead}>
        {icon ? <SemanticIcon name={icon} size="sm" decorative /> : null}
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <View style={styles.statValueRow}>
        <AppText variant="title" weight="bold" numberOfLines={1}>
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" tone="secondary" style={styles.statUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

function MetricCard({
  label,
  value,
  icon,
  highlighted,
  helpText,
}: {
  label: string;
  value: string;
  icon?: SemanticIconName;
  highlighted?: boolean;
  helpText?: string;
}) {
  return (
    <View
      accessibilityHint={helpText}
      style={[styles.metricCard, highlighted ? styles.metricCardActive : null]}>
      <View style={styles.statHead}>
        {icon ? <SemanticIcon name={icon} size="sm" decorative /> : null}
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <AppText variant="title" weight="bold" numberOfLines={1}>
        {value}
      </AppText>
    </View>
  );
}

/* ================================================================== */
/*  PlaybackControls (native scrubber)                                */
/* ================================================================== */

interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  progress: number;
  elapsed: string;
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  markers?: TimelineMarker[];
  getPreviewAt?: (normalized: number) => TimelinePreviewPoint | null;
  durationMs?: number;
  enableKeyboardShortcuts?: boolean;
  onSeekBy?: (deltaSeconds: number) => void;
  onSpeedRelative?: (delta: number) => void;
  onStepFrame?: (delta: number) => void;
  scrubberBackground?: ReactNode;
}

// Web `<PlaybackControls>` -> native scrubber: tap the track to seek
// (locationX / measured width), play/pause/stop + speed-cycle buttons, the
// step-frame / skip-10s controls (the web keyboard shortcuts are pointer/key
// only — here they are exposed as buttons), the speed Sparkline background, the
// timeline marker ticks, and a current-position preview (the web hover preview
// is pointer-only, so the preview is shown for the live progress instead).
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
  markers,
  getPreviewAt,
  onSeekBy,
  onStepFrame,
  scrubberBackground,
}: PlaybackControlsProps) {
  const [trackWidth, setTrackWidth] = useState(0);

  const onTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const onTrackPress = useCallback(
    (e: GestureResponderEvent) => {
      if (trackWidth <= 0) return;
      const x = e.nativeEvent.locationX;
      onSeek(clamp01(x / trackWidth));
    },
    [trackWidth, onSeek],
  );

  const cycleSpeed = useCallback(() => {
    const idx = REPLAY_SPEEDS.indexOf(speed);
    const safeIdx = idx === -1 ? 0 : idx;
    const next = REPLAY_SPEEDS[(safeIdx + 1) % REPLAY_SPEEDS.length];
    onSpeedChange(next);
  }, [speed, onSpeedChange]);

  const preview = getPreviewAt ? getPreviewAt(progress) : null;
  const progressPct = `${clamp01(progress) * 100}%` as DimensionValue;

  return (
    <GlassPanel style={styles.controls}>
      <View style={styles.controlRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
          onPress={isPlaying ? onPause : onPlay}
          style={styles.controlBtnPrimary}>
          <SemanticIcon name={isPlaying ? 'pause' : 'play'} size="sm" decorative />
          <AppText variant="caption" weight="semibold">
            {isPlaying ? 'Pause' : 'Play'}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Stop"
          onPress={onStop}
          style={styles.controlBtn}>
          <SemanticIcon name="stop" size="sm" decorative />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Playback speed ${speed}x`}
          onPress={cycleSpeed}
          style={styles.controlBtn}>
          <AppText variant="caption" weight="semibold" tone="accent">
            {speed}x
          </AppText>
        </Pressable>
        <View style={styles.timeBox}>
          <AppText variant="caption" tone="secondary">
            {elapsed} / {total}
          </AppText>
        </View>
      </View>

      <Pressable
        accessibilityRole="adjustable"
        accessibilityLabel="Replay position"
        onPress={onTrackPress}
        onLayout={onTrackLayout}
        style={styles.track}>
        {scrubberBackground ? (
          <View pointerEvents="none" style={styles.trackBackground}>
            {scrubberBackground}
          </View>
        ) : null}
        <View pointerEvents="none" style={styles.trackBase} />
        <View
          pointerEvents="none"
          style={[styles.trackFill, {width: progressPct}]}
        />
        {(markers ?? []).map((m, i) => (
          <View
            key={`${m.kind}-${i}`}
            pointerEvents="none"
            style={[
              styles.trackMarker,
              {
                left: `${clamp01(m.at) * 100}%` as DimensionValue,
                backgroundColor: markerColor(m.kind),
              },
            ]}
          />
        ))}
        <View
          pointerEvents="none"
          style={[styles.trackHandle, {left: progressPct}]}
        />
      </Pressable>

      <View style={styles.stepRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back 10 seconds"
          onPress={() => onSeekBy?.(-10)}
          style={styles.stepBtn}>
          <SemanticIcon name="skipBack" size="sm" decorative />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous frame"
          onPress={() => onStepFrame?.(-1)}
          style={styles.stepBtn}>
          <SemanticIcon name="previous" size="sm" decorative />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next frame"
          onPress={() => onStepFrame?.(1)}
          style={styles.stepBtn}>
          <SemanticIcon name="next" size="sm" decorative />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Forward 10 seconds"
          onPress={() => onSeekBy?.(10)}
          style={styles.stepBtn}>
          <SemanticIcon name="skipForward" size="sm" decorative />
        </Pressable>
      </View>

      {preview ? (
        <View style={styles.previewRow}>
          {preview.speed ? (
            <PreviewChip label="Speed" value={preview.speed} />
          ) : null}
          {preview.power ? (
            <PreviewChip label="Power" value={preview.power} />
          ) : null}
          {preview.soc ? <PreviewChip label="SoC" value={preview.soc} /> : null}
          {preview.elevation ? (
            <PreviewChip label="Elev" value={preview.elevation} />
          ) : null}
        </View>
      ) : null}
    </GlassPanel>
  );
}

function PreviewChip({label, value}: {label: string; value: string}) {
  return (
    <View style={styles.previewChip}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText variant="caption" weight="semibold">
        {value}
      </AppText>
    </View>
  );
}

/* ================================================================== */
/*  TripReplayMap (native-safe — Leaflet is DOM-only)                 */
/* ================================================================== */

interface TripReplayMapProps {
  positions: DrivePosition[];
  currentIndex: number;
  onSeekToIndex: (index: number) => void;
  reduceMotion?: boolean;
}

// The web map is built on Leaflet/react-leaflet (DOM + SVG tiles) and is not
// available in React Native without a native map dependency. This port keeps
// the web map's decision logic (hasMeaningfulRoute / firstValidIndex / stationary
// banner / empty state) and surfaces an explicit "interactive map unavailable"
// panel that still reports the route endpoints, the live playhead coordinate +
// heading + speed bucket, and jump-to-start/end seek affordances.
function TripReplayMap({
  positions,
  currentIndex,
  onSeekToIndex,
  reduceMotion = false,
}: TripReplayMapProps) {
  const hasRoute = useMemo(() => hasMeaningfulRoute(positions), [positions]);
  const anchorIdx = useMemo(() => firstValidIndex(positions), [positions]);
  const anchorPoint = anchorIdx >= 0 ? positions[anchorIdx] : undefined;
  const startPos = hasRoute ? positions[0] : undefined;
  const endPos =
    hasRoute && positions.length > 1
      ? positions[positions.length - 1]
      : undefined;
  const currentPosition = hasRoute ? positions[currentIndex] ?? null : null;
  const heading = useMemo(() => {
    if (!hasRoute || positions.length < 2) return 0;
    const next =
      currentIndex < positions.length - 1 ? currentIndex + 1 : currentIndex;
    const prev = next > 0 ? next - 1 : 0;
    return computeHeading(positions[prev], positions[next]);
  }, [currentIndex, positions, hasRoute]);

  if (positions.length === 0) {
    return (
      <GlassPanel style={styles.mapPanel}>
        <EmptyState
          title="Route"
          message="No position data available for this drive"
        />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel style={styles.mapPanel}>
      <View style={styles.mapHeader}>
        <View style={styles.mapHeaderText}>
          <AppText variant="caption" tone="secondary" weight="semibold">
            Route
          </AppText>
          <AppText variant="caption" tone="muted">
            Interactive map unavailable on native ·{' '}
            {reduceMotion ? 'snap playhead' : 'animated playhead'}
          </AppText>
        </View>
        <SemanticIcon name="mapPinned" size="sm" decorative />
      </View>

      {!hasRoute ? (
        <View style={styles.mapBanner} accessibilityRole="alert">
          <SemanticIcon name="navigationAlt" size="sm" decorative />
          <AppText variant="caption" tone="secondary" style={styles.mapBannerText}>
            Only one GPS coordinate was recorded for this drive, so the route
            can't be drawn. The trip statistics, speed, and elevation timeline
            below are unaffected.
          </AppText>
        </View>
      ) : null}

      {hasRoute ? (
        <View style={styles.mapBody}>
          <MapCoordRow
            color="#10b981"
            label="Start"
            position={startPos}
          />
          <MapCoordRow color="#ef4444" label="End" position={endPos} />
          {currentPosition ? (
            <MapCoordRow
              color={speedColor(currentPosition.speed ?? 0)}
              label={`Playhead · ${fmtInt(heading)}°`}
              position={currentPosition}
            />
          ) : null}
          <View style={styles.mapLegend}>
            <LegendDot color="#10b981" label="<30" />
            <LegendDot color="#22d3ee" label="30–60" />
            <LegendDot color="#f59e0b" label="60–100" />
            <LegendDot color="#ef4444" label="100+" />
          </View>
          <View style={styles.mapJumpRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to start"
              onPress={() => onSeekToIndex(0)}
              style={styles.controlBtn}>
              <AppText variant="caption" tone="secondary">
                Jump to start
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Jump to end"
              onPress={() => onSeekToIndex(positions.length - 1)}
              style={styles.controlBtn}>
              <AppText variant="caption" tone="secondary">
                Jump to end
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : anchorPoint ? (
        <View style={styles.mapBody}>
          <MapCoordRow color="#22d3ee" label="Recorded at" position={anchorPoint} />
        </View>
      ) : null}
    </GlassPanel>
  );
}

function MapCoordRow({
  color,
  label,
  position,
}: {
  color: string;
  label: string;
  position?: DrivePosition | null;
}) {
  return (
    <View style={styles.mapCoordRow}>
      <View style={[styles.mapDot, {backgroundColor: color}]} />
      <AppText variant="caption" tone="muted" style={styles.mapCoordLabel}>
        {label}
      </AppText>
      <AppText variant="caption" tone="secondary" numberOfLines={1}>
        {position
          ? `${fmtNumber(position.latitude, 4)}, ${fmtNumber(
              position.longitude,
              4,
            )}`
          : '—'}
      </AppText>
    </View>
  );
}

function LegendDot({color, label}: {color: string; label: string}) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.mapDot, {backgroundColor: color}]} />
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

/* ================================================================== */
/*  TripReplayCharts (native — Recharts cursor sync is DOM-only)      */
/* ================================================================== */

interface TripReplayChartsProps {
  data: TripReplayChartPoint[];
  currentIndex: number;
  speedUnit: string;
  onSeekToIndex: (index: number) => void;
  syncId?: string;
  height?: number;
}

interface ChartColumn {
  index: number;
  speed: number;
  power: number;
  time: number;
}

const CHART_COL_HEIGHT = 120;
const CHART_TARGET_COLUMNS = 60;
const SPEED_COLOR = '#00f0ff';
const POWER_COLOR = '#f59e0b';
const CHART_CURSOR_COLOR = '#00b4d8';

function downsampleColumns(data: TripReplayChartPoint[]): ChartColumn[] {
  if (data.length <= CHART_TARGET_COLUMNS) {
    return data.map(d => ({
      index: d.index,
      speed: d.speed,
      power: d.power,
      time: d.time,
    }));
  }
  const stride = data.length / CHART_TARGET_COLUMNS;
  const out: ChartColumn[] = [];
  for (let i = 0; i < CHART_TARGET_COLUMNS; i++) {
    const idx = Math.min(data.length - 1, Math.floor(i * stride));
    out.push({
      index: data[idx].index,
      speed: data[idx].speed,
      power: data[idx].power,
      time: data[idx].time,
    });
  }
  return out;
}

// Web `<TripReplayCharts>` (Recharts area chart + persistent cursor-sync store)
// -> native dual-series timeline: downsampled speed columns you tap to seek
// (the active column + a cursor line mark the playhead), a power Sparkline
// strip, a legend, and a live readout. The mousemove-driven cross-chart cursor
// sync is pointer-only and has no native analogue.
function TripReplayCharts({
  data,
  currentIndex,
  speedUnit,
  onSeekToIndex,
  height = 220,
}: TripReplayChartsProps) {
  const t = useNativeT();
  const columns = useMemo(() => downsampleColumns(data), [data]);
  const speedMax = useMemo(
    () => Math.max(1, ...columns.map(c => c.speed)),
    [columns],
  );
  const powerSeries = useMemo(() => columns.map(c => c.power), [columns]);

  const activeColumn = useMemo(() => {
    if (data.length === 0 || columns.length === 0) return -1;
    const ratio = data.length <= 1 ? 0 : currentIndex / (data.length - 1);
    return Math.min(columns.length - 1, Math.round(ratio * (columns.length - 1)));
  }, [currentIndex, data.length, columns.length]);

  const cursorLeft =
    columns.length > 1 && activeColumn >= 0
      ? (`${(activeColumn / (columns.length - 1)) * 100}%` as DimensionValue)
      : undefined;

  const current = data[currentIndex] ?? data[data.length - 1];

  if (data.length === 0) {
    return (
      <ChartContainer
        ariaLabel={t(
          'replay.timeline.aria',
          'Trip replay speed and power timeline area chart',
        )}
        height={height}
        subtitle={t('replay.timeline.subtitle', 'Tap to seek replay position')}
        title={t('replay.timeline.title', 'Speed & Power Timeline')}>
        <EmptyState
          title={t('replay.timeline.title', 'Speed & Power Timeline')}
          message={t('replay.timeline.noData', 'No telemetry data available')}
        />
      </ChartContainer>
    );
  }

  return (
    <ChartContainer
      ariaLabel={t(
        'replay.timeline.aria',
        'Trip replay speed and power timeline area chart',
      )}
      height={height}
      subtitle={t('replay.timeline.subtitle', 'Tap to seek replay position')}
      title={t('replay.timeline.title', 'Speed & Power Timeline')}>
      <View style={styles.timeline}>
        <View style={styles.timelineLegend}>
          <LegendDot color={SPEED_COLOR} label={`${t('replay.timeline.speed', 'Speed')} (${speedUnit})`} />
          <LegendDot color={POWER_COLOR} label={`${t('replay.timeline.power', 'Power')} (kW)`} />
        </View>

        <View style={styles.timelinePlot}>
          <View style={styles.timelineColumns}>
            {columns.map((col, i) => {
              const selected = i === activeColumn;
              const h = Math.max(2, (col.speed / speedMax) * CHART_COL_HEIGHT);
              return (
                <Pressable
                  key={`${col.index}-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${t(
                    'replay.timeline.speed',
                    'Speed',
                  )} ${fmtNumber(col.speed, 0)} ${speedUnit}`}
                  accessibilityState={{selected}}
                  onPress={() => onSeekToIndex(col.index)}
                  style={styles.timelineColumnTouch}>
                  <View
                    pointerEvents="none"
                    style={[
                      styles.timelineColumn,
                      {height: h},
                      selected ? styles.timelineColumnActive : null,
                    ]}
                  />
                </Pressable>
              );
            })}
          </View>
          {cursorLeft != null ? (
            <View
              pointerEvents="none"
              style={[styles.timelineCursor, {left: cursorLeft}]}
            />
          ) : null}
        </View>

        <View style={styles.timelinePowerStrip}>
          <AppText variant="caption" tone="muted">
            {t('replay.timeline.power', 'Power')} (kW)
          </AppText>
          {powerSeries.length > 1 ? (
            <Sparkline color={POWER_COLOR} data={powerSeries} height={28} width={320} />
          ) : null}
        </View>

        <View style={styles.timelineReadout}>
          <PreviewChip
            label={t('replay.timeline.speed', 'Speed')}
            value={`${fmtNumber(current?.speed ?? 0, 0)} ${speedUnit}`}
          />
          <PreviewChip
            label={t('replay.timeline.power', 'Power')}
            value={`${fmtNumber(current?.power ?? 0, 1)} kW`}
          />
          <PreviewChip label="t" value={`${fmtNumber(current?.time ?? 0, 0)}m`} />
        </View>
      </View>
    </ChartContainer>
  );
}

/* ================================================================== */
/*  Page Component                                                     */
/* ================================================================== */

export interface TripReplayPageProps {
  /** Route `:id` param. The web read this via react-router useParams. */
  id?: string;
  /** react-router `<Link>` / navigation sink. Native hosts wire routing. */
  onNavigate?: (to: string) => void;
  /**
   * Restore source for the web `?at=&play=` deep-link (there is no URL on
   * native). `at` is the normalized [0,1] progress; `play` auto-starts replay.
   */
  initialReplayParams?: {at?: number; play?: boolean};
  /**
   * Debounced (300ms) persist sink mirroring the web `setSearchParams` writer.
   * Receives `at` (only when 0<progress<1) and `play` (only while playing).
   */
  onReplayParamsChange?: (params: {at?: number; play?: boolean}) => void;
}

/**
 * TripReplayPage with map ↔ chart ↔ scrubber cursor sync.
 *
 * The page owns the rendered surfaces (map, scrubber, speed+power chart,
 * elevation) and threads a single source of truth — `replay.currentIndex` from
 * `useTripReplay` — through all of them via the shared `handleSeekToIndex`
 * callback. Position-derived fields (speed, outsideTemp, ratedRange, cumulative
 * haversine distance) are SI canonical and go through `convertXFromSI`.
 */
export default function TripReplayPage({
  id,
  onNavigate,
  initialReplayParams,
  onReplayParamsChange,
}: TripReplayPageProps = {}) {
  const t = useNativeT();
  useNativePageTitle(t('replay.title', 'Trip Replay'));

  const {data: drive, isLoading, error} = useDrive(id ?? '');
  const {reduce} = useNativeMotionPreference();

  // Display preferences for position-derived SI fields.
  const {unitPrefs} = useNativeUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  /* ---- Normalize positions ---- */
  // The /drives/{id} positions array carries only lat/lon/heading/speed; power,
  // battery, elevation, range, temperature live on the parallel telemetry
  // array. Build a sorted index of telemetry by timestamp so we can join each
  // position to its nearest-by-ts telemetry row in O(log n).
  const telemetryByTs = useMemo(() => {
    if (!drive) return [] as Array<{ts: number; row: Record<string, unknown>}>;
    const tel =
      (drive as unknown as {telemetry?: Array<Record<string, unknown>>})
        .telemetry ?? [];
    return tel
      .map(row => {
        const tsStr =
          (row.created_at as string) ??
          (row.createdAt as string) ??
          (row.timestamp as string) ??
          '';
        const ts = tsStr ? new Date(tsStr).getTime() : NaN;
        return {ts, row};
      })
      .filter(x => Number.isFinite(x.ts))
      .sort((a, b) => a.ts - b.ts);
  }, [drive]);

  const nearestTelemetry = useCallback(
    (positionTs: number): Record<string, unknown> | null => {
      if (telemetryByTs.length === 0 || !Number.isFinite(positionTs)) {
        return null;
      }
      let lo = 0;
      let hi = telemetryByTs.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (telemetryByTs[mid].ts < positionTs) lo = mid + 1;
        else hi = mid;
      }
      if (
        lo > 0 &&
        Math.abs(telemetryByTs[lo - 1].ts - positionTs) <
          Math.abs(telemetryByTs[lo].ts - positionTs)
      ) {
        return telemetryByTs[lo - 1].row;
      }
      return telemetryByTs[lo].row;
    },
    [telemetryByTs],
  );

  const positions: DrivePosition[] = useMemo(() => {
    if (!drive) return [];
    const pos = drive.positions ?? [];
    return pos
      .map((raw: unknown) => {
        const p = raw as Record<string, unknown>;
        const tsStr =
          (p.timestamp as string) ??
          (p.created_at as string) ??
          (p.createdAt as string) ??
          '';
        const positionTs = tsStr ? new Date(tsStr).getTime() : NaN;
        const tel = nearestTelemetry(positionTs) ?? {};
        const pick = <V,>(k: string, snake?: string): V | null => {
          const fromPos =
            (p[k] as V | null | undefined) ??
            (snake ? (p[snake] as V | null | undefined) : undefined);
          if (fromPos !== undefined && fromPos !== null) return fromPos as V;
          const fromTel =
            (tel[k] as V | null | undefined) ??
            (snake ? (tel[snake] as V | null | undefined) : undefined);
          return (fromTel ?? null) as V | null;
        };
        return {
          latitude: (p.latitude as number) ?? 0,
          longitude: (p.longitude as number) ?? 0,
          speed: (p.speed as number | null) ?? (tel.speed as number | null) ?? null,
          power: pick<number>('power'),
          batteryLevel: pick<number>('batteryLevel', 'battery_level') ?? 0,
          timestamp: tsStr,
          elevation: pick<number>('elevation'),
          insideTemp: pick<number>('insideTemp', 'inside_temp'),
          outsideTemp: pick<number>('outsideTemp', 'outside_temp'),
          idealRange: pick<number>('idealRange', 'ideal_range'),
          ratedRange: pick<number>('ratedRange', 'rated_range'),
          odometer: pick<number>('odometer'),
          fanStatus: pick<number>('fanStatus', 'fan_status'),
          isClimateOn: (p.isClimateOn ??
            p.is_climate_on ??
            tel.isClimateOn ??
            tel.is_climate_on) as DrivePosition['isClimateOn'],
        } as DrivePosition;
      })
      .filter(p => p.latitude !== 0 || p.longitude !== 0);
  }, [drive, nearestTelemetry]);

  /* ---- Replay hook ---- */
  const [replay, controls] = useTripReplay(positions);

  /* ---- Single source of truth for "where on the trip are we?" ---- */
  const handleSeekToIndex = useCallback(
    (idx: number) => {
      controls.seekTo(idx);
    },
    [controls],
  );

  /* ---- Timeline markers ---- */
  const replayMarkers: ReplayMarker[] = useMemo(
    () => computeReplayMarkers(positions),
    [positions],
  );
  const scrubberMarkers: TimelineMarker[] = useMemo(
    () =>
      replayMarkers.map(m => ({
        at: m.at,
        kind: m.kind,
        label: m.label,
        count: m.count,
      })),
    [replayMarkers],
  );

  /* ---- Deep-linking: initialReplayParams.at / .play (debounced 300ms) ---- */
  // The web persisted `?at=&play=` to the URL via useSearchParams; native has no
  // URL, so restore reads `initialReplayParams` and persist calls
  // `onReplayParamsChange`. The restore-once + debounce semantics are preserved.
  const restoredRef = useRef(false);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (restoredRef.current) return;
    if (positions.length === 0) return;
    restoredRef.current = true;
    const at = initialReplayParams?.at;
    const play = initialReplayParams?.play;
    if (at != null) {
      if (Number.isFinite(at) && at >= 0 && at <= 1) {
        controls.seekToProgress(at);
      }
    }
    if (play === true) {
      controls.play();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positions.length]);

  useEffect(() => {
    if (!restoredRef.current) return;
    if (positions.length === 0) return;
    if (!onReplayParamsChange) return;
    if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    const snapshotProgress = replay.progress;
    const snapshotPlaying = replay.isPlaying;
    writeTimerRef.current = setTimeout(() => {
      onReplayParamsChange({
        at:
          snapshotProgress > 0 && snapshotProgress < 1
            ? Number(snapshotProgress.toFixed(3))
            : undefined,
        play: snapshotPlaying ? true : undefined,
      });
    }, 300);
    return () => {
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
    };
  }, [replay.progress, replay.isPlaying, positions.length, onReplayParamsChange]);

  /* ---- Elevation profile data ---- */
  // cumDist is meters from haversineDistance; convert raw meters with
  // convertDistanceFromSI (avoids the legacy km-into-miles helper bug).
  const elevationData: ElevationDataPoint[] = useMemo(() => {
    let cumDistMeters = 0;
    return positions.map((p, i) => {
      if (i > 0) {
        cumDistMeters += haversineDistance(
          positions[i - 1].latitude,
          positions[i - 1].longitude,
          p.latitude,
          p.longitude,
        );
      }
      return {
        index: i,
        distance: Number(
          convertDistanceFromSI(cumDistMeters, unitPrefs.distance).toFixed(2),
        ),
        elevation: p.elevation ?? 0,
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : 0,
      };
    });
  }, [positions, unitPrefs.distance, unitPrefs.speed]);

  /* ---- Speed + Power timeline data ---- */
  const timelineData: TripReplayChartPoint[] = useMemo(() => {
    if (positions.length === 0) return [];
    const t0 = new Date(positions[0].timestamp).getTime();
    return positions.map((p, i) => {
      const elapsedMin = (new Date(p.timestamp).getTime() - t0) / 60_000;
      return {
        index: i,
        time: Number(elapsedMin.toFixed(3)),
        speed: p.speed != null ? convertSpeedFromSI(p.speed, unitPrefs.speed) : 0,
        power: p.power ?? 0,
      };
    });
  }, [positions, unitPrefs.speed]);

  /* ---- Hover preview sampler for the scrubber ---- */
  const getPreviewAt = useCallback(
    (normalized: number): TimelinePreviewPoint | null => {
      if (positions.length === 0 || replay.totalTime <= 0) return null;
      const t0 = new Date(positions[0].timestamp).getTime();
      const targetMs = Math.max(0, Math.min(1, normalized)) * replay.totalTime;
      let lo = 0;
      let hi = positions.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        const tt = new Date(positions[mid].timestamp).getTime() - t0;
        if (tt < targetMs) lo = mid + 1;
        else hi = mid;
      }
      const p = positions[lo];
      if (!p) return null;
      return {
        at: normalized,
        speed:
          p.speed != null
            ? `${fmtNumber(convertSpeedFromSI(p.speed, unitPrefs.speed))} ${
                unitPrefs.speed
              }`
            : undefined,
        power: p.power != null ? `${fmtNumber(p.power, 1)} kW` : undefined,
        soc: `${fmtInt(p.batteryLevel)}%`,
        elevation: p.elevation != null ? `${fmtInt(p.elevation)} m` : undefined,
      };
    },
    [positions, replay.totalTime, unitPrefs.speed],
  );

  /* ---- Speed sparkline behind the scrubber ---- */
  const speedSparkData = useMemo(() => {
    if (positions.length === 0) return [] as number[];
    const target = 80;
    if (positions.length <= target) {
      return positions.map(p => p.speed ?? 0);
    }
    const stride = positions.length / target;
    const out: number[] = [];
    for (let i = 0; i < target; i++) {
      const idx = Math.min(positions.length - 1, Math.floor(i * stride));
      out.push(positions[idx].speed ?? 0);
    }
    return out;
  }, [positions]);

  /* ---- Stat-card highlight: which marker is the playhead "on"? ---- */
  const activeMarker = useMemo(
    () => nearestMarker(replayMarkers, replay.progress, 0.02),
    [replayMarkers, replay.progress],
  );

  const cardHighlight = useCallback(
    (kinds: ReplayMarkerKind[]): boolean => {
      if (!activeMarker) return false;
      return kinds.includes(activeMarker.kind);
    },
    [activeMarker],
  );

  /* ---- Current stat values ---- */
  const cp = replay.currentPosition;

  /* ---- Drive summary stats ---- */
  const distanceM = drive?.distanceM ?? 0;
  const durationS = drive?.durationS ?? 0;
  const distanceUserUnit = convertDistanceFromSI(distanceM, distanceUnit);
  const efficiency =
    distanceM > 0 &&
    drive?.startBatteryPct != null &&
    drive?.endBatteryPct != null
      ? ((drive.startBatteryPct - drive.endBatteryPct) / distanceUserUnit) * 1000
      : null;

  const normalizedError =
    error instanceof Error
      ? error
      : error
      ? new Error(String(error))
      : null;

  const subtitle = drive
    ? `${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(
        drive.startTs,
      )}${
        drive.startAddress && drive.endAddress
          ? ` · ${drive.startAddress} → ${drive.endAddress}`
          : ''
      }`
    : undefined;

  return (
    <PageContainer
      title={t('replay.title', 'Trip Replay')}
      subtitle={subtitle}
      loading={isLoading}
      error={normalizedError}
      actions={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('replay.backToDrive', 'Back to Drive')}
          onPress={() => onNavigate?.(`/drives/${id}`)}
          style={styles.controlBtn}>
          <SemanticIcon name="back" size="sm" decorative />
          <AppText variant="caption" tone="secondary">
            {t('replay.backToDrive', 'Back to Drive')}
          </AppText>
        </Pressable>
      }>
      {positions.length === 0 && !isLoading ? (
        <FadeIn>
          <GlassPanel style={styles.emptyPanel}>
            <EmptyState
              title={t('replay.title', 'Trip Replay')}
              message={t(
                'replay.noGps',
                'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.',
              )}
            />
          </GlassPanel>
        </FadeIn>
      ) : (
        <>
          {/* Section 1 — Map */}
          <FadeIn>
            <TripReplayMap
              positions={positions}
              currentIndex={replay.currentIndex}
              onSeekToIndex={handleSeekToIndex}
              reduceMotion={reduce}
            />
          </FadeIn>

          {/* Section 2 — Playback Controls */}
          <FadeIn delay={0.05}>
            <PlaybackControls
              isPlaying={replay.isPlaying}
              speed={replay.speed}
              progress={replay.progress}
              elapsed={fmtDuration(replay.elapsedTime)}
              total={fmtDuration(replay.totalTime)}
              onPlay={controls.play}
              onPause={controls.pause}
              onStop={controls.stop}
              onSpeedChange={controls.setSpeed}
              onSeek={controls.seekToProgress}
              markers={scrubberMarkers}
              getPreviewAt={getPreviewAt}
              durationMs={replay.totalTime}
              enableKeyboardShortcuts
              onSeekBy={controls.seekBy}
              onSpeedRelative={controls.setSpeedRelative}
              onStepFrame={controls.stepFrame}
              scrubberBackground={
                speedSparkData.length > 1 ? (
                  <Sparkline data={speedSparkData} color="#22d3ee" height={24} width={400} />
                ) : undefined
              }
            />
          </FadeIn>

          {/* Section 3 — Current Stats Bar */}
          <FadeIn delay={0.1}>
            <GlassPanel style={styles.section}>
              <AppText
                variant="caption"
                tone="secondary"
                weight="semibold"
                style={styles.sectionTitle}>
                {t('replay.currentStats', 'Current Position Stats')}
              </AppText>
              <View style={styles.metricGrid}>
                <MetricCard
                  label={t('replay.stat.speed', 'Speed')}
                  value={
                    cp?.speed != null
                      ? `${fmtNumber(
                          convertSpeedFromSI(cp.speed, unitPrefs.speed),
                        )} ${unitPrefs.speed}`
                      : '—'
                  }
                  icon="speed"
                  highlighted={cardHighlight(['fast-segment'])}
                />
                <MetricCard
                  label={t('replay.stat.power', 'Power')}
                  value={cp?.power != null ? `${fmtNumber(cp.power, 1)} kW` : '—'}
                  icon="bolt"
                  highlighted={cardHighlight([
                    'regen-peak',
                    'charge-start',
                    'charge-stop',
                  ])}
                  helpText={t(
                    'help.replay.power',
                    'Instantaneous battery power at this point on the trip. Negative values indicate regenerative braking (energy flowing back into the pack); positive values indicate motor draw.',
                  )}
                />
                <MetricCard
                  label={t('replay.stat.battery', 'Battery')}
                  value={cp ? `${fmtInt(cp.batteryLevel)}%` : '—'}
                  icon="battery"
                  highlighted={cardHighlight([
                    'low-soc',
                    'charge-start',
                    'charge-stop',
                  ])}
                  helpText={t(
                    'help.replay.battery',
                    'State-of-charge percentage at this point. Drops indicate energy use; rises indicate regen or DC-fast-charging during a drive.',
                  )}
                />
                <MetricCard
                  label={t('replay.stat.elevation', 'Elevation')}
                  value={cp?.elevation != null ? `${fmtInt(cp.elevation)} m` : '—'}
                  icon="trends"
                />
                <MetricCard
                  label={t('replay.stat.range', 'Range')}
                  value={
                    cp?.ratedRange != null
                      ? `${fmtNumber(
                          convertDistanceFromSI(cp.ratedRange, unitPrefs.distance),
                        )} ${unitPrefs.distance}`
                      : '—'
                  }
                  icon="navigation"
                  helpText={t(
                    'help.replay.range',
                    'Estimated rated range remaining at this position based on EPA rated efficiency. Differs from real-world range, which depends on speed, terrain, climate, and load.',
                  )}
                />
                <MetricCard
                  label={t('replay.stat.temp', 'Temperature')}
                  value={
                    cp?.outsideTemp != null
                      ? `${fmtNumber(
                          convertTempFromSI(cp.outsideTemp, unitPrefs.temperature),
                        )} ${unitPrefs.temperature}`
                      : '—'
                  }
                  icon="climate"
                />
              </View>
            </GlassPanel>
          </FadeIn>

          {/* Section 4 — Elevation Profile */}
          <FadeIn delay={0.15}>
            <ElevationProfile
              data={elevationData}
              currentIndex={replay.currentIndex}
              onClickIndex={handleSeekToIndex}
              height={200}
              distanceUnit={unitPrefs.distance}
            />
          </FadeIn>

          {/* Section 5 — Speed + Power Timeline */}
          <FadeIn delay={0.2}>
            <TripReplayCharts
              data={timelineData}
              currentIndex={replay.currentIndex}
              speedUnit={unitPrefs.speed}
              onSeekToIndex={handleSeekToIndex}
            />
          </FadeIn>

          {/* Section 6 — Drive Summary */}
          <FadeIn delay={0.25}>
            <GlassPanel style={styles.section}>
              <AppText
                variant="caption"
                tone="secondary"
                weight="semibold"
                style={styles.sectionTitle}>
                {t('replay.summary.title', 'Drive Summary')}
              </AppText>
              <StaggerContainer>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.distance', 'Distance')}
                    value={fmtNumber(distanceUserUnit)}
                    unit={distanceUnit}
                    icon="trip"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.duration', 'Duration')}
                    value={fmtDriveTime(durationS / 60)}
                    icon="clock"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.efficiency', 'Efficiency')}
                    value={efficiency != null ? fmtNumber(efficiency) : '—'}
                    unit={efficiency != null ? 'Wh/km' : undefined}
                    icon="efficiency"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.elevGain', 'Elevation Gain')}
                    value={'—'}
                    icon="arrowUp"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.elevLoss', 'Elevation Loss')}
                    value={'—'}
                    icon="arrowDown"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.maxSpeed', 'Max Speed')}
                    value={
                      drive?.maxSpeedMps != null
                        ? fmtNumber(
                            convertSpeedFromSI(drive.maxSpeedMps, speedUnit),
                          )
                        : '—'
                    }
                    unit={drive?.maxSpeedMps != null ? speedUnit : undefined}
                    icon="speed"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.avgSpeed', 'Avg Speed')}
                    value={
                      drive?.avgSpeedMps != null
                        ? fmtNumber(
                            convertSpeedFromSI(drive.avgSpeedMps, speedUnit),
                          )
                        : '—'
                    }
                    unit={drive?.avgSpeedMps != null ? speedUnit : undefined}
                    icon="speed"
                  />
                </StaggerItem>
                <StaggerItem>
                  <StatCard
                    label={t('replay.summary.battery', 'Battery')}
                    value={
                      drive?.startBatteryPct != null &&
                      drive?.endBatteryPct != null
                        ? `${fmtInt(drive.startBatteryPct)}% → ${fmtInt(
                            drive.endBatteryPct,
                          )}%`
                        : '—'
                    }
                    icon="battery"
                  />
                </StaggerItem>
              </StaggerContainer>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}

/* ================================================================== */
/*  Styles                                                             */
/* ================================================================== */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  screenContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  headerText: {
    flexShrink: 1,
    gap: spacing.xs,
  },
  subtitle: {
    marginTop: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  body: {
    gap: spacing.lg,
  },
  loadingBox: {
    paddingVertical: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorBox: {
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
    borderRadius: 12,
    padding: spacing.md,
  },
  emptyPanel: {
    padding: spacing.xl,
  },
  section: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  sectionTitle: {
    marginBottom: spacing.xs,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  gridItem: {
    flexGrow: 1,
    flexBasis: '47%',
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.xs,
  },
  statUnit: {
    marginLeft: 2,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 96,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metricCardActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  controls: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  controlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  controlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  controlBtnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  timeBox: {
    marginLeft: 'auto',
  },
  track: {
    height: 40,
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: 12,
  },
  trackBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.5,
    justifyContent: 'center',
  },
  trackBase: {
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.surfaceRaised,
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    height: 6,
    borderRadius: 999,
    backgroundColor: colors.accent,
  },
  trackMarker: {
    position: 'absolute',
    top: 6,
    width: 2,
    height: 12,
    borderRadius: 1,
  },
  trackHandle: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    marginLeft: -6,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.background,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  stepBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  previewRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  previewChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
  },
  mapPanel: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  mapHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  mapHeaderText: {
    flexShrink: 1,
    gap: 2,
  },
  mapBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
    borderRadius: 12,
    padding: spacing.md,
  },
  mapBannerText: {
    flexShrink: 1,
  },
  mapBody: {
    gap: spacing.sm,
  },
  mapCoordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  mapCoordLabel: {
    width: 96,
  },
  mapDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  mapLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  mapJumpRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  timeline: {
    gap: spacing.sm,
    width: '100%',
  },
  timelineLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  timelinePlot: {
    height: CHART_COL_HEIGHT,
    position: 'relative',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    overflow: 'hidden',
  },
  timelineColumns: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 1,
    paddingHorizontal: 2,
  },
  timelineColumnTouch: {
    flex: 1,
    justifyContent: 'flex-end',
    minWidth: 2,
    height: '100%',
  },
  timelineColumn: {
    width: '100%',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    backgroundColor: 'rgba(0, 240, 255, 0.34)',
    borderTopWidth: 2,
    borderTopColor: SPEED_COLOR,
  },
  timelineColumnActive: {
    backgroundColor: 'rgba(0, 180, 216, 0.4)',
    borderTopColor: CHART_CURSOR_COLOR,
  },
  timelineCursor: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: CHART_CURSOR_COLOR,
    opacity: 0.92,
  },
  timelinePowerStrip: {
    gap: spacing.xs,
  },
  timelineReadout: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});




