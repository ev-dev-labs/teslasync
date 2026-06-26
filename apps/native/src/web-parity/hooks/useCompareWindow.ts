// Native parity port of web/src/hooks/useCompareWindow.ts.
//
// `useCompareWindow` returns inclusive-start / exclusive-end date ranges plus
// localised "this period vs previous period" labels (today/yesterday,
// this/last week, this/last month, this/last year) used together with `<Delta>`
// to render "↑ 12% vs last week"-style indicators. The whole module is pure
// `Date` arithmetic + i18n, so it ports to React Native unchanged except for the
// translation source:
//   - react-i18next `useTranslation` is absent from the native deps, so it is
//     replaced by a local key-preserving fallback shim (identical
//     `const { t } = useTranslation()` call shape, identical `t(key, fallback)`
//     signature, identical `delta.*` keys) that returns the inline English copy
//     while preserving translation intent. The `t` reference is module-stable
//     (like react-i18next's memoised `t`) so the `useMemo` dependency
//     `[window, anchor, t]` still only recomputes when `window`/`anchor` change.
//   - `Date`, `useMemo` and every date helper are platform-agnostic — no DOM,
//     browser, Recharts, Leaflet, or web UI imports are introduced.

import { useMemo } from 'react';

// ─── i18n fallback ────────────────────────────────────────────
// react-i18next is absent from the native deps; this returns the inline English
// copy while the call sites still reference the i18n key so intent is preserved.
type TFunc = (key: string, fallback: string) => string;

const fallbackT: TFunc = (_key, fallback) => fallback;

function useTranslation(): { t: TFunc } {
  return { t: fallbackT };
}

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
export function useCompareWindow(
  window: CompareWindow,
  anchor: Date = new Date(),
): CompareWindowResult {
  const { t } = useTranslation();

  return useMemo(() => {
    let currentStart: Date;
    let currentEnd: Date;
    let previousStart: Date;
    let previousEnd: Date;
    let currentLabel: string;
    let previousLabel: string;
    let vsPreviousLabel: string;

    switch (window) {
      case 'day': {
        currentStart = startOfDay(anchor);
        currentEnd = addDays(currentStart, 1);
        previousStart = addDays(currentStart, -1);
        previousEnd = currentStart;
        currentLabel = t('delta.today', 'today');
        previousLabel = t('delta.yesterday', 'yesterday');
        vsPreviousLabel = t('delta.vsYesterday', 'vs yesterday');
        break;
      }
      case 'week': {
        currentStart = startOfIsoWeek(anchor);
        currentEnd = addDays(currentStart, 7);
        previousStart = addDays(currentStart, -7);
        previousEnd = currentStart;
        currentLabel = t('delta.thisWeek', 'this week');
        previousLabel = t('delta.lastWeek', 'last week');
        vsPreviousLabel = t('delta.vsLastWeek', 'vs last week');
        break;
      }
      case 'month': {
        currentStart = startOfMonth(anchor);
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
        currentStart = startOfYear(anchor);
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
  }, [window, anchor, t]);
}
