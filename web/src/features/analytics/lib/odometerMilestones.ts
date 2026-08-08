/**
 * Pure odometer-milestone model.
 *
 * Drive distances enter as canonical meters. Model outputs remain canonical
 * kilometres and timestamps; React converts them to the selected display
 * unit. The caller supplies both the clock and the kilometre size of one
 * display unit so the ladder can be round in km, miles, or another supported
 * distance preference without embedding display conversion here.
 */

import type { Drive } from '@/types/driving';

export const DEFAULT_HISTORY_LIMIT = 1_000;
export const DEFAULT_SERIES_POINT_LIMIT = 240;
export const DEFAULT_UPCOMING_COUNT = 5;
export const MINIMUM_PACE_DRIVES = 5;
export const MAX_FORECAST_DAYS = 36_525;

const DAY_MS = 86_400_000;
const MAX_LADDER_STEPS = 10_000;

export type PaceScenarioId = 'trailing30' | 'trailing90' | 'observedHistory';

export interface ObservationExclusions {
  invalidTimestampRows: number;
  futureRows: number;
  nonFiniteDistanceRows: number;
  zeroDistanceRows: number;
  negativeDistanceRows: number;
}

export interface ObservationAccounting {
  returnedRows: number;
  eligibleRows: number;
  excludedRows: number;
  exclusions: ObservationExclusions;
  requestedLimit: number;
  capReached: boolean;
  firstEligibleMs: number | null;
  lastEligibleMs: number | null;
}

export interface CumulativeOdometerPoint {
  timestampMs: number;
  driveId: number;
  driveCount: number;
  cumulativeDistanceKm: number;
  odometerKm: number;
}

export interface MonthlyOdometerRollup {
  /** UTC calendar month (`yyyy-mm`). */
  month: string;
  monthStartMs: number;
  driveCount: number;
  distanceKm: number;
  endingOdometerKm: number;
}

export interface MilestoneSegment {
  previousMilestoneKm: number;
  nextMilestoneKm: number;
  segmentDistanceKm: number;
  progressedKm: number;
  remainingKm: number;
  progressRatio: number;
}

export interface ReachedMilestone {
  thresholdKm: number;
  reachedAtMs: number;
  crossingDriveId: number;
}

export interface MilestoneForecast {
  /** Projection from the supported trailing-90-day pace. */
  etaMs: number;
  /** Fastest and slowest valid projections across supported scenarios. */
  rangeStartMs: number;
  rangeEndMs: number;
  scenarioCount: number;
}

export interface UpcomingMilestone {
  thresholdKm: number;
  remainingKm: number;
  forecast: MilestoneForecast | null;
}

export interface PaceScenario {
  id: PaceScenarioId;
  windowDays: 30 | 90 | null;
  sampleCount: number;
  distanceKm: number;
  observationStartMs: number | null;
  observationEndMs: number | null;
  observedDays: number | null;
  paceKmPerDay: number | null;
  supported: boolean;
  nextMilestoneEtaMs: number | null;
}

export interface OdometerMilestoneMethod {
  historyLimit: number;
  minimumPaceDrives: number;
  milestoneUnitKm: number;
  cumulativePointLimit: number;
  maxForecastDays: number;
}

export interface OdometerMilestoneResult {
  asOfMs: number;
  baseOdometerKm: number;
  eligibleDistanceKm: number;
  currentOdometerKm: number;
  accounting: ObservationAccounting;
  cumulativeSeries: CumulativeOdometerPoint[];
  cumulativePointCount: number;
  monthly: MonthlyOdometerRollup[];
  segment: MilestoneSegment;
  reached: ReachedMilestone[];
  upcoming: UpcomingMilestone[];
  paceScenarios: PaceScenario[];
  primaryPace: PaceScenario;
  method: OdometerMilestoneMethod;
}

export interface OdometerMilestoneOptions {
  baseOdometerKm: number;
  nowMs: number;
  /** Canonical kilometres represented by one selected display-distance unit. */
  milestoneUnitKm: number;
  historyLimit?: number;
  minimumPaceDrives?: number;
  cumulativePointLimit?: number;
  upcomingCount?: number;
}

interface EligibleDrive {
  driveId: number;
  startTs: string;
  startMs: number;
  distanceKm: number;
  sourceIndex: number;
}

interface ValidatedOptions {
  baseOdometerKm: number;
  nowMs: number;
  milestoneUnitKm: number;
  historyLimit: number;
  minimumPaceDrives: number;
  cumulativePointLimit: number;
  upcomingCount: number;
}

const SCENARIOS: ReadonlyArray<{
  id: PaceScenarioId;
  windowDays: 30 | 90 | null;
}> = [
  { id: 'trailing30', windowDays: 30 },
  { id: 'trailing90', windowDays: 90 },
  { id: 'observedHistory', windowDays: null },
];

function requireNonNegativeFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
  return value;
}

function requirePositiveFinite(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return value;
}

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
  return value;
}

function requirePaceMinimum(value: number): number {
  const minimum = requirePositiveInteger(value, 'minimumPaceDrives');
  if (minimum < MINIMUM_PACE_DRIVES) {
    throw new RangeError(
      `minimumPaceDrives must be at least ${MINIMUM_PACE_DRIVES}`,
    );
  }
  return minimum;
}

function validateOptions(options: OdometerMilestoneOptions): ValidatedOptions {
  const nowMs = requireNonNegativeFinite(options.nowMs, 'nowMs');
  if (!Number.isFinite(new Date(nowMs).getTime())) {
    throw new RangeError('nowMs must be a valid timestamp');
  }

  return {
    baseOdometerKm: requireNonNegativeFinite(
      options.baseOdometerKm,
      'baseOdometerKm',
    ),
    nowMs,
    milestoneUnitKm: requirePositiveFinite(
      options.milestoneUnitKm,
      'milestoneUnitKm',
    ),
    historyLimit: requirePositiveInteger(
      options.historyLimit ?? DEFAULT_HISTORY_LIMIT,
      'historyLimit',
    ),
    minimumPaceDrives: requirePaceMinimum(
      options.minimumPaceDrives ?? MINIMUM_PACE_DRIVES,
    ),
    cumulativePointLimit: requirePositiveInteger(
      options.cumulativePointLimit ?? DEFAULT_SERIES_POINT_LIMIT,
      'cumulativePointLimit',
    ),
    upcomingCount: requirePositiveInteger(
      options.upcomingCount ?? DEFAULT_UPCOMING_COUNT,
      'upcomingCount',
    ),
  };
}

/**
 * Generate canonical-km thresholds from round display-unit values: every
 * 10,000 units through 100,000, then every 50,000 units. Enough thresholds
 * are added to leave `futureCount` steps beyond `maxKm`.
 */
export function buildMilestoneLadder(
  maxKm: number,
  milestoneUnitKm: number,
  futureCount = DEFAULT_UPCOMING_COUNT,
): number[] {
  requireNonNegativeFinite(maxKm, 'maxKm');
  requirePositiveFinite(milestoneUnitKm, 'milestoneUnitKm');
  requirePositiveInteger(futureCount, 'futureCount');

  const currentDisplay = maxKm / milestoneUnitKm;
  if (!Number.isFinite(currentDisplay)) {
    throw new RangeError('milestone ladder exceeds finite numeric bounds');
  }

  const displayThresholds = Array.from(
    { length: 10 },
    (_, index) => (index + 1) * 10_000,
  );
  const initialFuture = displayThresholds.filter(
    (threshold) => threshold > currentDisplay,
  ).length;
  const postHundredAtOrBelow =
    currentDisplay >= 150_000
      ? Math.floor((currentDisplay - 100_000) / 50_000)
      : 0;
  const postHundredCount =
    postHundredAtOrBelow + Math.max(0, futureCount - initialFuture);

  if (postHundredCount > MAX_LADDER_STEPS) {
    throw new RangeError('milestone ladder exceeds safe step count');
  }
  for (let index = 1; index <= postHundredCount; index += 1) {
    displayThresholds.push(100_000 + index * 50_000);
  }

  return displayThresholds.map((threshold) => {
    const thresholdKm = threshold * milestoneUnitKm;
    if (!Number.isFinite(thresholdKm)) {
      throw new RangeError('milestone threshold exceeds finite numeric bounds');
    }
    return thresholdKm;
  });
}

/** Evenly sample a sorted series; limits above one retain first and last. */
export function downsampleOdometerSeries(
  points: readonly CumulativeOdometerPoint[],
  limit: number,
): CumulativeOdometerPoint[] {
  requirePositiveInteger(limit, 'limit');
  if (points.length <= limit) return [...points];
  if (limit === 1) return [points[points.length - 1]!];

  return Array.from({ length: limit }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (points.length - 1)) / (limit - 1),
    );
    return points[sourceIndex]!;
  });
}

function collectEligible(
  drives: readonly Drive[],
  nowMs: number,
  historyLimit: number,
): { rows: EligibleDrive[]; accounting: ObservationAccounting } {
  const exclusions: ObservationExclusions = {
    invalidTimestampRows: 0,
    futureRows: 0,
    nonFiniteDistanceRows: 0,
    zeroDistanceRows: 0,
    negativeDistanceRows: 0,
  };
  const rows: EligibleDrive[] = [];

  drives.forEach((drive, sourceIndex) => {
    const startTs =
      typeof drive.startTs === 'string' ? drive.startTs.trim() : '';
    const startMs = Date.parse(startTs);
    if (!startTs || !Number.isFinite(startMs)) {
      exclusions.invalidTimestampRows += 1;
      return;
    }
    if (startMs > nowMs) {
      exclusions.futureRows += 1;
      return;
    }
    if (
      typeof drive.distanceM !== 'number' ||
      !Number.isFinite(drive.distanceM)
    ) {
      exclusions.nonFiniteDistanceRows += 1;
      return;
    }
    if (drive.distanceM === 0) {
      exclusions.zeroDistanceRows += 1;
      return;
    }
    if (drive.distanceM < 0) {
      exclusions.negativeDistanceRows += 1;
      return;
    }

    rows.push({
      driveId: Number.isFinite(drive.id) ? drive.id : 0,
      startTs,
      startMs,
      distanceKm: drive.distanceM / 1_000,
      sourceIndex,
    });
  });

  rows.sort(
    (left, right) =>
      left.startMs - right.startMs ||
      left.driveId - right.driveId ||
      left.startTs.localeCompare(right.startTs) ||
      left.distanceKm - right.distanceKm ||
      left.sourceIndex - right.sourceIndex,
  );

  return {
    rows,
    accounting: {
      returnedRows: drives.length,
      eligibleRows: rows.length,
      excludedRows: drives.length - rows.length,
      exclusions,
      requestedLimit: historyLimit,
      capReached: drives.length === historyLimit,
      firstEligibleMs: rows[0]?.startMs ?? null,
      lastEligibleMs: rows[rows.length - 1]?.startMs ?? null,
    },
  };
}

function buildMonthlyRollups(
  rows: readonly EligibleDrive[],
  baseOdometerKm: number,
): MonthlyOdometerRollup[] {
  const byMonth = new Map<string, { driveCount: number; distanceKm: number }>();
  for (const row of rows) {
    const month = new Date(row.startMs).toISOString().slice(0, 7);
    const aggregate = byMonth.get(month) ?? {
      driveCount: 0,
      distanceKm: 0,
    };
    aggregate.driveCount += 1;
    aggregate.distanceKm += row.distanceKm;
    byMonth.set(month, aggregate);
  }

  let odometerKm = baseOdometerKm;
  return [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, aggregate]) => {
      odometerKm += aggregate.distanceKm;
      return {
        month,
        monthStartMs: Date.parse(`${month}-01T00:00:00.000Z`),
        driveCount: aggregate.driveCount,
        distanceKm: aggregate.distanceKm,
        endingOdometerKm: odometerKm,
      };
    });
}

function projectEtaMs(
  remainingKm: number,
  paceKmPerDay: number | null,
  nowMs: number,
): number | null {
  if (
    paceKmPerDay == null ||
    !Number.isFinite(paceKmPerDay) ||
    paceKmPerDay <= 0 ||
    !Number.isFinite(remainingKm) ||
    remainingKm <= 0
  ) {
    return null;
  }

  const projectedDays = remainingKm / paceKmPerDay;
  if (
    !Number.isFinite(projectedDays) ||
    projectedDays <= 0 ||
    projectedDays > MAX_FORECAST_DAYS
  ) {
    return null;
  }
  const etaMs = nowMs + projectedDays * DAY_MS;
  return Number.isFinite(etaMs) && Number.isFinite(new Date(etaMs).getTime())
    ? etaMs
    : null;
}

function buildPaceScenarios(
  rows: readonly EligibleDrive[],
  nowMs: number,
  minimumPaceDrives: number,
  nextMilestoneKm: number,
  currentOdometerKm: number,
): PaceScenario[] {
  const firstEligibleMs = rows[0]?.startMs ?? null;
  const remainingKm = nextMilestoneKm - currentOdometerKm;

  return SCENARIOS.map(({ id, windowDays }) => {
    const cutoffMs =
      windowDays == null ? null : nowMs - windowDays * DAY_MS;
    const scenarioRows =
      cutoffMs == null
        ? rows
        : rows.filter((row) => row.startMs >= cutoffMs);
    const observationStartMs =
      firstEligibleMs == null
        ? null
        : cutoffMs == null
          ? firstEligibleMs
          : Math.max(cutoffMs, firstEligibleMs);
    const observedDays =
      observationStartMs == null
        ? null
        : (nowMs - observationStartMs) / DAY_MS;
    const distanceKm = scenarioRows.reduce(
      (sum, row) => sum + row.distanceKm,
      0,
    );
    const rawPace =
      scenarioRows.length >= minimumPaceDrives &&
      observedDays != null &&
      observedDays > 0 &&
      distanceKm > 0
        ? distanceKm / observedDays
        : null;
    const paceKmPerDay =
      rawPace != null && Number.isFinite(rawPace) && rawPace > 0
        ? rawPace
        : null;

    return {
      id,
      windowDays,
      sampleCount: scenarioRows.length,
      distanceKm,
      observationStartMs,
      observationEndMs: observationStartMs == null ? null : nowMs,
      observedDays,
      paceKmPerDay,
      supported: paceKmPerDay != null,
      nextMilestoneEtaMs: projectEtaMs(
        remainingKm,
        paceKmPerDay,
        nowMs,
      ),
    };
  });
}

function buildForecast(
  remainingKm: number,
  scenarios: readonly PaceScenario[],
  nowMs: number,
): MilestoneForecast | null {
  const primary = scenarios.find(
    (scenario) => scenario.id === 'trailing90',
  );
  const etaMs = projectEtaMs(
    remainingKm,
    primary?.paceKmPerDay ?? null,
    nowMs,
  );
  if (etaMs == null) return null;

  const scenarioEtas = scenarios
    .map((scenario) =>
      projectEtaMs(remainingKm, scenario.paceKmPerDay, nowMs),
    )
    .filter((candidate): candidate is number => candidate != null);

  return {
    etaMs,
    rangeStartMs: Math.min(...scenarioEtas),
    rangeEndMs: Math.max(...scenarioEtas),
    scenarioCount: scenarioEtas.length,
  };
}

export function buildOdometerMilestones(
  drives: readonly Drive[],
  options: OdometerMilestoneOptions,
): OdometerMilestoneResult {
  const validated = validateOptions(options);
  const { rows, accounting } = collectEligible(
    drives,
    validated.nowMs,
    validated.historyLimit,
  );
  const eligibleDistanceKm = rows.reduce(
    (sum, row) => sum + row.distanceKm,
    0,
  );
  const currentOdometerKm =
    validated.baseOdometerKm + eligibleDistanceKm;
  if (!Number.isFinite(currentOdometerKm)) {
    throw new RangeError('cumulative odometer exceeds finite numeric bounds');
  }

  const ladder = buildMilestoneLadder(
    currentOdometerKm,
    validated.milestoneUnitKm,
    validated.upcomingCount,
  );
  let nextIndex = ladder.findIndex(
    (thresholdKm) => thresholdKm > validated.baseOdometerKm,
  );
  if (nextIndex < 0) nextIndex = ladder.length;

  let runningOdometerKm = validated.baseOdometerKm;
  let runningDistanceKm = 0;
  const reached: ReachedMilestone[] = [];
  const fullCumulativeSeries: CumulativeOdometerPoint[] = [];

  rows.forEach((row, index) => {
    runningDistanceKm += row.distanceKm;
    runningOdometerKm += row.distanceKm;
    while (
      nextIndex < ladder.length &&
      runningOdometerKm >= ladder[nextIndex]!
    ) {
      reached.push({
        thresholdKm: ladder[nextIndex]!,
        reachedAtMs: row.startMs,
        crossingDriveId: row.driveId,
      });
      nextIndex += 1;
    }
    fullCumulativeSeries.push({
      timestampMs: row.startMs,
      driveId: row.driveId,
      driveCount: index + 1,
      cumulativeDistanceKm: runningDistanceKm,
      odometerKm: runningOdometerKm,
    });
  });

  const nextMilestoneKm = ladder[nextIndex]!;
  const previousMilestoneKm =
    nextIndex > 0 ? ladder[nextIndex - 1]! : 0;
  const segmentDistanceKm = nextMilestoneKm - previousMilestoneKm;
  const progressedKm = Math.max(
    0,
    Math.min(
      segmentDistanceKm,
      currentOdometerKm - previousMilestoneKm,
    ),
  );
  const segment: MilestoneSegment = {
    previousMilestoneKm,
    nextMilestoneKm,
    segmentDistanceKm,
    progressedKm,
    remainingKm: Math.max(0, nextMilestoneKm - currentOdometerKm),
    progressRatio:
      segmentDistanceKm > 0 ? progressedKm / segmentDistanceKm : 0,
  };

  const paceScenarios = buildPaceScenarios(
    rows,
    validated.nowMs,
    validated.minimumPaceDrives,
    nextMilestoneKm,
    currentOdometerKm,
  );
  const primaryPace = paceScenarios.find(
    (scenario) => scenario.id === 'trailing90',
  )!;
  const upcoming = ladder
    .slice(nextIndex, nextIndex + validated.upcomingCount)
    .map<UpcomingMilestone>((thresholdKm) => {
      const remainingKm = Math.max(
        0,
        thresholdKm - currentOdometerKm,
      );
      return {
        thresholdKm,
        remainingKm,
        forecast: buildForecast(
          remainingKm,
          paceScenarios,
          validated.nowMs,
        ),
      };
    });

  return {
    asOfMs: validated.nowMs,
    baseOdometerKm: validated.baseOdometerKm,
    eligibleDistanceKm,
    currentOdometerKm,
    accounting,
    cumulativeSeries: downsampleOdometerSeries(
      fullCumulativeSeries,
      validated.cumulativePointLimit,
    ),
    cumulativePointCount: fullCumulativeSeries.length,
    monthly: buildMonthlyRollups(rows, validated.baseOdometerKm),
    segment,
    reached,
    upcoming,
    paceScenarios,
    primaryPace,
    method: {
      historyLimit: validated.historyLimit,
      minimumPaceDrives: validated.minimumPaceDrives,
      milestoneUnitKm: validated.milestoneUnitKm,
      cumulativePointLimit: validated.cumulativePointLimit,
      maxForecastDays: MAX_FORECAST_DAYS,
    },
  };
}
