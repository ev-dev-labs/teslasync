/**
 * signalLogSummary — pure derivations for the Signal Log Viewer.
 *
 * The viewer fetches a flat batch of `SignalLogEntry` rows (one per
 * signal sample) and needs three orthogonal projections of that batch:
 *   - `summarizeSignalLog`   → KPI + value-type-breakdown counters.
 *   - `buildSignalChartData` → timestamp-keyed rows for `SignalChartPanel`.
 *   - `buildSignalStats`     → per-signal min/max/avg/count for the chart's
 *                              dual-axis heuristic + the breakdown panel.
 *
 * Kept framework-free (no React) so the logic is unit-testable and shared
 * without pulling a component graph. Mirrors the historical derivations in
 * `SignalExplorerPage` so both surfaces stay visually consistent.
 */

import type { SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalStat } from '../hooks/useLiveSignalStream';

export interface SignalLogSummary {
  /** Total rows returned across every selected signal. */
  totalRecords: number;
  /** How many signals the user asked for. */
  signalsSelected: number;
  /** How many of the selected signals actually returned at least one row. */
  distinctSignals: number;
  /** Rows whose value is numeric. */
  numericPoints: number;
  /** Rows whose value is a string. */
  textPoints: number;
  /** Rows whose value is a boolean. */
  boolPoints: number;
  /** ISO timestamp of the oldest row, or null when empty. */
  earliest: string | null;
  /** ISO timestamp of the newest row, or null when empty. */
  latest: string | null;
}

const EMPTY_SUMMARY: SignalLogSummary = {
  totalRecords: 0,
  signalsSelected: 0,
  distinctSignals: 0,
  numericPoints: 0,
  textPoints: 0,
  boolPoints: 0,
  earliest: null,
  latest: null,
};

/** Reduce a raw batch of rows into the viewer's headline counters. */
export function summarizeSignalLog(
  rows: SignalLogEntry[] | null | undefined,
  selectedSignals: string[] | null | undefined,
): SignalLogSummary {
  const safeRows = rows ?? [];
  const safeSelected = selectedSignals ?? [];
  if (safeRows.length === 0) {
    return { ...EMPTY_SUMMARY, signalsSelected: safeSelected.length };
  }

  const present = new Set<string>();
  let numericPoints = 0;
  let textPoints = 0;
  let boolPoints = 0;
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const row of safeRows) {
    present.add(row.signal);
    if (row.value_num !== null && row.value_num !== undefined) numericPoints += 1;
    else if (row.value_bool !== null && row.value_bool !== undefined) boolPoints += 1;
    else if (row.value_str !== null && row.value_str !== undefined) textPoints += 1;

    const ms = new Date(row.created_at).getTime();
    if (!Number.isNaN(ms)) {
      if (ms < earliestMs) { earliestMs = ms; earliest = row.created_at; }
      if (ms > latestMs) { latestMs = ms; latest = row.created_at; }
    }
  }

  return {
    totalRecords: safeRows.length,
    signalsSelected: safeSelected.length,
    distinctSignals: present.size,
    numericPoints,
    textPoints,
    boolPoints,
    earliest,
    latest,
  };
}

/**
 * Project rows into timestamp-keyed records for the multi-line chart.
 * Booleans are coerced to 1/0 so on/off signals still plot; non-numeric
 * strings — and non-finite numbers (NaN / ±Infinity) — are left null so the
 * chart's numeric guard skips them instead of an Infinity blowing out the
 * shared Y-axis domain and flattening every real series.
 */
export function buildSignalChartData(
  rows: SignalLogEntry[] | null | undefined,
): Record<string, unknown>[] {
  const safeRows = rows ?? [];
  if (safeRows.length === 0) return [];

  const byTs = new Map<string, Record<string, unknown>>();
  for (const row of safeRows) {
    let entry = byTs.get(row.created_at);
    if (!entry) {
      entry = { timestamp: row.created_at };
      byTs.set(row.created_at, entry);
    }
    const num = row.value_num;
    // Finite numbers win (including 0); a nullish or non-finite value_num
    // falls back to the boolean 1/0 coercion, else null so the chart skips it.
    entry[row.signal] =
      num !== null && num !== undefined && Number.isFinite(num)
        ? num
        : row.value_bool === true
          ? 1
          : row.value_bool === false
            ? 0
            : null;
  }

  return Array.from(byTs.values()).sort(
    (a, b) =>
      new Date(a.timestamp as string).getTime() -
      new Date(b.timestamp as string).getTime(),
  );
}

/** Compute per-signal statistics (min/max/avg/count) over finite numeric samples. */
export function buildSignalStats(
  rows: SignalLogEntry[] | null | undefined,
): SignalStat[] {
  const safeRows = rows ?? [];
  if (safeRows.length === 0) return [];

  const bySignal = new Map<string, number[]>();
  for (const row of safeRows) {
    const v = row.value_num;
    // Skip nullish AND non-finite (NaN / ±Infinity) samples: a single one would
    // otherwise poison the whole signal's min/max/avg via Math.min/max/reduce.
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    const arr = bySignal.get(row.signal) ?? [];
    arr.push(v);
    bySignal.set(row.signal, arr);
  }

  return Array.from(bySignal.entries()).map(([signal, values]) => ({
    signal,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: values.reduce((a, b) => a + b, 0) / values.length,
    count: values.length,
  }));
}
