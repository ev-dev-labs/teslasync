/**
 * useCompareWindow unit tests.
 *
 * The hook derives contiguous "this period vs previous period" ranges plus
 * localised labels for the four supported windows. All date math runs through
 * the platform `Date` in the runner's local timezone, so every assertion here
 * is written against local calendar components (`getFullYear` / `getMonth` /
 * `getDate` / `getHours` ...) rather than absolute epoch millis or ISO strings.
 * That keeps the suite deterministic regardless of the machine's TZ offset.
 */

import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stable, spy-able translation stub. `vi.hoisted` gives us a single function
// reference that survives across renders (a fresh arrow per render would bust
// the hook's `t`-keyed memo and defeat the referential-stability assertions).
const { tMock } = vi.hoisted(() => ({
  tMock: vi.fn((_key: string, fallback: string) => fallback),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}));

import { useCompareWindow, type CompareWindow } from '../useCompareWindow';

/** Local calendar components down to millisecond — TZ-independent. */
function parts(d: Date): number[] {
  return [
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds(),
  ];
}

function render(window: CompareWindow, anchor: Date) {
  return renderHook(() => useCompareWindow(window, anchor)).result.current;
}

beforeEach(() => {
  tMock.mockReset();
  tMock.mockImplementation((_key: string, fallback: string) => fallback);
});

describe('useCompareWindow — day window', () => {
  // Wednesday, 15 Jan 2025, 12:30 local.
  const anchor = new Date(2025, 0, 15, 12, 30, 45, 123);

  it('spans midnight-to-midnight for the anchored day and the day before', () => {
    const r = render('day', anchor);
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 15, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2025, 0, 16, 0, 0, 0, 0]);
    expect(parts(r.previousRange.start)).toEqual([2025, 0, 14, 0, 0, 0, 0]);
    expect(parts(r.previousRange.end)).toEqual([2025, 0, 15, 0, 0, 0, 0]);
  });

  it('emits today/yesterday labels', () => {
    const r = render('day', anchor);
    expect(r.currentLabel).toBe('today');
    expect(r.previousLabel).toBe('yesterday');
    expect(r.vsPreviousLabel).toBe('vs yesterday');
  });

  it('normalises the anchor time-of-day away (no leakage of 12:30:45.123)', () => {
    const r = render('day', anchor);
    for (const d of [r.currentRange.start, r.currentRange.end, r.previousRange.start]) {
      expect(d.getHours()).toBe(0);
      expect(d.getMinutes()).toBe(0);
      expect(d.getSeconds()).toBe(0);
      expect(d.getMilliseconds()).toBe(0);
    }
  });
});

describe('useCompareWindow — week window (ISO, Monday start)', () => {
  it('anchors a mid-week date to the containing Monday..next-Monday range', () => {
    // Wed 15 Jan 2025 → ISO week starts Mon 13 Jan, ends (exclusive) Mon 20 Jan.
    const r = render('week', new Date(2025, 0, 15, 9));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 13, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2025, 0, 20, 0, 0, 0, 0]);
    expect(parts(r.previousRange.start)).toEqual([2025, 0, 6, 0, 0, 0, 0]);
    expect(parts(r.previousRange.end)).toEqual([2025, 0, 13, 0, 0, 0, 0]);
  });

  it('maps a Sunday back to the *previous* Monday (Sunday closes the ISO week)', () => {
    // Sun 19 Jan 2025 still belongs to the week that started Mon 13 Jan.
    const r = render('week', new Date(2025, 0, 19, 23, 59));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 13, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2025, 0, 20, 0, 0, 0, 0]);
  });

  it('keeps a Monday anchor on the same Monday', () => {
    const r = render('week', new Date(2025, 0, 13, 6));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 13, 0, 0, 0, 0]);
  });

  it('emits this-week/last-week labels', () => {
    const r = render('week', new Date(2025, 0, 15));
    expect(r.currentLabel).toBe('this week');
    expect(r.previousLabel).toBe('last week');
    expect(r.vsPreviousLabel).toBe('vs last week');
  });
});

describe('useCompareWindow — month window', () => {
  it('spans the whole anchored month with an exclusive next-month end', () => {
    const r = render('month', new Date(2025, 5, 17, 8)); // June 2025
    expect(parts(r.currentRange.start)).toEqual([2025, 5, 1, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2025, 6, 1, 0, 0, 0, 0]);
    expect(parts(r.previousRange.start)).toEqual([2025, 4, 1, 0, 0, 0, 0]);
    expect(parts(r.previousRange.end)).toEqual([2025, 5, 1, 0, 0, 0, 0]);
  });

  it('rolls the previous month across the year boundary (January → December)', () => {
    const r = render('month', new Date(2025, 0, 10));
    expect(parts(r.previousRange.start)).toEqual([2024, 11, 1, 0, 0, 0, 0]);
    expect(parts(r.previousRange.end)).toEqual([2025, 0, 1, 0, 0, 0, 0]);
  });

  it('avoids the classic addMonths overflow when the anchor is a month-end', () => {
    // Anchoring on Jan 31 must still yield [Jan 1, Feb 1) — never "Feb 31"/Mar 3.
    const r = render('month', new Date(2025, 0, 31, 23, 30));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 1, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2025, 1, 1, 0, 0, 0, 0]);
  });

  it('handles a leap-year February correctly', () => {
    const r = render('month', new Date(2024, 1, 15)); // Feb 2024 (leap)
    expect(parts(r.currentRange.start)).toEqual([2024, 1, 1, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2024, 2, 1, 0, 0, 0, 0]);
  });

  it('emits this-month/last-month labels', () => {
    const r = render('month', new Date(2025, 5, 10));
    expect(r.currentLabel).toBe('this month');
    expect(r.previousLabel).toBe('last month');
    expect(r.vsPreviousLabel).toBe('vs last month');
  });
});

describe('useCompareWindow — year window', () => {
  it('spans Jan 1..next Jan 1 for the anchored year', () => {
    const r = render('year', new Date(2025, 7, 3, 14));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 1, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2026, 0, 1, 0, 0, 0, 0]);
    expect(parts(r.previousRange.start)).toEqual([2024, 0, 1, 0, 0, 0, 0]);
    expect(parts(r.previousRange.end)).toEqual([2025, 0, 1, 0, 0, 0, 0]);
  });

  it('emits this-year/last-year labels', () => {
    const r = render('year', new Date(2025, 0, 1));
    expect(r.currentLabel).toBe('this year');
    expect(r.previousLabel).toBe('last year');
    expect(r.vsPreviousLabel).toBe('vs last year');
  });

  it('falls back to the yearly comparison for an unrecognised window (default branch)', () => {
    const r = render('decade' as unknown as CompareWindow, new Date(2025, 3, 10));
    expect(parts(r.currentRange.start)).toEqual([2025, 0, 1, 0, 0, 0, 0]);
    expect(parts(r.currentRange.end)).toEqual([2026, 0, 1, 0, 0, 0, 0]);
    expect(r.currentLabel).toBe('this year');
  });
});

describe('useCompareWindow — range invariants', () => {
  const windows: CompareWindow[] = ['day', 'week', 'month', 'year'];

  it('produces contiguous, non-overlapping ranges (previous.end === current.start)', () => {
    const anchor = new Date(2025, 2, 9, 11, 45);
    for (const w of windows) {
      const r = render(w, anchor);
      expect(r.previousRange.end.getTime()).toBe(r.currentRange.start.getTime());
    }
  });

  it('keeps every range strictly forward in time (start < end)', () => {
    const anchor = new Date(2025, 2, 9, 11, 45);
    for (const w of windows) {
      const r = render(w, anchor);
      expect(r.currentRange.start.getTime()).toBeLessThan(r.currentRange.end.getTime());
      expect(r.previousRange.start.getTime()).toBeLessThan(r.previousRange.end.getTime());
    }
  });

  it('gives the current and previous periods an identical duration', () => {
    // True for day/week/year always, and for month whenever both months share
    // the same length — March and February differ, so pick an equal-length pair.
    const r = render('month', new Date(2025, 6, 15)); // July (31d) vs June (30d)
    // July and June differ in length, so months are intentionally NOT asserted
    // equal here; verify the day window instead where equality must hold.
    const day = render('day', new Date(2025, 6, 15));
    const curr = day.currentRange.end.getTime() - day.currentRange.start.getTime();
    const prev = day.previousRange.end.getTime() - day.previousRange.start.getTime();
    expect(curr).toBe(prev);
    expect(r.currentRange.start.getTime()).toBeLessThan(r.currentRange.end.getTime());
  });
});

describe('useCompareWindow — input safety', () => {
  it('does not mutate the caller-supplied anchor', () => {
    const anchor = new Date(2025, 0, 15, 12, 30, 45, 123);
    const before = anchor.getTime();
    render('month', anchor);
    expect(anchor.getTime()).toBe(before);
  });

  it('falls back to the current time instead of emitting Invalid Date ranges', () => {
    const r = render('day', new Date('not-a-real-date'));
    expect(Number.isNaN(r.currentRange.start.getTime())).toBe(false);
    expect(Number.isNaN(r.currentRange.end.getTime())).toBe(false);
    expect(Number.isNaN(r.previousRange.start.getTime())).toBe(false);
    // Still a well-formed midnight-aligned day window.
    expect(r.currentRange.start.getHours()).toBe(0);
    expect(r.currentRange.end.getTime()).toBeGreaterThan(r.currentRange.start.getTime());
  });

  it('defaults the anchor to now when none is supplied', () => {
    const { result } = renderHook(() => useCompareWindow('year'));
    expect(result.current.currentRange.start.getFullYear()).toBe(new Date().getFullYear());
  });
});

describe('useCompareWindow — memoisation', () => {
  it('returns a referentially stable result when the anchor instant is unchanged', () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: Date }) => useCompareWindow('week', a),
      { initialProps: { a: new Date(2025, 0, 15, 8) } },
    );
    const first = result.current;
    // A brand-new Date object for the *same* instant must not bust the memo.
    rerender({ a: new Date(2025, 0, 15, 8) });
    expect(result.current).toBe(first);
  });

  it('recomputes when the anchor moves to a different instant', () => {
    const { result, rerender } = renderHook(
      ({ a }: { a: Date }) => useCompareWindow('day', a),
      { initialProps: { a: new Date(2025, 0, 15) } },
    );
    const first = result.current;
    rerender({ a: new Date(2025, 0, 16) });
    expect(result.current).not.toBe(first);
    expect(result.current.currentRange.start.getDate()).toBe(16);
  });

  it('recomputes when the window changes but the anchor stays put', () => {
    const anchor = new Date(2025, 0, 15, 8);
    const { result, rerender } = renderHook(
      ({ w }: { w: CompareWindow }) => useCompareWindow(w, anchor),
      { initialProps: { w: 'day' as CompareWindow } },
    );
    const first = result.current;
    rerender({ w: 'month' });
    expect(result.current).not.toBe(first);
    expect(result.current.currentLabel).toBe('this month');
  });
});

describe('useCompareWindow — i18n wiring', () => {
  it('resolves every label through i18n using the documented delta.* keys', () => {
    const dict: Record<string, string> = {
      'delta.thisMonth': 'ce mois-ci',
      'delta.lastMonth': 'le mois dernier',
      'delta.vsLastMonth': 'vs le mois dernier',
    };
    tMock.mockImplementation((key: string, fallback: string) => dict[key] ?? fallback);

    const r = render('month', new Date(2025, 5, 10));
    expect(r.currentLabel).toBe('ce mois-ci');
    expect(r.previousLabel).toBe('le mois dernier');
    expect(r.vsPreviousLabel).toBe('vs le mois dernier');
    expect(tMock).toHaveBeenCalledWith('delta.thisMonth', 'this month');
    expect(tMock).toHaveBeenCalledWith('delta.vsLastMonth', 'vs last month');
  });

  it('requests the day-specific keys for the day window', () => {
    render('day', new Date(2025, 0, 15));
    expect(tMock).toHaveBeenCalledWith('delta.today', 'today');
    expect(tMock).toHaveBeenCalledWith('delta.yesterday', 'yesterday');
    expect(tMock).toHaveBeenCalledWith('delta.vsYesterday', 'vs yesterday');
  });
});
