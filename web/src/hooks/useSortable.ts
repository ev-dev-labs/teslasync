import { useCallback, useMemo, useState } from 'react'

/** Sort direction used by {@link useSortable}. */
export type SortDirection = 'asc' | 'desc'

/** Return shape of {@link useSortable}. */
export interface Sortable<T> {
  /**
   * A sorted copy of the input list. The input array is never mutated.
   * `null`/`undefined` cells always sort to the end, regardless of direction.
   */
  sorted: T[]
  /** The property currently used as the sort key. */
  sortKey: keyof T
  /** The active sort direction. */
  sortDir: SortDirection
  /**
   * Sort by `key`. Calling `toggle` with the active key flips the direction;
   * calling it with a different key selects that key in ascending order.
   */
  toggle: (key: keyof T) => void
}

/**
 * Headless column-sorting primitive for tables and list views.
 *
 * Keeps `sortKey` + `sortDir` in local state and returns a stably-sorted copy
 * of `data` (the input array is never mutated). `null`/`undefined` values are
 * always pinned to the end independent of direction, so empty cells don't jump
 * around when the user flips ascending/descending.
 *
 * `data` tolerates `undefined`/`null` (e.g. a query result that has not loaded
 * yet) — in that case `sorted` is an empty array rather than a thrown
 * `TypeError` from spreading a nullish value.
 *
 * @typeParam T   Row shape.
 * @param data       Rows to sort. May be `undefined`/`null` while loading.
 * @param defaultKey Initial sort key.
 * @param defaultDir Initial direction (defaults to `'asc'`).
 */
export function useSortable<T>(
  data: T[] | undefined | null,
  defaultKey: keyof T,
  defaultDir: SortDirection = 'asc',
): Sortable<T> {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey)
  const [sortDir, setSortDir] = useState<SortDirection>(defaultDir)

  const sorted = useMemo(() => {
    const list = data ?? []
    return [...list].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      // Missing values always sort last, and equal-missing pairs keep their
      // relative order — a consistent comparator (compare(a,b) === -compare(b,a)).
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const toggle = useCallback(
    (key: keyof T) => {
      if (key === sortKey) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('asc')
      }
    },
    [sortKey],
  )

  return useMemo<Sortable<T>>(
    () => ({ sorted, sortKey, sortDir, toggle }),
    [sorted, sortKey, sortDir, toggle],
  )
}
