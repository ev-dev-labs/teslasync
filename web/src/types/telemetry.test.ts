/**
 * `types/telemetry.ts` — behaviour + data-contract harness.
 *
 * `telemetry.ts` is mostly pure type declarations, so a smoke import proves
 * nothing and asserting an interface back to itself is tautological. What
 * actually matters here is twofold:
 *
 *  1. The dual-shape NORMALIZERS the module now co-locates with the
 *     `TelemetryStatus` / `VehicleTelemetry` types. The `/telemetry` payload
 *     has shipped vehicles as an array OR a `Record<vin, …>` map, under
 *     `vehicles` OR the legacy `streaming_vehicles` key, in camelCase OR
 *     snake_case. `normalizeVehicleTelemetry` / `telemetryVehicleList` /
 *     `telemetryUptimeSeconds` are the single place that collapses all of that
 *     to a canonical, null-safe shape. These are exercised exhaustively —
 *     including the regression this hardening fixed: the ARRAY branch used to
 *     skip snake_case normalization, so `signalCount` silently read as
 *     `undefined` (→ rendered 0) whenever the backend sent an array of
 *     snake_case rows.
 *
 *  2. The snake→camel bridge every consumer relies on — `camelCaseKeys()` in
 *     `@/lib/resilience`, invoked by `request()` — must keep emitting objects
 *     that satisfy the remaining interfaces with the exact field names they
 *     document. This suite pins that contract at RUNTIME through the real
 *     producer (the same strategy `types/driving.test.ts` uses), because
 *     tsconfig excludes test files from `tsc`, so a dropped/renamed key would
 *     otherwise break pages with no compile error to catch it.
 *
 * Pure logic + a real transform: no components, hooks, network, or timers.
 */
import { describe, it, expect } from 'vitest';
import { camelCaseKeys } from '@/lib/resilience';
import { deriveSignalRows } from '@/features/telemetry/signalGapUtils';
import {
  normalizeVehicleTelemetry,
  telemetryVehicleList,
  telemetryUptimeSeconds,
} from './telemetry';
import type {
  SignalPoint,
  SignalStats,
  SignalHistoryResponse,
  SignalLogEntry,
  SignalRow,
  SignalEntry,
  RangeStats,
  TelemetryStatus,
  VehicleTelemetry,
} from './telemetry';

/* ── Runtime helpers ────────────────────────────────────────────────────── */

/** Asserts `v` is a non-null object and returns it as an indexable record. */
function asRecord(v: unknown): Record<string, unknown> {
  expect(v).not.toBeNull();
  expect(typeof v).toBe('object');
  return v as Record<string, unknown>;
}

/** Asserts every key in `keys` is present on `v`; returns the record. */
function expectHasKeys(v: unknown, keys: readonly string[]): Record<string, unknown> {
  const rec = asRecord(v);
  for (const k of keys) expect(rec).toHaveProperty(k);
  return rec;
}

/**
 * A raw per-vehicle row exactly as a snake_case backend emits it — i.e. WITHOUT
 * the camelCase counters the `VehicleTelemetry` interface marks required. The
 * `as unknown as VehicleTelemetry` cast models that runtime reality (the whole
 * point of the normalizers is to survive it) without leaking `any`.
 */
function snakeVehicle(row: Record<string, unknown>): VehicleTelemetry {
  return row as unknown as VehicleTelemetry;
}

/* ── normalizeVehicleTelemetry ──────────────────────────────────────────── */

describe('normalizeVehicleTelemetry', () => {
  it('resolves snake_case counters to canonical camelCase fields', () => {
    const out = normalizeVehicleTelemetry(
      snakeVehicle({
        vin: '5YJVIN',
        signal_count: 10,
        batch_count: 2,
        signals_per_second: 3.5,
        last_received: '2025-01-15T12:00:00Z',
      }),
    );

    expect(out.vin).toBe('5YJVIN');
    expect(out.signalCount).toBe(10);
    expect(out.batchCount).toBe(2);
    expect(out.signalsPerSecond).toBe(3.5);
    expect(out.lastReceived).toBe('2025-01-15T12:00:00Z');
  });

  it('prefers the camelCase spelling when both casings are present', () => {
    const out = normalizeVehicleTelemetry({
      vin: 'A',
      signalCount: 99,
      signal_count: 1,
      batchCount: 7,
      batch_count: 1,
      signalsPerSecond: 4,
      signals_per_second: 1,
      lastReceived: 'camel',
      last_received: 'snake',
    });

    expect(out.signalCount).toBe(99);
    expect(out.batchCount).toBe(7);
    expect(out.signalsPerSecond).toBe(4);
    expect(out.lastReceived).toBe('camel');
  });

  it('defaults missing counts to 0 but leaves absent rate / last-seen undefined', () => {
    const out = normalizeVehicleTelemetry(snakeVehicle({ vin: 'B', state: 'asleep' }));

    // Counts are summable without a guard…
    expect(out.signalCount).toBe(0);
    expect(out.batchCount).toBe(0);
    // …while genuinely-absent optionals stay undefined (distinct from a real 0).
    expect(out.signalsPerSecond).toBeUndefined();
    expect(out.lastReceived).toBeUndefined();
  });

  it('preserves a real 0 count instead of treating it as missing (nullish, not falsy)', () => {
    const out = normalizeVehicleTelemetry({
      vin: 'C',
      signalCount: 0,
      batchCount: 0,
      signalsPerSecond: 0,
    });

    expect(out.signalCount).toBe(0);
    expect(out.batchCount).toBe(0);
    expect(out.signalsPerSecond).toBe(0);
  });

  it('applies the VIN override and preserves unrelated fields via spread', () => {
    const out = normalizeVehicleTelemetry(
      snakeVehicle({ state: 'online', is_streaming: true, latency_ms: 42, data_source: 'mqtt' }),
      'VIN-FROM-KEY',
    );

    expect(out.vin).toBe('VIN-FROM-KEY');
    expect(out.state).toBe('online');
    expect(out.is_streaming).toBe(true);
    expect(out.latency_ms).toBe(42);
    expect(out.data_source).toBe('mqtt');
  });
});

/* ── telemetryVehicleList ───────────────────────────────────────────────── */

describe('telemetryVehicleList', () => {
  it('returns an empty array for null / undefined / vehicle-less status', () => {
    expect(telemetryVehicleList(null)).toEqual([]);
    expect(telemetryVehicleList(undefined)).toEqual([]);
    expect(telemetryVehicleList({ connected: false })).toEqual([]);
    expect(telemetryVehicleList({ connected: true, vehicles: {} })).toEqual([]);
  });

  it('normalizes a Record<vin, …> map, using the map key as the authoritative VIN', () => {
    const status = {
      connected: true,
      vehicles: {
        '5YJVIN': snakeVehicle({ signal_count: 10, batch_count: 2, signals_per_second: 3 }),
      },
    } as TelemetryStatus;

    const list = telemetryVehicleList(status);

    expect(list).toHaveLength(1);
    expect(list[0].vin).toBe('5YJVIN');
    expect(list[0].signalCount).toBe(10);
    expect(list[0].batchCount).toBe(2);
    expect(list[0].signalsPerSecond).toBe(3);
  });

  it('normalizes an ARRAY of snake_case rows — the array-branch regression', () => {
    // Pre-fix the array branch was a bare pass-through, so `signalCount` /
    // `batchCount` stayed undefined and rendered as 0. It must now resolve
    // snake_case exactly like the record branch does.
    const status = {
      connected: true,
      vehicles: [snakeVehicle({ vin: 'A', signal_count: 5, batch_count: 1 })],
    } as unknown as TelemetryStatus;

    const list = telemetryVehicleList(status);

    expect(list).toHaveLength(1);
    expect(list[0].vin).toBe('A');
    expect(list[0].signalCount).toBe(5);
    expect(list[0].batchCount).toBe(1);
  });

  it('falls back to streaming_vehicles when vehicles is absent', () => {
    const status = {
      connected: false,
      streaming_vehicles: { VIN2: snakeVehicle({ state: 'online' }) },
    } as TelemetryStatus;

    const list = telemetryVehicleList(status);

    expect(list).toHaveLength(1);
    expect(list[0].vin).toBe('VIN2');
    expect(list[0].signalCount).toBe(0);
  });

  it('prefers vehicles over streaming_vehicles when both are present', () => {
    const status = {
      connected: true,
      vehicles: [snakeVehicle({ vin: 'PRIMARY', signal_count: 1 })],
      streaming_vehicles: { FALLBACK: snakeVehicle({ signal_count: 99 }) },
    } as unknown as TelemetryStatus;

    const list = telemetryVehicleList(status);

    expect(list).toHaveLength(1);
    expect(list[0].vin).toBe('PRIMARY');
  });

  it('tolerates a malformed non-object vehicles field without throwing', () => {
    const status = { connected: true, vehicles: 'oops' } as unknown as TelemetryStatus;
    expect(telemetryVehicleList(status)).toEqual([]);
  });
});

/* ── telemetryUptimeSeconds ─────────────────────────────────────────────── */

describe('telemetryUptimeSeconds', () => {
  it('reads the camelCase field, falling back to snake_case', () => {
    expect(telemetryUptimeSeconds({ connected: true, uptimeSeconds: 120 })).toBe(120);
    expect(telemetryUptimeSeconds({ connected: true, uptime_seconds: 240 })).toBe(240);
  });

  it('prefers camelCase when both spellings are present', () => {
    expect(
      telemetryUptimeSeconds({ connected: true, uptimeSeconds: 5, uptime_seconds: 999 }),
    ).toBe(5);
  });

  it('preserves a real 0 (nullish coalescing, not truthiness)', () => {
    expect(telemetryUptimeSeconds({ connected: true, uptimeSeconds: 0 })).toBe(0);
    expect(telemetryUptimeSeconds({ connected: true, uptime_seconds: 0 })).toBe(0);
  });

  it('returns undefined when uptime is absent or the status is nullish', () => {
    expect(telemetryUptimeSeconds({ connected: true })).toBeUndefined();
    expect(telemetryUptimeSeconds(null)).toBeUndefined();
    expect(telemetryUptimeSeconds(undefined)).toBeUndefined();
  });
});

/* ── camelCaseKeys bridge → TelemetryStatus / VehicleTelemetry ──────────── */

describe('telemetry contract via the camelCaseKeys resilience bridge', () => {
  it('feeds a snake_case Record payload end-to-end into a normalized fleet', () => {
    // Shaped like the real Go `/telemetry` response (snake_case, vehicles as a
    // Record<vin, …> map) before request() applies camelCaseKeys().
    const backend = {
      connected: true,
      broker: 'tcp://mosquitto:1883',
      uptime_seconds: 3600,
      topics: ['telemetry/+/v/+'],
      vehicles: {
        '5YJ3E1EA': {
          vin: '5YJ3E1EA',
          state: 'online',
          signal_count: 1200,
          batch_count: 40,
          signals_per_second: 3.5,
          last_received: '2025-01-15T12:00:00Z',
          is_streaming: true,
        },
      },
    };

    const status = camelCaseKeys(backend) as TelemetryStatus;

    // The bridge exposes both casings on the raw vehicle entry…
    const rawVehicle = asRecord(asRecord(status.vehicles)['5YJ3E1EA']);
    expect(rawVehicle.signal_count).toBe(1200);
    expect(rawVehicle.signalCount).toBe(1200);

    // …and the normalizers collapse the whole thing to canonical values.
    expect(telemetryUptimeSeconds(status)).toBe(3600);

    const list = telemetryVehicleList(status);
    expect(list).toHaveLength(1);
    const v = expectHasKeys(list[0], ['vin', 'signalCount', 'batchCount']);
    expect(v.vin).toBe('5YJ3E1EA');
    expect(v.signalCount).toBe(1200);
    expect(v.batchCount).toBe(40);
    expect((list[0] as VehicleTelemetry).signalsPerSecond).toBe(3.5);
  });

  it('handles the array-shape payload through the same bridge', () => {
    const backend = {
      connected: true,
      vehicles: [
        { vin: 'A', signal_count: 5, batch_count: 1, signals_per_second: 0.5, last_received: 't' },
      ],
    };

    const status = camelCaseKeys(backend) as TelemetryStatus;
    const list = telemetryVehicleList(status);

    expect(list).toHaveLength(1);
    expect(list[0].vin).toBe('A');
    expect(list[0].signalCount).toBe(5);
    expect(list[0].lastReceived).toBe('t');
  });
});

/* ── Signal data-shape contracts (via the same bridge / real producers) ──── */

describe('signal data-shape contracts', () => {
  it('SignalPoint / SignalLogEntry: snake value channels surface as valueNum/Str/Bool', () => {
    const backend = { timestamp: '2025-01-15T12:00:00Z', value_num: 42, value_str: null, value_bool: null };

    const point = camelCaseKeys(backend) as SignalPoint;
    const logEntry = camelCaseKeys(backend) as SignalLogEntry;

    expect(point.valueNum).toBe(42);
    expect(point.valueStr).toBeNull(); // null survives the transform (not coerced)
    expect(point.valueBool).toBeNull();
    expect(logEntry.timestamp).toBe('2025-01-15T12:00:00Z');
    expect(logEntry.valueNum).toBe(42);
  });

  it('SignalStats: vehicle_id → vehicleId with nullable oldest / newest preserved', () => {
    const stats = camelCaseKeys({
      vehicle_id: 7,
      count: 3,
      oldest: '2025-01-01T00:00:00Z',
      newest: null,
    }) as SignalStats;

    expect(stats.vehicleId).toBe(7);
    expect(stats.count).toBe(3);
    expect(stats.oldest).toBe('2025-01-01T00:00:00Z');
    expect(stats.newest).toBeNull();
  });

  it('SignalHistoryResponse: recurses into the nested data[] points', () => {
    const resp = camelCaseKeys({
      vehicle_id: 2,
      signal: 'VehicleSpeed',
      from: '2025-01-15T11:00:00Z',
      to: '2025-01-15T12:00:00Z',
      count: 1,
      data: [{ timestamp: '2025-01-15T11:30:00Z', value_num: 55 }],
    }) as SignalHistoryResponse;

    expectHasKeys(resp, ['vehicleId', 'signal', 'from', 'to', 'count', 'data']);
    expect(resp.vehicleId).toBe(2);
    expect(resp.data).toHaveLength(1);
    expect(resp.data[0].valueNum).toBe(55);
  });

  it('SignalEntry: the discriminant + already-camel fields pass through the bridge intact', () => {
    const entry: SignalEntry = { id: 1, timestamp: 't', name: 'Gear', value: 'D', type: 'string' };

    // camelCaseKeys must be a faithful pass-through for an all-camel shape.
    expect(camelCaseKeys(entry)).toEqual(entry);
    expect(['number', 'string', 'boolean']).toContain(entry.type);
    expect(entry.value).toBe('D');
  });

  it('RangeStats: holds min ≤ avg ≤ max and survives the bridge unchanged', () => {
    const stats: RangeStats = { min: 10, max: 30, avg: 20, count: 3 };

    expect(camelCaseKeys(stats)).toEqual(stats);
    expect(stats.min).toBeLessThanOrEqual(stats.avg);
    expect(stats.avg).toBeLessThanOrEqual(stats.max);
    expect(stats.count).toBe(3);
  });

  it('SignalRow: the deriveSignalRows producer emits the documented shape', () => {
    const now = Date.parse('2025-01-15T12:00:00Z');
    const rows: SignalRow[] = deriveSignalRows(
      {
        speed: { value: 42, timestamp: new Date(now - 10_000).toISOString() },
        gear: { value: 'D', timestamp: null },
        bare: 99, // legacy bare-scalar payload → no timestamp
      },
      now,
    );

    expect(rows).toHaveLength(3);

    const speed = rows.find((r) => r.name === 'speed')!;
    expect(speed.value).toBe('42'); // stringified for display
    expect(speed.category).toBe('active'); // < aging threshold
    expect(speed.staleness).toBeGreaterThanOrEqual(0);

    const gear = rows.find((r) => r.name === 'gear')!;
    expect(gear.timestamp).toBeNull();
    expect(gear.category).toBe('never');

    const bare = rows.find((r) => r.name === 'bare')!;
    expect(bare.value).toBe('99');
    expect(bare.category).toBe('never');
  });
});
