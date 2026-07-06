/**
 * signalGapUtils — behaviour + hardening coverage.
 *
 * These four pure derivations are the single source of truth behind both the
 * Signal Gap Detector KPIs (`useSignalGapAnalysis`) and the catalog table. The
 * suite exercises every export, every branch, and the two real bugs the
 * hardening fixed:
 *   - `deriveSignalRows`   — the `{ value, timestamp }` vs bare-scalar tolerance,
 *     the nullish (not falsy) value stringification (`0` / `false` survive), the
 *     active / stale / never categorisation against an injected `now`, and the
 *     regression where an *unparseable* timestamp slipped through as a bogus
 *     "active" row with `NaN` staleness (now normalised to "never received").
 *   - `computeGapBuckets`  — the four-way active/aging/stale/never tally, the
 *     exact `< 30` / `< 300` boundaries, and never-by-missing-timestamp.
 *   - `computeFreshnessPct`— the `total <= 0` guard and the rounded
 *     (active + aging) / total fraction.
 *   - `formatStaleness`    — non-finite → em-dash, the s/m/h segments, and the
 *     floor/clamp fixes (no "60s"/"1h 60m" overflow, no negative "-3s ago").
 *
 * Pure logic: no components, hooks, network, or timers, so this follows the
 * repo's existing `signalLogSummary.test.ts` convention (plain Vitest, no RTL /
 * MSW needed).
 */
import { describe, it, expect } from 'vitest';

import type { SignalRow } from '@/types/telemetry';

import {
  GAP_ACTIVE_MAX_S,
  GAP_AGING_MAX_S,
  GAP_BUCKET_COLORS,
  computeFreshnessPct,
  computeGapBuckets,
  deriveSignalRows,
  formatStaleness,
  type GapBucketKey,
  type GapBuckets,
} from './signalGapUtils';

/** Deterministic staleness reference — every `tsAgo` is relative to this. */
const NOW = Date.parse('2024-06-01T12:00:00.000Z');
/** ISO string for a timestamp `seconds` before `NOW` (ms-exact round-trip). */
const tsAgo = (seconds: number): string => new Date(NOW - seconds * 1000).toISOString();

/** Build a fully-typed SignalRow, overriding only the fields under test. */
function rowOf(over: Partial<SignalRow> = {}): SignalRow {
  return {
    name: 'signal',
    value: '1',
    timestamp: '2024-06-01T12:00:00.000Z',
    staleness: 0,
    category: 'active',
    ...over,
  };
}

/** Build a GapBuckets, defaulting every bucket to zero. */
function bucketsOf(over: Partial<GapBuckets> = {}): GapBuckets {
  return { total: 0, active: 0, aging: 0, stale: 0, never: 0, ...over };
}

describe('staleness thresholds + bucket colours', () => {
  it('orders the active window strictly inside the aging window', () => {
    expect(GAP_ACTIVE_MAX_S).toBe(30);
    expect(GAP_AGING_MAX_S).toBe(300);
    expect(GAP_ACTIVE_MAX_S).toBeLessThan(GAP_AGING_MAX_S);
  });

  it('exposes a distinct hex colour for each of the four buckets', () => {
    const keys: GapBucketKey[] = ['active', 'aging', 'stale', 'never'];
    expect(Object.keys(GAP_BUCKET_COLORS).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(GAP_BUCKET_COLORS[key]).toMatch(/^#[0-9a-f]{6}$/i);
    }
    expect(new Set(Object.values(GAP_BUCKET_COLORS)).size).toBe(keys.length);
  });
});

describe('deriveSignalRows', () => {
  it('returns an empty array for null / undefined input', () => {
    expect(deriveSignalRows(null, NOW)).toEqual([]);
    expect(deriveSignalRows(undefined, NOW)).toEqual([]);
    expect(deriveSignalRows({}, NOW)).toEqual([]);
  });

  it('normalises a { value, timestamp } entry with staleness against the injected now', () => {
    const rows = deriveSignalRows({ battery_level: { value: 82, timestamp: tsAgo(10) } }, NOW);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual<SignalRow>({
      name: 'battery_level',
      value: '82',
      timestamp: tsAgo(10),
      staleness: 10,
      category: 'active',
    });
  });

  it('is deterministic under the injected now (later reference → larger staleness)', () => {
    const data = { s: { value: 1, timestamp: tsAgo(10) } };

    expect(deriveSignalRows(data, NOW)[0].staleness).toBe(10);
    expect(deriveSignalRows(data, NOW + 5_000)[0].staleness).toBe(15);
  });

  it('coarsens category to active / stale / never while keeping raw staleness', () => {
    const rows = deriveSignalRows(
      {
        fresh: { value: 1, timestamp: tsAgo(5) }, // < 30s
        aging: { value: 2, timestamp: tsAgo(120) }, // 30–300s → still "active" category
        stale: { value: 3, timestamp: tsAgo(600) }, // > 300s
        never: { value: 4, timestamp: null },
      },
      NOW,
    );

    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(byName.fresh.category).toBe('active');
    // The 3-value category has no "aging" — an aging-window row reads "active"
    // in the table even though computeGapBuckets tallies it as aging.
    expect(byName.aging.category).toBe('active');
    expect(byName.aging.staleness).toBe(120);
    expect(byName.stale.category).toBe('stale');
    expect(byName.never.category).toBe('never');
    expect(byName.never.staleness).toBe(Infinity);
  });

  it('tolerates a bare scalar entry (older payload shape) as a never-received row', () => {
    const rows = deriveSignalRows({ speed: 60, gear: 'D' }, NOW);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(byName.speed).toEqual<SignalRow>({
      name: 'speed',
      value: '60',
      timestamp: null,
      staleness: Infinity,
      category: 'never',
    });
    expect(byName.gear.value).toBe('D');
    expect(byName.gear.category).toBe('never');
  });

  it('stringifies value nullish-not-falsy: 0 / false survive, null / missing → em-dash', () => {
    const rows = deriveSignalRows(
      {
        zero: { value: 0, timestamp: tsAgo(1) },
        off: { value: false, timestamp: tsAgo(1) },
        nulled: { value: null, timestamp: tsAgo(1) },
        missing: { timestamp: tsAgo(1) },
        bareNull: null,
      },
      NOW,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    expect(byName.zero.value).toBe('0');
    expect(byName.off.value).toBe('false');
    expect(byName.nulled.value).toBe('—');
    expect(byName.missing.value).toBe('—');
    expect(byName.bareNull.value).toBe('—');
    expect(byName.bareNull.category).toBe('never');
  });

  it('normalises an unparseable timestamp to "never" instead of a bogus NaN "active" (regression)', () => {
    // Pre-fix: staleness = (now - NaN) / 1000 = NaN, `NaN > 300` is false, so
    // the row read "active" with a NaN staleness — yet computeGapBuckets counted
    // the very same row as "stale". It must normalise to never/null/Infinity.
    const [row] = deriveSignalRows({ broken: { value: 7, timestamp: 'not-a-date' } }, NOW);

    expect(row.category).toBe('never');
    expect(row.timestamp).toBeNull();
    expect(row.staleness).toBe(Infinity);
    expect(row.value).toBe('7');

    // Consistency: the derived row now lands in the "never" bucket, never "stale".
    expect(computeGapBuckets([row])).toEqual(bucketsOf({ total: 1, never: 1 }));
  });
});

describe('computeGapBuckets', () => {
  it('returns an all-zero tally with total 0 for no rows', () => {
    expect(computeGapBuckets([])).toEqual(bucketsOf({ total: 0 }));
  });

  it('partitions rows into active / aging / stale / never with a running total', () => {
    const rows: SignalRow[] = [
      rowOf({ name: 'a', staleness: 5, category: 'active' }),
      rowOf({ name: 'b', staleness: 120, category: 'active' }),
      rowOf({ name: 'c', staleness: 600, category: 'stale' }),
      rowOf({ name: 'd', timestamp: null, staleness: Infinity, category: 'never' }),
    ];

    expect(computeGapBuckets(rows)).toEqual<GapBuckets>({
      total: 4,
      active: 1,
      aging: 1,
      stale: 1,
      never: 1,
    });
  });

  it('honours the exact < 30 (active) and < 300 (aging) boundaries', () => {
    const rows: SignalRow[] = [
      rowOf({ name: 'just-active', staleness: 29.999 }),
      rowOf({ name: 'edge-active', staleness: 30 }), // 30 is NOT < 30 → aging
      rowOf({ name: 'just-aging', staleness: 299.999 }),
      rowOf({ name: 'edge-aging', staleness: 300 }), // 300 is NOT < 300 → stale
    ];

    expect(computeGapBuckets(rows)).toEqual<GapBuckets>({
      total: 4,
      active: 1,
      aging: 2,
      stale: 1,
      never: 0,
    });
  });

  it('counts a missing timestamp as never regardless of the staleness number', () => {
    const rows: SignalRow[] = [
      rowOf({ name: 'x', timestamp: null, staleness: 5, category: 'never' }),
      rowOf({ name: 'y', timestamp: null, staleness: Infinity, category: 'never' }),
    ];

    const buckets = computeGapBuckets(rows);
    expect(buckets.never).toBe(2);
    expect(buckets.active).toBe(0);
    expect(buckets.total).toBe(2);
  });
});

describe('computeFreshnessPct', () => {
  it('guards an empty catalog (total <= 0) and returns 0', () => {
    expect(computeFreshnessPct(bucketsOf({ total: 0 }))).toBe(0);
    expect(computeFreshnessPct(bucketsOf({ total: -1, active: 5 }))).toBe(0);
  });

  it('reports (active + aging) / total as a rounded percentage', () => {
    expect(computeFreshnessPct(bucketsOf({ total: 4, active: 2 }))).toBe(50);
    expect(computeFreshnessPct(bucketsOf({ total: 4, active: 1, aging: 1 }))).toBe(50);
    // 1 / 3 → 33.33 → 33 (rounded).
    expect(computeFreshnessPct(bucketsOf({ total: 3, active: 1, never: 2 }))).toBe(33);
  });

  it('spans the full 0–100 range', () => {
    expect(computeFreshnessPct(bucketsOf({ total: 5, active: 3, aging: 2 }))).toBe(100);
    expect(computeFreshnessPct(bucketsOf({ total: 4, stale: 2, never: 2 }))).toBe(0);
  });
});

describe('formatStaleness', () => {
  it('renders an em-dash for any non-finite input', () => {
    expect(formatStaleness(Infinity)).toBe('—');
    expect(formatStaleness(-Infinity)).toBe('—');
    expect(formatStaleness(NaN)).toBe('—');
  });

  it('formats seconds, minutes, and hours segments', () => {
    expect(formatStaleness(0)).toBe('0s ago');
    expect(formatStaleness(59)).toBe('59s ago');
    expect(formatStaleness(90)).toBe('1m ago');
    expect(formatStaleness(600)).toBe('10m ago');
    expect(formatStaleness(3600)).toBe('1h 0m ago');
  });

  it('clamps clock-skew negatives to zero instead of printing "-Ns ago"', () => {
    expect(formatStaleness(-5)).toBe('0s ago');
    expect(formatStaleness(-3600)).toBe('0s ago');
  });

  it('floors instead of rounding so it never overflows to "60s" / "1h 60m" (regression)', () => {
    // Pre-fix, fmtInt rounded 59.98 → 60 and 3599/60 → 60.
    expect(formatStaleness(59.98)).toBe('59s ago');
    expect(formatStaleness(3599)).toBe('59m ago');
    expect(formatStaleness(7199)).toBe('1h 59m ago');
  });
});
