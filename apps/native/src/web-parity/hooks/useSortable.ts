/**
 * Native web-parity port of `web/src/hooks/useSortable.ts`.
 *
 * Generic client-side sort primitive for tabular / list data. Tracks the
 * active sort column (`sortKey`) and direction (`sortDir`), derives a sorted
 * copy of the input array, and exposes a header-tap `toggle` that flips the
 * direction when the same column is tapped again or switches column (resetting
 * to ascending) when a different one is chosen — the canonical sortable-table
 * header UX, identical to the web contract.
 *
 * Behaviour (preserved 1:1 from web):
 *   - `sorted` is a new array each time `data`, `sortKey`, or `sortDir`
 *     changes (memoized); the input `data` is never mutated (it is spread
 *     before sorting).
 *   - `null` / `undefined` values sort last regardless of direction: a nullish
 *     `a` returns `1`, a nullish `b` returns `-1` before the direction sign is
 *     applied, so blanks always sink to the bottom.
 *   - Non-null comparison uses the generic `<` / `>` operators (works for
 *     numbers, strings, dates-as-numbers), yielding `-1 | 0 | 1`, then negated
 *     for `'desc'`.
 *   - `toggle(key)` flips direction when `key === sortKey`, otherwise selects
 *     `key` and resets direction to `'asc'`.
 *
 * Native adaptation: none required. The hook is pure React state/derivation —
 * its only dependency is `{ useMemo, useState } from 'react'`, which behaves
 * identically under React Native. No DOM APIs, browser globals, HTML elements,
 * Recharts/Leaflet, or web UI components are referenced, so the logic, state
 * names (`sortKey` / `sortDir` / `sorted` / `toggle`), generic signature, and
 * default-direction argument are ported verbatim.
 */

import { useMemo, useState } from 'react';

export function useSortable<T>(
  data: T[],
  defaultKey: keyof T,
  defaultDir: 'asc' | 'desc' = 'asc',
) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultKey);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>(defaultDir);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const toggle = (key: keyof T) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  return { sorted, sortKey, sortDir, toggle };
}
