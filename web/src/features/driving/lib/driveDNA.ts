/**
 * Drive DNA analytical model.
 *
 * The drive telemetry endpoint is a chronological change-feed projection.
 * Rows are emitted at irregular timestamps and StateReader forward-folds the
 * latest known values into each row. This model therefore describes sampled
 * emission evidence; it never treats row counts as elapsed-time weighting.
 *
 * The endpoint's legacy `power` field is kW (PackVoltage × PackCurrent / 1000).
 * It is lifted exactly once at this boundary into canonical watts. Every
 * exported timeline, statistic, distribution, and art dimension uses SI.
 */
import type { DriveTelemetryPoint } from '@/types/driving';

export const DNA_VIEWBOX = 100;
export const DNA_CENTER = DNA_VIEWBOX / 2;
export const DRIVE_DNA_MAX_CHART_POINTS = 600;
export const DRIVE_DNA_MAX_ART_POINTS = 720;
export const POWER_COAST_THRESHOLD_W = 1_000;
export const SPEED_STATIONARY_MAX_MPS = 0.5;
export const SPEED_LOW_MAX_MPS = 13.88888888888889;
export const SPEED_MEDIUM_MAX_MPS = 25;

export type DriveDnaChannel =
  | 'speed'
  | 'power'
  | 'soc'
  | 'outsideTemp'
  | 'elevation';

export type DriveDnaTraitId =
  | 'spirited'
  | 'gentle'
  | 'mountainous'
  | 'regen-observed'
  | 'cold-start'
  | 'low-demand'
  | 'balanced';

export type PowerStateId = 'regen' | 'coast' | 'propulsion';
export type SpeedBandId = 'stationary' | 'low' | 'medium' | 'high';

export interface DriveDnaTrait {
  id: DriveDnaTraitId;
  /** Bounded artistic heuristic strength, not a score. */
  strength01: number;
}

export interface DriveDnaEncoding {
  progress01: number;
  speed01: number | null;
  /** Signed normalized pack power: -1 regen, 0 coast, +1 propulsion. */
  powerSigned01: number | null;
  powerMagnitude01: number | null;
  soc01: number | null;
  elevation01: number | null;
}

export interface DriveDnaTimelinePoint {
  timestamp: string;
  timestampMs: number;
  elapsedS: number;
  progress: number;
  speedMps: number | null;
  powerW: number | null;
  socPct: number | null;
  elevationM: number | null;
  outsideTempC: number | null;
  encoding: DriveDnaEncoding;
}

export interface DriveDnaChannelCoverage {
  availableCount: number;
  /** Percentage of valid-timestamp rows, or null when there is no denominator. */
  availablePct: number | null;
}

export type DriveDnaCoverage = Record<
  DriveDnaChannel,
  DriveDnaChannelCoverage
>;

export interface DriveDnaSampleEvidence {
  returnedRows: number;
  validRows: number;
  observedSpanS: number | null;
  medianIntervalS: number | null;
  largestGapS: number | null;
  invalidTimestampCount: number;
  /** Additional valid rows sharing a timestamp already seen. */
  duplicateTimestampCount: number;
}

export interface DriveDnaSampledStats {
  topSpeedMps: number | null;
  medianSpeedMps: number | null;
  peakPropulsionW: number | null;
  /** Positive magnitude of the most-negative measured power value. */
  peakRegenW: number | null;
  startSocPct: number | null;
  endSocPct: number | null;
  socDeltaPct: number | null;
  positiveElevationClimbM: number | null;
  powerMeasuredCount: number;
  regenEmissionCount: number | null;
  propulsionEmissionCount: number | null;
  coastEmissionCount: number | null;
  regenEmissionShare: number | null;
  propulsionEmissionShare: number | null;
  coastEmissionShare: number | null;
  firstOutsideTempC: number | null;
}

export interface DriveDnaDistributionBin<T extends string> {
  id: T;
  count: number;
  /** Share of emissions with that channel available, never a time share. */
  share: number | null;
}

export interface DriveDnaDistributions {
  power: {
    basis: 'emission-count';
    measuredCount: number;
    bins: DriveDnaDistributionBin<PowerStateId>[];
  };
  speed: {
    basis: 'emission-count';
    measuredCount: number;
    bins: DriveDnaDistributionBin<SpeedBandId>[];
  };
}

export interface DriveDnaEncodingDimension {
  availableCount: number;
  canonicalMin: number | null;
  canonicalMax: number | null;
  normalizedMin: number | null;
  normalizedMax: number | null;
}

export interface DriveDnaDimensions {
  journeyProgress: DriveDnaEncodingDimension;
  speed: DriveDnaEncodingDimension;
  power: DriveDnaEncodingDimension;
  soc: DriveDnaEncodingDimension;
  elevation: DriveDnaEncodingDimension;
}

export interface DNAPetal {
  angle: number;
  r0: number;
  r1: number;
  color: string;
  width: number;
  opacity: number;
}

export interface DNARing {
  r: number;
  color: string;
}

export interface DriveGenome {
  petals: DNAPetal[];
  rings: DNARing[];
  haloColor: string;
  traits: DriveDnaTrait[];
  signature: string;
  sourcePointCount: number;
  encodedPointCount: number;
}

export interface DriveDnaModel {
  timeline: DriveDnaTimelinePoint[];
  chartPoints: DriveDnaTimelinePoint[];
  sample: DriveDnaSampleEvidence;
  coverage: DriveDnaCoverage;
  stats: DriveDnaSampledStats;
  distributions: DriveDnaDistributions;
  dimensions: DriveDnaDimensions;
  genome: DriveGenome;
}

type TelemetryInput = DriveTelemetryPoint | null | undefined;

interface IndexedPoint {
  point: DriveTelemetryPoint;
  sourceIndex: number;
  timestampMs: number;
}

interface BaseTimelinePoint {
  timestamp: string;
  timestampMs: number;
  elapsedS: number;
  progress: number;
  speedMps: number | null;
  powerW: number | null;
  socPct: number | null;
  elevationM: number | null;
  outsideTempC: number | null;
}

type TimelineValueReader = (
  point: DriveDnaTimelinePoint,
) => number | null;

const DOWNSAMPLE_EXTREMA_READERS: readonly TimelineValueReader[] = [
  (point) => point.speedMps,
  (point) => point.powerW,
];

const DOWNSAMPLE_TRANSITION_READERS: readonly TimelineValueReader[] = [
  ...DOWNSAMPLE_EXTREMA_READERS,
  (point) => point.socPct,
  (point) => point.elevationM,
];

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstFinite(...values: unknown[]): number | null {
  for (const value of values) {
    const candidate = finite(value);
    if (candidate != null) return candidate;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function timestampOf(point: DriveTelemetryPoint): number | null {
  const candidates: unknown[] = [
    point.createdAt,
    point.created_at,
    point.timestamp,
  ];
  for (const candidate of candidates) {
    if (
      (typeof candidate !== 'string' && !(candidate instanceof Date)) ||
      String(candidate).trim() === ''
    ) {
      continue;
    }
    const timestampMs = new Date(candidate).getTime();
    if (Number.isFinite(timestampMs)) return timestampMs;
  }
  return null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const left = sorted[middle - 1];
  const right = sorted[middle];
  return left == null || right == null ? null : (left + right) / 2;
}

function minOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let result = values[0] ?? null;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value != null && (result == null || value < result)) result = value;
  }
  return result;
}

function maxOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let result = values[0] ?? null;
  for (let index = 1; index < values.length; index += 1) {
    const value = values[index];
    if (value != null && (result == null || value > result)) result = value;
  }
  return result;
}

function numericValues(
  points: readonly DriveDnaTimelinePoint[],
  read: (point: DriveDnaTimelinePoint) => number | null,
): number[] {
  const values: number[] = [];
  for (const point of points) {
    const value = read(point);
    if (value != null && Number.isFinite(value)) values.push(value);
  }
  return values;
}

type BucketMode = 'time' | 'index';

function sortedUniqueIndices(
  indices: readonly number[],
  pointCount: number,
): number[] {
  return [...new Set(indices)]
    .filter((index) => index >= 0 && index < pointCount)
    .sort((left, right) => left - right);
}

function extremaIndices(
  points: readonly DriveDnaTimelinePoint[],
  read: TimelineValueReader,
  candidates?: readonly number[],
): number[] {
  const indices =
    candidates ??
    Array.from({ length: points.length }, (_, index) => index);
  let minimumIndex = -1;
  let maximumIndex = -1;
  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;

  for (const index of indices) {
    const point = points[index];
    const value = point ? read(point) : null;
    if (value == null) continue;
    if (value < minimum) {
      minimum = value;
      minimumIndex = index;
    }
    if (value > maximum) {
      maximum = value;
      maximumIndex = index;
    }
  }

  return sortedUniqueIndices(
    [minimumIndex, maximumIndex],
    points.length,
  );
}

function bucketPosition(
  points: readonly DriveDnaTimelinePoint[],
  index: number,
  mode: BucketMode,
): number {
  if (points.length <= 1) return 0;
  if (mode === 'time') {
    const firstTimestamp = points[0]?.timestampMs;
    const lastTimestamp = points[points.length - 1]?.timestampMs;
    if (
      firstTimestamp != null &&
      lastTimestamp != null &&
      lastTimestamp > firstTimestamp
    ) {
      return clamp(
        ((points[index]?.timestampMs ?? firstTimestamp) - firstTimestamp) /
          (lastTimestamp - firstTimestamp),
        0,
        1,
      );
    }
  }
  return index / (points.length - 1);
}

function partitionIntoBuckets(
  points: readonly DriveDnaTimelinePoint[],
  indices: readonly number[],
  bucketCount: number,
  mode: BucketMode,
): number[][] {
  const buckets = Array.from(
    { length: Math.max(1, bucketCount) },
    () => [] as number[],
  );
  for (const index of sortedUniqueIndices(indices, points.length)) {
    const position = bucketPosition(points, index, mode);
    const bucketIndex = Math.min(
      buckets.length - 1,
      Math.floor(position * buckets.length),
    );
    buckets[bucketIndex]?.push(index);
  }
  return buckets;
}

/**
 * Choose representatives from elapsed-time buckets, then use deterministic
 * candidate-index buckets to fill empty time buckets caused by irregular
 * telemetry cadence.
 */
function bucketSampleIndices(
  points: readonly DriveDnaTimelinePoint[],
  candidateIndices: readonly number[],
  limit: number,
): number[] {
  const candidates = sortedUniqueIndices(
    candidateIndices,
    points.length,
  );
  if (limit <= 0) return [];
  if (candidates.length <= limit) return candidates;

  const selected = new Set<number>();
  const timeBuckets = partitionIntoBuckets(
    points,
    candidates,
    limit,
    'time',
  );
  for (let bucketIndex = 0; bucketIndex < timeBuckets.length; bucketIndex += 1) {
    const bucket = timeBuckets[bucketIndex] ?? [];
    if (bucket.length === 0) continue;
    const target = (bucketIndex + 0.5) / timeBuckets.length;
    let nearest = bucket[0] as number;
    let nearestDistance = Math.abs(
      bucketPosition(points, nearest, 'time') - target,
    );
    for (let index = 1; index < bucket.length; index += 1) {
      const candidate = bucket[index];
      if (candidate == null) continue;
      const distance = Math.abs(
        bucketPosition(points, candidate, 'time') - target,
      );
      if (
        distance < nearestDistance ||
        (distance === nearestDistance && candidate < nearest)
      ) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }
    selected.add(nearest);
  }

  const needed = limit - selected.size;
  if (needed > 0) {
    const remaining = candidates.filter((index) => !selected.has(index));
    for (let bucketIndex = 0; bucketIndex < needed; bucketIndex += 1) {
      const start = Math.floor(
        (bucketIndex * remaining.length) / needed,
      );
      const end = Math.floor(
        ((bucketIndex + 1) * remaining.length) / needed,
      );
      const candidate = remaining[Math.floor((start + end - 1) / 2)];
      if (candidate != null) selected.add(candidate);
    }
  }

  return [...selected].sort((left, right) => left - right);
}

function bucketExtremaIndices(
  points: readonly DriveDnaTimelinePoint[],
  bucketCount: number,
  mode: BucketMode,
): number[] {
  const allIndices = Array.from(
    { length: points.length },
    (_, index) => index,
  );
  const buckets = partitionIntoBuckets(
    points,
    allIndices,
    bucketCount,
    mode,
  );
  const output: number[] = [];
  for (const bucket of buckets) {
    for (const read of DOWNSAMPLE_EXTREMA_READERS) {
      output.push(...extremaIndices(points, read, bucket));
    }
  }
  return sortedUniqueIndices(output, points.length);
}

function transitionBoundaryIndices(
  points: readonly DriveDnaTimelinePoint[],
): number[] {
  const output: number[] = [];
  for (const read of DOWNSAMPLE_TRANSITION_READERS) {
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (!previous || !current) continue;
      if ((read(previous) == null) !== (read(current) == null)) {
        output.push(index - 1, index);
      }
    }
  }
  return sortedUniqueIndices(output, points.length);
}

/**
 * Bounded chronological evidence preserving endpoints, speed/power extrema,
 * and null/defined boundaries before filling deterministic time/index buckets.
 */
function boundedTimeline(
  points: readonly DriveDnaTimelinePoint[],
  limit: number,
): DriveDnaTimelinePoint[] {
  if (limit <= 0 || points.length === 0) return [];
  if (points.length <= limit) return [...points];

  const selected = new Set<number>();
  const addCandidates = (indices: readonly number[]): void => {
    const remainingLimit = limit - selected.size;
    if (remainingLimit <= 0) return;
    const available = sortedUniqueIndices(indices, points.length).filter(
      (index) => !selected.has(index),
    );
    const chosen =
      available.length <= remainingLimit
        ? available
        : bucketSampleIndices(points, available, remainingLimit);
    for (const index of chosen) selected.add(index);
  };

  addCandidates([0, points.length - 1]);
  addCandidates(
    DOWNSAMPLE_EXTREMA_READERS.flatMap((read) =>
      extremaIndices(points, read),
    ),
  );
  addCandidates(transitionBoundaryIndices(points));

  for (const mode of ['time', 'index'] as const) {
    const remainingLimit = limit - selected.size;
    if (remainingLimit <= 0) break;
    const bucketCount = Math.max(1, Math.floor(remainingLimit / 4));
    addCandidates(bucketExtremaIndices(points, bucketCount, mode));
  }

  if (selected.size < limit) {
    addCandidates(
      Array.from({ length: points.length }, (_, index) => index),
    );
  }

  return [...selected]
    .sort((left, right) => left - right)
    .map((index) => points[index])
    .filter((point): point is DriveDnaTimelinePoint => point != null);
}

function coverageOf(
  points: readonly DriveDnaTimelinePoint[],
  read: (point: DriveDnaTimelinePoint) => number | null,
): DriveDnaChannelCoverage {
  let availableCount = 0;
  for (const point of points) {
    if (read(point) != null) availableCount += 1;
  }
  return {
    availableCount,
    availablePct:
      points.length > 0 ? (availableCount / points.length) * 100 : null,
  };
}

function dimensionOf(
  canonical: readonly number[],
  normalized: readonly number[],
): DriveDnaEncodingDimension {
  return {
    availableCount: canonical.length,
    canonicalMin: minOf(canonical),
    canonicalMax: maxOf(canonical),
    normalizedMin: minOf(normalized),
    normalizedMax: maxOf(normalized),
  };
}

function distributionBin<T extends string>(
  id: T,
  count: number,
  denominator: number,
): DriveDnaDistributionBin<T> {
  return {
    id,
    count,
    share: denominator > 0 ? count / denominator : null,
  };
}

function mixHash(hash: number, value: number): number {
  let output = hash;
  const integer = value | 0;
  for (let shift = 0; shift < 32; shift += 8) {
    output ^= (integer >>> shift) & 0xff;
    output = Math.imul(output, 0x01000193) >>> 0;
  }
  return output;
}

function quantized(value: number | null, scale = 10_000): number {
  return value == null ? -2_147_483_648 : Math.round(value * scale);
}

/** Signature over normalized, chronologically ordered encoding dimensions. */
function signatureOf(points: readonly DriveDnaTimelinePoint[]): string {
  if (points.length === 0) return '0000000';
  let hash = 0x811c9dc5;
  for (const point of points) {
    const values = [
      point.encoding.progress01,
      point.encoding.speed01,
      point.encoding.powerSigned01,
      point.encoding.powerMagnitude01,
      point.encoding.soc01,
      point.encoding.elevation01,
    ];
    for (const value of values) hash = mixHash(hash, quantized(value));
  }
  return (hash >>> 0)
    .toString(36)
    .padStart(7, '0')
    .slice(0, 7)
    .toUpperCase();
}

function trait(
  id: DriveDnaTraitId,
  strength: number,
): DriveDnaTrait {
  return { id, strength01: clamp(strength, 0, 1) };
}

function buildTraits(
  stats: DriveDnaSampledStats,
  speedCount: number,
  powerValues: readonly number[],
): DriveDnaTrait[] {
  const traits: DriveDnaTrait[] = [];
  const topSpeed = stats.topSpeedMps;
  if (topSpeed != null && topSpeed > 33) {
    traits.push(trait('spirited', (topSpeed - 33) / 20));
  } else if (topSpeed != null && topSpeed < 14) {
    traits.push(trait('gentle', (14 - Math.max(0, topSpeed)) / 14));
  }

  if (
    stats.positiveElevationClimbM != null &&
    stats.positiveElevationClimbM > 150
  ) {
    traits.push(
      trait(
        'mountainous',
        (stats.positiveElevationClimbM - 150) / 450,
      ),
    );
  }
  if (
    stats.regenEmissionShare != null &&
    stats.regenEmissionShare > 0.35
  ) {
    traits.push(
      trait('regen-observed', (stats.regenEmissionShare - 0.35) / 0.65),
    );
  }
  if (
    stats.firstOutsideTempC != null &&
    stats.firstOutsideTempC < 5
  ) {
    traits.push(trait('cold-start', (5 - stats.firstOutsideTempC) / 25));
  }

  const medianAbsolutePower = median(powerValues.map((value) => Math.abs(value)));
  if (medianAbsolutePower != null && medianAbsolutePower < 8_000) {
    traits.push(
      trait('low-demand', (8_000 - medianAbsolutePower) / 8_000),
    );
  }

  if (traits.length === 0 && speedCount > 0 && powerValues.length > 0) {
    traits.push(trait('balanced', 0.5));
  }
  return traits;
}

function buildGenome(
  timeline: readonly DriveDnaTimelinePoint[],
  stats: DriveDnaSampledStats,
  speedCount: number,
  powerValues: readonly number[],
  elevationValues: readonly number[],
): DriveGenome {
  const artPoints = boundedTimeline(
    timeline,
    DRIVE_DNA_MAX_ART_POINTS,
  );
  const petals = artPoints.map((point) => {
    const encoding = point.encoding;
    const speed = encoding.speed01;
    const signedPower = encoding.powerSigned01;
    const magnitude = encoding.powerMagnitude01;
    const hue =
      signedPower == null
        ? 210
        : signedPower < 0
          ? 190 - Math.abs(signedPower) * 40
          : 190 + signedPower * 160;
    const saturation = magnitude == null ? 30 : 55 + magnitude * 40;
    const lightness =
      encoding.soc01 == null ? 55 : 40 + encoding.soc01 * 35;
    const r0 = 10;
    return {
      angle: encoding.progress01 * Math.PI * 2 - Math.PI / 2,
      r0,
      r1: r0 + (speed ?? 0.18) * (DNA_CENTER - 14),
      color: `hsl(${Math.round(hue)}, ${Math.round(saturation)}%, ${Math.round(lightness)}%)`,
      width: magnitude == null ? 0.55 : 0.4 + magnitude * 1.4,
      opacity: 0.35 + encoding.progress01 * 0.55,
    };
  });

  const minElevation = minOf(elevationValues);
  const maxElevation = maxOf(elevationValues);
  const elevationSpan =
    minElevation != null && maxElevation != null
      ? maxElevation - minElevation
      : 0;
  const ringCount =
    elevationValues.length >= 2 && elevationSpan > 0
      ? clamp(Math.ceil(elevationSpan / 60), 1, 5)
      : 0;
  const rings: DNARing[] = Array.from(
    { length: ringCount },
    (_, index) => {
      const fraction = (index + 1) / (ringCount + 1);
      return {
        r: 12 + fraction * (DNA_CENTER - 14),
        color: `hsla(${Math.round(200 - fraction * 60)}, 45%, 55%, 0.16)`,
      };
    },
  );

  const haloColor =
    stats.regenEmissionShare == null
      ? 'hsl(210, 30%, 16%)'
      : `hsl(${Math.round(190 - stats.regenEmissionShare * 40)}, 40%, 16%)`;

  return {
    petals,
    rings,
    haloColor,
    traits: buildTraits(stats, speedCount, powerValues),
    signature: signatureOf(timeline),
    sourcePointCount: timeline.length,
    encodedPointCount: artPoints.length,
  };
}

/**
 * Build the complete deterministic Drive DNA model without mutating input.
 */
export function buildDriveDnaModel(
  raw: readonly TelemetryInput[] | null | undefined,
): DriveDnaModel {
  const rows = raw ?? [];
  const indexed: IndexedPoint[] = [];
  let invalidTimestampCount = 0;

  rows.forEach((point, sourceIndex) => {
    if (point == null) {
      invalidTimestampCount += 1;
      return;
    }
    const timestampMs = timestampOf(point);
    if (timestampMs == null) {
      invalidTimestampCount += 1;
      return;
    }
    indexed.push({ point, sourceIndex, timestampMs });
  });

  indexed.sort(
    (left, right) =>
      left.timestampMs - right.timestampMs ||
      left.sourceIndex - right.sourceIndex,
  );

  let duplicateTimestampCount = 0;
  for (let index = 1; index < indexed.length; index += 1) {
    if (indexed[index]?.timestampMs === indexed[index - 1]?.timestampMs) {
      duplicateTimestampCount += 1;
    }
  }

  const firstTimestamp = indexed[0]?.timestampMs ?? null;
  const lastTimestamp = indexed[indexed.length - 1]?.timestampMs ?? null;
  const spanMs =
    firstTimestamp != null && lastTimestamp != null
      ? Math.max(0, lastTimestamp - firstTimestamp)
      : null;

  const base: BaseTimelinePoint[] = indexed.map(
    ({ point, timestampMs }, index) => {
      const elapsedS =
        firstTimestamp == null ? 0 : (timestampMs - firstTimestamp) / 1_000;
      const progress =
        spanMs != null && spanMs > 0
          ? (timestampMs - (firstTimestamp ?? timestampMs)) / spanMs
          : indexed.length > 1
            ? index / (indexed.length - 1)
            : 0;
      const powerKw = finite(point.power);
      const liftedPowerW = powerKw == null ? null : powerKw * 1_000;
      return {
        timestamp: new Date(timestampMs).toISOString(),
        timestampMs,
        elapsedS: Number.isFinite(elapsedS) ? elapsedS : 0,
        progress: clamp(progress, 0, 1),
        speedMps: finite(point.speed),
        powerW: Number.isFinite(liftedPowerW) ? liftedPowerW : null,
        socPct: firstFinite(point.soc, point.batteryLevel, point.usableSoc),
        elevationM: finite(point.elevation),
        outsideTempC: finite(point.outsideTemp),
      };
    },
  );

  const baseSpeeds = base
    .map((point) => point.speedMps)
    .filter((value): value is number => value != null);
  const basePowers = base
    .map((point) => point.powerW)
    .filter((value): value is number => value != null);
  const baseElevations = base
    .map((point) => point.elevationM)
    .filter((value): value is number => value != null);
  const maxPositiveSpeed = Math.max(0, maxOf(baseSpeeds) ?? 0);
  const maxAbsolutePower = Math.max(
    0,
    maxOf(basePowers.map((value) => Math.abs(value))) ?? 0,
  );
  const minElevation = minOf(baseElevations);
  const maxElevation = maxOf(baseElevations);
  const elevationSpan =
    minElevation != null && maxElevation != null
      ? maxElevation - minElevation
      : 0;

  const timeline: DriveDnaTimelinePoint[] = base.map((point) => ({
    ...point,
    encoding: {
      progress01: point.progress,
      speed01:
        point.speedMps == null
          ? null
          : maxPositiveSpeed > 0
            ? clamp(point.speedMps / maxPositiveSpeed, 0, 1)
            : 0,
      powerSigned01:
        point.powerW == null
          ? null
          : maxAbsolutePower > 0
            ? clamp(point.powerW / maxAbsolutePower, -1, 1)
            : 0,
      powerMagnitude01:
        point.powerW == null
          ? null
          : maxAbsolutePower > 0
            ? clamp(Math.abs(point.powerW) / maxAbsolutePower, 0, 1)
            : 0,
      soc01:
        point.socPct == null ? null : clamp(point.socPct / 100, 0, 1),
      elevation01:
        point.elevationM == null
          ? null
          : elevationSpan > 0 && minElevation != null
            ? clamp((point.elevationM - minElevation) / elevationSpan, 0, 1)
            : 0.5,
    },
  }));

  const intervalsS: number[] = [];
  for (let index = 1; index < timeline.length; index += 1) {
    const current = timeline[index];
    const previous = timeline[index - 1];
    if (current && previous) {
      intervalsS.push(
        Math.max(0, (current.timestampMs - previous.timestampMs) / 1_000),
      );
    }
  }

  const speedValues = numericValues(timeline, (point) => point.speedMps);
  const powerValues = numericValues(timeline, (point) => point.powerW);
  const socValues = numericValues(timeline, (point) => point.socPct);
  const elevationValues = numericValues(
    timeline,
    (point) => point.elevationM,
  );
  const outsideTempValues = numericValues(
    timeline,
    (point) => point.outsideTempC,
  );

  let positiveElevationClimbM: number | null = null;
  if (elevationValues.length >= 2) {
    positiveElevationClimbM = 0;
    for (let index = 1; index < elevationValues.length; index += 1) {
      const current = elevationValues[index];
      const previous = elevationValues[index - 1];
      if (current != null && previous != null && current > previous) {
        positiveElevationClimbM += current - previous;
      }
    }
  }

  const startSocPct = socValues[0] ?? null;
  const endSocPct = socValues[socValues.length - 1] ?? null;
  const regenEmissionCount = powerValues.filter(
    (value) => value < -POWER_COAST_THRESHOLD_W,
  ).length;
  const propulsionEmissionCount = powerValues.filter(
    (value) => value > POWER_COAST_THRESHOLD_W,
  ).length;
  const coastEmissionCount =
    powerValues.length - regenEmissionCount - propulsionEmissionCount;

  const stats: DriveDnaSampledStats = {
    topSpeedMps: maxOf(speedValues),
    medianSpeedMps: median(speedValues),
    peakPropulsionW:
      powerValues.length > 0 ? Math.max(0, maxOf(powerValues) ?? 0) : null,
    peakRegenW:
      powerValues.length > 0
        ? Math.max(0, maxOf(powerValues.map((value) => -value)) ?? 0)
        : null,
    startSocPct,
    endSocPct,
    socDeltaPct:
      startSocPct != null && endSocPct != null
        ? endSocPct - startSocPct
        : null,
    positiveElevationClimbM,
    powerMeasuredCount: powerValues.length,
    regenEmissionCount:
      powerValues.length > 0 ? regenEmissionCount : null,
    propulsionEmissionCount:
      powerValues.length > 0 ? propulsionEmissionCount : null,
    coastEmissionCount:
      powerValues.length > 0 ? coastEmissionCount : null,
    regenEmissionShare:
      powerValues.length > 0
        ? regenEmissionCount / powerValues.length
        : null,
    propulsionEmissionShare:
      powerValues.length > 0
        ? propulsionEmissionCount / powerValues.length
        : null,
    coastEmissionShare:
      powerValues.length > 0
        ? coastEmissionCount / powerValues.length
        : null,
    firstOutsideTempC: outsideTempValues[0] ?? null,
  };

  const powerBins: DriveDnaDistributionBin<PowerStateId>[] = [
    distributionBin('regen', regenEmissionCount, powerValues.length),
    distributionBin('coast', coastEmissionCount, powerValues.length),
    distributionBin(
      'propulsion',
      propulsionEmissionCount,
      powerValues.length,
    ),
  ];
  const speedCounts: Record<SpeedBandId, number> = {
    stationary: 0,
    low: 0,
    medium: 0,
    high: 0,
  };
  for (const speed of speedValues) {
    if (speed < SPEED_STATIONARY_MAX_MPS) speedCounts.stationary += 1;
    else if (speed < SPEED_LOW_MAX_MPS) speedCounts.low += 1;
    else if (speed < SPEED_MEDIUM_MAX_MPS) speedCounts.medium += 1;
    else speedCounts.high += 1;
  }
  const speedBins: DriveDnaDistributionBin<SpeedBandId>[] = (
    ['stationary', 'low', 'medium', 'high'] as const
  ).map((id) => distributionBin(id, speedCounts[id], speedValues.length));

  const coverage: DriveDnaCoverage = {
    speed: coverageOf(timeline, (point) => point.speedMps),
    power: coverageOf(timeline, (point) => point.powerW),
    soc: coverageOf(timeline, (point) => point.socPct),
    outsideTemp: coverageOf(timeline, (point) => point.outsideTempC),
    elevation: coverageOf(timeline, (point) => point.elevationM),
  };

  const dimensions: DriveDnaDimensions = {
    journeyProgress: dimensionOf(
      timeline.map((point) => point.progress),
      timeline.map((point) => point.encoding.progress01),
    ),
    speed: dimensionOf(
      speedValues,
      numericValues(timeline, (point) => point.encoding.speed01),
    ),
    power: dimensionOf(
      powerValues,
      numericValues(timeline, (point) => point.encoding.powerSigned01),
    ),
    soc: dimensionOf(
      socValues,
      numericValues(timeline, (point) => point.encoding.soc01),
    ),
    elevation: dimensionOf(
      elevationValues,
      numericValues(timeline, (point) => point.encoding.elevation01),
    ),
  };

  return {
    timeline,
    chartPoints: boundedTimeline(
      timeline,
      DRIVE_DNA_MAX_CHART_POINTS,
    ),
    sample: {
      returnedRows: rows.length,
      validRows: timeline.length,
      observedSpanS: spanMs == null ? null : spanMs / 1_000,
      medianIntervalS: median(intervalsS),
      largestGapS: maxOf(intervalsS),
      invalidTimestampCount,
      duplicateTimestampCount,
    },
    coverage,
    stats,
    distributions: {
      power: {
        basis: 'emission-count',
        measuredCount: powerValues.length,
        bins: powerBins,
      },
      speed: {
        basis: 'emission-count',
        measuredCount: speedValues.length,
        bins: speedBins,
      },
    },
    dimensions,
    genome: buildGenome(
      timeline,
      stats,
      speedValues.length,
      powerValues,
      elevationValues,
    ),
  };
}

/** Compatibility art-only entry point for callers that do not need evidence. */
export function generateDriveDNA(
  raw: readonly TelemetryInput[] | null | undefined,
): DriveGenome {
  return buildDriveDnaModel(raw).genome;
}

/** Convert a petal into an SVG line segment from the fingerprint centre. */
export function petalLine(
  petal: DNAPetal,
): { x1: number; y1: number; x2: number; y2: number } {
  return {
    x1: DNA_CENTER + Math.cos(petal.angle) * petal.r0,
    y1: DNA_CENTER + Math.sin(petal.angle) * petal.r0,
    x2: DNA_CENTER + Math.cos(petal.angle) * petal.r1,
    y2: DNA_CENTER + Math.sin(petal.angle) * petal.r1,
  };
}
