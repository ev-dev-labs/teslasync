import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { DrivePosition } from '@/types/driving';
import {
  useTripReplay,
  buildTimeline,
  indexAtTime,
  REPLAY_SPEEDS,
} from '../useTripReplay';

/**
 * useTripReplay unit tests.
 *
 * Two layers:
 *   1. The pure helpers ({@link buildTimeline}, {@link indexAtTime}) — exercised
 *      directly for deterministic coverage of the timeline math.
 *   2. The hook itself, driven through a virtual clock with Vitest fake timers.
 *      A `setInterval` (TICK_MS = 50ms) advances a scaled elapsed clock; every
 *      `advanceTimersByTime` step is wrapped in `act()` so React commits before
 *      we assert.
 *
 * These tests pin the three bugs the elevation surfaced:
 *   - totalTime must be correct on the FIRST render (was read from a ref set in
 *     an effect → lagged one commit → "0:00 / 0:00" scrubber).
 *   - progress / elapsedTime must update on a seek even when currentIndex does
 *     not change (was a ref read → stale, froze the scrubber + URL sync).
 *   - the playhead must rewind when the positions array (drive) changes (a
 *     stale index pointed past a shorter array → blank marker).
 */

const BASE = Date.parse('2025-01-01T00:00:00Z');

function pos(timestamp: string, over: Partial<DrivePosition> = {}): DrivePosition {
  return {
    latitude: 0,
    longitude: 0,
    speed: 0,
    power: 0,
    batteryLevel: 80,
    timestamp,
    insideTemp: null,
    outsideTemp: null,
    idealRange: null,
    ratedRange: null,
    odometer: null,
    elevation: null,
    fanStatus: null,
    isClimateOn: null,
    ...over,
  };
}

/** Build `n` positions spaced `stepMs` apart → offsets [0, step, 2*step, …]. */
function track(n: number, stepMs = 1000): DrivePosition[] {
  return Array.from({ length: n }, (_, i) =>
    pos(new Date(BASE + i * stepMs).toISOString(), { latitude: i, longitude: i, speed: i }),
  );
}

/* ================================================================== */
/*  Pure helpers                                                       */
/* ================================================================== */

describe('buildTimeline', () => {
  it('returns an empty timeline for empty / nullish input', () => {
    expect(buildTimeline([])).toEqual([]);
    // Defensive: a nullish array must not throw.
    expect(buildTimeline(undefined as unknown as DrivePosition[])).toEqual([]);
  });

  it('maps ascending timestamps to ms-since-start offsets', () => {
    expect(buildTimeline(track(4, 1000))).toEqual([0, 1000, 2000, 3000]);
  });

  it('uses the first parseable timestamp as the origin and zeroes bad rows', () => {
    const positions = [
      pos('not-a-date'),
      pos(new Date(BASE).toISOString()),
      pos('also-garbage'),
      pos(new Date(BASE + 5000).toISOString()),
    ];
    // Origin is index 1 (first finite). Bad rows collapse to 0 so a single
    // unparseable row can't turn totalTime into NaN.
    expect(buildTimeline(positions)).toEqual([0, 0, 0, 5000]);
  });

  it('returns an empty timeline when every timestamp is unparseable', () => {
    expect(buildTimeline([pos('x'), pos('y')])).toEqual([]);
  });
});

describe('indexAtTime', () => {
  const offsets = [0, 1000, 2000, 3000, 4000];

  it('returns 0 for an empty offset list', () => {
    expect(indexAtTime([], 1234)).toBe(0);
  });

  it('returns the exact index on a direct hit', () => {
    expect(indexAtTime(offsets, 2000)).toBe(2);
  });

  it('rounds to the nearest neighbour on either side', () => {
    expect(indexAtTime(offsets, 1400)).toBe(1); // closer to 1000
    expect(indexAtTime(offsets, 1600)).toBe(2); // closer to 2000
  });

  it('clamps targets outside the range to the first / last index', () => {
    expect(indexAtTime(offsets, -500)).toBe(0);
    expect(indexAtTime(offsets, 99999)).toBe(4);
  });
});

describe('REPLAY_SPEEDS', () => {
  it('exposes the ordered speed slots', () => {
    expect(REPLAY_SPEEDS).toEqual([1, 10, 25, 50, 100]);
  });
});

/* ================================================================== */
/*  Hook                                                               */
/* ================================================================== */

describe('useTripReplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('derives totalTime and the initial frame synchronously on first render', () => {
    const positions = track(5); // offsets [0..4000]
    const { result } = renderHook(() => useTripReplay(positions));
    const [state] = result.current;

    // Regression: totalTime used to be 0 on the first render (ref set in an
    // effect). It must reflect the timeline immediately.
    expect(state.totalTime).toBe(4000);
    expect(state.isPlaying).toBe(false);
    expect(state.speed).toBe(1);
    expect(state.currentIndex).toBe(0);
    expect(state.progress).toBe(0);
    expect(state.elapsedTime).toBe(0);
    expect(state.currentPosition).toEqual(positions[0]);
  });

  it('handles an empty timeline without moving or producing NaN', () => {
    const { result } = renderHook(() => useTripReplay([]));
    const getState = () => result.current[0];

    expect(getState().totalTime).toBe(0);
    expect(getState().currentPosition).toBeNull();

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(1000));

    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
    expect(getState().progress).toBe(0);
    expect(getState().currentPosition).toBeNull();
  });

  it('advances the playhead over time while playing', () => {
    const { result } = renderHook(() => useTripReplay(track(5)));
    const getState = () => result.current[0];

    act(() => result.current[1].play());
    expect(getState().isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(1000)); // 20 ticks * 50ms * speed 1

    expect(getState().elapsedTime).toBe(1000);
    expect(getState().currentIndex).toBe(1);
    expect(getState().progress).toBeCloseTo(0.25, 5);
  });

  it('applies the speed multiplier to the virtual clock', () => {
    const { result } = renderHook(() => useTripReplay(track(100))); // total 99000
    const getState = () => result.current[0];

    act(() => result.current[1].setSpeed(10));
    expect(getState().speed).toBe(10);

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(100)); // 2 ticks * 50ms * speed 10 = 1000ms

    expect(getState().elapsedTime).toBe(1000);
  });

  it('stops and pins to the last frame when the clock reaches the end', () => {
    const { result } = renderHook(() => useTripReplay(track(5))); // total 4000
    const getState = () => result.current[0];

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(4200));

    expect(getState().isPlaying).toBe(false);
    expect(getState().currentIndex).toBe(4);
    expect(getState().elapsedTime).toBe(4000);
    expect(getState().progress).toBe(1);
  });

  it('restarts from the beginning when play() is pressed at the end', () => {
    const { result } = renderHook(() => useTripReplay(track(5)));
    const getState = () => result.current[0];

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(4200));
    expect(getState().currentIndex).toBe(4);

    act(() => result.current[1].play()); // parked at end → rewind
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
    expect(getState().isPlaying).toBe(true);

    act(() => vi.advanceTimersByTime(1000));
    expect(getState().currentIndex).toBe(1);
  });

  it('pause() freezes the clock without rewinding', () => {
    const { result } = renderHook(() => useTripReplay(track(100)));
    const getState = () => result.current[0];

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(500)); // elapsed 500
    expect(getState().elapsedTime).toBe(500);

    act(() => result.current[1].pause());
    expect(getState().isPlaying).toBe(false);

    act(() => vi.advanceTimersByTime(2000)); // interval torn down → no movement
    expect(getState().elapsedTime).toBe(500);
  });

  it('stop() rewinds to the start and halts playback', () => {
    const { result } = renderHook(() => useTripReplay(track(100)));
    const getState = () => result.current[0];

    act(() => result.current[1].play());
    act(() => vi.advanceTimersByTime(1000));
    expect(getState().elapsedTime).toBe(1000);

    act(() => result.current[1].stop());
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
    expect(getState().isPlaying).toBe(false);

    act(() => vi.advanceTimersByTime(1000));
    expect(getState().elapsedTime).toBe(0);
  });

  it('setSpeedRelative steps through slots and clamps at both ends', () => {
    const { result } = renderHook(() => useTripReplay(track(5)));
    const getState = () => result.current[0];

    act(() => result.current[1].setSpeedRelative(1)); // 1 → 10
    expect(getState().speed).toBe(10);
    act(() => result.current[1].setSpeedRelative(2)); // 10 → 50
    expect(getState().speed).toBe(50);

    act(() => result.current[1].setSpeedRelative(10)); // clamp at fastest
    expect(getState().speed).toBe(100);
    act(() => result.current[1].setSpeedRelative(-99)); // clamp at slowest
    expect(getState().speed).toBe(1);
  });

  it('seekTo jumps to an index and clamps out-of-range requests', () => {
    const positions = track(5);
    const { result } = renderHook(() => useTripReplay(positions));
    const getState = () => result.current[0];

    act(() => result.current[1].seekTo(2));
    expect(getState().currentIndex).toBe(2);
    expect(getState().elapsedTime).toBe(2000);
    expect(getState().currentPosition).toEqual(positions[2]);

    act(() => result.current[1].seekTo(999));
    expect(getState().currentIndex).toBe(4);

    act(() => result.current[1].seekTo(-5));
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
  });

  it('seekToProgress maps a 0..1 fraction to elapsed and clamps out of range', () => {
    const { result } = renderHook(() => useTripReplay(track(5))); // total 4000
    const getState = () => result.current[0];

    act(() => result.current[1].seekToProgress(0.5));
    expect(getState().elapsedTime).toBe(2000);
    expect(getState().currentIndex).toBe(2);
    expect(getState().progress).toBeCloseTo(0.5, 5);

    act(() => result.current[1].seekToProgress(2)); // clamp → 1
    expect(getState().progress).toBe(1);
    expect(getState().currentIndex).toBe(4);

    act(() => result.current[1].seekToProgress(-1)); // clamp → 0
    expect(getState().progress).toBe(0);
    expect(getState().elapsedTime).toBe(0);
  });

  it('keeps progress/elapsed reactive even when the frame index does not change', () => {
    // offsets = [0, 1000]; both 0.1 and 0.2 land on frame 0 (100/200ms are both
    // nearer 0 than 1000). The progress/elapsed still MUST update — this is the
    // stale-ref regression that froze the scrubber.
    const { result } = renderHook(() => useTripReplay(track(2)));
    const getState = () => result.current[0];

    act(() => result.current[1].seekToProgress(0.1));
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(100);
    expect(getState().progress).toBeCloseTo(0.1, 5);

    act(() => result.current[1].seekToProgress(0.2));
    expect(getState().currentIndex).toBe(0); // unchanged
    expect(getState().elapsedTime).toBe(200); // but elapsed advanced
    expect(getState().progress).toBeCloseTo(0.2, 5);
  });

  it('seekBy nudges the clock by seconds and clamps to [0, total]', () => {
    const { result } = renderHook(() => useTripReplay(track(5))); // total 4000
    const getState = () => result.current[0];

    act(() => result.current[1].seekBy(2)); // +2s
    expect(getState().elapsedTime).toBe(2000);

    act(() => result.current[1].seekBy(-10)); // clamp at 0
    expect(getState().elapsedTime).toBe(0);

    act(() => result.current[1].seekBy(999)); // clamp at total
    expect(getState().elapsedTime).toBe(4000);
    expect(getState().currentIndex).toBe(4);
  });

  it('seekBy is a no-op on an empty timeline', () => {
    const { result } = renderHook(() => useTripReplay([]));
    const getState = () => result.current[0];

    act(() => result.current[1].seekBy(5));
    expect(getState().elapsedTime).toBe(0);
    expect(getState().currentIndex).toBe(0);
  });

  it('stepFrame moves the playhead by whole frames and clamps', () => {
    const positions = track(5);
    const { result } = renderHook(() => useTripReplay(positions));
    const getState = () => result.current[0];

    act(() => result.current[1].stepFrame(2));
    expect(getState().currentIndex).toBe(2);
    expect(getState().elapsedTime).toBe(2000);

    act(() => result.current[1].stepFrame(1));
    expect(getState().currentIndex).toBe(3);

    act(() => result.current[1].stepFrame(100)); // clamp at last
    expect(getState().currentIndex).toBe(4);

    act(() => result.current[1].stepFrame(-100)); // clamp at first
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
  });

  it('rewinds the playhead when the positions array changes to a new drive', () => {
    const long = track(5); // total 4000
    const short = track(2); // total 1000
    const { result, rerender } = renderHook(({ p }: { p: DrivePosition[] }) => useTripReplay(p), {
      initialProps: { p: long },
    });
    const getState = () => result.current[0];

    act(() => result.current[1].seekTo(4));
    expect(getState().currentIndex).toBe(4);

    rerender({ p: short });

    // Regression: a stale index (4) would point past `short` (len 2).
    expect(getState().currentIndex).toBe(0);
    expect(getState().elapsedTime).toBe(0);
    expect(getState().totalTime).toBe(1000);
    expect(getState().currentPosition).toEqual(short[0]);
  });

  it('tears down its interval on unmount', () => {
    const { result, unmount } = renderHook(() => useTripReplay(track(100)));

    act(() => result.current[1].play());
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
