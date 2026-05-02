import { useMemo } from 'react';

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
    return list.filter((item) =>
      fields.some((f) => {
        const v = typeof f === 'function' ? f(item) : item[f];
        return String(v ?? '').toLowerCase().includes(q);
      }),
    );
  }, [items, query, fields]);
}
