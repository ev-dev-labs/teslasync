/**
 * useLiveSignalStream — behavioural + hardening coverage.
 *
 * The hook owns two independent slices driven off a single SSE subscription:
 *   - a throttled (2 Hz) selected-signals chart buffer with a 5-minute rolling
 *     window and per-signal running stats, and
 *   - a pause-aware, vehicle-scoped firehose tail with a 1 Hz rate counter.
 *
 * We replace `useRealtimeEvents` with a controllable stub that CAPTURES the
 * `onVehicleUpdate` handler the hook registers, so tests can feed SSE frames
 * synchronously and observe every branch without a network. Fake timers give
 * deterministic control over `Date.now()` (throttle + window math) and the
 * 1 Hz rate interval.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SignalStat, UseLiveSignalStreamOptions } from './useLiveSignalStream';
import type { SignalEntry } from '@/types/telemetry';

// Shared, hoisted state the mock factory reads/writes. `vi.hoisted` is required
// because vi.mock factories are hoisted above the module body and may not close
// over ordinary top-level `let` bindings.
const stub = vi.hoisted(() => ({
  handler: null as ((data: unknown) => void) | null,
  connected: false,
  lastEnabled: undefined as boolean | undefined,
}));

vi.mock('@/hooks/useRealtimeEvents', () => ({
  useRealtimeEvents: (opts: {
    enabled?: boolean;
    onVehicleUpdate?: (data: unknown) => void;
  }) => {
    stub.lastEnabled = opts.enabled;
    stub.handler = opts.onVehicleUpdate ?? null;
    return { connected: stub.connected };
  },
}));

import { useLiveSignalStream } from './useLiveSignalStream';

const BASE_ISO = '2026-01-01T00:00:00.000Z';

function emit(payload: unknown): void {
  act(() => {
    stub.handler?.(payload);
  });
}

function advanceAndEmit(ms: number, payload: unknown): void {
  act(() => {
    vi.advanceTimersByTime(ms);
    stub.handler?.(payload);
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function stat(stats: SignalStat[], signal: string): SignalStat | undefined {
  return stats.find((s) => s.signal === signal);
}

function tailEntry(entries: SignalEntry[], name: string): SignalEntry | undefined {
  return entries.find((e) => e.name === name);
}

function setup(opts: Partial<UseLiveSignalStreamOptions> = {}) {
  const initialProps: UseLiveSignalStreamOptions = {
    enabled: true,
    vehicleId: 1,
    chartSignals: [],
    tailMax: 500,
    ...opts,
  };
  return renderHook((props: UseLiveSignalStreamOptions) => useLiveSignalStream(props), {
    initialProps,
  });
}

beforeEach(() => {
  stub.handler = null;
  stub.connected = false;
  stub.lastEnabled = undefined;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(BASE_ISO));
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ───────────────────────────── connection + wiring ─────────────────────────
describe('useLiveSignalStream — connection wiring', () => {
  it('forwards `enabled` to useRealtimeEvents and mirrors the connection state', () => {
    stub.connected = true;
    const { result, rerender } = setup({ enabled: true });

    expect(stub.lastEnabled).toBe(true);
    expect(result.current.connected).toBe(true);

    // Flip the underlying wire state + the enabled flag and re-render.
    stub.connected = false;
    rerender({ enabled: false, vehicleId: 1, chartSignals: [], tailMax: 500 });
    expect(stub.lastEnabled).toBe(false);
    expect(result.current.connected).toBe(false);
  });

  it('starts with empty buffers and stable control identities', () => {
    const { result } = setup();
    expect(result.current.chartData).toEqual([]);
    expect(result.current.chartStats).toEqual([]);
    expect(result.current.chartPointCount).toBe(0);
    expect(result.current.tailEntries).toEqual([]);
    expect(result.current.tailRate).toBe(0);
    expect(result.current.tailPaused).toBe(false);
    expect(typeof result.current.clearTail).toBe('function');
    expect(typeof result.current.resetChart).toBe('function');
  });
});

// ───────────────────────────── chart slice ─────────────────────────────────
describe('useLiveSignalStream — chart slice', () => {
  it('accumulates selected-signal points and derives running min/max/avg/count', () => {
    const { result } = setup({ chartSignals: ['battery_level', 'vehicle_speed'], tailMax: 0 });

    emit({ signals: { battery_level: 80, vehicle_speed: 10 } });
    advanceAndEmit(600, { signals: { battery_level: 82, vehicle_speed: 20 } });
    advanceAndEmit(600, { signals: { battery_level: 84 } }); // speed absent this frame

    expect(result.current.chartData).toHaveLength(3);
    expect(result.current.chartPointCount).toBe(3);
    expect(result.current.chartData[0].battery_level).toBe(80);
    expect(result.current.chartData[0].vehicle_speed).toBe(10);
    // The third frame carried no speed → the point omits that key entirely.
    expect(result.current.chartData[2].battery_level).toBe(84);
    expect(result.current.chartData[2].vehicle_speed).toBeUndefined();

    const battery = stat(result.current.chartStats, 'battery_level');
    expect(battery).toEqual({ signal: 'battery_level', min: 80, max: 84, avg: 82, count: 3 });
    const speed = stat(result.current.chartStats, 'vehicle_speed');
    expect(speed).toEqual({ signal: 'vehicle_speed', min: 10, max: 20, avg: 15, count: 2 });
  });

  it('coerces booleans/numeric strings and drops non-numeric values', () => {
    const { result } = setup({ chartSignals: ['a', 'b', 'c', 'd'], tailMax: 0 });

    emit({ signals: { a: true, b: false, c: '42.5', d: 'abc' } });

    const point = result.current.chartData[0];
    expect(point.a).toBe(1);
    expect(point.b).toBe(0);
    expect(point.c).toBe(42.5);
    // 'abc' → parseFloat NaN → skipped, so neither the point nor the stats
    // gain a `d` entry.
    expect('d' in point).toBe(false);
    expect(stat(result.current.chartStats, 'd')).toBeUndefined();
    expect(stat(result.current.chartStats, 'a')?.count).toBe(1);
  });

  it('throttles state flushes to ~2 Hz while buffering every frame', () => {
    const { result } = setup({ chartSignals: ['x'], tailMax: 0 });

    emit({ signals: { x: 1 } }); // first frame flushes immediately
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartPointCount).toBe(1);

    // Second frame within the 500ms window is buffered but NOT flushed to state.
    emit({ signals: { x: 2 } });
    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartPointCount).toBe(1);

    // Cross the throttle boundary → the next frame flushes the whole buffer.
    advanceAndEmit(600, { signals: { x: 3 } });
    expect(result.current.chartData).toHaveLength(3);
    expect(result.current.chartPointCount).toBe(3);
  });

  it('trims chart data to the 5-minute window yet keeps the all-time counter', () => {
    const { result } = setup({ chartSignals: ['x'], tailMax: 0 });

    emit({ signals: { x: 1 }, timestamp: BASE_ISO });
    expect(result.current.chartData).toHaveLength(1);

    // Jump 6 minutes ahead: the first point falls outside the 5-min window.
    advanceAndEmit(6 * 60 * 1000, {
      signals: { x: 2 },
      timestamp: '2026-01-01T00:06:00.000Z',
    });

    expect(result.current.chartData).toHaveLength(1);
    expect(result.current.chartData[0].x).toBe(2);
    expect(result.current.chartData[0].timestamp).toBe('2026-01-01T00:06:00.000Z');
    // The running counter reflects every point ever received, not the window.
    expect(result.current.chartPointCount).toBe(2);
  });

  it('resetChart clears the chart buffers, stats, and counter', () => {
    const { result } = setup({ chartSignals: ['x'], tailMax: 0 });
    emit({ signals: { x: 5 } });
    expect(result.current.chartData).toHaveLength(1);

    act(() => result.current.resetChart());

    expect(result.current.chartData).toEqual([]);
    expect(result.current.chartStats).toEqual([]);
    expect(result.current.chartPointCount).toBe(0);
  });
});

// ───────────────────────────── tail slice ──────────────────────────────────
describe('useLiveSignalStream — tail slice', () => {
  it('flattens a bare `signals` frame, typing values and skipping meta/nested keys', () => {
    const { result } = setup({ chartSignals: [] });

    emit({
      vehicle_id: 1,
      timestamp: BASE_ISO,
      signals: {
        battery_level: 80,
        is_charging: true,
        gear: 'D',
        vehicle_id: 5, // meta key → skipped
        ts: 'skip', // meta key → skipped
        nested: { a: 1 }, // object → skipped
      },
    });

    expect(result.current.tailEntries).toHaveLength(3);
    expect(tailEntry(result.current.tailEntries, 'battery_level')).toMatchObject({
      value: '80',
      type: 'number',
    });
    expect(tailEntry(result.current.tailEntries, 'is_charging')).toMatchObject({
      value: 'true',
      type: 'boolean',
    });
    expect(tailEntry(result.current.tailEntries, 'gear')).toMatchObject({
      value: 'D',
      type: 'string',
    });
    expect(tailEntry(result.current.tailEntries, 'vehicle_id')).toBeUndefined();
    expect(tailEntry(result.current.tailEntries, 'nested')).toBeUndefined();
  });

  it('reads `cold[]` frames and prepends newest entries first', () => {
    const { result } = setup({ chartSignals: [] });

    emit({
      timestamp: BASE_ISO,
      cold: [
        { name: 'a', value: 1 },
        { name: 'b', value: 'hello' },
        { name: 'c', value: true },
        { bad: 'no name/value' }, // malformed → skipped
      ],
    });
    expect(result.current.tailEntries).toHaveLength(3);
    expect(tailEntry(result.current.tailEntries, 'a')).toMatchObject({ value: '1', type: 'number' });
    expect(tailEntry(result.current.tailEntries, 'b')).toMatchObject({
      value: 'hello',
      type: 'string',
    });

    // A later frame is prepended ahead of the earlier batch.
    advanceAndEmit(50, { timestamp: BASE_ISO, cold: [{ name: 'z', value: 9 }] });
    expect(result.current.tailEntries).toHaveLength(4);
    expect(result.current.tailEntries[0].name).toBe('z');
  });

  it('reads `tables` frames column-by-column', () => {
    const { result } = setup({ chartSignals: [] });

    emit({ timestamp: BASE_ISO, tables: { grp: { colA: 1, colB: 'z' } } });

    expect(result.current.tailEntries).toHaveLength(2);
    expect(tailEntry(result.current.tailEntries, 'colA')).toMatchObject({
      value: '1',
      type: 'number',
    });
    expect(tailEntry(result.current.tailEntries, 'colB')).toMatchObject({
      value: 'z',
      type: 'string',
    });
  });

  it('caps the tail buffer at tailMax and drops it entirely when tailMax is 0', () => {
    const capped = setup({ chartSignals: [], tailMax: 2 });
    emit({
      timestamp: BASE_ISO,
      cold: [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
        { name: 'c', value: 3 },
      ],
    });
    expect(capped.result.current.tailEntries).toHaveLength(2);
    expect(capped.result.current.tailEntries.map((e) => e.name)).toEqual(['a', 'b']);
    capped.unmount();

    const disabled = setup({ chartSignals: [], tailMax: 0 });
    emit({ timestamp: BASE_ISO, signals: { battery_level: 80 } });
    expect(disabled.result.current.tailEntries).toEqual([]);
  });

  it('honours pause/resume and clearTail', () => {
    const { result } = setup({ chartSignals: [] });

    emit({ timestamp: BASE_ISO, cold: [{ name: 'a', value: 1 }] });
    expect(result.current.tailEntries).toHaveLength(1);

    act(() => result.current.setTailPaused(true));
    emit({ timestamp: BASE_ISO, cold: [{ name: 'b', value: 2 }] });
    expect(result.current.tailPaused).toBe(true);
    expect(result.current.tailEntries).toHaveLength(1); // paused → ignored

    act(() => result.current.setTailPaused(false));
    emit({ timestamp: BASE_ISO, cold: [{ name: 'c', value: 3 }] });
    expect(result.current.tailEntries).toHaveLength(2);

    act(() => result.current.clearTail());
    expect(result.current.tailEntries).toEqual([]);
  });

  it('reports a 1 Hz signals/sec rate that resets on an idle second', () => {
    const { result } = setup({ chartSignals: [] });

    emit({
      timestamp: BASE_ISO,
      cold: [
        { name: 'a', value: 1 },
        { name: 'b', value: 2 },
        { name: 'c', value: 3 },
      ],
    });
    // Rate counter is empty until the 1s interval ticks.
    expect(result.current.tailRate).toBe(0);

    advance(1000);
    expect(result.current.tailRate).toBe(3);

    // No traffic in the next window → the rate collapses back to zero.
    advance(1000);
    expect(result.current.tailRate).toBe(0);
  });
});

// ─────────────────────────── vehicle scoping + reset ───────────────────────
describe('useLiveSignalStream — vehicle scoping', () => {
  it('drops frames for other vehicles but accepts numeric, string, and system frames', () => {
    const { result } = setup({ chartSignals: ['x'], tailMax: 0, vehicleId: 1 });

    emit({ signals: { x: 1 }, vehicle_id: 2 }); // wrong vehicle → dropped
    expect(result.current.chartPointCount).toBe(0);

    advanceAndEmit(600, { signals: { x: 1 }, vehicle_id: 1 }); // numeric match
    advanceAndEmit(600, { signals: { x: 2 }, vehicle_id: '1' }); // string match
    advanceAndEmit(600, { signals: { x: 3 } }); // system frame (no vehicle_id)

    expect(result.current.chartPointCount).toBe(3);
    expect(result.current.chartData).toHaveLength(3);
  });

  it('resets both slices when the selected vehicle changes', () => {
    const chartSignals = ['x'];
    const { result, rerender } = setup({ chartSignals, tailMax: 500, vehicleId: 1 });

    emit({ signals: { x: 1 }, cold: [{ name: 'a', value: 1 }], vehicle_id: 1 });
    expect(result.current.chartData.length).toBeGreaterThan(0);
    expect(result.current.tailEntries.length).toBeGreaterThan(0);

    rerender({ enabled: true, vehicleId: 2, chartSignals, tailMax: 500 });

    expect(result.current.chartData).toEqual([]);
    expect(result.current.tailEntries).toEqual([]);
    expect(result.current.chartPointCount).toBe(0);
  });
});

// ───────────────────────────── robustness (bug fixes) ──────────────────────
describe('useLiveSignalStream — robustness', () => {
  it('ignores every frame while disabled', () => {
    const { result } = setup({ enabled: false, chartSignals: ['x'], tailMax: 500 });

    emit({ signals: { x: 1 }, cold: [{ name: 'a', value: 1 }] });

    expect(stub.lastEnabled).toBe(false);
    expect(result.current.chartData).toEqual([]);
    expect(result.current.tailEntries).toEqual([]);
    expect(result.current.chartPointCount).toBe(0);
    expect(result.current.tailRate).toBe(0);
  });

  it('tolerates null and primitive frames without throwing, then keeps processing', () => {
    const { result } = setup({ chartSignals: ['x'], tailMax: 500 });

    // A malformed SSE frame must not throw inside the shared handler.
    expect(() => {
      emit(null);
      emit(undefined);
      emit('a bare string');
      emit(42);
      emit(true);
    }).not.toThrow();

    expect(result.current.chartData).toEqual([]);
    expect(result.current.tailEntries).toEqual([]);
    expect(result.current.chartPointCount).toBe(0);

    // The subscription is still healthy — a valid frame afterwards is handled.
    emit({ signals: { x: 7 }, cold: [{ name: 'a', value: 1 }] });
    expect(result.current.chartData[0].x).toBe(7);
    expect(tailEntry(result.current.tailEntries, 'a')).toMatchObject({ value: '1' });
  });
});
