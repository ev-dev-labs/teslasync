/**
 * Regime Shifts model — changepoint detection on weekly consumption.
 *
 * Answers "did my car's efficiency regime actually change, and when?" with
 * binary segmentation: recursively split the weekly Wh/km series at the point
 * that most reduces the total squared error, accepting a split only when the
 * reduction beats a BIC-style penalty (2·σ̂²·ln n). Each accepted boundary is
 * a regime shift, annotated with the consumption delta and the average-
 * temperature delta between the adjacent segments as a candidate cause.
 *
 * Pure and React-free.
 */

import type { Drive } from '@/types/driving';

export interface WeekSample {
  /** `yyyy-mm-dd` local Monday. */
  weekStart: string;
  whPerKm: number;
  distanceM: number;
  avgTempC: number | null;
}

export interface Segment {
  startWeek: string;
  endWeek: string;
  weeks: number;
  meanWhPerKm: number;
}

export interface RegimeShift {
  /** Week the new regime begins. */
  weekStart: string;
  /** Consumption change relative to the previous segment, e.g. +0.09 = +9%. */
  deltaShare: number;
  deltaWhPerKm: number;
  /** Avg outside temp delta (new − old), °C; null when either side lacks temps. */
  tempDeltaC: number | null;
}

export interface RegimeSummary {
  series: WeekSample[];
  segments: Segment[];
  shifts: RegimeShift[];
  analyzedWeeks: number;
}

const MIN_SEGMENT_WEEKS = 3;
const MAX_SHIFTS = 4;

function usable(d: Drive): boolean {
  return (
    d.energyUsedWh != null && Number.isFinite(d.energyUsedWh) && d.energyUsedWh > 0 &&
    Number.isFinite(d.distanceM) && d.distanceM >= 1000
  );
}

function weekStartOf(ms: number): string {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Build the weekly distance-weighted consumption series, ascending. */
export function buildWeeklySeries(drives: readonly Drive[]): WeekSample[] {
  const byWeek = new Map<string, { energy: number; distance: number; tempSum: number; tempW: number }>();
  for (const d of drives) {
    if (!usable(d)) continue;
    const ms = new Date(d.startTs).getTime();
    if (!Number.isFinite(ms)) continue;
    const week = weekStartOf(ms);
    const agg = byWeek.get(week) ?? { energy: 0, distance: 0, tempSum: 0, tempW: 0 };
    agg.energy += d.energyUsedWh!;
    agg.distance += d.distanceM;
    if (d.outsideTempAvgC != null && Number.isFinite(d.outsideTempAvgC)) {
      agg.tempSum += d.outsideTempAvgC * d.distanceM;
      agg.tempW += d.distanceM;
    }
    byWeek.set(week, agg);
  }
  return Array.from(byWeek.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([weekStart, agg]) => ({
      weekStart,
      whPerKm: Math.round((agg.energy / (agg.distance / 1000)) * 10) / 10,
      distanceM: agg.distance,
      avgTempC: agg.tempW > 0 ? Math.round((agg.tempSum / agg.tempW) * 10) / 10 : null,
    }));
}

function sse(values: readonly number[], from: number, to: number): number {
  // Sum of squared errors around the mean over [from, to).
  let sum = 0;
  for (let i = from; i < to; i++) sum += values[i]!;
  const n = to - from;
  if (n === 0) return 0;
  const mean = sum / n;
  let out = 0;
  for (let i = from; i < to; i++) {
    const e = values[i]! - mean;
    out += e * e;
  }
  return out;
}

/**
 * Binary segmentation over `values`, returning accepted split indices
 * (ascending). A split is accepted when SSE(parent) − SSE(children) exceeds
 * `penalty`. Exported for direct unit-testing of the detector itself.
 */
export function binarySegmentation(
  values: readonly number[],
  penalty: number,
  minSegment = MIN_SEGMENT_WEEKS,
  maxSplits = MAX_SHIFTS,
): number[] {
  const splits: number[] = [];
  const queue: [number, number][] = [[0, values.length]];

  while (queue.length > 0 && splits.length < maxSplits) {
    // Greedy: take the segment whose best split yields the biggest gain.
    let bestGain = -Infinity;
    let bestQueueIdx = -1;
    let bestSplit = -1;
    for (let q = 0; q < queue.length; q++) {
      const [from, to] = queue[q]!;
      const parent = sse(values, from, to);
      for (let s = from + minSegment; s <= to - minSegment; s++) {
        const gain = parent - sse(values, from, s) - sse(values, s, to);
        if (gain > bestGain) {
          bestGain = gain;
          bestQueueIdx = q;
          bestSplit = s;
        }
      }
    }
    if (bestQueueIdx === -1 || bestGain <= penalty) break;
    const [from, to] = queue[bestQueueIdx]!;
    queue.splice(bestQueueIdx, 1, [from, bestSplit], [bestSplit, to]);
    splits.push(bestSplit);
  }

  return splits.sort((a, b) => a - b);
}

export function summarizeRegimes(drives: readonly Drive[]): RegimeSummary {
  const series = buildWeeklySeries(drives);
  const values = series.map((w) => w.whPerKm);

  if (series.length < MIN_SEGMENT_WEEKS * 2) {
    return { series, segments: [], shifts: [], analyzedWeeks: series.length };
  }

  // Noise scale for the penalty: variance of week-over-week differences
  // (robust to the very level shifts we're hunting, unlike global variance).
  const diffs: number[] = [];
  for (let i = 1; i < values.length; i++) diffs.push(values[i]! - values[i - 1]!);
  const diffVar = diffs.reduce((s, d) => s + d * d, 0) / Math.max(1, diffs.length) / 2;
  const penalty = 2 * diffVar * Math.log(values.length);

  const splits = binarySegmentation(values, penalty);
  const bounds = [0, ...splits, values.length];

  const segments: Segment[] = [];
  for (let b = 0; b < bounds.length - 1; b++) {
    const from = bounds[b]!;
    const to = bounds[b + 1]!;
    let sum = 0;
    for (let i = from; i < to; i++) sum += values[i]!;
    segments.push({
      startWeek: series[from]!.weekStart,
      endWeek: series[to - 1]!.weekStart,
      weeks: to - from,
      meanWhPerKm: Math.round((sum / (to - from)) * 10) / 10,
    });
  }

  const shifts: RegimeShift[] = [];
  for (let s = 0; s < splits.length; s++) {
    const prev = segments[s]!;
    const next = segments[s + 1]!;
    const splitIdx = splits[s]!;

    const tempOf = (from: number, to: number): number | null => {
      const temps = series.slice(from, to).map((w) => w.avgTempC).filter((t): t is number => t != null);
      return temps.length ? temps.reduce((a, b) => a + b, 0) / temps.length : null;
    };
    const boundsIdx = [0, ...splits, values.length];
    const prevTemp = tempOf(boundsIdx[s]!, splitIdx);
    const nextTemp = tempOf(splitIdx, boundsIdx[s + 2]!);

    shifts.push({
      weekStart: series[splitIdx]!.weekStart,
      deltaShare: prev.meanWhPerKm > 0
        ? Math.round(((next.meanWhPerKm - prev.meanWhPerKm) / prev.meanWhPerKm) * 1000) / 1000
        : 0,
      deltaWhPerKm: Math.round((next.meanWhPerKm - prev.meanWhPerKm) * 10) / 10,
      tempDeltaC:
        prevTemp != null && nextTemp != null ? Math.round((nextTemp - prevTemp) * 10) / 10 : null,
    });
  }

  return { series, segments, shifts, analyzedWeeks: series.length };
}
