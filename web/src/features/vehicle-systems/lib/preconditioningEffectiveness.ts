/**
 * Observational preconditioning effectiveness around recorded departures.
 *
 * Climate samples are joined to drives inside the 45 minutes immediately
 * before each start. A departure is "conditioned" only when an HVAC-on signal
 * is observed; it is "unconditioned" only when every joined HVAC signal is
 * explicitly off. Unknown state is never silently assigned to a control.
 *
 * Results compare medians for cabin-to-setpoint delta at departure and the
 * improvement from the first to last pre-drive sample, separately for hot and
 * cold starts. This is observational evidence, not a causal energy-savings
 * estimate.
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

export interface DepartureEvidence {
  driveId: number;
  departureMs: number;
  regime: DepartureRegime;
  conditioned: boolean;
  sampleCount: number;
  hvacOnSamples: number;
  initialDeltaC: number;
  startDeltaC: number;
  improvementC: number;
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
  confidence: number;
  evidence: EvidenceLevel;
}

export interface PreconditioningSummary {
  departures: DepartureEvidence[];
  joinedDepartures: number;
  conditionedDepartures: number;
  unconditionedDepartures: number;
  unclassifiedDepartures: number;
  conditionedShare: number | null;
  overall: PreconditioningComparison;
  strata: PreconditioningComparison[];
}

export interface PreconditioningOptions {
  preDriveWindowS?: number;
  minInitialDeltaC?: number;
}

interface NormalizedClimate {
  ms: number;
  insideC: number;
  targetC: number;
  hvacOn: boolean | null;
}

const DEFAULT_WINDOW_S = 45 * 60;
const DEFAULT_MIN_INITIAL_DELTA_C = 1;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeClimate(
  samples: readonly PreconditioningClimateSample[],
): NormalizedClimate[] {
  const rows: NormalizedClimate[] = [];
  for (const sample of samples) {
    const timestamp = sample.timestamp ?? sample.created_at;
    if (!timestamp) continue;
    const ms = new Date(timestamp).getTime();
    const insideC = finite(sample.insideTemp);
    const driverC = finite(sample.driverTempSetting);
    const passengerC = finite(sample.passengerTempSetting);
    if (!Number.isFinite(ms) || insideC == null || (driverC == null && passengerC == null)) continue;
    const targetC =
      driverC != null && passengerC != null
        ? (driverC + passengerC) / 2
        : (driverC ?? passengerC)!;
    rows.push({ ms, insideC, targetC, hvacOn: normalizeHvacOn(sample) });
  }
  rows.sort((a, b) => a.ms - b.ms);
  return rows.filter((row, index) => index === 0 || row.ms !== rows[index - 1]!.ms);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function compare(
  departures: readonly DepartureEvidence[],
  regime: DepartureRegime | 'all',
): PreconditioningComparison {
  const members =
    regime === 'all' ? departures : departures.filter((departure) => departure.regime === regime);
  const conditioned = members.filter((departure) => departure.conditioned);
  const unconditioned = members.filter((departure) => !departure.conditioned);
  const conditionedStartDeltaC = median(conditioned.map((row) => row.startDeltaC));
  const unconditionedStartDeltaC = median(unconditioned.map((row) => row.startDeltaC));
  const conditionedImprovementC = median(conditioned.map((row) => row.improvementC));
  const unconditionedImprovementC = median(unconditioned.map((row) => row.improvementC));
  const balance = Math.min(conditioned.length, unconditioned.length);
  const confidence = Math.min(1, balance / 6) * Math.min(1, members.length / 16);
  const evidence: EvidenceLevel =
    balance === 0
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
    confidence,
    evidence,
  };
}

export function summarizePreconditioningEffectiveness(
  samples: readonly PreconditioningClimateSample[],
  drives: readonly Drive[],
  options: PreconditioningOptions = {},
): PreconditioningSummary {
  const preDriveWindowS = options.preDriveWindowS ?? DEFAULT_WINDOW_S;
  const minInitialDeltaC = options.minInitialDeltaC ?? DEFAULT_MIN_INITIAL_DELTA_C;
  const climate = normalizeClimate(samples);
  const departures: DepartureEvidence[] = [];
  let validDrives = 0;

  for (const drive of drives) {
    const departureMs = new Date(drive.startTs).getTime();
    if (!Number.isFinite(departureMs)) continue;
    validDrives += 1;
    const windowStart = departureMs - preDriveWindowS * 1000;
    const rows = climate.filter((row) => row.ms >= windowStart && row.ms < departureMs);
    if (rows.length < 2) continue;

    const first = rows[0]!;
    const last = rows[rows.length - 1]!;
    const initialSignedDeltaC = first.insideC - first.targetC;
    if (Math.abs(initialSignedDeltaC) < minInitialDeltaC) continue;
    const states = rows.map((row) => row.hvacOn);
    const hvacOnSamples = states.filter((state) => state === true).length;
    const conditioned = hvacOnSamples > 0;
    const explicitlyUnconditioned = states.every((state) => state === false);
    if (!conditioned && !explicitlyUnconditioned) continue;

    const initialDeltaC = Math.abs(initialSignedDeltaC);
    const startDeltaC = Math.abs(last.insideC - last.targetC);
    departures.push({
      driveId: drive.id,
      departureMs,
      regime: initialSignedDeltaC > 0 ? 'hot' : 'cold',
      conditioned,
      sampleCount: rows.length,
      hvacOnSamples,
      initialDeltaC,
      startDeltaC,
      improvementC: initialDeltaC - startDeltaC,
    });
  }

  const conditionedDepartures = departures.filter((row) => row.conditioned).length;
  const unconditionedDepartures = departures.length - conditionedDepartures;
  return {
    departures,
    joinedDepartures: departures.length,
    conditionedDepartures,
    unconditionedDepartures,
    unclassifiedDepartures: validDrives - departures.length,
    conditionedShare:
      departures.length > 0 ? conditionedDepartures / departures.length : null,
    overall: compare(departures, 'all'),
    strata: [compare(departures, 'hot'), compare(departures, 'cold')],
  };
}
