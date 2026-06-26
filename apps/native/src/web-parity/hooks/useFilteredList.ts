// Native parity port of web/src/hooks/useFilteredList.ts.
//
// This is a pure, framework-agnostic client-side substring filter built on
// React `useMemo` only — it touches no DOM, browser, Recharts, Leaflet, or web
// UI APIs — so the logic ports verbatim to React Native. The single source
// import (`react` useMemo, web L1) is kept as-is; the FilterField<T> type
// (web L4), the JSDoc contract (web L6-21), the generic signature (web L22-26),
// and the empty-query passthrough + lowercased substring `some`/`includes`
// matching over property-name or accessor-function fields (web L27-37) are all
// preserved unchanged.

import {useMemo} from 'react';

/** Either a property name on `T` or a function that extracts a string from `T`. */
export type FilterField<T> = keyof T | ((item: T) => string | null | undefined);

/**
 * Client-side substring filter over a list.
 *
 * Returns the original list unchanged when `query` is empty or whitespace.
 * Otherwise, returns items where any of the supplied fields contains the
 * lowercased query as a substring.
 *
 * Field accessors may be either a property name on `T` (in which case the
 * value is read directly via bracket access) or a function returning the
 * string to match against.
 *
 * Note: pass a stable `fields` reference (e.g. via `useMemo` or an
 * outside-component constant) when you care about reference equality —
 * inline array literals will cause the filter to recompute on every render,
 * which is cheap but wasteful for very large lists.
 */
export function useFilteredList<T>(
  items: T[] | undefined | null,
  query: string,
  fields: ReadonlyArray<FilterField<T>>,
): T[] {
  return useMemo(() => {
    const list = items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(item =>
      fields.some(f => {
        const v = typeof f === 'function' ? f(item) : item[f];
        return String(v ?? '').toLowerCase().includes(q);
      }),
    );
  }, [items, query, fields]);
}
