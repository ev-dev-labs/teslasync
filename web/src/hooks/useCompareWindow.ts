import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

export type CompareWindow = 'day' | 'week' | 'month' | 'year';

export interface DateRange {
  start: Date;
  end: Date;
}

export interface CompareWindowResult {
  /** Localised label for the current period (e.g. "this week"). */
  currentLabel: string;
  /** Localised label for the prior period (e.g. "last week"). */
  previousLabel: string;
  /**
   * Localised "vs <previous>" string ready to drop into `<Delta comparedTo>`.
   * (e.g. "vs last week")
   */
  vsPreviousLabel: string;
  /** Inclusive-start, exclusive-end range covering the current period. */
  currentRange: DateRange;
  /** Inclusive-start, exclusive-end range covering the prior period. */
  previousRange: DateRange;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function addMonths(d: Date, n: number): Date {
  const x = new Date(d);
  x.setMonth(x.getMonth() + n);
  return x;
}

function addYears(d: Date, n: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + n);
  return x;
}

/**
 * Start of the ISO week (Monday). Avoids dragging in date-fns just for one
 * helper; matches `getISODay()` semantics with Monday=1.
 */
function startOfIsoWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0=Sunday..6=Saturday
  const diff = day === 0 ? -6 : 1 - day;
  return addDays(x, diff);
}

function startOfMonth(d: Date): Date {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

function startOfYear(d: Date): Date {
  const x = startOfDay(d);
  x.setMonth(0, 1);
  return x;
}

/**
 * `useCompareWindow` — returns ranges + localised labels for "this period vs
 * previous period" comparisons. Used together with `<Delta>` to render
 * "↑ 12% vs last week"-style indicators.
 */
export function useCompareWindow(window: CompareWindow, anchor: Date = new Date()): CompareWindowResult {
  const { t } = useTranslation();

  // Key the memo on the numeric instant rather than the `Date` object itself.
  // `Date` instances compare by reference, so a caller that passes a fresh
  // `new Date(sameInstant)` on every render would otherwise bust the memo each
  // time. `getTime()` also collapses an invalid anchor to `NaN`, which we fall
  // back from below instead of emitting `Invalid Date` ranges downstream.
  const anchorMs = anchor.getTime();

  return useMemo(() => {
    const base = Number.isNaN(anchorMs) ? new Date() : new Date(anchorMs);

    let currentStart: Date;
    let currentEnd: Date;
    let previousStart: Date;
    let previousEnd: Date;
    let currentLabel: string;
    let previousLabel: string;
    let vsPreviousLabel: string;

    switch (window) {
      case 'day': {
        currentStart = startOfDay(base);
        currentEnd = addDays(currentStart, 1);
        previousStart = addDays(currentStart, -1);
        previousEnd = currentStart;
        currentLabel = t('delta.today', 'today');
        previousLabel = t('delta.yesterday', 'yesterday');
        vsPreviousLabel = t('delta.vsYesterday', 'vs yesterday');
        break;
      }
      case 'week': {
        currentStart = startOfIsoWeek(base);
        currentEnd = addDays(currentStart, 7);
        previousStart = addDays(currentStart, -7);
        previousEnd = currentStart;
        currentLabel = t('delta.thisWeek', 'this week');
        previousLabel = t('delta.lastWeek', 'last week');
        vsPreviousLabel = t('delta.vsLastWeek', 'vs last week');
        break;
      }
      case 'month': {
        currentStart = startOfMonth(base);
        currentEnd = addMonths(currentStart, 1);
        previousStart = addMonths(currentStart, -1);
        previousEnd = currentStart;
        currentLabel = t('delta.thisMonth', 'this month');
        previousLabel = t('delta.lastMonth', 'last month');
        vsPreviousLabel = t('delta.vsLastMonth', 'vs last month');
        break;
      }
      case 'year':
      default: {
        currentStart = startOfYear(base);
        currentEnd = addYears(currentStart, 1);
        previousStart = addYears(currentStart, -1);
        previousEnd = currentStart;
        currentLabel = t('delta.thisYear', 'this year');
        previousLabel = t('delta.lastYear', 'last year');
        vsPreviousLabel = t('delta.vsLastYear', 'vs last year');
        break;
      }
    }

    return {
      currentLabel,
      previousLabel,
      vsPreviousLabel,
      currentRange: { start: currentStart, end: currentEnd },
      previousRange: { start: previousStart, end: previousEnd },
    };
  }, [window, anchorMs, t]);
}
