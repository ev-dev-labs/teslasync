/**
 * Active-HVAC comfort control consistency.
 *
 * Temperatures stay in canonical Celsius and durations in SI seconds. The
 * analysis compares cabin temperature with the mean available front-row
 * setpoint only while HVAC is observably active. It also identifies active
 * runs that begin outside the comfort band, measures time to sustained
 * comfort, and records opposite-side overshoot.
 *
 * The score is confidence-aware: a raw blend of band adherence, absolute
 * deviation, left/right agreement, and stabilization is shrunk toward a
 * neutral 50 when sample or window evidence is thin.
 */

import { normalizeHvacOn, type HvacSignalSample } from './hvacCycling';

export interface ComfortSample extends HvacSignalSample {
  insideTemp?: number | null;
  driverTempSetting?: number | null;
  passengerTempSetting?: number | null;
}

export interface StabilizationWindow {
  startMs: number;
  endMs: number;
  samples: number;
  direction: 'hot' | 'cold';
  startDeviationC: number;
  timeToBandS: number | null;
  overshootC: number;
}

export interface OvershootBin {
  lowerC: number;
  upperC: number | null;
  windows: number;
  share: number;
}

export interface ComfortConsistencyOptions {
  comfortBandC?: number;
  maxGapS?: number;
  sustainSamples?: number;
  maxTargetShiftC?: number;
}

export interface ComfortConsistencySummary {
  analyzedSamples: number;
  withinComfortBandShare: number | null;
  meanAbsDeviationC: number | null;
  medianAbsDeviationC: number | null;
  p90AbsDeviationC: number | null;
  meanSetpointDisagreementC: number | null;
  disagreementSampleShare: number | null;
  stabilizationWindows: StabilizationWindow[];
  stabilizedWindows: number;
  medianStabilizationS: number | null;
  medianOvershootC: number | null;
  overshootDistribution: OvershootBin[];
  consistencyScore: number | null;
  confidence: number;
}

interface NormalizedComfort {
  ms: number;
  insideC: number;
  targetC: number;
  deviationC: number;
  disagreementC: number | null;
  hvacOn: boolean | null;
}

const DEFAULTS: Required<ComfortConsistencyOptions> = {
  comfortBandC: 1.5,
  maxGapS: 30 * 60,
  sustainSamples: 2,
  maxTargetShiftC: 2,
};

const OVERSHOOT_EDGES = [0, 0.5, 1, 2] as const;

function finite(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalize(samples: readonly ComfortSample[]): NormalizedComfort[] {
  const rows: NormalizedComfort[] = [];
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
    rows.push({
      ms,
      insideC,
      targetC,
      deviationC: insideC - targetC,
      disagreementC:
        driverC != null && passengerC != null ? Math.abs(driverC - passengerC) : null,
      hvacOn: normalizeHvacOn(sample),
    });
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

function percentile(values: readonly number[], proportion: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1)]!;
}

function buildStabilizationWindows(
  rows: readonly NormalizedComfort[],
  options: Required<ComfortConsistencyOptions>,
): StabilizationWindow[] {
  const result: StabilizationWindow[] = [];
  let run: NormalizedComfort[] = [];

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }
    const first = run[0]!;
    if (Math.abs(first.deviationC) <= options.comfortBandC) {
      run = [];
      return;
    }

    let timeToBandS: number | null = null;
    for (let index = 0; index <= run.length - options.sustainSamples; index += 1) {
      const sustained = run
        .slice(index, index + options.sustainSamples)
        .every((row) => Math.abs(row.deviationC) <= options.comfortBandC);
      if (sustained) {
        timeToBandS = (run[index]!.ms - first.ms) / 1000;
        break;
      }
    }

    const hot = first.deviationC > 0;
    const overshootC = hot
      ? Math.max(0, ...run.map((row) => -row.deviationC))
      : Math.max(0, ...run.map((row) => row.deviationC));
    result.push({
      startMs: first.ms,
      endMs: run[run.length - 1]!.ms,
      samples: run.length,
      direction: hot ? 'hot' : 'cold',
      startDeviationC: first.deviationC,
      timeToBandS,
      overshootC,
    });
    run = [];
  };

  for (const row of rows) {
    if (row.hvacOn !== true) {
      flush();
      continue;
    }
    const previous = run[run.length - 1];
    if (
      previous &&
      ((row.ms - previous.ms) / 1000 > options.maxGapS ||
        Math.abs(row.targetC - previous.targetC) > options.maxTargetShiftC)
    ) {
      flush();
    }
    run.push(row);
  }
  flush();
  return result;
}

function buildOvershootDistribution(
  windows: readonly StabilizationWindow[],
): OvershootBin[] {
  return OVERSHOOT_EDGES.map((lowerC, index) => {
    const upperC = OVERSHOOT_EDGES[index + 1] ?? null;
    const count = windows.filter(
      (window) =>
        window.overshootC >= lowerC && (upperC == null || window.overshootC < upperC),
    ).length;
    return {
      lowerC,
      upperC,
      windows: count,
      share: windows.length > 0 ? count / windows.length : 0,
    };
  });
}

export function summarizeComfortConsistency(
  samples: readonly ComfortSample[],
  options: ComfortConsistencyOptions = {},
): ComfortConsistencySummary {
  const config = { ...DEFAULTS, ...options };
  const allRows = normalize(samples);
  const rows = allRows.filter((row) => row.hvacOn === true);
  const deviations = rows.map((row) => Math.abs(row.deviationC));
  const disagreements = rows
    .map((row) => row.disagreementC)
    .filter((value): value is number => value != null);
  const windows = buildStabilizationWindows(allRows, config);
  const stabilizationValues = windows
    .map((window) => window.timeToBandS)
    .filter((value): value is number => value != null);
  const meanDeviation =
    deviations.length > 0
      ? deviations.reduce((sum, value) => sum + value, 0) / deviations.length
      : null;
  const meanDisagreement =
    disagreements.length > 0
      ? disagreements.reduce((sum, value) => sum + value, 0) / disagreements.length
      : null;
  const withinShare =
    deviations.length > 0
      ? deviations.filter((value) => value <= config.comfortBandC).length / deviations.length
      : null;
  const medianStabilizationS = median(stabilizationValues);

  const confidence =
    rows.length > 0
      ? 0.75 * Math.min(1, rows.length / 80) + 0.25 * Math.min(1, windows.length / 6)
      : 0;
  const agreementScore =
    meanDisagreement == null ? 0.5 : Math.max(0, 1 - meanDisagreement / 4);
  const stabilizationScore =
    medianStabilizationS == null ? 0.5 : Math.max(0, 1 - medianStabilizationS / 2700);
  const rawScore =
    withinShare == null || meanDeviation == null
      ? null
      : 100 *
        (0.5 * withinShare +
          0.25 * Math.max(0, 1 - meanDeviation / 5) +
          0.15 * agreementScore +
          0.1 * stabilizationScore);

  return {
    analyzedSamples: rows.length,
    withinComfortBandShare: withinShare,
    meanAbsDeviationC: meanDeviation,
    medianAbsDeviationC: median(deviations),
    p90AbsDeviationC: percentile(deviations, 0.9),
    meanSetpointDisagreementC: meanDisagreement,
    disagreementSampleShare:
      disagreements.length > 0
        ? disagreements.filter((value) => value > 1).length / disagreements.length
        : null,
    stabilizationWindows: windows,
    stabilizedWindows: stabilizationValues.length,
    medianStabilizationS,
    medianOvershootC: median(windows.map((window) => window.overshootC)),
    overshootDistribution: buildOvershootDistribution(windows),
    consistencyScore: rawScore == null ? null : Math.round(50 + confidence * (rawScore - 50)),
    confidence,
  };
}
