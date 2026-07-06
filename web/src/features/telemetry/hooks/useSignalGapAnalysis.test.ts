/**
 * useSignalGapAnalysis — the Signal Gap Detector's single derivation hook.
 *
 * The hook owns no DOM: it calls the low-level `useSignalGaps` query and folds
 * the live-signal map into the page's KPI band, staleness buckets, freshness
 * score, and worst-offender list via the REAL `signalGapUtils` math. So the
 * suite mocks ONLY that one query (through a hoisted holder) and drives the hook
 * with `renderHook` — no network, no provider, no `useQuery`.
 *
 * `Date.now()` is captured inside the `rows` memo, so the whole suite pins the
 * system clock with fake timers and builds every fixture timestamp as an EXACT
 * offset from that frozen `now`. Every staleness figure is therefore a stable
 * integer, and the bucket/freshness/topStale assertions are exact rather than
 * margin-based.
 *
 * Facets covered:
 *   1. FORWARDING   — the selected vehicleId is passed straight to useSignalGaps
 *                     and the raw query object is returned by reference.
 *   2. EMPTY/LOADING — undefined query data yields empty rows, zeroed buckets,
 *                     0% freshness, and an empty topStale (no throw).
 *   3. ROWS         — object and bare-scalar entries both normalise; null values
 *                     collapse to the em-dash; a null timestamp → `never`.
 *   4. BUCKETS      — the four staleness bands tally on their exact thresholds
 *                     (active <30s, aging <5m, stale ≥5m, never = no timestamp).
 *   5. FRESHNESS    — (active+aging)/total, rounded, and 0 for an empty vehicle.
 *   6. TOP-STALE    — worst-first ordering, capped at 6, never-received excluded,
 *                     and consistent with the stale bucket count.
 *   7. RECOMPUTE    — a bumped `dataUpdatedAt` re-derives staleness against the
 *                     new clock even when the data object is structurally shared.
 *   8. MEMO         — a stable query reference yields a stable analysis object
 *                     (and stable members) across a no-op re-render — pins the
 *                     referential-stability hardening this file adds.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

import type { SignalRow } from '@/types/telemetry';
import {
  GAP_ACTIVE_MAX_S,
  GAP_AGING_MAX_S,
} from '../signalGapUtils';

/** The subset of the react-query result the hook actually reads / forwards. */
interface FakeQuery {
  data: Record<string, unknown> | undefined;
  dataUpdatedAt: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
}

// ── Mutable holder shared with the hoisted vi.mock factory. Each render reads
//    the latest `query`; `lastVehicleId` records the argument the hook forwarded.
const H = vi.hoisted(() => ({
  query: undefined as unknown as FakeQuery,
  lastVehicleId: -1 as number,
}));

// Mock ONLY the low-level query. The hook imports nothing else from this module,
// so a minimal factory keeps the real (heavy) telemetry module out of the graph.
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalGaps: vi.fn((vehicleId: number) => {
    H.lastVehicleId = vehicleId;
    return H.query;
  }),
}));

import { useSignalGapAnalysis } from './useSignalGapAnalysis';
import { useSignalGaps } from '@/api/hooks/useTelemetry';

// A frozen wall clock so every staleness figure is a deterministic integer.
const NOW = new Date('2026-01-01T00:00:00.000Z').getTime();

/** ISO timestamp exactly `ms` milliseconds before the frozen `now`. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function makeQuery(over: Partial<FakeQuery> = {}): FakeQuery {
  return {
    data: over.data,
    dataUpdatedAt: over.dataUpdatedAt ?? NOW,
    isLoading: over.isLoading ?? false,
    isError: over.isError ?? false,
    error: over.error ?? null,
    refetch: over.refetch ?? vi.fn(),
  };
}

/** Render the hook against the holder's current query. */
function analyze(vehicleId = 42) {
  return renderHook((id: number) => useSignalGapAnalysis(id), {
    initialProps: vehicleId,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  H.query = makeQuery();
  H.lastVehicleId = -1;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useSignalGapAnalysis — query forwarding', () => {
  it('passes the vehicleId to useSignalGaps and returns its query by reference', () => {
    H.query = makeQuery({ data: {}, isLoading: false });
    const { result } = analyze(7);

    expect(useSignalGaps).toHaveBeenCalledWith(7);
    expect(H.lastVehicleId).toBe(7);
    // The raw query object is forwarded untouched so consumers can read
    // isLoading / isError / refetch off `analysis.query`.
    expect(result.current.query).toBe(H.query);
  });
});

describe('useSignalGapAnalysis — empty & loading', () => {
  it('yields empty derivations for undefined data without throwing', () => {
    H.query = makeQuery({ data: undefined, isLoading: true });
    const { result } = analyze();

    expect(result.current.rows).toEqual([]);
    expect(result.current.buckets).toEqual({
      total: 0,
      active: 0,
      aging: 0,
      stale: 0,
      never: 0,
    });
    expect(result.current.freshnessPct).toBe(0);
    expect(result.current.topStale).toEqual([]);
    // The loading flag still rides along on the forwarded query.
    expect(result.current.query.isLoading).toBe(true);
  });

  it('treats an empty signal map as a live-but-silent vehicle (zeroed, 0% fresh)', () => {
    H.query = makeQuery({ data: {} });
    const { result } = analyze();

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.buckets.total).toBe(0);
    expect(result.current.freshnessPct).toBe(0);
  });
});

describe('useSignalGapAnalysis — row normalisation', () => {
  it('normalises object entries, bare scalars, and null values/timestamps', () => {
    H.query = makeQuery({
      data: {
        battery_level: { value: 82, timestamp: ago(5_000) },
        odometer: 12_345, // bare scalar — no timestamp
        gear: { value: null, timestamp: ago(1_000) }, // null value → em-dash
        never_seen: { value: 5, timestamp: null },
      },
    });
    const { result } = analyze();

    const byName = Object.fromEntries(
      result.current.rows.map((r: SignalRow) => [r.name, r]),
    );

    expect(byName.battery_level.value).toBe('82');
    expect(byName.battery_level.staleness).toBe(5);
    // A bare scalar is tolerated: value stringified, timestamp absent.
    expect(byName.odometer.value).toBe('12345');
    expect(byName.odometer.timestamp).toBeNull();
    expect(byName.odometer.staleness).toBe(Infinity);
    // A null value renders as the em-dash placeholder, not the string "null".
    expect(byName.gear.value).toBe('—');
    // An explicit null timestamp is a "never received" signal.
    expect(byName.never_seen.timestamp).toBeNull();
  });
});

describe('useSignalGapAnalysis — buckets & freshness', () => {
  // Two signals in each of the four bands, straddling the exact thresholds.
  function mixedFleet() {
    return makeQuery({
      data: {
        active_fresh: { value: 1, timestamp: ago(5_000) }, // 5s → active
        active_edge: { value: 1, timestamp: ago((GAP_ACTIVE_MAX_S - 1) * 1000) }, // 29s → active
        aging_lo: { value: 1, timestamp: ago(GAP_ACTIVE_MAX_S * 1000) }, // 30s → aging
        aging_hi: { value: 1, timestamp: ago((GAP_AGING_MAX_S - 1) * 1000) }, // 299s → aging
        stale_edge: { value: 1, timestamp: ago(GAP_AGING_MAX_S * 1000) }, // 300s → stale
        stale_old: { value: 1, timestamp: ago(600_000) }, // 600s → stale
        never_null: { value: 1, timestamp: null }, // never
        never_scalar: 9, // bare scalar → never
      },
    });
  }

  it('tallies the four staleness bands on their exact thresholds', () => {
    H.query = mixedFleet();
    const { result } = analyze();

    expect(result.current.buckets).toEqual({
      total: 8,
      active: 2,
      aging: 2,
      stale: 2,
      never: 2,
    });
    // The bucket total must always equal the derived row count.
    expect(result.current.buckets.total).toBe(result.current.rows.length);
  });

  it('derives freshness as the rounded receiving share', () => {
    H.query = mixedFleet();
    const { result } = analyze();

    // (active 2 + aging 2) / total 8 = 50%.
    expect(result.current.freshnessPct).toBe(50);
  });

  it('rounds freshness to the nearest whole percent', () => {
    // 2 receiving of 3 total → 66.67% → 67 (rounds, never truncates).
    H.query = makeQuery({
      data: {
        a: { value: 1, timestamp: ago(5_000) }, // active
        b: { value: 1, timestamp: ago(60_000) }, // aging
        c: { value: 1, timestamp: ago(600_000) }, // stale
      },
    });
    const { result } = analyze();

    expect(result.current.buckets.total).toBe(3);
    expect(result.current.freshnessPct).toBe(67);
  });
});

describe('useSignalGapAnalysis — topStale', () => {
  it('orders the worst offenders first and caps the list at six', () => {
    // Seven stale signals (all ≥ the aging ceiling) at distinct ages, plus a
    // never-received one that must NOT appear in the stale ranking.
    H.query = makeQuery({
      data: {
        sig301: { value: 1, timestamp: ago(301_000) },
        sig400: { value: 1, timestamp: ago(400_000) },
        sig500: { value: 1, timestamp: ago(500_000) },
        sig600: { value: 1, timestamp: ago(600_000) },
        sig700: { value: 1, timestamp: ago(700_000) },
        sig800: { value: 1, timestamp: ago(800_000) },
        sig900: { value: 1, timestamp: ago(900_000) },
        never: { value: 1, timestamp: null },
      },
    });
    const { result } = analyze();

    // Worst (oldest) first, exactly six — the least-stale sig301 is dropped.
    expect(result.current.topStale.map((r: SignalRow) => r.name)).toEqual([
      'sig900',
      'sig800',
      'sig700',
      'sig600',
      'sig500',
      'sig400',
    ]);
    expect(result.current.topStale).toHaveLength(6);
    // Descending by staleness.
    const ages = result.current.topStale.map((r: SignalRow) => r.staleness);
    expect(ages).toEqual([...ages].sort((a, b) => b - a));
    // A never-received signal is not a "stale offender" (no age to rank).
    expect(result.current.topStale.some((r: SignalRow) => r.name === 'never')).toBe(false);
  });

  it('excludes never-received signals and stays consistent with the stale bucket', () => {
    H.query = makeQuery({
      data: {
        fresh: { value: 1, timestamp: ago(1_000) }, // active
        stale_one: { value: 1, timestamp: ago(400_000) }, // stale
        never_a: { value: 1, timestamp: null }, // never
        never_b: { value: 1, timestamp: null }, // never
      },
    });
    const { result } = analyze();

    expect(result.current.topStale).toHaveLength(1);
    expect(result.current.topStale[0].name).toBe('stale_one');
    // topStale is the (capped) view of the stale bucket — never rows excluded.
    expect(result.current.topStale.length).toBe(
      Math.min(result.current.buckets.stale, 6),
    );
    expect(result.current.buckets.never).toBe(2);
  });
});

describe('useSignalGapAnalysis — recompute on refetch', () => {
  it('re-derives staleness against the new clock when dataUpdatedAt changes', () => {
    // A single structurally-shared data object referenced across both renders.
    const shared = { vehicle_speed: { value: 60, timestamp: ago(10_000) } };
    H.query = makeQuery({ data: shared, dataUpdatedAt: NOW });
    const { result, rerender } = analyze();

    expect(result.current.rows[0].staleness).toBe(10);

    // Advance the wall clock 90s and simulate a realtime refetch: SAME data
    // reference, only dataUpdatedAt is bumped. The rows memo keys on
    // dataUpdatedAt precisely so staleness recomputes here.
    vi.setSystemTime(NOW + 90_000);
    H.query = makeQuery({ data: shared, dataUpdatedAt: NOW + 90_000 });
    rerender(42);

    expect(result.current.rows[0].staleness).toBe(100);
    // The signal has now crossed from active into the aging band.
    expect(result.current.buckets.active).toBe(0);
    expect(result.current.buckets.aging).toBe(1);
  });
});

describe('useSignalGapAnalysis — referential stability', () => {
  it('returns a stable analysis object and members across a no-op re-render', () => {
    H.query = makeQuery({
      data: {
        a: { value: 1, timestamp: ago(5_000) },
        b: { value: 1, timestamp: ago(400_000) },
      },
    });
    const { result, rerender } = analyze();
    const before = result.current;

    // Nothing changed — same query reference, same clock.
    rerender(42);
    const after = result.current;

    expect(after).toBe(before);
    expect(after.rows).toBe(before.rows);
    expect(after.buckets).toBe(before.buckets);
    expect(after.topStale).toBe(before.topStale);
    expect(after.query).toBe(before.query);
  });
});
