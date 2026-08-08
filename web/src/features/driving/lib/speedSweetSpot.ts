/**
 * Speed Sweet Spot model — descriptive evidence from whole-drive averages.
 *
 * Inputs remain canonical SI (m/s, m, s, Wh). The only km-based values are
 * Wh/km and the explicit 10 km/h bucket semantics used by this analysis.
 * Display conversion belongs to the React render boundary.
 */

import type { Drive } from '@/types/driving';

export const DEFAULT_BUCKET_KPH = 10;
export const DEFAULT_MIN_DRIVES_PER_BUCKET = 3;
export const DEFAULT_SCATTER_LIMIT = 300;
export const MIN_ELIGIBLE_DISTANCE_M = 2_000;
export const MIN_ELIGIBLE_DURATION_S = 300;

export interface SweetSpotOptions {
  /** Positive finite bucket width in km/h. */
  bucketKph?: number;
  /** Positive finite drive count required for a qualified bucket. */
  minDrivesPerBucket?: number;
  /** Requested API row limit, used only to identify a potentially capped window. */
  windowLimit?: number;
  /** Positive finite maximum number of drive points returned for visualization. */
  scatterLimit?: number;
}

export interface SpeedBucketPoint {
  key: string;
  bucketIndex: number;
  /** Inclusive lower and exclusive upper bucket bounds in km/h. */
  fromKph: number;
  toKph: number;
  speedKph: number;
  whPerKm: number;
  drives: number;
  distanceM: number;
  distanceShare: number;
  qualified: boolean;
}

export interface SpeedBandScore extends SpeedBucketPoint {
  /** Consumption rank among qualified bands; 1 is lowest. */
  rank: number | null;
  gapToBestWhPerKm: number | null;
  gapToOverallWhPerKm: number | null;
}

export interface SweetSpotBand {
  key: string;
  fromKph: number;
  toKph: number;
  speedKph: number;
  whPerKm: number;
  drives: number;
  distanceM: number;
  distanceShare: number;
}

export interface WinningBandCoverage {
  drives: number;
  driveShare: number;
  distanceM: number;
  distanceShare: number;
}

export interface RunnerUpContrast {
  band: SweetSpotBand;
  gapWhPerKm: number;
  /** Runner-up consumption minus winning consumption, divided by the winner. */
  gapShare: number;
}

export interface MonthlyOperatingContext {
  /** UTC calendar month containing the drive start. */
  month: string;
  drives: number;
  distanceM: number;
  durationS: number;
  energyUsedWh: number;
  /** Total distance divided by total duration, in canonical m/s. */
  avgSpeedMps: number;
  /** Total energy divided by total distance. */
  whPerKm: number;
}

export interface DriveEvidencePoint {
  driveId: number;
  startTs: string | null;
  avgSpeedMps: number;
  whPerKm: number;
  distanceM: number;
  bucketKey: string;
}

export interface SweetSpotResult {
  /** Ascending speed buckets, retained for compatibility with the original curve. */
  points: SpeedBucketPoint[];
  /** Ascending speed buckets with qualification ranks and comparison gaps. */
  bands: SpeedBandScore[];
  sweetSpot: SweetSpotBand | null;
  overallWhPerKm: number | null;
  observedGapWhPerKm: number | null;
  /**
   * Signed descriptive difference between overall weighted consumption and
   * the best qualified band, relative to overall consumption.
   */
  observedGapShare: number | null;
  observed: number;
  eligible: number;
  excluded: number;
  totalEligibleDistanceM: number;
  qualifiedBandCount: number;
  winningBandCoverage: WinningBandCoverage | null;
  runnerUp: RunnerUpContrast | null;
  monthly: MonthlyOperatingContext[];
  driveEvidence: DriveEvidencePoint[];
  driveEvidenceTotal: number;
  driveEvidenceCapped: boolean;
  scatterLimit: number;
  invalidDateCount: number;
  windowLimit: number | null;
  historyCapReached: boolean;
}

interface EligibleDrive {
  driveId: number;
  startTs: string | null;
  startMs: number | null;
  avgSpeedMps: number;
  speedKph: number;
  energyUsedWh: number;
  distanceM: number;
  durationS: number;
  whPerKm: number;
}

interface BucketAggregate {
  energyUsedWh: number;
  distanceM: number;
  drives: number;
}

function positiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function positiveInteger(value: number, name: string): number {
  return Math.max(1, Math.ceil(positiveFinite(value, name)));
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseStart(value: unknown): { startTs: string | null; startMs: number | null } {
  if (typeof value !== 'string' || value.trim() === '') {
    return { startTs: null, startMs: null };
  }
  const startMs = Date.parse(value);
  return Number.isFinite(startMs)
    ? { startTs: value, startMs }
    : { startTs: null, startMs: null };
}

function toEligibleDrive(drive: Drive): EligibleDrive | null {
  const energyUsedWh = drive.energyUsedWh;
  const avgSpeedMps = drive.avgSpeedMps;
  if (
    energyUsedWh == null ||
    !Number.isFinite(energyUsedWh) ||
    energyUsedWh <= 0 ||
    avgSpeedMps == null ||
    !Number.isFinite(avgSpeedMps) ||
    avgSpeedMps <= 0 ||
    !Number.isFinite(drive.distanceM) ||
    drive.distanceM < MIN_ELIGIBLE_DISTANCE_M ||
    !Number.isFinite(drive.durationS) ||
    drive.durationS < MIN_ELIGIBLE_DURATION_S
  ) {
    return null;
  }

  const parsed = parseStart(drive.startTs);
  return {
    driveId: drive.id,
    ...parsed,
    avgSpeedMps,
    speedKph: avgSpeedMps * 3.6,
    energyUsedWh,
    distanceM: drive.distanceM,
    durationS: drive.durationS,
    whPerKm: energyUsedWh / (drive.distanceM / 1_000),
  };
}

/** Stabilize conceptual boundaries such as `(60 / 3.6) * 3.6`. */
function bucketIndex(speedKph: number, bucketKph: number): number {
  const quotient = speedKph / bucketKph;
  const nearestInteger = Math.round(quotient);
  const tolerance = 1e-10 * Math.max(1, Math.abs(quotient));
  return Math.floor(
    Math.abs(quotient - nearestInteger) <= tolerance
      ? nearestInteger
      : quotient,
  );
}

function bandKey(index: number, bucketKph: number): string {
  return `${index * bucketKph}:${(index + 1) * bucketKph}`;
}

function asSweetSpot(point: SpeedBucketPoint): SweetSpotBand {
  return {
    key: point.key,
    fromKph: point.fromKph,
    toKph: point.toKph,
    speedKph: point.speedKph,
    whPerKm: point.whPerKm,
    drives: point.drives,
    distanceM: point.distanceM,
    distanceShare: point.distanceShare,
  };
}

function buildMonthly(rows: readonly EligibleDrive[]): MonthlyOperatingContext[] {
  const months = new Map<string, BucketAggregate & { durationS: number }>();
  for (const row of rows) {
    if (row.startMs == null) continue;
    const month = new Date(row.startMs).toISOString().slice(0, 7);
    const aggregate = months.get(month) ?? {
      energyUsedWh: 0,
      distanceM: 0,
      durationS: 0,
      drives: 0,
    };
    aggregate.energyUsedWh += row.energyUsedWh;
    aggregate.distanceM += row.distanceM;
    aggregate.durationS += row.durationS;
    aggregate.drives += 1;
    months.set(month, aggregate);
  }

  return [...months.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, aggregate]) => ({
      month,
      drives: aggregate.drives,
      distanceM: aggregate.distanceM,
      durationS: aggregate.durationS,
      energyUsedWh: aggregate.energyUsedWh,
      avgSpeedMps: aggregate.distanceM / aggregate.durationS,
      whPerKm: round1(aggregate.energyUsedWh / (aggregate.distanceM / 1_000)),
    }));
}

/**
 * Evenly sample a chronologically sorted series. For limits above one this
 * always includes the first and last rows, then deterministic interior rows.
 */
function sampleEvidence(
  rows: readonly DriveEvidencePoint[],
  limit: number,
): DriveEvidencePoint[] {
  if (rows.length <= limit) return [...rows];
  if (limit === 1) return [rows[Math.floor((rows.length - 1) / 2)]!];
  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round((index * (rows.length - 1)) / (limit - 1));
    return rows[sourceIndex]!;
  });
}

export function computeSweetSpot(
  drives: readonly Drive[],
  options: SweetSpotOptions = {},
): SweetSpotResult {
  const bucketKph = positiveFinite(
    options.bucketKph ?? DEFAULT_BUCKET_KPH,
    'bucketKph',
  );
  const minDrives = positiveInteger(
    options.minDrivesPerBucket ?? DEFAULT_MIN_DRIVES_PER_BUCKET,
    'minDrivesPerBucket',
  );
  const scatterLimit = positiveInteger(
    options.scatterLimit ?? DEFAULT_SCATTER_LIMIT,
    'scatterLimit',
  );
  const windowLimit =
    options.windowLimit == null
      ? null
      : positiveInteger(options.windowLimit, 'windowLimit');

  const eligibleRows = drives
    .map(toEligibleDrive)
    .filter((row): row is EligibleDrive => row != null);
  const totalEnergyWh = eligibleRows.reduce(
    (sum, row) => sum + row.energyUsedWh,
    0,
  );
  const totalDistanceM = eligibleRows.reduce(
    (sum, row) => sum + row.distanceM,
    0,
  );

  const buckets = new Map<number, BucketAggregate>();
  for (const row of eligibleRows) {
    const index = bucketIndex(row.speedKph, bucketKph);
    const aggregate = buckets.get(index) ?? {
      energyUsedWh: 0,
      distanceM: 0,
      drives: 0,
    };
    aggregate.energyUsedWh += row.energyUsedWh;
    aggregate.distanceM += row.distanceM;
    aggregate.drives += 1;
    buckets.set(index, aggregate);
  }

  const points: SpeedBucketPoint[] = [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, aggregate]) => ({
      key: bandKey(index, bucketKph),
      bucketIndex: index,
      fromKph: index * bucketKph,
      toKph: (index + 1) * bucketKph,
      speedKph: index * bucketKph + bucketKph / 2,
      whPerKm: round1(
        aggregate.energyUsedWh / (aggregate.distanceM / 1_000),
      ),
      drives: aggregate.drives,
      distanceM: aggregate.distanceM,
      distanceShare:
        totalDistanceM > 0 ? aggregate.distanceM / totalDistanceM : 0,
      qualified: aggregate.drives >= minDrives,
    }));

  const qualified = points
    .filter((point) => point.qualified)
    .sort(
      (left, right) =>
        left.whPerKm - right.whPerKm ||
        left.fromKph - right.fromKph,
    );
  const rankByKey = new Map(
    qualified.map((point, index) => [point.key, index + 1]),
  );
  const best = qualified[0] ?? null;
  const overallWhPerKm =
    totalDistanceM > 0
      ? round1(totalEnergyWh / (totalDistanceM / 1_000))
      : null;

  const bands: SpeedBandScore[] = points.map((point) => ({
    ...point,
    rank: rankByKey.get(point.key) ?? null,
    gapToBestWhPerKm:
      best != null ? round1(point.whPerKm - best.whPerKm) : null,
    gapToOverallWhPerKm:
      overallWhPerKm != null
        ? round1(point.whPerKm - overallWhPerKm)
        : null,
  }));
  const sweetSpot = best != null ? asSweetSpot(best) : null;
  const observedGapWhPerKm =
    sweetSpot != null && overallWhPerKm != null
      ? round1(overallWhPerKm - sweetSpot.whPerKm)
      : null;
  const observedGapShare =
    observedGapWhPerKm != null &&
    overallWhPerKm != null &&
    overallWhPerKm > 0
      ? observedGapWhPerKm / overallWhPerKm
      : null;

  const runnerPoint = qualified[1] ?? null;
  const runnerUp =
    best != null && runnerPoint != null
      ? {
          band: asSweetSpot(runnerPoint),
          gapWhPerKm: round1(runnerPoint.whPerKm - best.whPerKm),
          gapShare:
            best.whPerKm > 0
              ? (runnerPoint.whPerKm - best.whPerKm) / best.whPerKm
              : 0,
        }
      : null;

  const sortedEvidence = eligibleRows
    .map<DriveEvidencePoint>((row) => ({
      driveId: row.driveId,
      startTs: row.startTs,
      avgSpeedMps: row.avgSpeedMps,
      whPerKm: round1(row.whPerKm),
      distanceM: row.distanceM,
      bucketKey: bandKey(bucketIndex(row.speedKph, bucketKph), bucketKph),
    }))
    .sort((left, right) => {
      const leftMs = left.startTs == null ? Number.POSITIVE_INFINITY : Date.parse(left.startTs);
      const rightMs = right.startTs == null ? Number.POSITIVE_INFINITY : Date.parse(right.startTs);
      return leftMs - rightMs || left.driveId - right.driveId;
    });

  const observed = drives.length;
  const eligible = eligibleRows.length;
  return {
    points,
    bands,
    sweetSpot,
    overallWhPerKm,
    observedGapWhPerKm,
    observedGapShare,
    observed,
    eligible,
    excluded: observed - eligible,
    totalEligibleDistanceM: totalDistanceM,
    qualifiedBandCount: qualified.length,
    winningBandCoverage:
      sweetSpot != null
        ? {
            drives: sweetSpot.drives,
            driveShare: eligible > 0 ? sweetSpot.drives / eligible : 0,
            distanceM: sweetSpot.distanceM,
            distanceShare: sweetSpot.distanceShare,
          }
        : null,
    runnerUp,
    monthly: buildMonthly(eligibleRows),
    driveEvidence: sampleEvidence(sortedEvidence, scatterLimit),
    driveEvidenceTotal: sortedEvidence.length,
    driveEvidenceCapped: sortedEvidence.length > scatterLimit,
    scatterLimit,
    invalidDateCount: eligibleRows.filter((row) => row.startMs == null).length,
    windowLimit,
    historyCapReached: windowLimit != null && observed >= windowLimit,
  };
}
