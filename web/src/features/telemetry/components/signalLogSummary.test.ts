/**
 * signalLogSummary — behaviour + hardening coverage.
 *
 * Three pure derivations back the Signal Log Viewer. This suite exercises every
 * export, every branch, and the real bugs the hardening fixed:
 *   - `summarizeSignalLog`   — null/empty guards (preserving `signalsSelected`),
 *     the numeric/text/boolean split, distinct-signal counting, earliest/latest
 *     tracking across unordered + unparseable timestamps, and the nullish (not
 *     falsy) treatment of a `value_num` of 0 / `value_bool` of false.
 *   - `buildSignalChartData` — timestamp grouping into one record per instant,
 *     ascending sort regardless of input order, boolean 1/0 coercion, the "0 is
 *     preserved" nullish guard, and the non-finite guard (NaN / ±Infinity no
 *     longer plot — an Infinity used to blow out the shared Y-axis domain).
 *   - `buildSignalStats`     — per-signal min/max/avg/count, skipping non-numeric
 *     rows, the "0 counts" nullish guard, and the regression where a single NaN
 *     or Infinity poisoned a signal's entire min/max/avg.
 *
 * Pure logic: no components, hooks, network, or timers are involved, so this
 * follows the repo's existing `helpers.test.ts` convention (plain Vitest, no
 * RTL / MSW needed).
 */
import { describe, it, expect } from 'vitest';
import type { SignalLogEntry } from '@/components/SignalQueryControls';
import type { SignalStat } from '../hooks/useLiveSignalStream';
import {
  summarizeSignalLog,
  buildSignalChartData,
  buildSignalStats,
  type SignalLogSummary,
} from './signalLogSummary';

/** Build a fully-typed row, defaulting all three value channels to null. */
function row(
  signal: string,
  created_at: string,
  value: Partial<Pick<SignalLogEntry, 'value_num' | 'value_str' | 'value_bool'>> = {},
): SignalLogEntry {
  return { signal, created_at, value_num: null, value_str: null, value_bool: null, ...value };
}

const TS = {
  a: '2024-01-01T00:00:00.000Z',
  b: '2024-01-01T00:00:01.000Z',
  c: '2024-01-01T00:00:02.000Z',
} as const;

/** Locate a single signal's stat row (order is first-seen, not sorted). */
function statFor(stats: SignalStat[], signal: string): SignalStat | undefined {
  return stats.find((s) => s.signal === signal);
}

describe('summarizeSignalLog', () => {
  it('returns the empty summary for null / undefined / empty rows while preserving signalsSelected', () => {
    const empty: Omit<SignalLogSummary, 'signalsSelected'> = {
      totalRecords: 0,
      distinctSignals: 0,
      numericPoints: 0,
      textPoints: 0,
      boolPoints: 0,
      earliest: null,
      latest: null,
    };

    expect(summarizeSignalLog(null, ['a', 'b'])).toEqual({ ...empty, signalsSelected: 2 });
    expect(summarizeSignalLog(undefined, null)).toEqual({ ...empty, signalsSelected: 0 });
    expect(summarizeSignalLog([], ['only'])).toEqual({ ...empty, signalsSelected: 1 });
  });

  it('counts total records, distinct signals, and the numeric / text / boolean split', () => {
    const rows: SignalLogEntry[] = [
      row('speed', TS.a, { value_num: 10 }),
      row('speed', TS.b, { value_num: 20 }),
      row('gear', TS.a, { value_str: 'D' }),
      row('speed', TS.c, { value_bool: true }),
    ];

    const summary = summarizeSignalLog(rows, ['speed', 'gear', 'idle']);

    expect(summary.totalRecords).toBe(4);
    expect(summary.signalsSelected).toBe(3); // three asked for, even though only two returned rows
    expect(summary.distinctSignals).toBe(2); // 'speed' + 'gear'
    expect(summary.numericPoints).toBe(2);
    expect(summary.textPoints).toBe(1);
    expect(summary.boolPoints).toBe(1);
  });

  it('tracks the earliest and latest timestamps across unordered rows', () => {
    const rows: SignalLogEntry[] = [
      row('x', TS.b, { value_num: 1 }),
      row('x', TS.c, { value_num: 2 }),
      row('x', TS.a, { value_num: 3 }),
    ];

    const summary = summarizeSignalLog(rows, ['x']);

    expect(summary.earliest).toBe(TS.a);
    expect(summary.latest).toBe(TS.c);
  });

  it('ignores rows with an unparseable created_at when computing earliest / latest', () => {
    const rows: SignalLogEntry[] = [
      row('x', 'not-a-date', { value_num: 1 }),
      row('x', TS.b, { value_num: 2 }),
      row('x', 'also-garbage', { value_num: 3 }),
    ];

    const summary = summarizeSignalLog(rows, ['x']);

    // Invalid timestamps still count as records but never win min/max.
    expect(summary.totalRecords).toBe(3);
    expect(summary.earliest).toBe(TS.b);
    expect(summary.latest).toBe(TS.b);
  });

  it('leaves earliest / latest null when every timestamp is unparseable', () => {
    const rows: SignalLogEntry[] = [
      row('x', 'nope', { value_num: 1 }),
      row('x', 'still-nope', { value_num: 2 }),
    ];

    const summary = summarizeSignalLog(rows, ['x']);

    expect(summary.totalRecords).toBe(2);
    expect(summary.numericPoints).toBe(2);
    expect(summary.earliest).toBeNull();
    expect(summary.latest).toBeNull();
  });

  it('treats a value_num of 0 and value_bool of false as present (nullish, not falsy)', () => {
    // Regression guard: an `if (row.value_num)` style check would drop these.
    const rows: SignalLogEntry[] = [
      row('power', TS.a, { value_num: 0 }),
      row('charging', TS.a, { value_bool: false }),
    ];

    const summary = summarizeSignalLog(rows, ['power', 'charging']);

    expect(summary.numericPoints).toBe(1);
    expect(summary.boolPoints).toBe(1);
    expect(summary.textPoints).toBe(0);
  });

  it('counts an all-null row toward totalRecords but into none of the type buckets', () => {
    const rows: SignalLogEntry[] = [row('ghost', TS.a)];

    const summary = summarizeSignalLog(rows, ['ghost']);

    expect(summary.totalRecords).toBe(1);
    expect(summary.distinctSignals).toBe(1);
    expect(summary.numericPoints + summary.textPoints + summary.boolPoints).toBe(0);
  });
});

describe('buildSignalChartData', () => {
  it('returns an empty array for null / undefined / empty rows', () => {
    expect(buildSignalChartData(null)).toEqual([]);
    expect(buildSignalChartData(undefined)).toEqual([]);
    expect(buildSignalChartData([])).toEqual([]);
  });

  it('groups rows sharing a timestamp into one record with a key per signal', () => {
    const rows: SignalLogEntry[] = [
      row('speed', TS.a, { value_num: 10 }),
      row('power', TS.a, { value_num: 5 }),
    ];

    const data = buildSignalChartData(rows);

    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({ timestamp: TS.a, speed: 10, power: 5 });
  });

  it('sorts output ascending by timestamp regardless of input order', () => {
    const rows: SignalLogEntry[] = [
      row('speed', TS.c, { value_num: 3 }),
      row('speed', TS.a, { value_num: 1 }),
      row('speed', TS.b, { value_num: 2 }),
    ];

    const data = buildSignalChartData(rows);

    expect(data.map((d) => d.timestamp)).toEqual([TS.a, TS.b, TS.c]);
    expect(data.map((d) => d.speed)).toEqual([1, 2, 3]);
  });

  it('coerces booleans to 1 / 0 and leaves string-only rows null', () => {
    const rows: SignalLogEntry[] = [
      row('on', TS.a, { value_bool: true }),
      row('off', TS.a, { value_bool: false }),
      row('label', TS.a, { value_str: 'PARK' }),
    ];

    const data = buildSignalChartData(rows);

    expect(data[0]).toMatchObject({ on: 1, off: 0, label: null });
  });

  it('preserves a numeric 0 instead of dropping it as falsy', () => {
    // The `??` / finite path must keep 0, not fall through to the boolean coercion.
    const rows: SignalLogEntry[] = [row('power', TS.a, { value_num: 0, value_bool: true })];

    const data = buildSignalChartData(rows);

    expect(data[0].power).toBe(0);
  });

  it('skips a non-finite value_num rather than plotting NaN / Infinity (regression)', () => {
    // Pre-fix `value_num ?? …` returned NaN / Infinity verbatim; an Infinity
    // point then collapsed the shared Y-axis domain. Now non-finite value_num
    // falls back to the boolean coercion, else null.
    const rows: SignalLogEntry[] = [
      row('a', TS.a, { value_num: Number.NaN, value_bool: true }), // → falls back to bool → 1
      row('b', TS.a, { value_num: Number.POSITIVE_INFINITY }), // → null
      row('c', TS.a, { value_num: 42 }), // finite → kept
    ];

    const data = buildSignalChartData(rows);

    expect(data[0]).toMatchObject({ a: 1, b: null, c: 42 });
    expect(Object.values(data[0]).some((v) => typeof v === 'number' && !Number.isFinite(v))).toBe(false);
  });
});

describe('buildSignalStats', () => {
  it('returns an empty array for null / undefined / empty rows', () => {
    expect(buildSignalStats(null)).toEqual([]);
    expect(buildSignalStats(undefined)).toEqual([]);
    expect(buildSignalStats([])).toEqual([]);
  });

  it('computes min / max / avg / count per signal over numeric samples', () => {
    const rows: SignalLogEntry[] = [
      row('speed', TS.a, { value_num: 10 }),
      row('speed', TS.b, { value_num: 30 }),
      row('speed', TS.c, { value_num: 20 }),
      row('soc', TS.a, { value_num: 80 }),
    ];

    const stats = buildSignalStats(rows);

    expect(stats).toHaveLength(2);
    expect(statFor(stats, 'speed')).toEqual({ signal: 'speed', min: 10, max: 30, avg: 20, count: 3 });
    expect(statFor(stats, 'soc')).toEqual({ signal: 'soc', min: 80, max: 80, avg: 80, count: 1 });
  });

  it('skips non-numeric rows (string / boolean / null) and drops signals with no numeric samples', () => {
    const rows: SignalLogEntry[] = [
      row('speed', TS.a, { value_num: 5 }),
      row('speed', TS.b, { value_str: 'fast' }), // ignored
      row('gear', TS.a, { value_str: 'D' }), // no numeric sample at all
      row('charging', TS.a, { value_bool: true }), // no numeric sample at all
    ];

    const stats = buildSignalStats(rows);

    expect(stats).toHaveLength(1);
    expect(statFor(stats, 'speed')).toEqual({ signal: 'speed', min: 5, max: 5, avg: 5, count: 1 });
    expect(statFor(stats, 'gear')).toBeUndefined();
  });

  it('includes a value of 0 in the statistics (nullish guard, not falsy)', () => {
    const rows: SignalLogEntry[] = [
      row('power', TS.a, { value_num: 0 }),
      row('power', TS.b, { value_num: 4 }),
    ];

    const stat = statFor(buildSignalStats(rows), 'power');

    expect(stat).toEqual({ signal: 'power', min: 0, max: 4, avg: 2, count: 2 });
  });

  it('skips non-finite samples so one NaN / Infinity cannot poison a signal (regression)', () => {
    // Pre-fix, values = [NaN, 10, 20, Infinity, -Infinity] → Math.min/max/reduce
    // all returned NaN, poisoning min, max AND avg for the entire signal.
    const rows: SignalLogEntry[] = [
      row('speed', TS.a, { value_num: Number.NaN }),
      row('speed', TS.b, { value_num: 10 }),
      row('speed', TS.c, { value_num: 20 }),
      row('speed', TS.a, { value_num: Number.POSITIVE_INFINITY }),
      row('speed', TS.b, { value_num: Number.NEGATIVE_INFINITY }),
    ];

    const stat = statFor(buildSignalStats(rows), 'speed');

    expect(stat).toEqual({ signal: 'speed', min: 10, max: 20, avg: 15, count: 2 });
    expect(Number.isFinite(stat?.avg)).toBe(true);
  });

  it('drops a signal whose only numeric samples are non-finite', () => {
    const rows: SignalLogEntry[] = [
      row('broken', TS.a, { value_num: Number.NaN }),
      row('broken', TS.b, { value_num: Number.POSITIVE_INFINITY }),
    ];

    expect(buildSignalStats(rows)).toEqual([]);
  });
});
