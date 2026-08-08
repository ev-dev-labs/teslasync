/**
 * Observational pre-drive thermal evidence.
 *
 * Climate values remain Celsius and time values remain SI seconds. Every
 * returned climate row and drive receives an explicit outcome before a drive
 * can enter conditioned/control comparisons.
 */

import type { Drive } from '@/types/driving';
import { normalizeHvacOn, type HvacSignalSample } from './hvacCycling';

export interface PreconditioningClimateSample extends HvacSignalSample {
  insideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
}

export type DepartureRegime = 'hot' | 'cold';
export type EvidenceLevel = 'none' | 'limited' | 'moderate' | 'strong';
export type DepartureDisposition =
  | 'outside_climate_coverage'
  | 'no_window_rows'
  | 'insufficient_thermal_samples'
  | 'insufficient_observation_span'
  | 'stale_departure_sample'
  | 'target_shift'
  | 'initial_in_band'
  | 'ambiguous_hvac'
  | 'conditioned'
  | 'unconditioned';

export interface DepartureEvidence {
  driveId: number;
  departureMs: number;
  regime: DepartureRegime;
  conditioned: boolean;
  sampleCount: number;
  windowRowCount: number;
  hvacOnSamples: number;
  hvacOffSamples: number;
  unknownHvacSamples: number;
  initialDeltaC: number;
  startDeltaC: number;
  improvementC: number;
  observationSpanS: number;
  lastSampleLeadS: number;
  targetShiftC: number;
}

export interface DepartureDirectoryItem {
  driveId: number;
  departureMs: number;
  disposition: DepartureDisposition;
  regime: DepartureRegime | null;
  conditioned: boolean | null;
  windowRowCount: number;
  thermalSampleCount: number;
  hvacOnSamples: number;
  hvacOffSamples: number;
  unknownHvacSamples: number;
  firstSampleLeadS: number | null;
  lastSampleLeadS: number | null;
  observationSpanS: number | null;
  targetShiftC: number | null;
  initialDeltaC: number | null;
  startDeltaC: number | null;
  improvementC: number | null;
}

export interface PreconditioningComparison {
  regime: DepartureRegime | 'all';
  conditionedCount: number;
  unconditionedCount: number;
  conditionedStartDeltaC: number | null;
  unconditionedStartDeltaC: number | null;
  startDeltaAdvantageC: number | null;
  conditionedImprovementC: number | null;
  unconditionedImprovementC: number | null;
  improvementLiftC: number | null;
  balanceCount: number;
  volumeCount: number;
  balanceConfidence: number;
  volumeConfidence: number;
  confidence: number;
  evidence: EvidenceLevel;
}

export interface PreconditioningClimateRows {
  returnedRows: number;
  invalidRowRows: number;
  missingTimestampRows: number;
  invalidTimestampRows: number;
  timestampValidRows: number;
  duplicateTimestampRows: number;
  uniqueTimestampRows: number;
  missingInsideTempRows: number;
  missingSetpointRows: number;
  completeUnknownHvacRows: number;
  completeHvacOffRows: number;
  completeHvacOnRows: number;
}

export interface PreconditioningClimateSources {
  denominatorRows: number;
  insideTempRows: number;
  driverSetpointRows: number;
  passengerSetpointRows: number;
  anySetpointRows: number;
  pairedSetpointRows: number;
  thermallyCompleteRows: number;
  knownHvacRows: number;
  hvacOnRows: number;
  hvacOffRows: number;
}

export interface PreconditioningDriveRows {
  returnedRows: number;
  invalidRowRows: number;
  missingStartRows: number;
  invalidStartRows: number;
  duplicateDriveRows: number;
  uniqueValidDrives: number;
}

export interface PreconditioningDepartureAccounting {
  outsideClimateCoverage: number;
  noWindowRows: number;
  insufficientThermalSamples: number;
  insufficientObservationSpan: number;
  staleDepartureSample: number;
  targetShiftExclusions: number;
  initialInBand: number;
  ambiguousHvac: number;
  conditioned: number;
  unconditioned: number;
}

export interface PreconditioningCoverage {
  climateEarliestMs: number | null;
  climateLatestMs: number | null;
  climateSpanS: number;
  climateCadenceIntervals: number;
  climateMedianGapS: number | null;
  climateP90GapS: number | null;
  climateMaxGapS: number | null;
  driveEarliestMs: number | null;
  driveLatestMs: number | null;
  driveSpanS: number;
  overlappingDriveWindows: number;
}

export interface PreconditioningWindowSupport {
  departuresWithWindowRows: number;
  departuresWithThermalSupport: number;
  windowRowReferences: number;
  climateRowsUsed: number;
  climateRowsReused: number;
  medianWindowRows: number | null;
  medianThermalSamples: number | null;
  medianObservationSpanS: number | null;
  medianLastSampleLeadS: number | null;
  p90LastSampleLeadS: number | null;
}

export interface PreconditioningHourlyBucket {
  hour: number;
  classifiedDepartures: number;
  conditionedDepartures: number;
  unconditionedDepartures: number;
  meanStartDeltaC: number | null;
  meanImprovementC: number | null;
}

export interface PreconditioningImprovementBin {
  lowerC: number | null;
  upperC: number | null;
  conditioned: number;
  unconditioned: number;
  total: number;
}

export interface PreconditioningDirectory {
  total: number;
  displayed: number;
  omitted: number;
  cap: number;
  items: DepartureDirectoryItem[];
}

export interface PreconditioningIdentities {
  climateRowsBalanced: boolean;
  climateTimestampsBalanced: boolean;
  driveRowsBalanced: boolean;
  departureOutcomesBalanced: boolean;
  classifiedGroupsBalanced: boolean;
  regimesBalanced: boolean;
  directoryBalanced: boolean;
}

export interface PreconditioningOptions {
  preDriveWindowS?: number;
  minInitialDeltaC?: number;
  minThermalSamples?: number;
  minObservationSpanS?: number;
  maxDepartureSampleAgeS?: number;
  maxTargetShiftC?: number;
  directoryLimit?: number;
}

export interface PreconditioningSummary {
  climateRows: PreconditioningClimateRows;
  climateSources: PreconditioningClimateSources;
  driveRows: PreconditioningDriveRows;
  departureAccounting: PreconditioningDepartureAccounting;
  coverage: PreconditioningCoverage;
  windowSupport: PreconditioningWindowSupport;
  departures: DepartureEvidence[];
  directory: PreconditioningDirectory;
  joinedDepartures: number;
  conditionedDepartures: number;
  unconditionedDepartures: number;
  unclassifiedDepartures: number;
  conditionedShare: number | null;
  hotDepartures: number;
  coldDepartures: number;
  overall: PreconditioningComparison;
  strata: PreconditioningComparison[];
  hourlyProfile: PreconditioningHourlyBucket[];
  improvementDistribution: PreconditioningImprovementBin[];
  thresholds: Required<PreconditioningOptions>;
  identities: PreconditioningIdentities;
}

interface NormalizedClimate {
  ms: number;
  insideC: number | null;
  targetC: number | null;
  hvacOn: boolean | null;
  insideStateChanged: boolean;
}

interface ClimateNormalization {
  timeline: NormalizedClimate[];
  rows: PreconditioningClimateRows;
  sources: PreconditioningClimateSources;
}

interface NormalizedDrive {
  id: number;
  departureMs: number;
}

interface DriveNormalization {
  drives: NormalizedDrive[];
  rows: PreconditioningDriveRows;
}

export const DEFAULT_PRE_DRIVE_WINDOW_S = 45 * 60;
export const DEFAULT_MIN_INITIAL_DELTA_C = 1;
export const DEFAULT_MIN_THERMAL_SAMPLES = 2;
export const DEFAULT_MIN_OBSERVATION_SPAN_S = 5 * 60;
export const DEFAULT_MAX_DEPARTURE_SAMPLE_AGE_S = 15 * 60;
export const DEFAULT_MAX_TARGET_SHIFT_C = 2;
export const DEFAULT_PRECONDITIONING_DIRECTORY_LIMIT = 80;
export const MAX_PRECONDITIONING_DIRECTORY_LIMIT = 200;

const FULL_BALANCE_CONFIDENCE_AT = 6;
const FULL_VOLUME_CONFIDENCE_AT = 16;

const DEFAULTS: Required<PreconditioningOptions> = {
  preDriveWindowS: DEFAULT_PRE_DRIVE_WINDOW_S,
  minInitialDeltaC: DEFAULT_MIN_INITIAL_DELTA_C,
  minThermalSamples: DEFAULT_MIN_THERMAL_SAMPLES,
  minObservationSpanS: DEFAULT_MIN_OBSERVATION_SPAN_S,
  maxDepartureSampleAgeS: DEFAULT_MAX_DEPARTURE_SAMPLE_AGE_S,
  maxTargetShiftC: DEFAULT_MAX_TARGET_SHIFT_C,
  directoryLimit: DEFAULT_PRECONDITIONING_DIRECTORY_LIMIT,
};

const IMPROVEMENT_BINS = [
  { lowerC: null, upperC: 0 },
  { lowerC: 0, upperC: 2 },
  { lowerC: 2, upperC: 5 },
  { lowerC: 5, upperC: 10 },
  { lowerC: 10, upperC: null },
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentile(
  values: readonly number[],
  proportion: number,
): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(sorted.length * proportion) - 1),
  );
  return sorted[index]!;
}

function positiveOption(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

function resolveOptions(
  options: PreconditioningOptions | null | undefined,
): Required<PreconditioningOptions> {
  const source = isRecord(options) ? options : {};
  return {
    preDriveWindowS: positiveOption(
      source.preDriveWindowS,
      DEFAULTS.preDriveWindowS,
    ),
    minInitialDeltaC: positiveOption(
      source.minInitialDeltaC,
      DEFAULTS.minInitialDeltaC,
    ),
    minThermalSamples: Math.min(
      100,
      Math.max(
        2,
        Math.floor(
          positiveOption(
            source.minThermalSamples,
            DEFAULTS.minThermalSamples,
          ),
        ),
      ),
    ),
    minObservationSpanS: positiveOption(
      source.minObservationSpanS,
      DEFAULTS.minObservationSpanS,
    ),
    maxDepartureSampleAgeS: positiveOption(
      source.maxDepartureSampleAgeS,
      DEFAULTS.maxDepartureSampleAgeS,
    ),
    maxTargetShiftC: positiveOption(
      source.maxTargetShiftC,
      DEFAULTS.maxTargetShiftC,
    ),
    directoryLimit: Math.min(
      MAX_PRECONDITIONING_DIRECTORY_LIMIT,
      Math.max(
        1,
        Math.floor(
          positiveOption(
            source.directoryLimit,
            DEFAULTS.directoryLimit,
          ),
        ),
      ),
    ),
  };
}

function parseTimestamp(
  record: Record<string, unknown>,
  aliases: readonly string[],
): { kind: 'missing' | 'invalid' | 'valid'; ms: number | null } {
  const candidates = aliases.map((alias) => record[alias]);
  const present = candidates.filter(
    (value) => value !== null && value !== undefined && value !== '',
  );
  if (present.length === 0) return { kind: 'missing', ms: null };
  for (const candidate of present) {
    if (typeof candidate !== 'string' || candidate.trim().length === 0) {
      continue;
    }
    const ms = new Date(candidate).getTime();
    if (Number.isFinite(ms)) return { kind: 'valid', ms };
  }
  return { kind: 'invalid', ms: null };
}

function normalizeClimate(
  samples: readonly PreconditioningClimateSample[],
): ClimateNormalization {
  const rows: PreconditioningClimateRows = {
    returnedRows: samples.length,
    invalidRowRows: 0,
    missingTimestampRows: 0,
    invalidTimestampRows: 0,
    timestampValidRows: 0,
    duplicateTimestampRows: 0,
    uniqueTimestampRows: 0,
    missingInsideTempRows: 0,
    missingSetpointRows: 0,
    completeUnknownHvacRows: 0,
    completeHvacOffRows: 0,
    completeHvacOnRows: 0,
  };
  const sources: PreconditioningClimateSources = {
    denominatorRows: 0,
    insideTempRows: 0,
    driverSetpointRows: 0,
    passengerSetpointRows: 0,
    anySetpointRows: 0,
    pairedSetpointRows: 0,
    thermallyCompleteRows: 0,
    knownHvacRows: 0,
    hvacOnRows: 0,
    hvacOffRows: 0,
  };
  const timeline: NormalizedClimate[] = [];
  const seen = new Set<number>();

  for (const sample of samples as readonly unknown[]) {
    if (!isRecord(sample)) {
      rows.invalidRowRows += 1;
      continue;
    }
    const parsed = parseTimestamp(sample, ['timestamp', 'created_at']);
    if (parsed.kind === 'missing') {
      rows.missingTimestampRows += 1;
      continue;
    }
    if (parsed.kind === 'invalid' || parsed.ms == null) {
      rows.invalidTimestampRows += 1;
      continue;
    }
    rows.timestampValidRows += 1;
    if (seen.has(parsed.ms)) {
      rows.duplicateTimestampRows += 1;
      continue;
    }
    seen.add(parsed.ms);
    rows.uniqueTimestampRows += 1;
    sources.denominatorRows += 1;

    const insideC = finite(sample.insideTemp);
    const driverC = finite(sample.driverTempSetting);
    const passengerC = finite(sample.passengerTempSetting);
    const targetC =
      driverC != null && passengerC != null
        ? (driverC + passengerC) / 2
        : (driverC ?? passengerC);
    const hvacOn = normalizeHvacOn(sample as unknown as HvacSignalSample);

    if (insideC != null) sources.insideTempRows += 1;
    if (driverC != null) sources.driverSetpointRows += 1;
    if (passengerC != null) sources.passengerSetpointRows += 1;
    if (targetC != null) sources.anySetpointRows += 1;
    if (driverC != null && passengerC != null) {
      sources.pairedSetpointRows += 1;
    }
    if (insideC != null && targetC != null) {
      sources.thermallyCompleteRows += 1;
    }
    if (hvacOn != null) sources.knownHvacRows += 1;
    if (hvacOn === true) sources.hvacOnRows += 1;
    if (hvacOn === false) sources.hvacOffRows += 1;

    if (insideC == null) {
      rows.missingInsideTempRows += 1;
    } else if (targetC == null) {
      rows.missingSetpointRows += 1;
    } else if (hvacOn == null) {
      rows.completeUnknownHvacRows += 1;
    } else if (hvacOn) {
      rows.completeHvacOnRows += 1;
    } else {
      rows.completeHvacOffRows += 1;
    }
    timeline.push({
      ms: parsed.ms,
      insideC,
      targetC,
      hvacOn,
      insideStateChanged: false,
    });
  }
  timeline.sort((a, b) => a.ms - b.ms);
  for (let index = 0; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index]!;
    current.insideStateChanged =
      previous == null || current.insideC !== previous.insideC;
  }
  return { timeline, rows, sources };
}

function normalizeDrives(drives: readonly Drive[]): DriveNormalization {
  const rows: PreconditioningDriveRows = {
    returnedRows: drives.length,
    invalidRowRows: 0,
    missingStartRows: 0,
    invalidStartRows: 0,
    duplicateDriveRows: 0,
    uniqueValidDrives: 0,
  };
  const normalized: NormalizedDrive[] = [];
  const seen = new Set<number>();

  for (const drive of drives as readonly unknown[]) {
    if (!isRecord(drive)) {
      rows.invalidRowRows += 1;
      continue;
    }
    const id = finite(drive.id);
    if (id == null || id <= 0 || !Number.isInteger(id)) {
      rows.invalidRowRows += 1;
      continue;
    }
    const parsed = parseTimestamp(drive, ['startTs']);
    if (parsed.kind === 'missing') {
      rows.missingStartRows += 1;
      continue;
    }
    if (parsed.kind === 'invalid' || parsed.ms == null) {
      rows.invalidStartRows += 1;
      continue;
    }
    if (seen.has(id)) {
      rows.duplicateDriveRows += 1;
      continue;
    }
    seen.add(id);
    rows.uniqueValidDrives += 1;
    normalized.push({ id, departureMs: parsed.ms });
  }
  normalized.sort((a, b) => a.departureMs - b.departureMs);
  return { drives: normalized, rows };
}

function medianComparison(
  departures: readonly DepartureEvidence[],
  regime: DepartureRegime | 'all',
): PreconditioningComparison {
  const members =
    regime === 'all'
      ? departures
      : departures.filter((departure) => departure.regime === regime);
  const conditioned = members.filter((departure) => departure.conditioned);
  const unconditioned = members.filter((departure) => !departure.conditioned);
  const conditionedStartDeltaC = median(
    conditioned.map((row) => row.startDeltaC),
  );
  const unconditionedStartDeltaC = median(
    unconditioned.map((row) => row.startDeltaC),
  );
  const conditionedImprovementC = median(
    conditioned.map((row) => row.improvementC),
  );
  const unconditionedImprovementC = median(
    unconditioned.map((row) => row.improvementC),
  );
  const balanceCount = Math.min(conditioned.length, unconditioned.length);
  const balanceConfidence = Math.min(
    1,
    balanceCount / FULL_BALANCE_CONFIDENCE_AT,
  );
  const volumeConfidence = Math.min(
    1,
    members.length / FULL_VOLUME_CONFIDENCE_AT,
  );
  const confidence = balanceConfidence * volumeConfidence;
  const evidence: EvidenceLevel =
    balanceCount === 0
      ? 'none'
      : confidence >= 0.75
        ? 'strong'
        : confidence >= 0.4
          ? 'moderate'
          : 'limited';

  return {
    regime,
    conditionedCount: conditioned.length,
    unconditionedCount: unconditioned.length,
    conditionedStartDeltaC,
    unconditionedStartDeltaC,
    startDeltaAdvantageC:
      conditionedStartDeltaC != null && unconditionedStartDeltaC != null
        ? unconditionedStartDeltaC - conditionedStartDeltaC
        : null,
    conditionedImprovementC,
    unconditionedImprovementC,
    improvementLiftC:
      conditionedImprovementC != null && unconditionedImprovementC != null
        ? conditionedImprovementC - unconditionedImprovementC
        : null,
    balanceCount,
    volumeCount: members.length,
    balanceConfidence,
    volumeConfidence,
    confidence,
    evidence,
  };
}

function lowerBound(
  rows: readonly NormalizedClimate[],
  targetMs: number,
): number {
  let low = 0;
  let high = rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (rows[middle]!.ms < targetMs) low = middle + 1;
    else high = middle;
  }
  return low;
}

function incrementDisposition(
  accounting: PreconditioningDepartureAccounting,
  disposition: DepartureDisposition,
): void {
  if (disposition === 'outside_climate_coverage') {
    accounting.outsideClimateCoverage += 1;
  } else if (disposition === 'no_window_rows') {
    accounting.noWindowRows += 1;
  } else if (disposition === 'insufficient_thermal_samples') {
    accounting.insufficientThermalSamples += 1;
  } else if (disposition === 'insufficient_observation_span') {
    accounting.insufficientObservationSpan += 1;
  } else if (disposition === 'stale_departure_sample') {
    accounting.staleDepartureSample += 1;
  } else if (disposition === 'target_shift') {
    accounting.targetShiftExclusions += 1;
  } else if (disposition === 'initial_in_band') {
    accounting.initialInBand += 1;
  } else if (disposition === 'ambiguous_hvac') {
    accounting.ambiguousHvac += 1;
  } else if (disposition === 'conditioned') {
    accounting.conditioned += 1;
  } else {
    accounting.unconditioned += 1;
  }
}

function buildHourlyProfile(
  departures: readonly DepartureEvidence[],
): PreconditioningHourlyBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    classifiedDepartures: 0,
    conditionedDepartures: 0,
    unconditionedDepartures: 0,
    startDeltas: [] as number[],
    improvements: [] as number[],
  }));
  for (const departure of departures) {
    const bucket = buckets[new Date(departure.departureMs).getHours()]!;
    bucket.classifiedDepartures += 1;
    if (departure.conditioned) bucket.conditionedDepartures += 1;
    else bucket.unconditionedDepartures += 1;
    bucket.startDeltas.push(departure.startDeltaC);
    bucket.improvements.push(departure.improvementC);
  }
  return buckets.map((bucket) => ({
    hour: bucket.hour,
    classifiedDepartures: bucket.classifiedDepartures,
    conditionedDepartures: bucket.conditionedDepartures,
    unconditionedDepartures: bucket.unconditionedDepartures,
    meanStartDeltaC: mean(bucket.startDeltas),
    meanImprovementC: mean(bucket.improvements),
  }));
}

function buildImprovementDistribution(
  departures: readonly DepartureEvidence[],
): PreconditioningImprovementBin[] {
  return IMPROVEMENT_BINS.map(({ lowerC, upperC }) => {
    const members = departures.filter((departure) => {
      if (lowerC == null) return departure.improvementC < (upperC ?? 0);
      if (upperC == null) return departure.improvementC >= lowerC;
      return (
        departure.improvementC >= lowerC
        && departure.improvementC < upperC
      );
    });
    const conditioned = members.filter((row) => row.conditioned).length;
    return {
      lowerC,
      upperC,
      conditioned,
      unconditioned: members.length - conditioned,
      total: members.length,
    };
  });
}

function buildCoverage(
  climate: readonly NormalizedClimate[],
  drives: readonly NormalizedDrive[],
  options: Required<PreconditioningOptions>,
): PreconditioningCoverage {
  const climateGaps = climate.slice(1).map(
    (row, index) => (row.ms - climate[index]!.ms) / 1000,
  );
  const climateEarliestMs = climate[0]?.ms ?? null;
  const climateLatestMs = climate[climate.length - 1]?.ms ?? null;
  const driveEarliestMs = drives[0]?.departureMs ?? null;
  const driveLatestMs = drives[drives.length - 1]?.departureMs ?? null;
  const overlappingDriveWindows =
    climateEarliestMs == null || climateLatestMs == null
      ? 0
      : drives.filter((drive) => {
          const start =
            drive.departureMs - options.preDriveWindowS * 1000;
          return start <= climateLatestMs && drive.departureMs > climateEarliestMs;
        }).length;
  return {
    climateEarliestMs,
    climateLatestMs,
    climateSpanS:
      climate.length > 1
        ? (climateLatestMs! - climateEarliestMs!) / 1000
        : 0,
    climateCadenceIntervals: climateGaps.length,
    climateMedianGapS: median(climateGaps),
    climateP90GapS: percentile(climateGaps, 0.9),
    climateMaxGapS:
      climateGaps.length > 0
        ? climateGaps.reduce((maximum, gap) => Math.max(maximum, gap), 0)
        : null,
    driveEarliestMs,
    driveLatestMs,
    driveSpanS:
      drives.length > 1
        ? (driveLatestMs! - driveEarliestMs!) / 1000
        : 0,
    overlappingDriveWindows,
  };
}

function emptyDirectoryItem(
  drive: NormalizedDrive,
): DepartureDirectoryItem {
  return {
    driveId: drive.id,
    departureMs: drive.departureMs,
    disposition: 'outside_climate_coverage',
    regime: null,
    conditioned: null,
    windowRowCount: 0,
    thermalSampleCount: 0,
    hvacOnSamples: 0,
    hvacOffSamples: 0,
    unknownHvacSamples: 0,
    firstSampleLeadS: null,
    lastSampleLeadS: null,
    observationSpanS: null,
    targetShiftC: null,
    initialDeltaC: null,
    startDeltaC: null,
    improvementC: null,
  };
}

export function summarizePreconditioningEffectiveness(
  samples: readonly PreconditioningClimateSample[],
  drives: readonly Drive[],
  options: PreconditioningOptions = {},
): PreconditioningSummary {
  const thresholds = resolveOptions(options);
  const climateResult = normalizeClimate(
    Array.isArray(samples) ? samples : [],
  );
  const driveResult = normalizeDrives(Array.isArray(drives) ? drives : []);
  const coverage = buildCoverage(
    climateResult.timeline,
    driveResult.drives,
    thresholds,
  );
  const accounting: PreconditioningDepartureAccounting = {
    outsideClimateCoverage: 0,
    noWindowRows: 0,
    insufficientThermalSamples: 0,
    insufficientObservationSpan: 0,
    staleDepartureSample: 0,
    targetShiftExclusions: 0,
    initialInBand: 0,
    ambiguousHvac: 0,
    conditioned: 0,
    unconditioned: 0,
  };
  const departures: DepartureEvidence[] = [];
  const directory: DepartureDirectoryItem[] = [];
  const climateUseCounts = new Map<number, number>();
  const windowRowCounts: number[] = [];
  const thermalSampleCounts: number[] = [];
  const observationSpans: number[] = [];
  const lastSampleLeads: number[] = [];

  for (const drive of driveResult.drives) {
    const item = emptyDirectoryItem(drive);
    const windowStartMs =
      drive.departureMs - thresholds.preDriveWindowS * 1000;
    const hasCoverage =
      coverage.climateEarliestMs != null
      && coverage.climateLatestMs != null
      && windowStartMs <= coverage.climateLatestMs
      && drive.departureMs > coverage.climateEarliestMs;
    const finish = (disposition: DepartureDisposition) => {
      item.disposition = disposition;
      incrementDisposition(accounting, disposition);
      directory.push(item);
    };

    if (!hasCoverage) {
      finish('outside_climate_coverage');
      continue;
    }
    const startIndex = lowerBound(climateResult.timeline, windowStartMs);
    const endIndex = lowerBound(climateResult.timeline, drive.departureMs);
    const windowRows = climateResult.timeline.slice(startIndex, endIndex);
    item.windowRowCount = windowRows.length;
    if (windowRows.length === 0) {
      finish('no_window_rows');
      continue;
    }
    windowRowCounts.push(windowRows.length);
    for (const row of windowRows) {
      climateUseCounts.set(row.ms, (climateUseCounts.get(row.ms) ?? 0) + 1);
    }

    const hvacOnSamples = windowRows.filter(
      (row) => row.hvacOn === true,
    ).length;
    const hvacOffSamples = windowRows.filter(
      (row) => row.hvacOn === false,
    ).length;
    const unknownHvacSamples =
      windowRows.length - hvacOnSamples - hvacOffSamples;
    Object.assign(item, {
      hvacOnSamples,
      hvacOffSamples,
      unknownHvacSamples,
    });

    // /climate is a forward-folded state timeline. Repeated cabin values on
    // unrelated emissions are carried state, not fresh thermal observations.
    const thermalRows = windowRows.filter(
      (row): row is NormalizedClimate & { insideC: number; targetC: number } =>
        row.insideStateChanged
        && row.insideC != null
        && row.targetC != null,
    );
    item.thermalSampleCount = thermalRows.length;
    if (thermalRows.length < thresholds.minThermalSamples) {
      finish('insufficient_thermal_samples');
      continue;
    }
    thermalSampleCounts.push(thermalRows.length);

    const first = thermalRows[0]!;
    const last = thermalRows[thermalRows.length - 1]!;
    const observationSpanS = (last.ms - first.ms) / 1000;
    const firstSampleLeadS = (drive.departureMs - first.ms) / 1000;
    const lastSampleLeadS = (drive.departureMs - last.ms) / 1000;
    const targets = thermalRows.map((row) => row.targetC);
    const targetShiftC =
      targets.reduce((maximum, value) => Math.max(maximum, value), targets[0]!)
      - targets.reduce((minimum, value) => Math.min(minimum, value), targets[0]!);
    const initialSignedDeltaC = first.insideC - first.targetC;
    const initialDeltaC = Math.abs(initialSignedDeltaC);
    const startDeltaC = Math.abs(last.insideC - last.targetC);
    const improvementC = initialDeltaC - startDeltaC;

    Object.assign(item, {
      regime: initialSignedDeltaC > 0 ? 'hot' : 'cold',
      windowRowCount: windowRows.length,
      thermalSampleCount: thermalRows.length,
      hvacOnSamples,
      hvacOffSamples,
      unknownHvacSamples,
      firstSampleLeadS,
      lastSampleLeadS,
      observationSpanS,
      targetShiftC,
      initialDeltaC,
      startDeltaC,
      improvementC,
    });

    if (observationSpanS < thresholds.minObservationSpanS) {
      finish('insufficient_observation_span');
      continue;
    }
    observationSpans.push(observationSpanS);
    lastSampleLeads.push(lastSampleLeadS);
    if (lastSampleLeadS > thresholds.maxDepartureSampleAgeS) {
      finish('stale_departure_sample');
      continue;
    }
    if (targetShiftC > thresholds.maxTargetShiftC) {
      finish('target_shift');
      continue;
    }
    if (initialDeltaC < thresholds.minInitialDeltaC) {
      finish('initial_in_band');
      continue;
    }

    const conditioned = hvacOnSamples > 0;
    const unconditioned =
      hvacOnSamples === 0
      && unknownHvacSamples === 0
      && hvacOffSamples === windowRows.length;
    if (!conditioned && !unconditioned) {
      finish('ambiguous_hvac');
      continue;
    }
    item.conditioned = conditioned;
    const disposition: DepartureDisposition =
      conditioned ? 'conditioned' : 'unconditioned';
    const evidence: DepartureEvidence = {
      driveId: drive.id,
      departureMs: drive.departureMs,
      regime: initialSignedDeltaC > 0 ? 'hot' : 'cold',
      conditioned,
      sampleCount: thermalRows.length,
      windowRowCount: windowRows.length,
      hvacOnSamples,
      hvacOffSamples,
      unknownHvacSamples,
      initialDeltaC,
      startDeltaC,
      improvementC,
      observationSpanS,
      lastSampleLeadS,
      targetShiftC,
    };
    departures.push(evidence);
    finish(disposition);
  }

  const conditionedDepartures = departures.filter(
    (departure) => departure.conditioned,
  ).length;
  const unconditionedDepartures =
    departures.length - conditionedDepartures;
  const hotDepartures = departures.filter(
    (departure) => departure.regime === 'hot',
  ).length;
  const coldDepartures = departures.length - hotDepartures;
  const strata = [
    medianComparison(departures, 'hot'),
    medianComparison(departures, 'cold'),
  ];
  const comparableRegimes = new Set(
    strata
      .filter((comparison) => comparison.evidence !== 'none')
      .map((comparison) => comparison.regime),
  );
  const commonSupportDepartures = departures.filter(
    (departure) => comparableRegimes.has(departure.regime),
  );
  const departureOutcomeTotal = Object.values(accounting).reduce(
    (sum, value) => sum + value,
    0,
  );
  const climateRows = climateResult.rows;
  const climateOutcomeTotal =
    climateRows.invalidRowRows
    + climateRows.missingTimestampRows
    + climateRows.invalidTimestampRows
    + climateRows.duplicateTimestampRows
    + climateRows.missingInsideTempRows
    + climateRows.missingSetpointRows
    + climateRows.completeUnknownHvacRows
    + climateRows.completeHvacOffRows
    + climateRows.completeHvacOnRows;
  const driveRows = driveResult.rows;
  const driveOutcomeTotal =
    driveRows.invalidRowRows
    + driveRows.missingStartRows
    + driveRows.invalidStartRows
    + driveRows.duplicateDriveRows
    + driveRows.uniqueValidDrives;
  const directoryItems = [...directory]
    .sort((a, b) => b.departureMs - a.departureMs)
    .slice(0, thresholds.directoryLimit);

  return {
    climateRows,
    climateSources: climateResult.sources,
    driveRows,
    departureAccounting: accounting,
    coverage,
    windowSupport: {
      departuresWithWindowRows: windowRowCounts.length,
      departuresWithThermalSupport: thermalSampleCounts.length,
      windowRowReferences: windowRowCounts.reduce(
        (sum, count) => sum + count,
        0,
      ),
      climateRowsUsed: climateUseCounts.size,
      climateRowsReused: [...climateUseCounts.values()].filter(
        (count) => count > 1,
      ).length,
      medianWindowRows: median(windowRowCounts),
      medianThermalSamples: median(thermalSampleCounts),
      medianObservationSpanS: median(observationSpans),
      medianLastSampleLeadS: median(lastSampleLeads),
      p90LastSampleLeadS: percentile(lastSampleLeads, 0.9),
    },
    departures,
    directory: {
      total: directory.length,
      displayed: directoryItems.length,
      omitted: directory.length - directoryItems.length,
      cap: thresholds.directoryLimit,
      items: directoryItems,
    },
    joinedDepartures: departures.length,
    conditionedDepartures,
    unconditionedDepartures,
    unclassifiedDepartures:
      driveRows.uniqueValidDrives - departures.length,
    conditionedShare:
      departures.length > 0
        ? conditionedDepartures / departures.length
        : null,
    hotDepartures,
    coldDepartures,
    overall: medianComparison(commonSupportDepartures, 'all'),
    strata,
    hourlyProfile: buildHourlyProfile(departures),
    improvementDistribution: buildImprovementDistribution(departures),
    thresholds,
    identities: {
      climateRowsBalanced:
        climateRows.returnedRows === climateOutcomeTotal,
      climateTimestampsBalanced:
        climateRows.timestampValidRows
        === climateRows.uniqueTimestampRows
          + climateRows.duplicateTimestampRows,
      driveRowsBalanced: driveRows.returnedRows === driveOutcomeTotal,
      departureOutcomesBalanced:
        driveRows.uniqueValidDrives === departureOutcomeTotal,
      classifiedGroupsBalanced:
        departures.length
        === conditionedDepartures + unconditionedDepartures,
      regimesBalanced:
        departures.length === hotDepartures + coldDepartures,
      directoryBalanced: directory.length === driveRows.uniqueValidDrives,
    },
  };
}
