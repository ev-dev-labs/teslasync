// weekly-digest/helpers unit tests.
//
// Every export is exercised across multiple facets/branches:
//   getWeekRange   — Monday-anchored ISO week, Sunday regression guard, offset
//                    arithmetic, exact boundary time-of-day.
//   isInRange      — inclusive boundaries + unparseable-timestamp guard.
//   dayOfWeekIndex — Mon=0…Sun=6 mapping + the -1 sentinel that keeps a bad
//                    date from crashing the daily-bins consumer.
//   pctChange      — divide-by-zero branch, sign preservation, negative bases.
//   trendFor       — up/down/flat, the 0.01 flat threshold, invertPositive
//                    polarity, and the formatted magnitude string.
//   findCityPair   — nearest-neighbour selection, clamping to the extremes, and
//                    the non-finite → undefined guard.
//
// Dates are always passed with an explicit local time component (…T12:00:00, no
// trailing Z) so weekday assertions are timezone-independent: a date-only string
// would parse as UTC midnight and shift under negative UTC offsets.

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import {
  getWeekRange,
  isInRange,
  dayOfWeekIndex,
  pctChange,
  trendFor,
  findCityPair,
} from './helpers';

beforeAll(() => {
  // trendFor formats via fmtNumber(pct, 1); pin locale/precision so the
  // expected magnitude strings are deterministic regardless of CI defaults.
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getWeekRange', () => {
  it('anchors offset 0 to Monday 00:00 → Sunday 23:59:59.999 of the current week', () => {
    // Wednesday 2026-07-08.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 30, 0));

    const [start, end] = getWeekRange(0);

    expect(start.getDay()).toBe(1); // Monday
    expect(end.getDay()).toBe(0); // Sunday
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2026, 6, 6]);
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 6, 12]);
    // Exact time-of-day boundaries.
    expect([start.getHours(), start.getMinutes(), start.getSeconds(), start.getMilliseconds()]).toEqual([0, 0, 0, 0]);
    expect([end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([23, 59, 59, 999]);
    // "Now" is inside its own week.
    const now = new Date(2026, 6, 8, 12, 30, 0);
    expect(now >= start && now <= end).toBe(true);
  });

  it('keeps Sunday in the current week instead of rolling into next week (regression)', () => {
    // Sunday 2026-07-12 is the LAST day of the 07-06…07-12 week. The old
    // `getDate() - getDay() + 1` maths mapped Sunday forward to 07-13 (next
    // Monday), hiding today's data from the digest.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 12, 9, 0, 0));

    const [start, end] = getWeekRange(0);

    expect([start.getMonth(), start.getDate()]).toEqual([6, 6]); // Mon Jul 6
    expect([end.getMonth(), end.getDate()]).toEqual([6, 12]); // Sun Jul 12
    const today = new Date(2026, 6, 12, 9, 0, 0);
    expect(today >= start && today <= end).toBe(true);
  });

  it('resolves to the same Monday for every day of the week', () => {
    // Mon 07-06 … Sun 07-12 must all collapse to the same [07-06, 07-12] window.
    for (let date = 6; date <= 12; date++) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 6, date, 14, 0, 0));
      const [start, end] = getWeekRange(0);
      expect([start.getMonth(), start.getDate()]).toEqual([6, 6]);
      expect([end.getMonth(), end.getDate()]).toEqual([6, 12]);
      vi.useRealTimers();
    }
  });

  it('shifts by whole weeks for negative and positive offsets', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 8, 12, 0, 0)); // Wednesday

    const [curStart] = getWeekRange(0);
    const [prevStart, prevEnd] = getWeekRange(-1);
    const [nextStart] = getWeekRange(1);

    // Previous week starts exactly 7 days before the current week.
    expect([prevStart.getMonth(), prevStart.getDate()]).toEqual([5, 29]); // Mon Jun 29
    expect([prevEnd.getMonth(), prevEnd.getDate()]).toEqual([6, 5]); // Sun Jul 5
    expect(Math.round((curStart.getTime() - prevStart.getTime()) / 86_400_000)).toBe(7);
    expect(Math.round((nextStart.getTime() - curStart.getTime()) / 86_400_000)).toBe(7);
  });
});

describe('isInRange', () => {
  const start = new Date(2026, 6, 6, 0, 0, 0, 0);
  const end = new Date(2026, 6, 12, 23, 59, 59, 999);

  it('includes instants inside the window and both inclusive boundaries', () => {
    expect(isInRange('2026-07-08T12:00:00', start, end)).toBe(true);
    expect(isInRange('2026-07-06T00:00:00', start, end)).toBe(true); // == start
    expect(isInRange('2026-07-12T23:59:59.999', start, end)).toBe(true); // == end
  });

  it('excludes instants before or after the window', () => {
    expect(isInRange('2026-07-05T23:59:59', start, end)).toBe(false);
    expect(isInRange('2026-07-13T00:00:00', start, end)).toBe(false);
  });

  it('treats an unparseable timestamp as out of range instead of throwing', () => {
    expect(isInRange('not-a-date', start, end)).toBe(false);
    expect(isInRange('', start, end)).toBe(false);
  });
});

describe('dayOfWeekIndex', () => {
  it('maps weekdays with Monday first (Mon=0 … Sun=6)', () => {
    expect(dayOfWeekIndex('2026-07-06T12:00:00')).toBe(0); // Monday
    expect(dayOfWeekIndex('2026-07-08T12:00:00')).toBe(2); // Wednesday
    expect(dayOfWeekIndex('2026-07-11T12:00:00')).toBe(5); // Saturday
    expect(dayOfWeekIndex('2026-07-12T12:00:00')).toBe(6); // Sunday
  });

  it('returns -1 for an unparseable date so callers can skip it', () => {
    expect(dayOfWeekIndex('garbage')).toBe(-1);
    expect(dayOfWeekIndex('')).toBe(-1);
  });

  it('never yields an out-of-bounds bins index (0-6 or the -1 sentinel)', () => {
    // Regression guard: a NaN index used to select `bins[NaN]` === undefined and
    // throw on the following `.distance` write.
    const bins = [0, 0, 0, 0, 0, 0, 0];
    const goodIdx = dayOfWeekIndex('2026-07-09T12:00:00'); // Thursday → 3
    const badIdx = dayOfWeekIndex('nope');
    expect(bins[goodIdx]).toBeDefined();
    expect(badIdx).toBe(-1);
    expect(Number.isNaN(badIdx)).toBe(false);
  });
});

describe('pctChange', () => {
  it('computes a signed percentage delta for non-zero baselines', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(100, 100)).toBe(0);
    expect(pctChange(0, 100)).toBe(-100);
  });

  it('handles a zero baseline without dividing by zero', () => {
    expect(pctChange(50, 0)).toBe(100); // grew from nothing
    expect(pctChange(0, 0)).toBe(0);
    expect(pctChange(-5, 0)).toBe(0); // shrank/negative from nothing
  });

  it('preserves the numerator sign against a negative baseline', () => {
    // Math.abs on the denominator keeps direction driven by the delta.
    expect(pctChange(-5, -10)).toBe(50); // -10 → -5 is a 50% rise
    expect(pctChange(-15, -10)).toBe(-50); // -10 → -15 is a 50% fall
  });
});

describe('trendFor', () => {
  it('reports an upward trend with a +signed magnitude string', () => {
    expect(trendFor(120, 100)).toEqual({ direction: 'up', value: '+20.0%', positive: true });
  });

  it('reports a downward trend carrying the intrinsic minus sign', () => {
    expect(trendFor(80, 100)).toEqual({ direction: 'down', value: '-20.0%', positive: false });
  });

  it('collapses sub-0.01 deltas to a neutral flat result', () => {
    expect(trendFor(100, 100)).toEqual({ direction: 'flat', value: '0%', positive: true });
    expect(trendFor(100.005, 100)).toEqual({ direction: 'flat', value: '0%', positive: true });
  });

  it('inverts polarity for lower-is-better metrics', () => {
    // Energy/cost went UP → bad.
    expect(trendFor(120, 100, true)).toMatchObject({ direction: 'up', positive: false });
    // Energy/cost went DOWN → good.
    expect(trendFor(80, 100, true)).toMatchObject({ direction: 'down', positive: true });
  });

  it('formats growth-from-zero as +100.0%', () => {
    expect(trendFor(50, 0)).toEqual({ direction: 'up', value: '+100.0%', positive: true });
  });
});

describe('findCityPair', () => {
  it('returns an exact-distance city pair', () => {
    expect(findCityPair(350)).toMatchObject({ from: 'New York', to: 'Boston', km: 350 });
    expect(findCityPair(515)).toMatchObject({ from: 'Tokyo', to: 'Osaka', km: 515 });
  });

  it('snaps to the nearest pair when there is no exact match', () => {
    // 620 is closest to the 615 km LA→SF leg (Δ5) over Berlin→Munich 585 (Δ35).
    expect(findCityPair(620)).toMatchObject({ from: 'LA', to: 'San Francisco', km: 615 });
  });

  it('clamps to the shortest and longest pairs at the extremes', () => {
    expect(findCityPair(0)).toMatchObject({ km: 350 }); // shortest known leg
    expect(findCityPair(100_000)).toMatchObject({ km: 880 }); // longest known leg
  });

  it('returns undefined for a non-finite distance', () => {
    expect(findCityPair(NaN)).toBeUndefined();
  });
});
