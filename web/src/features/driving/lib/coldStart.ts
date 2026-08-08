/**
 * Cold Start Cost model — deterministic evidence for the selected drive window.
 *
 * Every measurement remains in its canonical storage unit: distance in meters,
 * energy in watt-hours, parking gaps in seconds, and temperature in Celsius.
 * Wh/km is retained for the existing aggregate contract. Display conversion is
 * deliberately left to the React boundary.
 */

import type { Drive } from '@/types/driving';

/** Gaps at or above this many hours make the next drive a "cold start". */
export const COLD_GAP_HOURS = 6;
/** Gaps at or below this many hours make the next drive a "warm start". */
export const WARM_GAP_HOURS = 1;
/** Minimum observations in both groups before the model claims a penalty. */
export const MIN_GROUP_DRIVES = 5;

const SECONDS_PER_HOUR = 3_600;
const COLD_GAP_S = COLD_GAP_HOURS * SECONDS_PER_HOUR;
const WARM_GAP_S = WARM_GAP_HOURS * SECONDS_PER_HOUR;

export type ColdStartClassification = 'cold' | 'warm' | 'ambiguous';
export type ParkingGapBucketKey =
  | 'warm'
  | 'ambiguous'
  | 'cold6To12'
  | 'cold12To24'
  | 'cold24Plus';

export interface GroupStats {
  drives: number;
  distanceM: number;
  whPerKm: number | null;
}

export interface ColdStartObservation {
  driveId: number;
  startTs: string;
  precedingGapS: number;
  classification: ColdStartClassification;
  bucket: ParkingGapBucketKey;
  distanceM: number;
  energyUsedWh: number;
  whPerKm: number;
  outsideTempAvgC: number | null;
}

export interface MonthlyColdStartRollup {
  /** UTC calendar month (`YYYY-MM`) containing the drive start. */
  month: string;
  cold: GroupStats;
  warm: GroupStats;
}

export interface ParkingGapBucket {
  key: ParkingGapBucketKey;
  drives: number;
  distanceM: number;
  /** Share of all drives with a valid preceding gap, 0–1. */
  share: number;
}

export interface TemperatureEvidence {
  driveId: number;
  startTs: string;
  classification: 'cold' | 'warm';
  distanceM: number;
  whPerKm: number;
  outsideTempAvgC: number;
}

export interface ColdStartOpportunity {
  driveId: number;
  startTs: string;
  precedingGapS: number;
  distanceM: number;
  outsideTempAvgC: number | null;
  /** Positive observed energy above the valid aggregate warm baseline. */
  estimatedAvoidableWh: number;
}

export interface ColdStartSummary {
  cold: GroupStats;
  warm: GroupStats;
  /** Extra consumption on cold starts, Wh/km; null without sufficient groups. */
  penaltyWhPerKm: number | null;
  /** Penalty as a share of warm consumption, 0–1. */
  penaltyShare: number | null;
  /** Total extra energy attributed to cold starts across the input, Wh. */
  totalPenaltyWh: number | null;
  /** Cold-start share of analyzable drives, 0–1. */
  coldShare: number | null;
  /** Drives with usable energy/distance and a valid non-negative preceding gap. */
  analyzed: number;
  /** Usable drives with valid starts, including those without a preceding gap. */
  eligible: number;
  /** Analyzed drives in the intentionally excluded 1–6 hour band. */
  ambiguous: number;
  /** Eligible drives whose preceding gap could not be established. */
  unclassified: number;
  sampleSufficient: boolean;
  observations: ColdStartObservation[];
  monthly: MonthlyColdStartRollup[];
  gapBuckets: ParkingGapBucket[];
  temperature: TemperatureEvidence[];
  opportunities: ColdStartOpportunity[];
}

interface TimestampedDrive {
  drive: Drive;
  startMs: number;
}

const GAP_BUCKET_KEYS: readonly ParkingGapBucketKey[] = [
  'warm',
  'ambiguous',
  'cold6To12',
  'cold12To24',
  'cold24Plus',
];

function usable(drive: Drive): boolean {
  return (
    drive.energyUsedWh != null &&
    Number.isFinite(drive.energyUsedWh) &&
    drive.energyUsedWh > 0 &&
    Number.isFinite(drive.distanceM) &&
    drive.distanceM >= 1_000
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function groupStats(observations: readonly ColdStartObservation[]): GroupStats {
  let energyUsedWh = 0;
  let distanceM = 0;
  for (const observation of observations) {
    energyUsedWh += observation.energyUsedWh;
    distanceM += observation.distanceM;
  }
  return {
    drives: observations.length,
    distanceM,
    whPerKm: distanceM >= 1_000 ? round1(energyUsedWh / (distanceM / 1_000)) : null,
  };
}

export function classifyParkingGap(gapS: number): ColdStartClassification | null {
  if (!Number.isFinite(gapS) || gapS < 0) return null;
  if (gapS >= COLD_GAP_S) return 'cold';
  if (gapS <= WARM_GAP_S) return 'warm';
  return 'ambiguous';
}

export function bucketParkingGap(gapS: number): ParkingGapBucketKey | null {
  const classification = classifyParkingGap(gapS);
  if (classification === 'warm' || classification === 'ambiguous') return classification;
  if (classification !== 'cold') return null;
  if (gapS < 12 * SECONDS_PER_HOUR) return 'cold6To12';
  if (gapS < 24 * SECONDS_PER_HOUR) return 'cold12To24';
  return 'cold24Plus';
}

function previousEndMs(previous: TimestampedDrive): number {
  const { drive, startMs } = previous;
  if (drive.endTs) return new Date(drive.endTs).getTime();
  return startMs + (Number.isFinite(drive.durationS) ? drive.durationS * 1_000 : 0);
}

function buildMonthly(observations: readonly ColdStartObservation[]): MonthlyColdStartRollup[] {
  const months = new Map<string, { cold: ColdStartObservation[]; warm: ColdStartObservation[] }>();
  for (const observation of observations) {
    if (observation.classification === 'ambiguous') continue;
    const month = new Date(observation.startTs).toISOString().slice(0, 7);
    const entry = months.get(month) ?? { cold: [], warm: [] };
    entry[observation.classification].push(observation);
    months.set(month, entry);
  }
  return [...months.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, groups]) => ({
      month,
      cold: groupStats(groups.cold),
      warm: groupStats(groups.warm),
    }));
}

function buildGapBuckets(observations: readonly ColdStartObservation[]): ParkingGapBucket[] {
  return GAP_BUCKET_KEYS.map((key) => {
    const rows = observations.filter((observation) => observation.bucket === key);
    return {
      key,
      drives: rows.length,
      distanceM: rows.reduce((sum, observation) => sum + observation.distanceM, 0),
      share: observations.length > 0 ? rows.length / observations.length : 0,
    };
  });
}

function buildOpportunities(
  observations: readonly ColdStartObservation[],
  warmWhPerKm: number | null,
  hasPositivePenalty: boolean,
): ColdStartOpportunity[] {
  if (!hasPositivePenalty || warmWhPerKm == null) return [];
  return observations
    .filter((observation) => observation.classification === 'cold')
    .map((observation) => ({
      driveId: observation.driveId,
      startTs: observation.startTs,
      precedingGapS: observation.precedingGapS,
      distanceM: observation.distanceM,
      outsideTempAvgC: observation.outsideTempAvgC,
      estimatedAvoidableWh: Math.round(
        Math.max(
          0,
          observation.energyUsedWh - warmWhPerKm * (observation.distanceM / 1_000),
        ),
      ),
    }))
    .filter((opportunity) => opportunity.estimatedAvoidableWh > 0)
    .sort(
      (a, b) =>
        b.estimatedAvoidableWh - a.estimatedAvoidableWh ||
        b.startTs.localeCompare(a.startTs) ||
        b.driveId - a.driveId,
    );
}

export function summarizeColdStarts(drives: readonly Drive[]): ColdStartSummary {
  const sorted: TimestampedDrive[] = drives
    .map((drive) => ({ drive, startMs: new Date(drive.startTs).getTime() }))
    .filter((item) => Number.isFinite(item.startMs))
    .sort((a, b) => a.startMs - b.startMs || a.drive.id - b.drive.id);

  const observations: ColdStartObservation[] = [];
  let eligible = 0;
  let unclassified = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]!;
    if (!usable(current.drive)) continue;
    eligible += 1;
    const previous = sorted[index - 1];
    if (!previous) {
      unclassified += 1;
      continue;
    }

    const precedingGapS = (current.startMs - previousEndMs(previous)) / 1_000;
    const classification = classifyParkingGap(precedingGapS);
    const bucket = bucketParkingGap(precedingGapS);
    if (!classification || !bucket) {
      unclassified += 1;
      continue;
    }

    observations.push({
      driveId: current.drive.id,
      startTs: current.drive.startTs,
      precedingGapS,
      classification,
      bucket,
      distanceM: current.drive.distanceM,
      energyUsedWh: current.drive.energyUsedWh!,
      whPerKm: round1(current.drive.energyUsedWh! / (current.drive.distanceM / 1_000)),
      outsideTempAvgC:
        current.drive.outsideTempAvgC != null &&
        Number.isFinite(current.drive.outsideTempAvgC)
          ? current.drive.outsideTempAvgC
          : null,
    });
  }

  const coldRows = observations.filter((observation) => observation.classification === 'cold');
  const warmRows = observations.filter((observation) => observation.classification === 'warm');
  const cold = groupStats(coldRows);
  const warm = groupStats(warmRows);
  const sampleSufficient =
    cold.whPerKm != null &&
    warm.whPerKm != null &&
    cold.drives >= MIN_GROUP_DRIVES &&
    warm.drives >= MIN_GROUP_DRIVES;

  let penaltyWhPerKm: number | null = null;
  let penaltyShare: number | null = null;
  let totalPenaltyWh: number | null = null;
  if (sampleSufficient) {
    penaltyWhPerKm = round1(cold.whPerKm! - warm.whPerKm!);
    penaltyShare = warm.whPerKm! > 0 ? penaltyWhPerKm / warm.whPerKm! : null;
    totalPenaltyWh = Math.round(Math.max(0, penaltyWhPerKm) * (cold.distanceM / 1_000));
  }

  const temperature: TemperatureEvidence[] = observations
    .filter(
      (observation): observation is ColdStartObservation & {
        classification: 'cold' | 'warm';
        outsideTempAvgC: number;
      } =>
        observation.classification !== 'ambiguous' &&
        observation.outsideTempAvgC != null,
    )
    .map((observation) => ({
      driveId: observation.driveId,
      startTs: observation.startTs,
      classification: observation.classification,
      distanceM: observation.distanceM,
      whPerKm: observation.whPerKm,
      outsideTempAvgC: observation.outsideTempAvgC,
    }));

  return {
    cold,
    warm,
    penaltyWhPerKm,
    penaltyShare,
    totalPenaltyWh,
    coldShare: observations.length > 0 ? coldRows.length / observations.length : null,
    analyzed: observations.length,
    eligible,
    ambiguous: observations.length - coldRows.length - warmRows.length,
    unclassified,
    sampleSufficient,
    observations,
    monthly: buildMonthly(observations),
    gapBuckets: buildGapBuckets(observations),
    temperature,
    opportunities: buildOpportunities(
      observations,
      warm.whPerKm,
      sampleSufficient && penaltyWhPerKm != null && penaltyWhPerKm > 0,
    ),
  };
}
