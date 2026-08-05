/**
 * Arrival reliability models timing uncertainty on routes driven repeatedly.
 *
 * Locations prefer normalized addresses and fall back to coordinates rounded
 * to roughly 100 m. Routes remain directional. Durations are compared within
 * two-hour local departure buckets; no traffic, weather, or routing data is
 * inferred.
 */
import type { Drive } from '@/types/driving';

const DEFAULT_MIN_ROUTE_SAMPLES = 3;
const DEFAULT_MIN_WINDOW_SAMPLES = 2;
const BUCKET_HOURS = 2;

export interface RouteLocation {
  key: string;
  label: string;
}

export interface ReliabilityWindow {
  routeKey: string;
  routeLabel: string;
  bucketStartHour: number;
  samples: number;
  p50DurationS: number;
  p90DurationS: number;
  robustSpreadS: number;
  onTimeProbability: number;
  reliabilityScore: number;
}

export interface RouteReliability {
  key: string;
  label: string;
  samples: number;
  p50DurationS: number;
  p90DurationS: number;
  robustSpreadS: number;
  onTimeProbability: number;
  reliabilityScore: number;
  windows: ReliabilityWindow[];
}

export interface ArrivalReliabilityResult {
  analyzedDrives: number;
  repeatedDrives: number;
  routes: RouteReliability[];
  bestWindow: ReliabilityWindow | null;
  worstWindow: ReliabilityWindow | null;
  overallOnTimeProbability: number | null;
  overallReliabilityScore: number | null;
}

export interface ArrivalReliabilityOptions {
  minRouteSamples?: number;
  minWindowSamples?: number;
}

function roundedCoordinate(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0.000' : rounded.toFixed(3);
}

/** Normalize one route endpoint, preferring its address over GPS. */
export function normalizeRouteLocation(
  address: string | null | undefined,
  lat: number | null | undefined,
  lon: number | null | undefined,
): RouteLocation | null {
  const label = typeof address === 'string' ? address.trim().replace(/\s+/g, ' ') : '';
  if (label) {
    const normalized = label
      .normalize('NFKD')
      .toLocaleLowerCase('en-US')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
    if (normalized) return { key: `address:${normalized}`, label };
  }

  if (
    lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)
    || lat < -90 || lat > 90 || lon < -180 || lon > 180
  ) return null;

  const coordinate = `${roundedCoordinate(lat)}, ${roundedCoordinate(lon)}`;
  return { key: `geo:${coordinate.replace(' ', '')}`, label: coordinate };
}

/** Linear-interpolated quantile on a sorted or unsorted finite sample. */
export function quantile(values: readonly number[], q: number): number {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const bounded = Math.max(0, Math.min(1, q));
  const position = (sorted.length - 1) * bounded;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

function summarizeDurations(durations: readonly number[]) {
  const p50DurationS = quantile(durations, 0.5);
  const p90DurationS = quantile(durations, 0.9);
  const deviations = durations.map((duration) => Math.abs(duration - p50DurationS));
  const robustSpreadS = 1.4826 * quantile(deviations, 0.5);
  const onTimeLimitS = p50DurationS + Math.max(300, p50DurationS * 0.1);
  const onTimeProbability =
    durations.filter((duration) => duration <= onTimeLimitS).length / durations.length;
  const consistency = Math.exp(-robustSpreadS / Math.max(p50DurationS, 1));
  const reliabilityScore = 100 * (0.65 * onTimeProbability + 0.35 * consistency);
  return {
    p50DurationS,
    p90DurationS,
    robustSpreadS,
    onTimeProbability,
    reliabilityScore,
  };
}

interface RouteSample {
  durationS: number;
  bucketStartHour: number;
}

interface RouteGroup {
  key: string;
  label: string;
  samples: RouteSample[];
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value != null && value > 0 ? value : fallback;
}

export function analyzeArrivalReliability(
  drives: readonly Drive[],
  options: ArrivalReliabilityOptions = {},
): ArrivalReliabilityResult {
  const minRouteSamples = positiveInteger(options.minRouteSamples, DEFAULT_MIN_ROUTE_SAMPLES);
  const minWindowSamples = positiveInteger(options.minWindowSamples, DEFAULT_MIN_WINDOW_SAMPLES);
  const groups = new Map<string, RouteGroup>();
  let analyzedDrives = 0;

  for (const drive of drives) {
    const startMs = new Date(drive.startTs).getTime();
    if (
      drive.endTs == null || !Number.isFinite(startMs)
      || !Number.isFinite(drive.durationS) || drive.durationS <= 0
    ) continue;
    const start = normalizeRouteLocation(drive.startAddress, drive.startLat, drive.startLon);
    const end = normalizeRouteLocation(drive.endAddress, drive.endLat, drive.endLon);
    if (!start || !end) continue;

    analyzedDrives += 1;
    const key = `${start.key}→${end.key}`;
    const bucketStartHour = Math.floor(new Date(startMs).getHours() / BUCKET_HOURS) * BUCKET_HOURS;
    const group = groups.get(key) ?? {
      key,
      label: `${start.label} → ${end.label}`,
      samples: [],
    };
    group.samples.push({ durationS: drive.durationS, bucketStartHour });
    groups.set(key, group);
  }

  const routes: RouteReliability[] = [];
  for (const group of groups.values()) {
    if (group.samples.length < minRouteSamples) continue;
    const routeStats = summarizeDurations(group.samples.map((sample) => sample.durationS));
    const buckets = new Map<number, number[]>();
    for (const sample of group.samples) {
      const durations = buckets.get(sample.bucketStartHour) ?? [];
      durations.push(sample.durationS);
      buckets.set(sample.bucketStartHour, durations);
    }
    const windows: ReliabilityWindow[] = [];
    for (const [bucketStartHour, durations] of buckets) {
      if (durations.length < minWindowSamples) continue;
      windows.push({
        routeKey: group.key,
        routeLabel: group.label,
        bucketStartHour,
        samples: durations.length,
        ...summarizeDurations(durations),
      });
    }
    windows.sort((a, b) => a.bucketStartHour - b.bucketStartHour);
    routes.push({
      key: group.key,
      label: group.label,
      samples: group.samples.length,
      ...routeStats,
      windows,
    });
  }

  routes.sort((a, b) => b.samples - a.samples || b.reliabilityScore - a.reliabilityScore);
  const windows = routes.flatMap((route) => route.windows);
  const ranked = windows.slice().sort(
    (a, b) => b.reliabilityScore - a.reliabilityScore || b.samples - a.samples,
  );
  const repeatedDrives = routes.reduce((sum, route) => sum + route.samples, 0);
  const weighted = (key: 'onTimeProbability' | 'reliabilityScore') =>
    repeatedDrives > 0
      ? routes.reduce((sum, route) => sum + route[key] * route.samples, 0) / repeatedDrives
      : null;

  return {
    analyzedDrives,
    repeatedDrives,
    routes,
    bestWindow: ranked[0] ?? null,
    worstWindow: ranked.length > 0 ? ranked[ranked.length - 1]! : null,
    overallOnTimeProbability: weighted('onTimeProbability'),
    overallReliabilityScore: weighted('reliabilityScore'),
  };
}
