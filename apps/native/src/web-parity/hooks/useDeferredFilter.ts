// Native parity port of web/src/hooks/useDeferredFilter.ts.
//
// useDeferredFilter — keep an input field responsive while a heavy list
// re-renders in the background.
//
// Pairs an "instant" controlled input value (`value`) with a "deferred"
// value (`deferred`) that React lags behind during expensive renders via
// `useDeferredValue`. Bind the input to `value`; feed `deferred` into the
// heavy filter / `useMemo` chain. While the deferred value is catching up,
// `isPending` flips to `true` so the UI can surface a subtle pending
// indicator without blocking keystrokes.
//
// Adoption pattern:
//
//     const filter = useDeferredFilter('');
//     const filtered = useMemo(
//       () => rows.filter(r => match(r, filter.deferred)),
//       [rows, filter.deferred],
//     );
//     return (
//       <>
//         <SearchInput value={filter.value} onChangeText={filter.setValue} />
//         {filter.isPending && (
//           <SpinnerSmall accessibilityLabel={t('filter.pending')} />
//         )}
//         <DataTable data={filtered} ... />
//       </>
//     );
//
// For externally-persisted filters, prefer calling `useDeferredValue`
// directly on the external state — there is no benefit to doubling up local
// React state on top of navigation/route state, and the `useDeferredValue`
// primitive alone is what defers the heavy render.
//
// Why not `useTransition`?
//   `useTransition` marks a STATE UPDATE as non-urgent. That works for
//   tab switching where the click-result render should be deprioritized.
//   For an input field we want the OPPOSITE: the keystroke render must
//   stay urgent (so the character appears instantly) while only the
//   downstream list render is deprioritized. `useDeferredValue` is the
//   right primitive for that direction.
//
// Web -> native adaptation (conversion contract rule 3): the hook logic is
// pure React (useState + useDeferredValue + useCallback) with no DOM, browser,
// or web-UI dependency, so the runtime surface ports byte-for-byte. Only the
// illustrative doc-comment example was adapted from web JSX
// (onChange/aria-label, URL query state via useUrlString) to native
// equivalents (onChangeText/accessibilityLabel, navigation/route state).

import {useCallback, useDeferredValue, useState} from 'react';

export interface DeferredFilter<T> {
  /** Current input value — updates synchronously on `setValue`. Bind to inputs. */
  value: T;
  /** Lagged value — equals `value` after React commits the deferred render. Use for filters / heavy `useMemo`. */
  deferred: T;
  /** True while `deferred` has not yet caught up to `value` (i.e. a non-urgent render is in flight). */
  isPending: boolean;
  /** Setter — accepts a new value or a `(prev) => next` updater. Reference-stable across renders. */
  setValue: (next: T | ((prev: T) => T)) => void;
}

export function useDeferredFilter<T>(initial: T): DeferredFilter<T> {
  const [value, setValueRaw] = useState<T>(initial);
  const deferred = useDeferredValue(value);
  const isPending = !Object.is(value, deferred);

  // Wrap the raw setter so the returned `setValue` is reference-stable
  // across renders. Without this, every consumer that lists `setValue`
  // in a `useEffect` / `useCallback` deps array would invalidate on
  // every render — defeating the responsiveness gain.
  const setValue = useCallback((next: T | ((prev: T) => T)) => {
    setValueRaw(next);
  }, []);

  return {value, deferred, isPending, setValue};
}
