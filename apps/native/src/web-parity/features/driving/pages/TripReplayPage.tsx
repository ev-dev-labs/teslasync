// TripReplayPage — native parity port for
// web/src/features/driving/pages/TripReplayPage.tsx.
//
// The web source (13 lines) is a *relocation re-export shim*:
//
//   export { default } from '@/features/trips/pages/TripReplayPage';
//
// i.e. the full TripReplayPage implementation lives at
// web/src/features/trips/pages/TripReplayPage.tsx (605 lines) plus its two
// sub-components TripReplayMap.tsx (Leaflet, 311 lines) and
// TripReplayCharts.tsx (Recharts, 264 lines); the driving-path module is a
// thin re-export so legacy import paths keep working.
//
// In the native parity tree the conversion manifest tracks ONLY this driving
// path as the canonical TripReplayPage (features/trips/pages/TripReplayPage is
// not a manifest entry and has no native target). A native re-export pointing
// at a non-existent trips module would fail typecheck, and a stub would
// violate the no-shortcut rule. So the relocated implementation is inlined
// here as a single self-contained native screen — exactly the established
// self-contained convention used by DrivesListPage.tsx (which inlines its
// unconverted lib/component siblings and imports only already-converted ones).
//
// Behaviour / state names / API paths / SI unit handling / i18n intent are
// preserved from the relocated source: useDrive(id) -> GET /drives/{id};
// position+telemetry nearest-timestamp merge; the time-based useTripReplay
// virtual-clock (1/10/25/50/100x, seekTo/seekToProgress/seekBy/stepFrame);
// computeReplayMarkers / nearestMarker timeline markers; the six current-stat
// MetricCards (speed/power/battery/elevation/range/temp); the elevation
// profile; the speed+power timeline; and the eight-tile drive summary. All
// position-derived SI fields convert at the render edge via convertXFromSI +
// useUnits (read from native useSettings).
//
// Native adaptations (rule 7 — browser-only behaviour replaced, documented):
//   - react-router useParams/Link/useSearchParams -> no RN router: the drive
//     id comes from an optional `driveId` prop, else falls back to the most
//     recent drive for the first vehicle; the ?at=/?play= URL deep-link
//     restore/persist effects and the "Back to Drive" Link are dropped.
//   - react-i18next useTranslation -> native-safe t(key, fallback) with
//     {{var}} interpolation.
//   - lucide-react icons -> text/emoji glyphs.
//   - @/components/maps Leaflet TripReplayMap -> native-safe route minimap
//     (normalised lat/lon scatter coloured by speed, start/end/playhead
//     markers, tap-to-seek, stationary-GPS banner) — there is no map library
//     in apps/native, so the interactive tile map is explicitly unavailable.
//   - @/components/charts Recharts TripReplayCharts -> native-safe speed+power
//     timeline (height-scaled bars + playhead line + tap-to-seek); the shared
//     Sparkline + ElevationProfile native charts are imported directly.
//   - @/components/data-display PlaybackControls -> native PlaybackControls
//     (play/pause/stop, speed cycle, step ±1 frame, tap-to-seek track with
//     marker ticks + speed sparkline background); hover preview + keyboard
//     shortcuts are touch-unavailable and dropped.
//   - @/components/ui GlassPanel/Button + @/components/layout PageContainer +
//     @/components/motion FadeIn/Stagger -> canonical AppText/GlassPanel +
//     inline PageContainer + passthrough motion Views.
//   - useMotionPreference -> AccessibilityInfo.isReduceMotionEnabled.
//   - lib geo/unitConversion/numberFormat/dateFormat + the replay hook and
//     marker helpers -> ported inline (SI in, convert at edge).
//
// No DOM / Recharts / Leaflet / react-router / react-i18next / framer-motion /
// lucide import reaches the native output — only react, react-native
// primitives, the canonical AppText/GlassPanel + theme tokens, the already
// converted Sparkline/ElevationProfile native charts, and the native
// driving/settings/vehicles hooks.

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
} from 'react-native';

import {AppText} from '../../../../components/ui/AppText';
import {GlassPanel} from '../../../../components/ui/GlassPanel';
import {EmptyState} from '../../../../components/feedback/EmptyState';
import {colors, spacing} from '../../../../theme/tokens';
import {ElevationProfile} from '../../../components/charts/ElevationProfile';
import type {ElevationDataPoint} from '../../../components/charts/ElevationProfile';
import {Sparkline} from '../../../components/charts/Sparkline';
import {
  useDrive,
  useDrives,
  type DrivePosition,
} from '../../../api/hooks/useDriving';
import {useSettings} from '../../../api/hooks/useSettings';
import {useVehicles} from '../../../api/hooks/useVehicles';

// ---- Native-safe i18n fallback (web react-i18next useTranslation) -----------

type InterpolationValues = Record<string, string | number>;
type NativeTFunction = (
  key: string,
  fallback: string,
  options?: InterpolationValues,
) => string;

function interpolate(template: string, values: InterpolationValues): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined ? '' : String(value);
  });
}

function useTranslation(): {t: NativeTFunction} {
  const t = useCallback<NativeTFunction>(
    (_key, fallback, options) =>
      options ? interpolate(fallback, options) : fallback,
    [],
  );
  return {t};
}

// ---- Native-safe usePageTitle (web @/hooks/usePageTitle) --------------------

function usePageTitle(title: string): void {
  useEffect(() => {
    // React Native has no document.title to write; no-op. The dependency
    // mirrors the web hook so the effect re-runs when the title changes.
  }, [title]);
}

// ---- Native-safe useMotionPreference (web @/hooks/useMotionPreference) ------

function useMotionPreference(): {reduce: boolean} {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then(value => {
      if (mounted) {
        setReduce(value);
      }
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
  return {reduce};
}

// ---- unitConversion (web @/lib/unitConversion, SI -> display) ---------------

type DistanceUnitPref = 'km' | 'mi';
type SpeedUnitPref = 'km/h' | 'mph';
type TemperatureUnitPref = '°C' | '°F';

interface UnitPrefsLite {
  distance: DistanceUnitPref;
  speed: SpeedUnitPref;
  temperature: TemperatureUnitPref;
}

const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;

function convertDistanceFromSI(meters: number, to: DistanceUnitPref): number {
  switch (to) {
    case 'km':
      return meters / METERS_PER_KM;
    case 'mi':
      return meters / METERS_PER_MILE;
  }
}

function convertSpeedFromSI(mps: number, to: SpeedUnitPref): number {
  switch (to) {
    case 'km/h':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_KM;
    case 'mph':
      return (mps * SECONDS_PER_HOUR) / METERS_PER_MILE;
  }
}

function convertTempFromSI(celsius: number, to: TemperatureUnitPref): number {
  switch (to) {
    case '°C':
      return celsius;
    case '°F':
      return (celsius * 9) / 5 + 32;
  }
}

function useUnits(): {unitPrefs: UnitPrefsLite} {
  const {data} = useSettings();
  const distance: DistanceUnitPref = data?.unit_of_length === 'mi' ? 'mi' : 'km';
  const speed: SpeedUnitPref = data?.unit_of_length === 'mi' ? 'mph' : 'km/h';
  const temperature: TemperatureUnitPref =
    data?.unit_of_temp === 'F' ? '°F' : '°C';
  const unitPrefs = useMemo<UnitPrefsLite>(
    () => ({distance, speed, temperature}),
    [distance, speed, temperature],
  );
  return {unitPrefs};
}

// ---- numberFormat (web @/lib/numberFormat) ----------------------------------

function safeNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtNumber(v: unknown, decimals = 1): string {
  const n = safeNumber(v);
  try {
    return n.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  } catch {
    return n.toFixed(decimals);
  }
}

function fmtInt(v: unknown): string {
  return fmtNumber(v, 0);
}

// ---- dateFormat (web @/lib/dateFormat) --------------------------------------

function formatDate(iso: string | null | undefined): string {
  if (!iso) {
    return '—';
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return '—';
  }
  try {
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return d.toDateString();
  }
}

// ---- page helpers (web TripReplayPage fmtDuration / fmtDriveTime) -----------

/** Format ms duration as "H:MM:SS" or "MM:SS"; non-finite/negative -> "00:00". */
function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) {
    return '00:00';
  }
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Format drive duration in minutes as "Xh Ym". */
function fmtDriveTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ---- geo (web @/lib/geo) ----------------------------------------------------

interface LatLngLike {
  latitude: number;
  longitude: number;
}

const MIN_MEANINGFUL_ROUTE_METERS = 10;

/** Haversine great-circle distance in meters. */
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

function hasMeaningfulRoute(positions: readonly LatLngLike[]): boolean {
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

function firstValidIndex(positions: readonly LatLngLike[]): number {
  for (let i = 0; i < positions.length; i++) {
    if (isValidLatLng(positions[i].latitude, positions[i].longitude)) {
      return i;
    }
  }
  return -1;
}

/** Linear scan for the position closest (by haversine) to a lat/lng. */
function nearestSampleIndex(
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

// ---- replayMarkers (web @/features/driving/lib/replayMarkers) ---------------

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
  if (values.length === 0) {
    return 0;
  }
  if (values.length === 1) {
    return values[0];
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(0, Math.min(1, p)) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) {
    return sorted[lower];
  }
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
  if (bucket.length === 1) {
    return bucket[0];
  }
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
  if (sameKind.length <= MAX_MARKERS) {
    return sameKind;
  }
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
  if (bucket.length > 0) {
    clustered.push(collapseBucket(bucket, kind));
  }
  return clustered;
}

/** Compute timeline markers from a sequence of trip positions (pure). */
function computeReplayMarkers(positions: DrivePosition[]): ReplayMarker[] {
  if (positions.length === 0) {
    return [];
  }

  const t0 = new Date(positions[0].timestamp).getTime();
  const tEnd = new Date(positions[positions.length - 1].timestamp).getTime();
  const totalMs = tEnd - t0;

  if (positions.length < 2 || totalMs <= 0) {
    const out: ReplayMarker[] = [{at: 0, kind: 'start', label: 'Start'}];
    if (positions.length > 1) {
      out.push({at: 1, kind: 'stop', label: 'End'});
    }
    return out;
  }

  const normalize = (i: number): number => {
    const t = new Date(positions[i].timestamp).getTime() - t0;
    if (!Number.isFinite(t) || totalMs === 0) {
      return 0;
    }
    return Math.max(0, Math.min(1, t / totalMs));
  };

  const markers: ReplayMarker[] = [
    {at: 0, kind: 'start', label: 'Start'},
    {at: 1, kind: 'stop', label: 'End'},
  ];

  // Charge segments: contiguous power < threshold for >= 30s.
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

  // Fast segments: contiguous speed > p95 for >= 10s.
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

  // Regen peaks: positions whose regen power exceeds p95.
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

  // Low SoC: first time battery drops below threshold.
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

  // Cluster adjacent same-kind markers if a kind exceeds MAX_MARKERS.
  const clusterKinds: ReplayMarkerKind[] = ['fast-segment', 'regen-peak'];
  const out: ReplayMarker[] = [];
  const handled = new Set<ReplayMarkerKind>();
  for (const k of clusterKinds) {
    out.push(...clusterAdjacent(markers, k));
    handled.add(k);
  }
  for (const m of markers) {
    if (!handled.has(m.kind)) {
      out.push(m);
    }
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

/** Lookup the marker (if any) closest to a normalized playhead position. */
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

// ---- useTripReplay (web @/hooks/useTripReplay) ------------------------------

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

function buildTimeline(positions: DrivePosition[]): number[] {
  if (positions.length === 0) {
    return [];
  }
  let t0 = NaN;
  for (const p of positions) {
    const t = new Date(p.timestamp).getTime();
    if (Number.isFinite(t)) {
      t0 = t;
      break;
    }
  }
  if (!Number.isFinite(t0)) {
    return [];
  }
  return positions.map(p => {
    const t = new Date(p.timestamp).getTime();
    return Number.isFinite(t) ? t - t0 : 0;
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
    totalTimeRef.current =
      offsets.length > 0 ? offsets[offsets.length - 1] : 0;
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
    if (offsets.length === 0 || total === 0) {
      return;
    }

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
    if (total <= 0 || offsets.length === 0) {
      return;
    }
    const targetMs = Math.max(
      0,
      Math.min(total, elapsedRef.current + deltaSeconds * 1000),
    );
    elapsedRef.current = targetMs;
    setCurrentIndex(indexAtTime(offsets, targetMs));
  }, []);

  const stepFrame = useCallback((delta: number) => {
    const offsets = offsetsRef.current;
    if (offsets.length === 0) {
      return;
    }
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

// ---- shared geometry helpers ------------------------------------------------

interface TripReplayChartPoint {
  index: number;
  time: number;
  speed: number;
  power: number;
}

function extent(values: number[]): {min: number; max: number} {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (v < min) {
      min = v;
    }
    if (v > max) {
      max = v;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return {min: 0, max: 1};
  }
  return {min, max};
}

/** Even-stride downsample preserving first + last samples. */
function downsample<T>(arr: T[], target: number): T[] {
  if (arr.length <= target) {
    return arr;
  }
  const out: T[] = [];
  const stride = arr.length / target;
  for (let i = 0; i < target; i++) {
    out.push(arr[Math.min(arr.length - 1, Math.floor(i * stride))]);
  }
  return out;
}

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

function markerColor(kind: ReplayMarkerKind): string {
  switch (kind) {
    case 'start':
      return colors.success;
    case 'stop':
      return colors.danger;
    case 'charge-start':
    case 'charge-stop':
      return '#a855f7';
    case 'fast-segment':
      return '#f59e0b';
    case 'regen-peak':
      return '#22d3ee';
    case 'low-soc':
      return '#ef4444';
    default:
      return colors.textMuted;
  }
}

// ---- PageContainer (web @/components/layout) --------------------------------

interface PageContainerProps {
  title: string;
  subtitle?: string;
  loading?: boolean;
  error?: Error | null;
  children?: ReactNode;
}

function PageContainer({
  title,
  subtitle,
  loading,
  error,
  children,
}: PageContainerProps): React.ReactElement {
  return (
    <ScrollView
      style={styles.pageRoot}
      contentContainerStyle={styles.pageContent}>
      <View style={styles.pageHeaderText}>
        <AppText variant="display" weight="bold">
          {title}
        </AppText>
        {subtitle ? (
          <AppText style={styles.pageSubtitle} tone="secondary">
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {error ? (
        <GlassPanel style={styles.errorPanel}>
          <AppText tone="danger" weight="semibold">
            {error.message}
          </AppText>
        </GlassPanel>
      ) : null}
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}

// ---- FadeIn (web @/components/motion) — passthrough View --------------------

function FadeIn({children}: {children: ReactNode; delay?: number}) {
  return <View style={styles.section}>{children}</View>;
}

// ---- StatCard / MetricCard (web @/components/data-display) ------------------

function StatCard({
  label,
  value,
  unit,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: string;
}) {
  return (
    <GlassPanel style={styles.statCard}>
      <View style={styles.statHeader}>
        {icon ? <AppText style={styles.statIcon}>{icon}</AppText> : null}
        <AppText variant="caption" tone="muted">
          {label}
        </AppText>
      </View>
      <View style={styles.statValueRow}>
        <AppText variant="title" weight="bold">
          {value}
        </AppText>
        {unit ? (
          <AppText variant="caption" tone="secondary" style={styles.statUnit}>
            {unit}
          </AppText>
        ) : null}
      </View>
    </GlassPanel>
  );
}

function MetricCard({
  label,
  value,
  icon,
  highlighted,
}: {
  label: string;
  value: string;
  icon?: string;
  highlighted?: boolean;
}) {
  return (
    <GlassPanel
      style={[styles.metricCard, highlighted ? styles.metricCardActive : null]}>
      <View style={styles.statHeader}>
        {icon ? <AppText style={styles.statIcon}>{icon}</AppText> : null}
        <AppText variant="caption" tone="muted" numberOfLines={1}>
          {label}
        </AppText>
      </View>
      <AppText variant="title" weight="semibold" style={styles.metricValue}>
        {value}
      </AppText>
    </GlassPanel>
  );
}

// ---- PlaybackControls (web @/components/data-display) -----------------------

interface PlaybackControlsProps {
  isPlaying: boolean;
  speed: ReplaySpeed;
  progress: number;
  elapsed: string;
  total: string;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onSpeedChange: (s: ReplaySpeed) => void;
  onSeek: (progress: number) => void;
  onStepFrame: (delta: number) => void;
  markers: ReplayMarker[];
  scrubberBackground?: ReactNode;
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
  onStepFrame,
  markers,
  scrubberBackground,
}: PlaybackControlsProps) {
  const {t} = useTranslation();
  const [trackWidth, setTrackWidth] = useState(0);

  const handleTrackLayout = useCallback((e: LayoutChangeEvent) => {
    setTrackWidth(e.nativeEvent.layout.width);
  }, []);

  const handleTrackPress = useCallback(
    (e: GestureResponderEvent) => {
      if (trackWidth <= 0) {
        return;
      }
      const x = e.nativeEvent.locationX;
      onSeek(Math.max(0, Math.min(1, x / trackWidth)));
    },
    [trackWidth, onSeek],
  );

  const cycleSpeed = useCallback(() => {
    const idx = REPLAY_SPEEDS.indexOf(speed);
    const nextIdx = (idx === -1 ? 0 : idx + 1) % REPLAY_SPEEDS.length;
    onSpeedChange(REPLAY_SPEEDS[nextIdx]);
  }, [speed, onSpeedChange]);

  const fillWidth = `${Math.max(0, Math.min(1, progress)) * 100}%` as DimensionValue;
  const handleLeft = `${Math.max(0, Math.min(1, progress)) * 100}%` as DimensionValue;

  return (
    <GlassPanel style={styles.controlsPanel}>
      <View style={styles.controlsRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('replay.controls.stepBack', 'Step back')}
          onPress={() => onStepFrame(-1)}
          style={styles.controlButton}>
          <AppText style={styles.controlGlyph}>⏮</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            isPlaying
              ? t('replay.controls.pause', 'Pause')
              : t('replay.controls.play', 'Play')
          }
          onPress={isPlaying ? onPause : onPlay}
          style={[styles.controlButton, styles.controlButtonPrimary]}>
          <AppText style={styles.controlGlyph}>{isPlaying ? '⏸' : '▶'}</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('replay.controls.stop', 'Stop')}
          onPress={onStop}
          style={styles.controlButton}>
          <AppText style={styles.controlGlyph}>⏹</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('replay.controls.stepForward', 'Step forward')}
          onPress={() => onStepFrame(1)}
          style={styles.controlButton}>
          <AppText style={styles.controlGlyph}>⏭</AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('replay.controls.speed', 'Playback speed')}
          onPress={cycleSpeed}
          style={styles.speedButton}>
          <AppText weight="semibold" style={styles.speedLabel}>
            {speed}x
          </AppText>
        </Pressable>
      </View>

      <Pressable onPress={handleTrackPress} onLayout={handleTrackLayout}>
        <View style={styles.scrubberTrack}>
          {scrubberBackground ? (
            <View pointerEvents="none" style={styles.scrubberBackground}>
              {scrubberBackground}
            </View>
          ) : null}
          <View pointerEvents="none" style={[styles.scrubberFill, {width: fillWidth}]} />
          {markers.map((m, i) => (
            <View
              key={`${m.kind}-${i}-${m.at}`}
              pointerEvents="none"
              style={[
                styles.scrubberMarker,
                {
                  left: `${Math.max(0, Math.min(1, m.at)) * 100}%` as DimensionValue,
                  backgroundColor: markerColor(m.kind),
                },
              ]}
            />
          ))}
          <View
            pointerEvents="none"
            style={[styles.scrubberHandle, {left: handleLeft}]}
          />
        </View>
      </Pressable>

      <View style={styles.timeRow}>
        <AppText variant="caption" tone="muted">
          {elapsed}
        </AppText>
        <AppText variant="caption" tone="muted">
          {total}
        </AppText>
      </View>
    </GlassPanel>
  );
}

// ---- TripReplayMap (web @/features/trips/components/TripReplayMap) ----------
// Native-safe route minimap: there is no map library in apps/native, so the
// interactive Leaflet tile map is unavailable. The route is rendered as a
// normalised lat/lon scatter (speed-coloured, stretched to fill the box —
// NOT a geographic projection) with start/end/playhead markers and tap-to-seek,
// preserving the spatial + interaction intent.

const MINIMAP_HEIGHT = 240;
const MINIMAP_PADDING = 14;
const MINIMAP_MAX_POINTS = 120;

interface NativeTripReplayMapProps {
  positions: DrivePosition[];
  currentIndex: number;
  onSeekToIndex: (index: number) => void;
  reduceMotion: boolean;
}

function NativeTripReplayMap({
  positions,
  currentIndex,
  onSeekToIndex,
  reduceMotion,
}: NativeTripReplayMapProps) {
  const {t} = useTranslation();
  const [plotWidth, setPlotWidth] = useState(0);

  const hasRoute = useMemo(() => hasMeaningfulRoute(positions), [positions]);
  const anchorIdx = useMemo(() => firstValidIndex(positions), [positions]);

  const bounds = useMemo(() => {
    const lats: number[] = [];
    const lons: number[] = [];
    for (const p of positions) {
      if (isValidLatLng(p.latitude, p.longitude)) {
        lats.push(p.latitude);
        lons.push(p.longitude);
      }
    }
    const lat = extent(lats);
    const lon = extent(lons);
    return {
      latMin: lat.min,
      latSpan: Math.max(lat.max - lat.min, 1e-9),
      lonMin: lon.min,
      lonSpan: Math.max(lon.max - lon.min, 1e-9),
    };
  }, [positions]);

  const project = useCallback(
    (lat: number, lon: number): {x: number; y: number} => {
      const innerW = Math.max(plotWidth - MINIMAP_PADDING * 2, 1);
      const innerH = MINIMAP_HEIGHT - MINIMAP_PADDING * 2;
      const x =
        MINIMAP_PADDING + ((lon - bounds.lonMin) / bounds.lonSpan) * innerW;
      const y =
        MINIMAP_PADDING +
        (1 - (lat - bounds.latMin) / bounds.latSpan) * innerH;
      return {x, y};
    },
    [bounds, plotWidth],
  );

  const routePoints = useMemo(() => {
    if (!hasRoute) {
      return [] as Array<{index: number; lat: number; lon: number; color: string}>;
    }
    const valid = positions
      .map((p, index) => ({index, p}))
      .filter(({p}) => isValidLatLng(p.latitude, p.longitude));
    return downsample(valid, MINIMAP_MAX_POINTS).map(({index, p}) => ({
      index,
      lat: p.latitude,
      lon: p.longitude,
      color: speedColor(p.speed ?? 0),
    }));
  }, [positions, hasRoute]);

  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    setPlotWidth(e.nativeEvent.layout.width);
  }, []);

  const startP = hasRoute ? positions[firstValidIndex(positions)] : null;
  const endP = hasRoute
    ? [...positions].reverse().find(p => isValidLatLng(p.latitude, p.longitude)) ?? null
    : null;
  const currentP =
    hasRoute && positions[currentIndex] != null ? positions[currentIndex] : null;
  const anchorP = anchorIdx >= 0 ? positions[anchorIdx] : null;

  return (
    <GlassPanel style={styles.mapPanel}>
      <View style={styles.mapHeader}>
        <AppText weight="semibold">{t('replay.map.title', 'Route')}</AppText>
        <AppText variant="caption" tone="muted">
          {t(
            'replay.map.nativeNote',
            'Interactive tile map unavailable on native — route shown as a normalised path.',
          )}
        </AppText>
      </View>

      {positions.length === 0 ? (
        <EmptyState
          title={t('replay.map.title', 'Route')}
          message={t(
            'replay.map.noPositions',
            'No position data available for this drive',
          )}
        />
      ) : (
        <View style={styles.mapPlot} onLayout={handleLayout}>
          {!hasRoute ? (
            <View style={styles.mapBanner}>
              <AppText weight="semibold" tone="accent">
                {t('replay.map.stationaryRouteTitle', "Route can't be plotted")}
              </AppText>
              <AppText variant="caption" tone="secondary">
                {t(
                  'replay.map.stationaryRouteBody',
                  "Only one GPS coordinate was recorded for this drive, so the route can't be drawn. The trip statistics, speed, and elevation timeline above the scrubber are unaffected.",
                )}
              </AppText>
            </View>
          ) : null}

          {plotWidth > 0 && hasRoute
            ? routePoints.map(pt => {
                const {x, y} = project(pt.lat, pt.lon);
                return (
                  <Pressable
                    key={`pt-${pt.index}`}
                    accessibilityRole="button"
                    accessibilityLabel={t('replay.map.seek', 'Seek to point')}
                    onPress={() =>
                      onSeekToIndex(
                        nearestSampleIndex(positions, pt.lat, pt.lon),
                      )
                    }
                    style={[
                      styles.routeDot,
                      {left: x - 4, top: y - 4, backgroundColor: pt.color},
                    ]}
                  />
                );
              })
            : null}

          {plotWidth > 0 && hasRoute && startP
            ? (() => {
                const {x, y} = project(startP.latitude, startP.longitude);
                return (
                  <View
                    pointerEvents="none"
                    style={[styles.endpoint, styles.startPoint, {left: x - 6, top: y - 6}]}
                  />
                );
              })()
            : null}

          {plotWidth > 0 && hasRoute && endP
            ? (() => {
                const {x, y} = project(endP.latitude, endP.longitude);
                return (
                  <View
                    pointerEvents="none"
                    style={[styles.endpoint, styles.endPoint, {left: x - 6, top: y - 6}]}
                  />
                );
              })()
            : null}

          {plotWidth > 0 && !hasRoute && anchorP
            ? (() => {
                const {x, y} = project(anchorP.latitude, anchorP.longitude);
                return (
                  <View
                    pointerEvents="none"
                    style={[styles.endpoint, styles.anchorPoint, {left: x - 7, top: y - 7}]}
                  />
                );
              })()
            : null}

          {plotWidth > 0 && hasRoute && currentP
            ? (() => {
                const {x, y} = project(currentP.latitude, currentP.longitude);
                return (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.playhead,
                      reduceMotion ? styles.playheadSnap : null,
                      {left: x - 8, top: y - 8},
                    ]}
                  />
                );
              })()
            : null}
        </View>
      )}
    </GlassPanel>
  );
}

// ---- TripReplayCharts (web @/features/trips/components/TripReplayCharts) ----
// Native-safe speed + power timeline: Recharts area/axes/reference-line are
// unavailable in RN without an SVG backend, so the two series render as
// height-scaled bars with a tap-to-seek hit area per column and a playhead
// line at the current sample.

const TIMELINE_MAX_COLS = 90;
const TIMELINE_ROW_HEIGHT = 70;

interface NativeTripReplayChartsProps {
  data: TripReplayChartPoint[];
  currentIndex: number;
  speedUnit: string;
  onSeekToIndex: (index: number) => void;
}

function NativeTripReplayCharts({
  data,
  currentIndex,
  speedUnit,
  onSeekToIndex,
}: NativeTripReplayChartsProps) {
  const {t} = useTranslation();

  const cols = useMemo(() => downsample(data, TIMELINE_MAX_COLS), [data]);

  const speedExtent = useMemo(
    () => extent(cols.map(c => c.speed)),
    [cols],
  );
  const powerExtent = useMemo(
    () => extent(cols.map(c => c.power)),
    [cols],
  );

  const playheadPct = useMemo(() => {
    if (cols.length <= 1) {
      return 0;
    }
    let bestI = 0;
    let bestDist = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const d = Math.abs(cols[i].index - currentIndex);
      if (d < bestDist) {
        bestDist = d;
        bestI = i;
      }
    }
    return (bestI / (cols.length - 1)) * 100;
  }, [cols, currentIndex]);

  const maxTime = data.length > 0 ? data[data.length - 1].time : 0;

  const heightPct = (value: number, min: number, max: number): DimensionValue => {
    const span = max - min || 1;
    const pct = ((value - min) / span) * 100;
    return `${Math.max(3, Math.min(100, pct))}%` as DimensionValue;
  };

  return (
    <GlassPanel style={styles.chartPanel}>
      <View style={styles.mapHeader}>
        <AppText weight="semibold">
          {t('replay.timeline.title', 'Speed & Power Timeline')}
        </AppText>
        <AppText variant="caption" tone="muted">
          {t('replay.timeline.subtitle', 'Tap to seek replay position')}
        </AppText>
      </View>

      {data.length === 0 ? (
        <EmptyState
          title={t('replay.timeline.title', 'Speed & Power Timeline')}
          message={t('replay.timeline.noData', 'No telemetry data available')}
        />
      ) : (
        <>
          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#0072B2'}]} />
              <AppText variant="caption" tone="secondary">
                {t('replay.timeline.speed', 'Speed')} ({speedUnit})
              </AppText>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, {backgroundColor: '#E69F00'}]} />
              <AppText variant="caption" tone="secondary">
                {t('replay.timeline.power', 'Power')} (kW)
              </AppText>
            </View>
          </View>

          <View style={styles.timelinePlot}>
            <View pointerEvents="none" style={styles.timelineRows}>
              <View style={[styles.timelineRow, {height: TIMELINE_ROW_HEIGHT}]}>
                {cols.map((c, i) => (
                  <View key={`s-${i}`} style={styles.timelineCol}>
                    <View
                      style={[
                        styles.speedBar,
                        {
                          height: heightPct(
                            c.speed,
                            speedExtent.min,
                            speedExtent.max,
                          ),
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
              <View style={[styles.timelineRow, {height: TIMELINE_ROW_HEIGHT}]}>
                {cols.map((c, i) => (
                  <View key={`p-${i}`} style={styles.timelineCol}>
                    <View
                      style={[
                        styles.powerBar,
                        {
                          height: heightPct(
                            c.power,
                            powerExtent.min,
                            powerExtent.max,
                          ),
                        },
                      ]}
                    />
                  </View>
                ))}
              </View>
            </View>

            <View
              pointerEvents="none"
              style={[
                styles.timelinePlayhead,
                {left: `${playheadPct}%` as DimensionValue},
              ]}
            />

            <View style={styles.timelineHitRow}>
              {cols.map((c, i) => (
                <Pressable
                  key={`hit-${i}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('replay.timeline.seek', 'Seek')}
                  onPress={() => onSeekToIndex(c.index)}
                  style={styles.timelineHit}
                />
              ))}
            </View>
          </View>

          <View style={styles.timeRow}>
            <AppText variant="caption" tone="muted">
              0m
            </AppText>
            <AppText variant="caption" tone="muted">
              {fmtNumber(maxTime, 0)}m
            </AppText>
          </View>
        </>
      )}
    </GlassPanel>
  );
}

// ---- Page -------------------------------------------------------------------

interface TripReplayPageProps {
  /** Native param source (web reads useParams `/drives/:id`). Optional: when
   *  omitted the page falls back to the most recent drive for the vehicle. */
  driveId?: string | number;
}

export default function TripReplayPage({
  driveId,
}: TripReplayPageProps = {}): React.ReactElement {
  const {t} = useTranslation();
  usePageTitle(t('replay.title', 'Trip Replay'));

  // No RN router: derive the drive id from the optional prop, else fall back
  // to the most recent drive for the first vehicle.
  const {data: vehicles} = useVehicles();
  const vehicleId = vehicles?.[0]?.id;
  const {data: recentDrives} = useDrives(
    vehicleId != null ? String(vehicleId) : undefined,
  );
  const id =
    driveId != null
      ? String(driveId)
      : recentDrives?.[0]?.id != null
      ? String(recentDrives[0].id)
      : '';

  const {data: drive, isLoading, error} = useDrive(id);
  const {reduce} = useMotionPreference();

  const {unitPrefs} = useUnits();
  const distanceUnit = unitPrefs.distance;
  const speedUnit = unitPrefs.speed;

  // ── Normalize positions: join each /drives/{id} position to its nearest
  // telemetry row by timestamp so power/battery/elevation/range/temp fill in.
  const telemetryByTs = useMemo(() => {
    if (!drive) {
      return [] as Array<{ts: number; row: Record<string, unknown>}>;
    }
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
        if (telemetryByTs[mid].ts < positionTs) {
          lo = mid + 1;
        } else {
          hi = mid;
        }
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
    if (!drive) {
      return [];
    }
    const pos =
      (drive as unknown as {positions?: Array<Record<string, unknown>>})
        .positions ?? [];
    return pos
      .map(p => {
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
          if (fromPos !== undefined && fromPos !== null) {
            return fromPos as V;
          }
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

  const [replay, controls] = useTripReplay(positions);

  const handleSeekToIndex = useCallback(
    (idx: number) => {
      controls.seekTo(idx);
    },
    [controls],
  );

  const replayMarkers: ReplayMarker[] = useMemo(
    () => computeReplayMarkers(positions),
    [positions],
  );

  // Elevation profile data (SI -> display at the edge).
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

  // Speed + power timeline data.
  const timelineData: TripReplayChartPoint[] = useMemo(() => {
    if (positions.length === 0) {
      return [];
    }
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

  // Speed sparkline behind the scrubber (downsampled to ~80 points).
  const speedSparkData = useMemo(() => {
    if (positions.length === 0) {
      return [] as number[];
    }
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

  const activeMarker = useMemo(
    () => nearestMarker(replayMarkers, replay.progress, 0.02),
    [replayMarkers, replay.progress],
  );

  const cardHighlight = useCallback(
    (kinds: ReplayMarkerKind[]): boolean => {
      if (!activeMarker) {
        return false;
      }
      return kinds.includes(activeMarker.kind);
    },
    [activeMarker],
  );

  const cp = replay.currentPosition;

  // Drive summary stats (SI -> display).
  const distanceM = drive?.distanceM ?? 0;
  const durationS = drive?.durationS ?? 0;
  const distanceUserUnit = convertDistanceFromSI(distanceM, distanceUnit);
  const efficiency =
    distanceM > 0 &&
    drive?.startBatteryPct != null &&
    drive?.endBatteryPct != null
      ? ((drive.startBatteryPct - drive.endBatteryPct) / distanceUserUnit) * 1000
      : null;

  const subtitle = drive
    ? `${t('replay.drive', 'Drive')} #${drive.id} — ${formatDate(drive.startTs)}${
        drive.startAddress && drive.endAddress
          ? ` · ${drive.startAddress} → ${drive.endAddress}`
          : ''
      }`
    : undefined;

  const showEmpty = positions.length === 0 && !isLoading;

  return (
    <PageContainer
      title={t('replay.title', 'Trip Replay')}
      subtitle={subtitle}
      loading={isLoading}
      error={
        error instanceof Error
          ? error
          : error
          ? new Error(String(error))
          : null
      }>
      {showEmpty ? (
        <FadeIn>
          <EmptyState
            title={t('replay.title', 'Trip Replay')}
            message={t(
              'replay.noGps',
              'No GPS data available for this drive. Trip replay requires valid position coordinates from Fleet Telemetry.',
            )}
          />
        </FadeIn>
      ) : (
        <>
          {/* Section 1 — Route minimap */}
          <FadeIn>
            <NativeTripReplayMap
              positions={positions}
              currentIndex={replay.currentIndex}
              onSeekToIndex={handleSeekToIndex}
              reduceMotion={reduce}
            />
          </FadeIn>

          {/* Section 2 — Playback controls */}
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
              onStepFrame={controls.stepFrame}
              markers={replayMarkers}
              scrubberBackground={
                speedSparkData.length > 1 ? (
                  <Sparkline
                    data={speedSparkData}
                    color="#22d3ee"
                    height={24}
                    width={400}
                  />
                ) : undefined
              }
            />
          </FadeIn>

          {/* Section 3 — Current position stats */}
          <FadeIn delay={0.1}>
            <GlassPanel style={styles.statsPanel}>
              <AppText
                variant="caption"
                tone="secondary"
                weight="semibold"
                style={styles.sectionHeading}>
                {t('replay.currentStats', 'Current Position Stats')}
              </AppText>
              <View style={styles.metricGrid}>
                <MetricCard
                  label={t('replay.stat.speed', 'Speed')}
                  icon="🚗"
                  highlighted={cardHighlight(['fast-segment'])}
                  value={
                    cp?.speed != null
                      ? `${fmtNumber(
                          convertSpeedFromSI(cp.speed, unitPrefs.speed),
                        )} ${unitPrefs.speed}`
                      : '—'
                  }
                />
                <MetricCard
                  label={t('replay.stat.power', 'Power')}
                  icon="⚡"
                  highlighted={cardHighlight([
                    'regen-peak',
                    'charge-start',
                    'charge-stop',
                  ])}
                  value={cp?.power != null ? `${fmtNumber(cp.power, 1)} kW` : '—'}
                />
                <MetricCard
                  label={t('replay.stat.battery', 'Battery')}
                  icon="🔋"
                  highlighted={cardHighlight([
                    'low-soc',
                    'charge-start',
                    'charge-stop',
                  ])}
                  value={cp ? `${fmtInt(cp.batteryLevel)}%` : '—'}
                />
                <MetricCard
                  label={t('replay.stat.elevation', 'Elevation')}
                  icon="⛰"
                  value={cp?.elevation != null ? `${fmtInt(cp.elevation)} m` : '—'}
                />
                <MetricCard
                  label={t('replay.stat.range', 'Range')}
                  icon="🧭"
                  value={
                    cp?.ratedRange != null
                      ? `${fmtNumber(
                          convertDistanceFromSI(cp.ratedRange, unitPrefs.distance),
                        )} ${unitPrefs.distance}`
                      : '—'
                  }
                />
                <MetricCard
                  label={t('replay.stat.temp', 'Temperature')}
                  icon="🌡"
                  value={
                    cp?.outsideTemp != null
                      ? `${fmtNumber(
                          convertTempFromSI(
                            cp.outsideTemp,
                            unitPrefs.temperature,
                          ),
                        )} ${unitPrefs.temperature}`
                      : '—'
                  }
                />
              </View>
            </GlassPanel>
          </FadeIn>

          {/* Section 4 — Elevation profile */}
          <FadeIn delay={0.15}>
            <ElevationProfile
              data={elevationData}
              currentIndex={replay.currentIndex}
              onClickIndex={handleSeekToIndex}
              height={200}
              distanceUnit={unitPrefs.distance}
            />
          </FadeIn>

          {/* Section 5 — Speed + power timeline */}
          <FadeIn delay={0.2}>
            <NativeTripReplayCharts
              data={timelineData}
              currentIndex={replay.currentIndex}
              speedUnit={unitPrefs.speed}
              onSeekToIndex={handleSeekToIndex}
            />
          </FadeIn>

          {/* Section 6 — Drive summary */}
          <FadeIn delay={0.25}>
            <GlassPanel style={styles.statsPanel}>
              <AppText
                variant="caption"
                tone="secondary"
                weight="semibold"
                style={styles.sectionHeading}>
                {t('replay.summary.title', 'Drive Summary')}
              </AppText>
              <View style={styles.summaryGrid}>
                <StatCard
                  label={t('replay.summary.distance', 'Distance')}
                  value={fmtNumber(distanceUserUnit)}
                  unit={distanceUnit}
                  icon="🛣"
                />
                <StatCard
                  label={t('replay.summary.duration', 'Duration')}
                  value={fmtDriveTime(durationS / 60)}
                  icon="⏱"
                />
                <StatCard
                  label={t('replay.summary.efficiency', 'Efficiency')}
                  value={efficiency != null ? fmtNumber(efficiency) : '—'}
                  unit={efficiency != null ? 'Wh/km' : undefined}
                  icon="📈"
                />
                <StatCard
                  label={t('replay.summary.elevGain', 'Elevation Gain')}
                  value="—"
                  icon="↗"
                />
                <StatCard
                  label={t('replay.summary.elevLoss', 'Elevation Loss')}
                  value="—"
                  icon="↘"
                />
                <StatCard
                  label={t('replay.summary.maxSpeed', 'Max Speed')}
                  value={
                    drive?.maxSpeedMps != null
                      ? fmtNumber(convertSpeedFromSI(drive.maxSpeedMps, speedUnit))
                      : '—'
                  }
                  unit={drive?.maxSpeedMps != null ? speedUnit : undefined}
                  icon="🚗"
                />
                <StatCard
                  label={t('replay.summary.avgSpeed', 'Avg Speed')}
                  value={
                    drive?.avgSpeedMps != null
                      ? fmtNumber(convertSpeedFromSI(drive.avgSpeedMps, speedUnit))
                      : '—'
                  }
                  unit={drive?.avgSpeedMps != null ? speedUnit : undefined}
                  icon="🚗"
                />
                <StatCard
                  label={t('replay.summary.battery', 'Battery')}
                  value={
                    drive?.startBatteryPct != null && drive?.endBatteryPct != null
                      ? `${fmtInt(drive.startBatteryPct)}% → ${fmtInt(
                          drive.endBatteryPct,
                        )}%`
                      : '—'
                  }
                  icon="🔋"
                />
              </View>
            </GlassPanel>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  pageRoot: {
    flex: 1,
    backgroundColor: colors.background,
  },
  pageContent: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  pageHeaderText: {
    gap: spacing.xs,
  },
  pageSubtitle: {
    marginTop: spacing.xs,
  },
  errorPanel: {
    padding: spacing.lg,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerSurface,
  },
  loadingRow: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  section: {
    gap: spacing.md,
  },
  sectionHeading: {
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  // StatCard
  statCard: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 140,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  statIcon: {
    fontSize: 14,
  },
  statValueRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  statUnit: {
    marginBottom: 3,
  },
  // MetricCard
  metricCard: {
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 104,
    padding: spacing.md,
    gap: spacing.xs,
  },
  metricCardActive: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.surfaceSelected,
  },
  metricValue: {
    color: colors.accent,
  },
  // PlaybackControls
  controlsPanel: {
    padding: spacing.md,
    gap: spacing.md,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  controlButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  controlButtonPrimary: {
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
  },
  controlGlyph: {
    fontSize: 18,
    color: colors.textPrimary,
  },
  speedButton: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.md,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  speedLabel: {
    color: colors.accent,
  },
  scrubberTrack: {
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  scrubberBackground: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.4,
    justifyContent: 'center',
  },
  scrubberFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.accentSoft,
  },
  scrubberMarker: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: 2,
    borderRadius: 1,
  },
  scrubberHandle: {
    position: 'absolute',
    top: 2,
    width: 4,
    height: 28,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  timeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  // Map
  mapPanel: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  mapHeader: {
    gap: spacing.xs,
  },
  mapPlot: {
    height: MINIMAP_HEIGHT,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    position: 'relative',
    overflow: 'hidden',
  },
  mapBanner: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    top: spacing.sm,
    padding: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderAccent,
    backgroundColor: colors.accentSoft,
    gap: spacing.xs,
    zIndex: 2,
  },
  routeDot: {
    position: 'absolute',
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  endpoint: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.background,
  },
  startPoint: {
    backgroundColor: colors.success,
  },
  endPoint: {
    backgroundColor: colors.danger,
  },
  anchorPoint: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#22d3ee',
  },
  playhead: {
    position: 'absolute',
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.background,
    backgroundColor: '#00b4d8',
  },
  playheadSnap: {
    borderColor: colors.textPrimary,
  },
  // Timeline chart
  chartPanel: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  legendRow: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  timelinePlot: {
    position: 'relative',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceGlass,
    overflow: 'hidden',
  },
  timelineRows: {
    gap: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 2,
  },
  timelineCol: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    paddingHorizontal: 0.5,
  },
  speedBar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: '#0072B2',
  },
  powerBar: {
    width: '100%',
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
    backgroundColor: '#E69F00',
  },
  timelinePlayhead: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: '#00b4d8',
  },
  timelineHitRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: 'row',
  },
  timelineHit: {
    flex: 1,
  },
  // Stats
  statsPanel: {
    padding: spacing.lg,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
