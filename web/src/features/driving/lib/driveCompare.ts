/**
 * Pure Drive Compare model.
 *
 * Aggregate values remain SI here. Display conversion belongs at the render
 * boundary, while winner rules and progress normalization stay deterministic.
 */

import type { Drive, DriveDetail } from '@/types/driving';

export type CompareSide = 'a' | 'b';

export type CompareMetricKey =
  | 'distanceM'
  | 'durationS'
  | 'avgSpeedMps'
  | 'maxSpeedMps'
  | 'energyUsedWh'
  | 'whPerKm'
  | 'regenShare'
  | 'socUsed'
  | 'outsideTempAvgC'
  | 'score';

export type BetterDirection = 'lower' | 'higher' | null;

export interface CompareRow {
  key: CompareMetricKey;
  a: number | null;
  b: number | null;
  better: BetterDirection;
  winner: CompareSide | null;
}

export type CompareVerdict = CompareSide | 'tie' | 'insufficient';

export interface CompareSummary {
  verdict: CompareVerdict;
  aWins: number;
  bWins: number;
  ties: number;
  comparableCount: number;
}

export interface ProgressValuePoint {
  progress: number;
  value: number;
}

export interface NormalizedDriveProfile {
  speed: ProgressValuePoint[];
  soc: ProgressValuePoint[];
}

export interface ComparisonProfilePoint {
  progress: number;
  a: number | null;
  b: number | null;
}

export const MIN_COMPARABLE_DISTANCE_M = 1_000;

export const COMPARE_METRICS: ReadonlyArray<{
  key: CompareMetricKey;
  better: BetterDirection;
}> = [
  { key: 'distanceM', better: null },
  { key: 'durationS', better: null },
  { key: 'avgSpeedMps', better: null },
  { key: 'maxSpeedMps', better: null },
  { key: 'energyUsedWh', better: null },
  { key: 'whPerKm', better: 'lower' },
  { key: 'regenShare', better: 'higher' },
  { key: 'socUsed', better: null },
  { key: 'outsideTempAvgC', better: null },
  { key: 'score', better: 'higher' },
];

function num(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

/** Extract a metric and reject short/no-energy trips where ratios are noise. */
export function metricOf(drive: Drive, key: CompareMetricKey): number | null {
  switch (key) {
    case 'distanceM':
      return num(drive.distanceM);
    case 'durationS':
      return num(drive.durationS);
    case 'avgSpeedMps':
      return num(drive.avgSpeedMps);
    case 'maxSpeedMps':
      return num(drive.maxSpeedMps);
    case 'energyUsedWh':
      return num(drive.energyUsedWh);
    case 'whPerKm': {
      const energyWh = num(drive.energyUsedWh);
      const distanceM = num(drive.distanceM);
      return energyWh != null && energyWh > 0
        && distanceM != null && distanceM >= MIN_COMPARABLE_DISTANCE_M
        ? Math.round((energyWh / (distanceM / 1_000)) * 10) / 10
        : null;
    }
    case 'regenShare': {
      const regenWh = num(drive.regenEnergyWh);
      const energyWh = num(drive.energyUsedWh);
      const distanceM = num(drive.distanceM);
      return regenWh != null && regenWh >= 0
        && energyWh != null && energyWh > 0
        && distanceM != null && distanceM >= MIN_COMPARABLE_DISTANCE_M
        ? Math.round((regenWh / energyWh) * 1_000) / 1_000
        : null;
    }
    case 'socUsed': {
      const start = num(drive.startBatteryPct);
      const end = num(drive.endBatteryPct);
      return start != null && end != null && start >= end ? start - end : null;
    }
    case 'outsideTempAvgC':
      return num(drive.outsideTempAvgC);
    case 'score': {
      const score = num(drive.score);
      return score != null && score >= 0 && score <= 100 ? score : null;
    }
  }
}

export function compareDrives(a: Drive, b: Drive): CompareRow[] {
  return COMPARE_METRICS.map(({ key, better }) => {
    const valueA = metricOf(a, key);
    const valueB = metricOf(b, key);
    let winner: CompareSide | null = null;
    if (better != null && valueA != null && valueB != null && valueA !== valueB) {
      winner = (better === 'lower' ? valueA < valueB : valueA > valueB) ? 'a' : 'b';
    }
    return { key, a: valueA, b: valueB, better, winner };
  });
}

/** Count only directional metrics with values on both sides. */
export function summarizeComparison(rows: ReadonlyArray<CompareRow>): CompareSummary {
  let aWins = 0;
  let bWins = 0;
  let ties = 0;

  for (const row of rows) {
    if (row.better == null || row.a == null || row.b == null) continue;
    if (row.winner === 'a') aWins += 1;
    else if (row.winner === 'b') bWins += 1;
    else ties += 1;
  }

  const comparableCount = aWins + bWins + ties;
  const verdict: CompareVerdict = comparableCount === 0
    ? 'insufficient'
    : aWins === bWins
      ? 'tie'
      : aWins > bWins ? 'a' : 'b';

  return { verdict, aWins, bWins, ties, comparableCount };
}

interface TimestampedValue {
  timestampMs: number;
  value: number;
}

interface TimestampShape {
  timestamp?: string;
  createdAt?: string;
  created_at?: string;
}

function timestampMs(point: TimestampShape): number | null {
  const parsed = Date.parse(point.createdAt ?? point.created_at ?? point.timestamp ?? '');
  return Number.isFinite(parsed) ? parsed : null;
}

function sample(point: TimestampShape, value: unknown, valid: (n: number) => boolean): TimestampedValue | null {
  const time = timestampMs(point);
  return time != null && typeof value === 'number' && Number.isFinite(value) && valid(value)
    ? { timestampMs: time, value }
    : null;
}

function compact(samples: Array<TimestampedValue | null>): TimestampedValue[] {
  const byTimestamp = new Map<number, number>();
  for (const item of samples) {
    if (item) byTimestamp.set(item.timestampMs, item.value);
  }
  return [...byTimestamp]
    .map(([time, value]) => ({ timestampMs: time, value }))
    .sort((a, b) => a.timestampMs - b.timestampMs);
}

function preferred(primary: TimestampedValue[], fallback: TimestampedValue[]): TimestampedValue[] {
  return primary.length >= 2 || fallback.length < 2 ? primary : fallback;
}

function normalizeSeries(drive: DriveDetail, samples: TimestampedValue[]): ProgressValuePoint[] {
  if (samples.length === 0) return [];

  const start = Date.parse(drive.startTs);
  const explicitEnd = Date.parse(drive.endTs ?? '');
  const derivedEnd = Number.isFinite(start) && drive.durationS > 0
    ? start + drive.durationS * 1_000
    : Number.NaN;
  const end = Number.isFinite(explicitEnd) && explicitEnd > start ? explicitEnd : derivedEnd;
  const first = Number.isFinite(start) ? start : samples[0].timestampMs;
  const last = Number.isFinite(end) && end > first
    ? end
    : samples[samples.length - 1].timestampMs;
  const span = last - first;

  return samples.map((item, index) => ({
    progress: Math.round((
      span > 0
        ? Math.max(0, Math.min(1, (item.timestampMs - first) / span))
        : samples.length > 1 ? index / (samples.length - 1) : 0
    ) * 10_000) / 100,
    value: item.value,
  }));
}

/** Normalize each drive independently to 0–100% progress without interpolation. */
export function normalizeDriveProfile(drive: DriveDetail): NormalizedDriveProfile {
  const telemetry = drive.telemetry ?? [];
  const positions = drive.positions ?? [];

  const telemetrySpeed = compact(telemetry.map((point) =>
    sample(point, point.speed, (value) => value >= 0)));
  const positionSpeed = compact(positions.map((point) =>
    sample(point, point.speed, (value) => value >= 0)));
  const telemetrySoc = compact(telemetry.map((point) =>
    sample(point, point.soc ?? point.batteryLevel, (value) => value >= 0 && value <= 100)));
  const positionSoc = compact(positions.map((point) =>
    sample(point, point.batteryLevel, (value) => value >= 0 && value <= 100)));

  return {
    speed: normalizeSeries(drive, preferred(telemetrySpeed, positionSpeed)),
    soc: normalizeSeries(drive, preferred(telemetrySoc, positionSoc)),
  };
}

/** Merge original sample positions for a two-line chart; missing values stay null. */
export function mergeProfileSeries(
  a: ReadonlyArray<ProgressValuePoint>,
  b: ReadonlyArray<ProgressValuePoint>,
): ComparisonProfilePoint[] {
  const rows = new Map<number, ComparisonProfilePoint>();
  for (const point of a) {
    const progress = Math.round(point.progress * 100) / 100;
    rows.set(progress, { progress, a: point.value, b: rows.get(progress)?.b ?? null });
  }
  for (const point of b) {
    const progress = Math.round(point.progress * 100) / 100;
    rows.set(progress, { progress, a: rows.get(progress)?.a ?? null, b: point.value });
  }
  return [...rows.values()].sort((left, right) => left.progress - right.progress);
}
