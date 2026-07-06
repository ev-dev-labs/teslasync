/**
 * useThroughputHistory — behaviour + hardening coverage.
 *
 * The hook is an accumulator: it samples a live "signals / sec" rate into a
 * rolling time-series on a fixed cadence. There is no network — the rate is
 * pushed in by the caller — so these tests drive it with fake timers and a
 * pinned system clock, then assert the emitted series, the rolling-window cap,
 * the memoised `peak`, and the reset semantics.
 *
 * They also lock in the hardening applied while elevating the file:
 *   - a non-finite / negative rate is clamped to 0 (never poisons the chart);
 *   - a non-positive `maxPoints` still fills (cap floored to 1) rather than
 *     silently discarding every sample;
 *   - a non-positive `intervalMs` falls back to the 1000ms default instead of
 *     busy-looping;
 *   - the sampling interval reads the latest rate live via a ref and is NOT
 *     rebuilt on every rate change;
 *   - the interval is torn down on unmount.
 */
import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useThroughputHistory } from './useThroughputHistory';
import type { UseThroughputHistoryOptions } from './useThroughputHistory';

/** Fixed clock so emitted ISO timestamps are deterministic. */
const BASE = new Date('2025-01-01T00:00:00.000Z');

/** Advance the mocked clock inside act() so interval-driven setState commits. */
function tick(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

/** Expected ISO timestamp of the Nth tick at a given cadence. */
function tsAfter(n: number, cadence = 1000) {
  return new Date(BASE.getTime() + n * cadence).toISOString();
}

describe('useThroughputHistory', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts empty with a zero peak and a callable reset', () => {
    const { result } = renderHook(() => useThroughputHistory(0));

    expect(result.current.history).toEqual([]);
    expect(result.current.peak).toBe(0);
    expect(typeof result.current.reset).toBe('function');
  });

  it('samples at 1Hz with default options, stamping ISO time + rate', () => {
    const { result } = renderHook(() => useThroughputHistory(6));

    // Nothing is emitted before the first cadence elapses.
    tick(999);
    expect(result.current.history).toEqual([]);

    tick(1);
    expect(result.current.history).toEqual([{ ts: tsAfter(1), rate: 6 }]);

    tick(1000);
    expect(result.current.history).toEqual([
      { ts: tsAfter(1), rate: 6 },
      { ts: tsAfter(2), rate: 6 },
    ]);
    expect(result.current.peak).toBe(6);
  });

  it('reads the latest rate live without rebuilding the interval', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { result, rerender } = renderHook(
      ({ rate }: { rate: number }) => useThroughputHistory(rate, { intervalMs: 1000, maxPoints: 60 }),
      { initialProps: { rate: 5 } },
    );

    tick(1000);
    const clearsAfterMount = clearSpy.mock.calls.length;

    rerender({ rate: 9 });
    tick(1000);

    // The next sample carries the updated rate — proving it is read from a ref.
    expect(result.current.history.map((p) => p.rate)).toEqual([5, 9]);
    expect(result.current.history.map((p) => p.ts)).toEqual([tsAfter(1), tsAfter(2)]);
    // The interval was NOT torn down and rebuilt when only `rate` changed.
    expect(clearSpy.mock.calls.length).toBe(clearsAfterMount);

    clearSpy.mockRestore();
  });

  it('caps the series at maxPoints, dropping the oldest samples first', () => {
    const { result } = renderHook(() => useThroughputHistory(4, { maxPoints: 3, intervalMs: 1000 }));

    // Advance one cadence at a time so each sample commits with its own clock.
    for (let i = 0; i < 5; i += 1) tick(1000);

    expect(result.current.history).toHaveLength(3);
    // Oldest two (ticks 1 & 2) rolled off; ticks 3–5 remain, in order.
    expect(result.current.history.map((p) => p.ts)).toEqual([tsAfter(3), tsAfter(4), tsAfter(5)]);
  });

  it('recomputes peak as the window slides — a high sample rolling off lowers it', () => {
    const { result, rerender } = renderHook(
      ({ rate }: { rate: number }) => useThroughputHistory(rate, { maxPoints: 2, intervalMs: 1000 }),
      { initialProps: { rate: 10 } },
    );

    tick(1000); // window: [10]
    expect(result.current.peak).toBe(10);

    rerender({ rate: 1 });
    tick(1000); // window: [10, 1]
    expect(result.current.history).toHaveLength(2);
    expect(result.current.peak).toBe(10);

    tick(1000); // window: [1, 1] — the 10 has rolled off
    expect(result.current.history.map((p) => p.rate)).toEqual([1, 1]);
    expect(result.current.peak).toBe(1);
  });

  it('clamps non-finite and negative rates to zero', () => {
    const { result, rerender } = renderHook(
      ({ rate }: { rate: number }) => useThroughputHistory(rate, { intervalMs: 1000 }),
      { initialProps: { rate: Number.NaN } },
    );

    tick(1000);
    expect(result.current.history[0].rate).toBe(0);

    rerender({ rate: -42 });
    tick(1000);
    expect(result.current.history[1].rate).toBe(0);

    rerender({ rate: Number.POSITIVE_INFINITY });
    tick(1000);
    expect(result.current.history[2].rate).toBe(0);

    expect(result.current.peak).toBe(0);
  });

  it('does not sample while disabled, then resumes once enabled', () => {
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useThroughputHistory(3, { enabled, intervalMs: 1000 }),
      { initialProps: { enabled: false } },
    );

    tick(5000);
    expect(result.current.history).toEqual([]);

    rerender({ enabled: true });
    tick(1000);
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].rate).toBe(3);
  });

  it('clears the series when resetKey changes, then keeps sampling', () => {
    const { result, rerender } = renderHook(
      ({ key }: { key: string }) => useThroughputHistory(7, { resetKey: key, intervalMs: 1000 }),
      { initialProps: { key: 'veh-1' } },
    );

    tick(3000);
    expect(result.current.history).toHaveLength(3);
    expect(result.current.peak).toBe(7);

    rerender({ key: 'veh-2' });
    expect(result.current.history).toEqual([]);
    expect(result.current.peak).toBe(0);

    // The interval survives a reset-key change and keeps appending.
    tick(1000);
    expect(result.current.history).toHaveLength(1);
  });

  it('reset() empties the series and zeroes the peak', () => {
    const { result } = renderHook(() => useThroughputHistory(8, { intervalMs: 1000 }));

    tick(2000);
    expect(result.current.history).toHaveLength(2);
    expect(result.current.peak).toBe(8);

    act(() => {
      result.current.reset();
    });

    expect(result.current.history).toEqual([]);
    expect(result.current.peak).toBe(0);
  });

  it('keeps reset referentially stable across re-renders', () => {
    const { result, rerender } = renderHook(
      ({ rate }: { rate: number }) => useThroughputHistory(rate),
      { initialProps: { rate: 1 } },
    );
    const firstReset = result.current.reset;

    rerender({ rate: 2 });
    rerender({ rate: 3 });

    expect(result.current.reset).toBe(firstReset);
  });

  it('falls back to a minimum cap of 1 when maxPoints is non-positive', () => {
    const { result } = renderHook(() => useThroughputHistory(4, { maxPoints: 0, intervalMs: 1000 }));

    tick(3000);

    // maxPoints=0 would discard every sample; the guard floors the cap to 1
    // so the most-recent sample is always retained.
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].rate).toBe(4);
  });

  it('falls back to the default cadence when intervalMs is non-positive', () => {
    const { result } = renderHook(() => useThroughputHistory(2, { intervalMs: 0 }));

    // intervalMs=0 would busy-loop; the hook coerces it to the 1000ms default.
    tick(999);
    expect(result.current.history).toEqual([]);

    tick(1);
    expect(result.current.history).toHaveLength(1);
  });

  it('tears down the sampling interval on unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval');
    const { unmount } = renderHook(() =>
      useThroughputHistory(1, { intervalMs: 1000 } satisfies UseThroughputHistoryOptions),
    );

    clearSpy.mockClear();
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
