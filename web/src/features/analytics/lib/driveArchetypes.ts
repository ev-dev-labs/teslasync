/**
 * Deterministic, observational drive clustering.
 *
 * API values remain SI throughout this model. Display-unit conversion belongs
 * at the React render boundary.
 */

import type { Drive } from '@/types/driving';

export type ArchetypeLabel =
  | 'highwayRun'
  | 'roadTrip'
  | 'morningCommute'
  | 'eveningCommute'
  | 'shortHop'
  | 'coldWeather'
  | 'everyday';

export type ArchetypeStatus =
  | 'insufficient_drives'
  | 'insufficient_variation'
  | 'insufficient_partition'
  | 'clustered';

export type ArchetypeQuality =
  | 'none'
  | 'limited'
  | 'moderate'
  | 'strong';

export interface ArchetypeCentroid {
  distanceM: number;
  speedMps: number;
  /** Circular mean of local start hour, 0-23.9. */
  hour: number;
  efficiencyWhPerM: number;
  tempC: number;
}

export interface Archetype {
  index: number;
  label: ArchetypeLabel;
  size: number;
  share: number;
  centroid: ArchetypeCentroid;
  medianEfficiencyWhPerM: number;
  totalDistanceM: number;
  totalEnergyWh: number;
  driveIds: number[];
  representativeDriveIds: number[];
  meanAssignmentDistance: number;
  p90AssignmentDistance: number;
  medianAssignmentMargin: number;
  ambiguousAssignments: number;
  nearestClusterIndex: number | null;
  nearestCentroidDistance: number | null;
}

export interface ArchetypeSourceAccounting {
  returnedRows: number;
  invalidRowRows: number;
  invalidIdRows: number;
  duplicateDriveRows: number;
  missingStartRows: number;
  invalidStartRows: number;
  invalidDistanceRows: number;
  shortDistanceRows: number;
  missingEnergyRows: number;
  invalidEnergyRows: number;
  missingSpeedRows: number;
  invalidSpeedRows: number;
  eligibleObservedTempRows: number;
  eligibleImputedTempRows: number;
}

export interface ArchetypeCoverage {
  timestampedRows: number;
  earliestMs: number | null;
  latestMs: number | null;
  spanS: number;
  historyLimit: number;
  historyCapReached: boolean;
}

export interface ArchetypeModelCandidate {
  k: number;
  realizedK: number;
  silhouette: number;
  inertia: number;
  restartAgreement: number;
  smallestCluster: number;
  largestCluster: number;
  selected: boolean;
}

export interface ArchetypeAssignment {
  driveId: number;
  departureMs: number;
  clusterIndex: number;
  label: ArchetypeLabel;
  distanceM: number;
  speedMps: number;
  durationS: number | null;
  energyUsedWh: number;
  efficiencyWhPerM: number;
  tempC: number;
  tempImputed: boolean;
  localHour: number;
  localMonth: string;
  startAddress: string | null;
  endAddress: string | null;
  assignmentDistance: number;
  secondClusterDistance: number | null;
  assignmentMargin: number;
}

export interface ArchetypeAssignmentDirectory {
  total: number;
  displayed: number;
  omitted: number;
  cap: number;
  items: ArchetypeAssignment[];
}

export interface ArchetypeFeatureRange {
  min: number | null;
  median: number | null;
  max: number | null;
}

export interface ArchetypeFeatureRanges {
  distanceM: ArchetypeFeatureRange;
  speedMps: ArchetypeFeatureRange;
  efficiencyWhPerM: ArchetypeFeatureRange;
  tempC: ArchetypeFeatureRange;
}

export interface ArchetypeHourBucket {
  hour: number;
  total: number;
  clusters: Array<{ clusterIndex: number; count: number }>;
}

export interface ArchetypeMonthBucket {
  month: string;
  total: number;
  clusters: Array<{ clusterIndex: number; count: number }>;
}

export interface ArchetypeIdentities {
  sourceRowsBalanced: boolean;
  eligibleRowsBalanced: boolean;
  clusterMembershipBalanced: boolean;
  assignmentsBalanced: boolean;
  directoryBalanced: boolean;
  selectedCandidateBalanced: boolean;
}

export interface ArchetypeOptions {
  minK?: number;
  maxK?: number;
  minDrives?: number;
  minDistanceM?: number;
  silhouetteSample?: number;
  defaultTempC?: number;
  seed?: number;
  historyLimit?: number;
  directoryLimit?: number;
  /** IANA timezone used for every calendar feature and aggregation. */
  timeZone?: string;
}

export interface ArchetypeSummary {
  status: ArchetypeStatus;
  quality: ArchetypeQuality;
  clusters: Archetype[];
  k: number;
  silhouette: number;
  analyzedDrives: number;
  skippedDrives: number;
  source: ArchetypeSourceAccounting;
  coverage: ArchetypeCoverage;
  candidates: ArchetypeModelCandidate[];
  assignments: ArchetypeAssignment[];
  directory: ArchetypeAssignmentDirectory;
  featureRanges: ArchetypeFeatureRanges;
  hourlyProfile: ArchetypeHourBucket[];
  monthlyProfile: ArchetypeMonthBucket[];
  temperatureImputationC: number;
  temperatureImputationSource: 'observed_median' | 'configured_default';
  activeFeatureDimensions: number;
  labelCollisionCount: number;
  thresholds: Required<ArchetypeOptions>;
  identities: ArchetypeIdentities;
}

interface DrivePoint {
  driveId: number;
  departureMs: number;
  distanceM: number;
  speedMps: number;
  durationS: number | null;
  energyUsedWh: number;
  hour: number;
  month: string;
  efficiencyWhPerM: number;
  tempC: number;
  tempImputed: boolean;
  startAddress: string | null;
  endAddress: string | null;
  features: number[];
}

interface PendingDrivePoint extends Omit<DrivePoint, 'tempC' | 'tempImputed' | 'features'> {
  observedTempC: number | null;
}

interface StandardizedData {
  values: number[][];
  activeDimensions: number;
  means: number[];
  deviations: number[];
}

interface CandidateEvaluation {
  public: ArchetypeModelCandidate;
  rawSilhouette: number;
  assignments: number[];
  centroids: number[][];
}

const DEFAULTS: Required<ArchetypeOptions> = {
  minK: 2,
  maxK: 5,
  minDrives: 20,
  minDistanceM: 500,
  silhouetteSample: 400,
  defaultTempC: 15,
  seed: 0x5eed,
  historyLimit: 1000,
  directoryLimit: 80,
  timeZone: 'UTC',
};

export const MAX_ARCHETYPE_DIRECTORY_LIMIT = 200;
const FEATURE_COUNT = 6;
const KMEANS_ITERATIONS = 40;
const KMEANS_RESTARTS = 4;
const AMBIGUOUS_MARGIN = 0.1;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function validTimeZone(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return DEFAULTS.timeZone;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return value;
  } catch {
    return DEFAULTS.timeZone;
  }
}

function resolveOptions(options: ArchetypeOptions | null | undefined): Required<ArchetypeOptions> {
  const source = isRecord(options) ? options : {};
  const minK = Math.max(2, Math.min(8, positiveInteger(source.minK, DEFAULTS.minK)));
  const maxK = Math.max(
    minK,
    Math.min(8, positiveInteger(source.maxK, DEFAULTS.maxK)),
  );
  return {
    minK,
    maxK,
    minDrives: Math.max(
      minK * 4,
      Math.min(10_000, positiveInteger(source.minDrives, DEFAULTS.minDrives)),
    ),
    minDistanceM: positiveNumber(source.minDistanceM, DEFAULTS.minDistanceM),
    silhouetteSample: Math.max(
      10,
      Math.min(1000, positiveInteger(source.silhouetteSample, DEFAULTS.silhouetteSample)),
    ),
    defaultTempC:
      finite(source.defaultTempC) ?? DEFAULTS.defaultTempC,
    seed:
      finite(source.seed) != null
        ? Math.floor(finite(source.seed)!)
        : DEFAULTS.seed,
    historyLimit: Math.max(
      1,
      Math.min(1000, positiveInteger(source.historyLimit, DEFAULTS.historyLimit)),
    ),
    directoryLimit: Math.max(
      1,
      Math.min(
        MAX_ARCHETYPE_DIRECTORY_LIMIT,
        positiveInteger(source.directoryLimit, DEFAULTS.directoryLimit),
      ),
    ),
    timeZone: validTimeZone(source.timeZone),
  };
}

function calendarParts(
  milliseconds: number,
  formatter: Intl.DateTimeFormat,
): { hour: number; month: string } {
  const parts = formatter.formatToParts(new Date(milliseconds));
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value('year');
  const month = value('month');
  const day = value('day');
  const hour = value('hour');
  const minute = value('minute');
  const second = value('second');
  if (
    year <= 0
    || month <= 0
    || day <= 0
    || hour < 0
    || minute < 0
    || second < 0
  ) {
    throw new RangeError('unable to derive calendar parts in configured timezone');
  }
  return {
    hour: hour + minute / 60 + second / 3600,
    month: `${year}-${String(month).padStart(2, '0')}`,
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(values: readonly number[], proportion: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index]!;
}

function round(value: number, precision = 3): number {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function range(values: readonly number[]): ArchetypeFeatureRange {
  if (values.length === 0) return { min: null, median: null, max: null };
  return {
    min: Math.min(...values),
    median: median(values),
    max: Math.max(...values),
  };
}

function safeAddress(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Normalize drive rows and construct the six-dimensional SI feature space.
 * Every returned row receives exactly one terminal source disposition.
 */
export function buildDrivePoints(
  drives: readonly Drive[],
  options: ArchetypeOptions = {},
): {
  points: DrivePoint[];
  skipped: number;
  accounting: ArchetypeSourceAccounting;
  coverage: Omit<ArchetypeCoverage, 'historyLimit' | 'historyCapReached'>;
  temperatureImputationC: number;
  temperatureImputationSource: 'observed_median' | 'configured_default';
  thresholds: Required<ArchetypeOptions>;
} {
  const thresholds = resolveOptions(options);
  const sourceRows = Array.isArray(drives) ? drives : [];
  const accounting: ArchetypeSourceAccounting = {
    returnedRows: sourceRows.length,
    invalidRowRows: 0,
    invalidIdRows: 0,
    duplicateDriveRows: 0,
    missingStartRows: 0,
    invalidStartRows: 0,
    invalidDistanceRows: 0,
    shortDistanceRows: 0,
    missingEnergyRows: 0,
    invalidEnergyRows: 0,
    missingSpeedRows: 0,
    invalidSpeedRows: 0,
    eligibleObservedTempRows: 0,
    eligibleImputedTempRows: 0,
  };
  const pending: PendingDrivePoint[] = [];
  const seenIds = new Set<number>();
  const timestampedMs: number[] = [];
  const observedTemperatures: number[] = [];
  const calendarFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: thresholds.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });

  for (const raw of sourceRows as readonly unknown[]) {
    if (!isRecord(raw)) {
      accounting.invalidRowRows += 1;
      continue;
    }
    const driveId = finite(raw.id);
    if (driveId == null || driveId <= 0 || !Number.isInteger(driveId)) {
      accounting.invalidIdRows += 1;
      continue;
    }
    if (seenIds.has(driveId)) {
      accounting.duplicateDriveRows += 1;
      continue;
    }
    seenIds.add(driveId);

    const startValue = raw.startTs;
    if (startValue == null || startValue === '') {
      accounting.missingStartRows += 1;
      continue;
    }
    if (typeof startValue !== 'string') {
      accounting.invalidStartRows += 1;
      continue;
    }
    const departureMs = new Date(startValue).getTime();
    if (!Number.isFinite(departureMs)) {
      accounting.invalidStartRows += 1;
      continue;
    }
    timestampedMs.push(departureMs);

    const distanceM = finite(raw.distanceM);
    if (distanceM == null || distanceM <= 0) {
      accounting.invalidDistanceRows += 1;
      continue;
    }
    if (distanceM < thresholds.minDistanceM) {
      accounting.shortDistanceRows += 1;
      continue;
    }

    if (raw.energyUsedWh == null) {
      accounting.missingEnergyRows += 1;
      continue;
    }
    const energyUsedWh = finite(raw.energyUsedWh);
    if (energyUsedWh == null || energyUsedWh <= 0) {
      accounting.invalidEnergyRows += 1;
      continue;
    }

    if (raw.avgSpeedMps == null) {
      accounting.missingSpeedRows += 1;
      continue;
    }
    const speedMps = finite(raw.avgSpeedMps);
    if (speedMps == null || speedMps <= 0) {
      accounting.invalidSpeedRows += 1;
      continue;
    }

    const observedTempC = finite(raw.outsideTempAvgC);
    if (observedTempC == null) {
      accounting.eligibleImputedTempRows += 1;
    } else {
      accounting.eligibleObservedTempRows += 1;
      observedTemperatures.push(observedTempC);
    }
    const calendar = calendarParts(departureMs, calendarFormatter);
    const durationS = finite(raw.durationS);

    pending.push({
      driveId,
      departureMs,
      distanceM,
      speedMps,
      durationS: durationS != null && durationS > 0 ? durationS : null,
      energyUsedWh,
      hour: calendar.hour,
      month: calendar.month,
      efficiencyWhPerM: energyUsedWh / distanceM,
      observedTempC,
      startAddress: safeAddress(raw.startAddress),
      endAddress: safeAddress(raw.endAddress),
    });
  }

  const measuredTemperatureMedian = median(observedTemperatures);
  const temperatureImputationC =
    measuredTemperatureMedian ?? thresholds.defaultTempC;
  const temperatureImputationSource =
    measuredTemperatureMedian == null
      ? 'configured_default'
      : 'observed_median';
  const points = pending.map((row): DrivePoint => {
    const tempImputed = row.observedTempC == null;
    const tempC = row.observedTempC ?? temperatureImputationC;
    const angle = (row.hour / 24) * 2 * Math.PI;
    return {
      driveId: row.driveId,
      departureMs: row.departureMs,
      distanceM: row.distanceM,
      speedMps: row.speedMps,
      durationS: row.durationS,
      energyUsedWh: row.energyUsedWh,
      hour: row.hour,
      month: row.month,
      efficiencyWhPerM: row.efficiencyWhPerM,
      tempC,
      tempImputed,
      startAddress: row.startAddress,
      endAddress: row.endAddress,
      features: [
        Math.log1p(row.distanceM),
        row.speedMps,
        Math.sin(angle),
        Math.cos(angle),
        row.efficiencyWhPerM,
        tempC,
      ],
    };
  });
  const earliestMs =
    timestampedMs.length > 0 ? Math.min(...timestampedMs) : null;
  const latestMs =
    timestampedMs.length > 0 ? Math.max(...timestampedMs) : null;

  return {
    points,
    skipped: accounting.returnedRows - points.length,
    accounting,
    coverage: {
      timestampedRows: timestampedMs.length,
      earliestMs,
      latestMs,
      spanS:
        earliestMs != null && latestMs != null
          ? (latestMs - earliestMs) / 1000
          : 0,
    },
    temperatureImputationC,
    temperatureImputationSource,
    thresholds,
  };
}

function standardize(points: readonly DrivePoint[]): StandardizedData {
  const means = new Array<number>(FEATURE_COUNT).fill(0);
  const deviations = new Array<number>(FEATURE_COUNT).fill(0);
  for (let feature = 0; feature < FEATURE_COUNT; feature += 1) {
    means[feature] =
      points.reduce((sum, point) => sum + point.features[feature]!, 0)
      / points.length;
    const variance =
      points.reduce((sum, point) => {
        const delta = point.features[feature]! - means[feature]!;
        return sum + delta * delta;
      }, 0) / points.length;
    deviations[feature] = Math.sqrt(variance);
  }
  return {
    values: points.map((point) =>
      point.features.map((value, feature) =>
        deviations[feature]! > 1e-9
          ? (value - means[feature]!) / deviations[feature]!
          : 0,
      ),
    ),
    activeDimensions: deviations.filter((value) => value > 1e-9).length,
    means,
    deviations,
  };
}

function sqDist(a: readonly number[], b: readonly number[]): number {
  let sum = 0;
  for (let index = 0; index < a.length; index += 1) {
    const delta = a[index]! - b[index]!;
    sum += delta * delta;
  }
  return sum;
}

/** Deterministic 32-bit PRNG. */
function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** K-means++ seeding followed by bounded Lloyd iterations. */
export function kMeans(
  data: readonly number[][],
  k: number,
  rand: () => number,
): { assignments: number[]; centroids: number[][]; inertia: number } {
  const pointCount = data.length;
  const dimensions = data[0]?.length ?? 0;
  if (
    pointCount === 0
    || dimensions === 0
    || !Number.isInteger(k)
    || k < 1
    || k > pointCount
  ) {
    throw new RangeError('kMeans requires non-empty data and 1 <= k <= point count');
  }

  const centroids: number[][] = [
    [...data[Math.min(pointCount - 1, Math.floor(rand() * pointCount))]!],
  ];
  const closest = data.map((point) => sqDist(point, centroids[0]!));

  while (centroids.length < k) {
    const total = closest.reduce((sum, distance) => sum + distance, 0);
    let pick = centroids.length % pointCount;
    if (total > 0) {
      let target = rand() * total;
      pick = pointCount - 1;
      for (let index = 0; index < pointCount; index += 1) {
        target -= closest[index]!;
        if (target <= 0) {
          pick = index;
          break;
        }
      }
    }
    const next = [...data[pick]!];
    centroids.push(next);
    for (let index = 0; index < pointCount; index += 1) {
      closest[index] = Math.min(
        closest[index]!,
        sqDist(data[index]!, next),
      );
    }
  }

  const assignments = new Array<number>(pointCount).fill(0);
  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    let moved = false;
    for (let index = 0; index < pointCount; index += 1) {
      let bestCluster = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let cluster = 0; cluster < centroids.length; cluster += 1) {
        const distance = sqDist(data[index]!, centroids[cluster]!);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCluster = cluster;
        }
      }
      if (assignments[index] !== bestCluster) {
        assignments[index] = bestCluster;
        moved = true;
      }
    }

    const sums = Array.from(
      { length: k },
      () => new Array<number>(dimensions).fill(0),
    );
    const counts = new Array<number>(k).fill(0);
    for (let index = 0; index < pointCount; index += 1) {
      const cluster = assignments[index]!;
      counts[cluster] += 1;
      for (let feature = 0; feature < dimensions; feature += 1) {
        sums[cluster]![feature]! += data[index]![feature]!;
      }
    }
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (counts[cluster] === 0) {
        let farthestIndex = 0;
        let farthestDistance = -1;
        for (let index = 0; index < pointCount; index += 1) {
          const distance = sqDist(
            data[index]!,
            centroids[assignments[index]!]!,
          );
          if (distance > farthestDistance) {
            farthestDistance = distance;
            farthestIndex = index;
          }
        }
        centroids[cluster] = [...data[farthestIndex]!];
        continue;
      }
      for (let feature = 0; feature < dimensions; feature += 1) {
        centroids[cluster]![feature] =
          sums[cluster]![feature]! / counts[cluster]!;
      }
    }
    if (!moved && iteration > 0) break;
  }

  const inertia = data.reduce(
    (sum, point, index) =>
      sum + sqDist(point, centroids[assignments[index]!]!),
    0,
  );
  return { assignments, centroids, inertia };
}

/**
 * Mean silhouette coefficient over a deterministic bounded sample.
 * Singleton-cluster members contribute zero instead of disappearing.
 */
export function meanSilhouette(
  data: readonly number[][],
  assignments: readonly number[],
  k: number,
  sampleSize: number,
): number {
  if (data.length < 2 || k < 2 || assignments.length !== data.length) return 0;
  const step = Math.max(1, Math.ceil(data.length / Math.max(1, sampleSize)));
  let total = 0;
  let counted = 0;

  for (let index = 0; index < data.length; index += step) {
    const own = assignments[index]!;
    const sums = new Array<number>(k).fill(0);
    const counts = new Array<number>(k).fill(0);
    for (let other = 0; other < data.length; other += 1) {
      if (index === other) continue;
      const cluster = assignments[other]!;
      sums[cluster]! += Math.sqrt(sqDist(data[index]!, data[other]!));
      counts[cluster]! += 1;
    }
    counted += 1;
    if (counts[own] === 0) continue;
    const within = sums[own]! / counts[own]!;
    let nearest = Number.POSITIVE_INFINITY;
    for (let cluster = 0; cluster < k; cluster += 1) {
      if (cluster === own || counts[cluster] === 0) continue;
      nearest = Math.min(nearest, sums[cluster]! / counts[cluster]!);
    }
    if (!Number.isFinite(nearest)) continue;
    const denominator = Math.max(within, nearest);
    if (denominator > 0) total += (nearest - within) / denominator;
  }
  return counted > 0 ? total / counted : 0;
}

function combinationsOfTwo(value: number): number {
  return value < 2 ? 0 : (value * (value - 1)) / 2;
}

/** Label-invariant restart agreement using the adjusted Rand index. */
export function adjustedRandIndex(
  first: readonly number[],
  second: readonly number[],
): number {
  if (first.length !== second.length || first.length < 2) return 0;
  const rows = new Map<number, number>();
  const columns = new Map<number, number>();
  const cells = new Map<string, number>();
  for (let index = 0; index < first.length; index += 1) {
    const row = first[index]!;
    const column = second[index]!;
    rows.set(row, (rows.get(row) ?? 0) + 1);
    columns.set(column, (columns.get(column) ?? 0) + 1);
    const key = `${row}:${column}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const pairCount = combinationsOfTwo(first.length);
  if (pairCount === 0) return 0;
  const cellPairs = [...cells.values()].reduce(
    (sum, count) => sum + combinationsOfTwo(count),
    0,
  );
  const rowPairs = [...rows.values()].reduce(
    (sum, count) => sum + combinationsOfTwo(count),
    0,
  );
  const columnPairs = [...columns.values()].reduce(
    (sum, count) => sum + combinationsOfTwo(count),
    0,
  );
  const expected = (rowPairs * columnPairs) / pairCount;
  const maximum = (rowPairs + columnPairs) / 2;
  const denominator = maximum - expected;
  if (Math.abs(denominator) < 1e-12) {
    const forward = new Map<number, number>();
    const reverse = new Map<number, number>();
    for (let index = 0; index < first.length; index += 1) {
      const left = first[index]!;
      const right = second[index]!;
      if (
        (forward.has(left) && forward.get(left) !== right)
        || (reverse.has(right) && reverse.get(right) !== left)
      ) {
        return 0;
      }
      forward.set(left, right);
      reverse.set(right, left);
    }
    return 1;
  }
  return (cellPairs - expected) / denominator;
}

function evaluateCandidate(
  data: readonly number[][],
  k: number,
  options: Required<ArchetypeOptions>,
): CandidateEvaluation {
  const runs = Array.from({ length: KMEANS_RESTARTS }, (_, restart) =>
    kMeans(data, k, mulberry32(options.seed + k * 131 + restart * 977)),
  ).sort((left, right) => left.inertia - right.inertia);
  const realizedClusterCount = (assignments: readonly number[]) =>
    new Set(assignments).size;
  const best =
    runs.find((run) => realizedClusterCount(run.assignments) === k)
    ?? runs[0]!;
  const clusterSizes = new Array<number>(k).fill(0);
  for (const assignment of best.assignments) clusterSizes[assignment] += 1;
  const realizedK = clusterSizes.filter((size) => size > 0).length;
  const silhouette =
    realizedK === k
      ? meanSilhouette(data, best.assignments, k, options.silhouetteSample)
      : 0;
  const agreements = runs.filter((run) => run !== best).map((run) =>
    adjustedRandIndex(best.assignments, run.assignments),
  );
  return {
    public: {
      k,
      realizedK,
      silhouette,
      inertia: round(best.inertia),
      restartAgreement: round(
        agreements.length > 0
          ? agreements.reduce((sum, value) => sum + value, 0) / agreements.length
          : 1,
      ),
      smallestCluster: Math.min(...clusterSizes.filter((size) => size > 0)),
      largestCluster: Math.max(...clusterSizes),
      selected: false,
    },
    rawSilhouette: silhouette,
    assignments: best.assignments,
    centroids: best.centroids,
  };
}

function circularMeanHour(hours: readonly number[]): number {
  const x = hours.reduce(
    (sum, hour) => sum + Math.cos((hour / 24) * 2 * Math.PI),
    0,
  );
  const y = hours.reduce(
    (sum, hour) => sum + Math.sin((hour / 24) * 2 * Math.PI),
    0,
  );
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return 0;
  let angle = Math.atan2(y, x);
  if (angle < 0) angle += 2 * Math.PI;
  return (angle / (2 * Math.PI)) * 24;
}

/** Assign a heuristic display label from a cluster's SI centroid. */
export function labelForCentroid(centroid: ArchetypeCentroid): ArchetypeLabel {
  if (centroid.distanceM >= 150_000) return 'roadTrip';
  if (centroid.speedMps >= 70 / 3.6 && centroid.distanceM >= 30_000) {
    return 'highwayRun';
  }
  if (centroid.distanceM <= 6_000) return 'shortHop';
  if (centroid.tempC <= 3) return 'coldWeather';
  if (centroid.hour >= 5.5 && centroid.hour < 10.5) return 'morningCommute';
  if (centroid.hour >= 15.5 && centroid.hour < 20.5) return 'eveningCommute';
  return 'everyday';
}

function qualityFor(status: ArchetypeStatus, silhouette: number): ArchetypeQuality {
  if (status !== 'clustered') return 'none';
  if (silhouette >= 0.5) return 'strong';
  if (silhouette >= 0.25) return 'moderate';
  return 'limited';
}

function buildHourlyProfile(
  assignments: readonly ArchetypeAssignment[],
): ArchetypeHourBucket[] {
  return Array.from({ length: 24 }, (_, hour) => {
    const members = assignments.filter(
      (assignment) => Math.floor(assignment.localHour) % 24 === hour,
    );
    const counts = new Map<number, number>();
    for (const member of members) {
      counts.set(member.clusterIndex, (counts.get(member.clusterIndex) ?? 0) + 1);
    }
    return {
      hour,
      total: members.length,
      clusters: [...counts.entries()]
        .map(([clusterIndex, count]) => ({ clusterIndex, count }))
        .sort((left, right) => left.clusterIndex - right.clusterIndex),
    };
  });
}

function buildMonthlyProfile(
  assignments: readonly ArchetypeAssignment[],
): ArchetypeMonthBucket[] {
  const buckets = new Map<string, Map<number, number>>();
  for (const assignment of assignments) {
    const month = assignment.localMonth;
    const counts = buckets.get(month) ?? new Map<number, number>();
    counts.set(
      assignment.clusterIndex,
      (counts.get(assignment.clusterIndex) ?? 0) + 1,
    );
    buckets.set(month, counts);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, counts]) => ({
      month,
      total: [...counts.values()].reduce((sum, count) => sum + count, 0),
      clusters: [...counts.entries()]
        .map(([clusterIndex, count]) => ({ clusterIndex, count }))
        .sort((left, right) => left.clusterIndex - right.clusterIndex),
    }));
}

function emptySummary(
  status: Exclude<ArchetypeStatus, 'clustered'>,
  normalized: ReturnType<typeof buildDrivePoints>,
  activeFeatureDimensions: number,
): ArchetypeSummary {
  const eligibleRows =
    normalized.accounting.eligibleObservedTempRows
    + normalized.accounting.eligibleImputedTempRows;
  const sourceOutcomeTotal = Object.entries(normalized.accounting)
    .filter(([key]) => key !== 'returnedRows')
    .reduce((sum, [, value]) => sum + value, 0);
  return {
    status,
    quality: 'none',
    clusters: [],
    k: 0,
    silhouette: 0,
    analyzedDrives: normalized.points.length,
    skippedDrives: normalized.skipped,
    source: normalized.accounting,
    coverage: {
      ...normalized.coverage,
      historyLimit: normalized.thresholds.historyLimit,
      historyCapReached:
        normalized.accounting.returnedRows >= normalized.thresholds.historyLimit,
    },
    candidates: [],
    assignments: [],
    directory: {
      total: 0,
      displayed: 0,
      omitted: 0,
      cap: normalized.thresholds.directoryLimit,
      items: [],
    },
    featureRanges: {
      distanceM: range(normalized.points.map((point) => point.distanceM)),
      speedMps: range(normalized.points.map((point) => point.speedMps)),
      efficiencyWhPerM: range(
        normalized.points.map((point) => point.efficiencyWhPerM),
      ),
      tempC: range(normalized.points.map((point) => point.tempC)),
    },
    hourlyProfile: buildHourlyProfile([]),
    monthlyProfile: [],
    temperatureImputationC: normalized.temperatureImputationC,
    temperatureImputationSource: normalized.temperatureImputationSource,
    activeFeatureDimensions,
    labelCollisionCount: 0,
    thresholds: normalized.thresholds,
    identities: {
      sourceRowsBalanced:
        normalized.accounting.returnedRows === sourceOutcomeTotal,
      eligibleRowsBalanced: normalized.points.length === eligibleRows,
      clusterMembershipBalanced: true,
      assignmentsBalanced: true,
      directoryBalanced: true,
      selectedCandidateBalanced: true,
    },
  };
}

export function summarizeArchetypes(
  drives: readonly Drive[],
  options: ArchetypeOptions = {},
): ArchetypeSummary {
  const normalized = buildDrivePoints(drives, options);
  const standardized =
    normalized.points.length > 0
      ? standardize(normalized.points)
      : {
          values: [],
          activeDimensions: 0,
          means: new Array<number>(FEATURE_COUNT).fill(0),
          deviations: new Array<number>(FEATURE_COUNT).fill(0),
        };
  if (normalized.points.length < normalized.thresholds.minDrives) {
    return emptySummary(
      'insufficient_drives',
      normalized,
      standardized.activeDimensions,
    );
  }

  if (standardized.activeDimensions === 0) {
    return emptySummary(
      'insufficient_variation',
      normalized,
      standardized.activeDimensions,
    );
  }

  const maxK = Math.min(
    normalized.thresholds.maxK,
    Math.floor(normalized.points.length / 4),
  );
  const evaluations: CandidateEvaluation[] = [];
  for (let k = normalized.thresholds.minK; k <= maxK; k += 1) {
    evaluations.push(
      evaluateCandidate(standardized.values, k, normalized.thresholds),
    );
  }
  const eligibleEvaluations = evaluations.filter(
    (candidate) => candidate.public.realizedK === candidate.public.k,
  );
  if (eligibleEvaluations.length === 0) {
    const summary = emptySummary(
      'insufficient_partition',
      normalized,
      standardized.activeDimensions,
    );
    summary.candidates = evaluations.map((evaluation) => evaluation.public);
    return summary;
  }
  const selected = eligibleEvaluations.reduce((best, candidate) => {
    if (candidate.rawSilhouette > best.rawSilhouette) return candidate;
    if (
      candidate.rawSilhouette === best.rawSilhouette
      && candidate.public.k < best.public.k
    ) {
      return candidate;
    }
    return best;
  });
  selected.public.selected = true;

  const realizedClusterIndices = [...new Set(selected.assignments)]
    .sort((left, right) => left - right);
  const assignmentDrafts = normalized.points.map((point, index) => {
    const clusterIndex = selected.assignments[index]!;
    const distances = realizedClusterIndices
      .map((candidateIndex) => ({
        clusterIndex: candidateIndex,
        distance: Math.sqrt(
          sqDist(
            standardized.values[index]!,
            selected.centroids[candidateIndex]!,
          ),
        ),
      }))
      .sort((left, right) => left.distance - right.distance);
    const assigned =
      distances.find((distance) => distance.clusterIndex === clusterIndex)
      ?? distances[0]!;
    const second =
      distances.find((distance) => distance.clusterIndex !== clusterIndex)
      ?? null;
    const assignmentMargin =
      second != null && second.distance > 0
        ? Math.max(
            0,
            Math.min(1, (second.distance - assigned.distance) / second.distance),
          )
        : 0;
    return {
      point,
      clusterIndex,
      assignmentDistance: assigned.distance,
      secondClusterDistance: second?.distance ?? null,
      assignmentMargin,
    };
  });

  const clusters: Archetype[] = realizedClusterIndices
    .map((clusterIndex) => {
      const members = assignmentDrafts.filter(
        (assignment) => assignment.clusterIndex === clusterIndex,
      );
      const mean = (pick: (point: DrivePoint) => number) =>
        members.reduce((sum, member) => sum + pick(member.point), 0)
        / members.length;
      const centroid: ArchetypeCentroid = {
        distanceM: round(
          Math.expm1(
            selected.centroids[clusterIndex]![0]!
              * standardized.deviations[0]!
              + standardized.means[0]!,
          ),
          1,
        ),
        speedMps: round(mean((point) => point.speedMps)),
        hour: round(circularMeanHour(members.map((member) => member.point.hour)), 1),
        efficiencyWhPerM: round(mean((point) => point.efficiencyWhPerM), 4),
        tempC: round(mean((point) => point.tempC), 1),
      };
      const representativeDriveIds = [...members]
        .sort(
          (left, right) =>
            left.assignmentDistance - right.assignmentDistance
            || left.point.driveId - right.point.driveId,
        )
        .slice(0, 3)
        .map((member) => member.point.driveId);
      const nearest = realizedClusterIndices
        .map((candidateIndex) => ({
          clusterIndex: candidateIndex,
          distance:
            candidateIndex === clusterIndex
              ? Number.POSITIVE_INFINITY
              : Math.sqrt(
                  sqDist(
                    selected.centroids[clusterIndex]!,
                    selected.centroids[candidateIndex]!,
                  ),
                ),
        }))
        .sort((left, right) => left.distance - right.distance)[0] ?? null;
      return {
        index: clusterIndex,
        label: labelForCentroid(centroid),
        size: members.length,
        share: members.length / normalized.points.length,
        centroid,
        medianEfficiencyWhPerM:
          median(members.map((member) => member.point.efficiencyWhPerM)) ?? 0,
        totalDistanceM: members.reduce(
          (sum, member) => sum + member.point.distanceM,
          0,
        ),
        totalEnergyWh: members.reduce(
          (sum, member) => sum + member.point.energyUsedWh,
          0,
        ),
        driveIds: members.map((member) => member.point.driveId),
        representativeDriveIds,
        meanAssignmentDistance: round(
          members.reduce(
            (sum, member) => sum + member.assignmentDistance,
            0,
          ) / members.length,
        ),
        p90AssignmentDistance: round(
          percentile(
            members.map((member) => member.assignmentDistance),
            0.9,
          ),
        ),
        medianAssignmentMargin: round(
          median(members.map((member) => member.assignmentMargin)) ?? 0,
        ),
        ambiguousAssignments: members.filter(
          (member) => member.assignmentMargin < AMBIGUOUS_MARGIN,
        ).length,
        nearestClusterIndex: nearest?.clusterIndex ?? null,
        nearestCentroidDistance:
          nearest != null && Number.isFinite(nearest.distance)
            ? round(nearest.distance)
            : null,
      };
    })
    .filter((cluster) => cluster.size > 0)
    .sort((left, right) => right.size - left.size || left.index - right.index);
  const labelsByCluster = new Map(
    clusters.map((cluster) => [cluster.index, cluster.label]),
  );
  const assignments: ArchetypeAssignment[] = assignmentDrafts.map(
    ({
      point,
      clusterIndex,
      assignmentDistance,
      secondClusterDistance,
      assignmentMargin,
    }) => ({
      driveId: point.driveId,
      departureMs: point.departureMs,
      clusterIndex,
      label: labelsByCluster.get(clusterIndex) ?? 'everyday',
      distanceM: point.distanceM,
      speedMps: point.speedMps,
      durationS: point.durationS,
      energyUsedWh: point.energyUsedWh,
      efficiencyWhPerM: point.efficiencyWhPerM,
      tempC: point.tempC,
      tempImputed: point.tempImputed,
      localHour: point.hour,
      localMonth: point.month,
      startAddress: point.startAddress,
      endAddress: point.endAddress,
      assignmentDistance: round(assignmentDistance),
      secondClusterDistance:
        secondClusterDistance != null ? round(secondClusterDistance) : null,
      assignmentMargin,
    }),
  );
  const directoryItems = [...assignments]
    .sort(
      (left, right) =>
        right.departureMs - left.departureMs || right.driveId - left.driveId,
    )
    .slice(0, normalized.thresholds.directoryLimit);
  const directoryDriveIds = new Set(
    directoryItems.map((assignment) => assignment.driveId),
  );
  const outsideDirectory = assignments.filter(
    (assignment) => !directoryDriveIds.has(assignment.driveId),
  );
  const sourceOutcomeTotal = Object.entries(normalized.accounting)
    .filter(([key]) => key !== 'returnedRows')
    .reduce((sum, [, value]) => sum + value, 0);
  const eligibleRows =
    normalized.accounting.eligibleObservedTempRows
    + normalized.accounting.eligibleImputedTempRows;
  const clusterMembers = clusters.reduce(
    (sum, cluster) => sum + cluster.size,
    0,
  );

  return {
    status: 'clustered',
    quality: qualityFor('clustered', selected.public.silhouette),
    clusters,
    k: clusters.length,
    silhouette: selected.public.silhouette,
    analyzedDrives: normalized.points.length,
    skippedDrives: normalized.skipped,
    source: normalized.accounting,
    coverage: {
      ...normalized.coverage,
      historyLimit: normalized.thresholds.historyLimit,
      historyCapReached:
        normalized.accounting.returnedRows >= normalized.thresholds.historyLimit,
    },
    candidates: evaluations.map((evaluation) => evaluation.public),
    assignments,
    directory: {
      total: assignments.length,
      displayed: directoryItems.length,
      omitted: outsideDirectory.length,
      cap: normalized.thresholds.directoryLimit,
      items: directoryItems,
    },
    featureRanges: {
      distanceM: range(normalized.points.map((point) => point.distanceM)),
      speedMps: range(normalized.points.map((point) => point.speedMps)),
      efficiencyWhPerM: range(
        normalized.points.map((point) => point.efficiencyWhPerM),
      ),
      tempC: range(normalized.points.map((point) => point.tempC)),
    },
    hourlyProfile: buildHourlyProfile(assignments),
    monthlyProfile: buildMonthlyProfile(assignments),
    temperatureImputationC: normalized.temperatureImputationC,
    temperatureImputationSource: normalized.temperatureImputationSource,
    activeFeatureDimensions: standardized.activeDimensions,
    labelCollisionCount:
      clusters.length - new Set(clusters.map((cluster) => cluster.label)).size,
    thresholds: normalized.thresholds,
    identities: {
      sourceRowsBalanced:
        normalized.accounting.returnedRows === sourceOutcomeTotal,
      eligibleRowsBalanced: normalized.points.length === eligibleRows,
      clusterMembershipBalanced:
        normalized.points.length === clusterMembers,
      assignmentsBalanced:
        normalized.points.length === assignments.length,
      directoryBalanced:
        directoryDriveIds.size === directoryItems.length
        && directoryItems.every((item) =>
          assignments.some((assignment) => assignment.driveId === item.driveId)
        )
        && assignments.length === directoryItems.length + outsideDirectory.length,
      selectedCandidateBalanced:
        evaluations.filter((evaluation) => evaluation.public.selected).length === 1,
    },
  };
}
