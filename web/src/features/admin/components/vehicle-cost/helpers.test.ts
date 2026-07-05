import { describe, it, expect, vi } from 'vitest';

import {
  avgRowsPerVehicle,
  rankVehicles,
  vehicleName,
  type SectionState,
  type VehicleCostBar,
} from './helpers';
import type { VehicleCostRow } from '@/types/admin-operator-confidence';

// ---------------------------------------------------------------------------
// vehicle-cost/helpers — contract lock + null-safety hardening
//
// These pure helpers back the Vehicle Ingest Cost admin page. The API returns
// operational counters (row counts, byte estimates, ingest rates, DLQ
// failures) that flow straight into a Recharts bar chart and a MetricBar
// share list, so a single `undefined` or mis-ordered row would surface as a
// blank bar, a `NaN%` label, or a `.toFixed` crash at the display boundary.
// The cases below pin: (1) display-name fallback semantics, (2) the ranking
// map → sort → slice contract including null-safety and input immutability,
// (3) the divide-by-zero guard on the fleet average, and (4) the shared
// SectionState / VehicleCostBar shapes the sibling panels consume.
// ---------------------------------------------------------------------------

function makeRow(overrides: Partial<VehicleCostRow> = {}): VehicleCostRow {
  return {
    vehicle_id: 1,
    display_name: 'Model 3',
    signal_row_count: 100,
    signal_bytes_est: 9_600,
    ingest_rate_per_minute_24h: 12.5,
    dlq_failures_24h: 0,
    last_seen_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

/** Mirrors the page's `nameOf`: real name, else a `Vehicle #{id}` fallback. */
const nameOf = (row: VehicleCostRow) => vehicleName(row, `Vehicle #${row.vehicle_id}`);

describe('vehicleName', () => {
  it('returns the display name when one is present', () => {
    expect(vehicleName({ display_name: 'Roadster', vehicle_id: 3 }, 'fallback')).toBe('Roadster');
  });

  it('trims surrounding whitespace from the display name', () => {
    expect(vehicleName({ display_name: '  Cybertruck  ', vehicle_id: 4 }, 'fallback')).toBe(
      'Cybertruck',
    );
  });

  it.each<[string, string]>([
    ['whitespace only', '   '],
    ['empty string', ''],
  ])('falls back when the display name is %s', (_label, value) => {
    expect(vehicleName({ display_name: value, vehicle_id: 5 }, 'Vehicle #5')).toBe('Vehicle #5');
  });

  it.each<[string, string | null | undefined]>([
    ['null', null],
    ['undefined', undefined],
  ])('falls back when the display name is %s', (_label, value) => {
    expect(vehicleName({ display_name: value, vehicle_id: 6 }, 'Vehicle #6')).toBe('Vehicle #6');
  });

  it('does not substitute the fallback when a real name exists', () => {
    const result = vehicleName({ display_name: 'Model S Plaid', vehicle_id: 7 }, 'Vehicle #7');
    expect(result).not.toBe('Vehicle #7');
    expect(result).toContain('Plaid');
  });
});

describe('rankVehicles', () => {
  const vehicles: VehicleCostRow[] = [
    makeRow({ vehicle_id: 1, display_name: 'Alpha', signal_bytes_est: 100, signal_row_count: 5 }),
    makeRow({ vehicle_id: 2, display_name: 'Bravo', signal_bytes_est: 900, signal_row_count: 2 }),
    makeRow({ vehicle_id: 3, display_name: 'Charlie', signal_bytes_est: 400, signal_row_count: 9 }),
  ];

  it('ranks by bytes descending and projects to the VehicleCostBar shape', () => {
    const bars = rankVehicles(vehicles, nameOf, 'bytes', 8);
    expect(bars.map((b) => b.vehicle_id)).toEqual([2, 3, 1]);
    expect(bars[0]).toEqual({
      vehicle_id: 2,
      name: 'Bravo',
      bytes: 900,
      rows: 2,
      rate: 12.5,
      failures: 0,
    });
  });

  it('ranks by rows descending so top-talkers ordering differs from bytes', () => {
    const bars = rankVehicles(vehicles, nameOf, 'rows', 8);
    expect(bars.map((b) => b.vehicle_id)).toEqual([3, 1, 2]);
  });

  it('applies nameOf to every row and threads the result through', () => {
    const spy = vi.fn((row: VehicleCostRow) => `V${row.vehicle_id}`);
    const bars = rankVehicles(vehicles, spy, 'bytes', 8);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy).toHaveBeenCalledWith(vehicles[0]);
    expect(bars.map((b) => b.name)).toEqual(['V2', 'V3', 'V1']);
  });

  it('coerces missing/nullish numeric fields to 0 for chart null-safety', () => {
    // A row that arrived without its counters (defensive: the API contract
    // types these as required, but a partial payload must never yield NaN).
    const sparse = {
      vehicle_id: 42,
      display_name: null,
      last_seen_at: '',
    } as unknown as VehicleCostRow;
    const [bar] = rankVehicles([sparse], nameOf, 'bytes', 8);
    expect(bar).toEqual({
      vehicle_id: 42,
      name: 'Vehicle #42',
      bytes: 0,
      rows: 0,
      rate: 0,
      failures: 0,
    });
  });

  it('respects the top-N limit', () => {
    const bars = rankVehicles(vehicles, nameOf, 'bytes', 2);
    expect(bars).toHaveLength(2);
    expect(bars.map((b) => b.vehicle_id)).toEqual([2, 3]);
  });

  it.each<number>([0, -5])('returns an empty list for a non-positive limit (%i)', (limit) => {
    expect(rankVehicles(vehicles, nameOf, 'bytes', limit)).toEqual([]);
  });

  it('is null-safe when the vehicle list itself is nullish', () => {
    expect(rankVehicles(undefined as unknown as VehicleCostRow[], nameOf, 'bytes', 8)).toEqual([]);
    expect(rankVehicles(null as unknown as VehicleCostRow[], nameOf, 'rows', 8)).toEqual([]);
  });

  it('returns an empty list for an empty input', () => {
    expect(rankVehicles([], nameOf, 'bytes', 8)).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const input = [...vehicles];
    const before = input.map((v) => v.vehicle_id);
    rankVehicles(input, nameOf, 'bytes', 8);
    expect(input.map((v) => v.vehicle_id)).toEqual(before);
    expect(input).toHaveLength(3);
  });

  it('carries rate and failures through untouched', () => {
    const loud = makeRow({
      vehicle_id: 9,
      signal_bytes_est: 1,
      ingest_rate_per_minute_24h: 88.25,
      dlq_failures_24h: 4,
    });
    const [bar] = rankVehicles([loud], nameOf, 'bytes', 8);
    expect(bar.rate).toBe(88.25);
    expect(bar.failures).toBe(4);
  });
});

describe('avgRowsPerVehicle', () => {
  it('computes the fleet mean', () => {
    expect(avgRowsPerVehicle(1000, 4)).toBe(250);
  });

  it('returns a fractional mean without rounding', () => {
    expect(avgRowsPerVehicle(10, 3)).toBeCloseTo(3.3333, 3);
  });

  it.each<[string, number, number]>([
    ['zero vehicles (divide-by-zero guard)', 1000, 0],
    ['a negative vehicle count', 1000, -2],
  ])('returns 0 for %s', (_label, total, count) => {
    expect(avgRowsPerVehicle(total, count)).toBe(0);
  });

  it('returns 0 when there are no rows', () => {
    expect(avgRowsPerVehicle(0, 5)).toBe(0);
  });
});

describe('shared section-state / bar contracts', () => {
  it('SectionState models loading/error/onRetry for a data-bound panel', () => {
    const onRetry = vi.fn();
    const state: SectionState = { loading: true, error: null, onRetry };
    expect(state.loading).toBe(true);
    state.onRetry();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('rankVehicles output is a VehicleCostBar with exactly the expected keys', () => {
    const [bar]: VehicleCostBar[] = rankVehicles([makeRow()], nameOf, 'bytes', 1);
    expect(Object.keys(bar).sort()).toEqual([
      'bytes',
      'failures',
      'name',
      'rate',
      'rows',
      'vehicle_id',
    ]);
  });
});
