/**
 * HVAC run-length analysis over timestamped climate samples.
 *
 * Each sample's state is resolved from all available power, compressor, and
 * fan signals. Adjacent sample intervals are then merged into on/off runs;
 * gaps larger than the configured ceiling contribute no observed time.
 * Durations are returned in SI seconds.
 */

import { resolveHvacActive } from '@/lib/climateState';

export interface HvacSignalSample {
  timestamp?: string | null;
  created_at?: string | null;
  hvacPower?: boolean | null;
  isAcOn?: boolean | null;
  fanSpeed?: number | null;
  hvacFanStatus?: number | null;
}

export interface HvacRun {
  on: boolean;
  startMs: number;
  endMs: number;
  durationS: number;
  intervals: number;
}

export interface HvacHourlyProfile {
  hour: number;
  onS: number;
  observedS: number;
  dutyCycle: number | null;
  eventStarts: number;
}

export interface HvacCyclingSummary {
  runs: HvacRun[];
  analyzedSamples: number;
  observedS: number;
  dutyCycle: number | null;
  eventCount: number;
  medianOnS: number | null;
  medianOffS: number | null;
  shortCycleRate: number | null;
  longestRunS: number | null;
  hourlyProfile: HvacHourlyProfile[];
}

export interface HvacCyclingOptions {
  maxGapS?: number;
  shortCycleThresholdS?: number;
}

const DEFAULT_MAX_GAP_S = 30 * 60;
const DEFAULT_SHORT_CYCLE_S = 10 * 60;

function finiteSignal(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Resolve HVAC-on without letting one explicit active signal be cancelled by
 * a stale off signal. Returns `null` only when no signal is interpretable.
 */
export function normalizeHvacOn(sample: HvacSignalSample): boolean | null {
  const states: boolean[] = [];
  const primaryState = resolveHvacActive(sample.hvacPower, sample.isAcOn);
  if (primaryState != null) states.push(primaryState);

  for (const fan of [finiteSignal(sample.fanSpeed), finiteSignal(sample.hvacFanStatus)]) {
    if (fan != null) states.push(fan > 0);
  }

  if (states.some(Boolean)) return true;
  return states.length > 0 ? false : null;
}

interface NormalizedSample {
  ms: number;
  on: boolean;
}

function normalize(samples: readonly HvacSignalSample[]): NormalizedSample[] {
  const rows: NormalizedSample[] = [];
  for (const sample of samples) {
    const timestamp = sample.timestamp ?? sample.created_at;
    if (!timestamp) continue;
    const ms = new Date(timestamp).getTime();
    const on = normalizeHvacOn(sample);
    if (!Number.isFinite(ms) || on == null) continue;
    rows.push({ ms, on });
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

function splitIntervalByHour(
  startMs: number,
  endMs: number,
  on: boolean,
  profile: HvacHourlyProfile[],
): void {
  let cursor = startMs;
  while (cursor < endMs) {
    const current = new Date(cursor);
    const hour = current.getHours();
    const boundary = new Date(cursor);
    boundary.setMinutes(0, 0, 0);
    boundary.setHours(boundary.getHours() + 1);
    const next = Math.min(endMs, Math.max(cursor + 1, boundary.getTime()));
    const durationS = (next - cursor) / 1000;
    profile[hour]!.observedS += durationS;
    if (on) profile[hour]!.onS += durationS;
    cursor = next;
  }
}

export function summarizeHvacCycling(
  samples: readonly HvacSignalSample[],
  options: HvacCyclingOptions = {},
): HvacCyclingSummary {
  const maxGapS = options.maxGapS ?? DEFAULT_MAX_GAP_S;
  const shortCycleThresholdS = options.shortCycleThresholdS ?? DEFAULT_SHORT_CYCLE_S;
  const rows = normalize(samples);
  const runs: HvacRun[] = [];
  const hourlyProfile: HvacHourlyProfile[] = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    onS: 0,
    observedS: 0,
    dutyCycle: null,
    eventStarts: 0,
  }));

  for (let index = 0; index < rows.length - 1; index += 1) {
    const current = rows[index]!;
    const next = rows[index + 1]!;
    const durationS = (next.ms - current.ms) / 1000;
    if (durationS <= 0 || durationS > maxGapS) continue;

    splitIntervalByHour(current.ms, next.ms, current.on, hourlyProfile);
    const previous = runs[runs.length - 1];
    if (previous && previous.on === current.on && previous.endMs === current.ms) {
      previous.endMs = next.ms;
      previous.durationS += durationS;
      previous.intervals += 1;
    } else {
      runs.push({
        on: current.on,
        startMs: current.ms,
        endMs: next.ms,
        durationS,
        intervals: 1,
      });
    }
  }

  const onRuns = runs.filter((run) => run.on);
  const offRuns = runs.filter((run) => !run.on);
  for (const run of onRuns) hourlyProfile[new Date(run.startMs).getHours()]!.eventStarts += 1;
  for (const bucket of hourlyProfile) {
    bucket.dutyCycle = bucket.observedS > 0 ? bucket.onS / bucket.observedS : null;
    bucket.onS = Math.round(bucket.onS);
    bucket.observedS = Math.round(bucket.observedS);
  }

  const observedS = runs.reduce((sum, run) => sum + run.durationS, 0);
  const onS = onRuns.reduce((sum, run) => sum + run.durationS, 0);
  const shortRuns = onRuns.filter((run) => run.durationS <= shortCycleThresholdS).length;

  return {
    runs,
    analyzedSamples: rows.length,
    observedS: Math.round(observedS),
    dutyCycle: observedS > 0 ? onS / observedS : null,
    eventCount: onRuns.length,
    medianOnS: median(onRuns.map((run) => run.durationS)),
    medianOffS: median(offRuns.map((run) => run.durationS)),
    shortCycleRate: onRuns.length > 0 ? shortRuns / onRuns.length : null,
    longestRunS: onRuns.length > 0 ? Math.max(...onRuns.map((run) => run.durationS)) : null,
    hourlyProfile,
  };
}
