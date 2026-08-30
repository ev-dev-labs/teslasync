/**
 * @module hooks/useDataState
 *
 * Ergonomic adapter from a TanStack Query result to the shared data-trust
 * contract in `api/dataState.ts`.
 *
 * Pages should read `state.fatalError` (not `query.error`) for their
 * page-level error surface and render `<StaleRefreshWarning state={state} />`
 * beside retained content, so a failed background refresh downgrades trust
 * instead of destroying the view.
 */

import { useMemo } from 'react'

import {
  combineDataStates,
  deriveDataState,
  type DataState,
  type DataStateSource,
  type DeriveDataStateOptions,
} from '@/api/dataState'

/**
 * Memoised {@link deriveDataState}. The identity of the returned object is
 * stable while the underlying query fields are unchanged, so it is safe to
 * pass into memoised children and effect dependency arrays.
 *
 * `dataUpdatedAt` intentionally participates in the dependency list: it is
 * what makes `ageMs` advance across successful refetches.
 */
export function useDataState<T>(
  source: DataStateSource<T>,
  options: DeriveDataStateOptions = {},
): DataState<T> {
  const { provenance, partial, unavailable, maxAgeMs } = options
  return useMemo(
    () => deriveDataState(source, { provenance, partial, unavailable, maxAgeMs }),
    // Structural dependency list: `source` is a fresh object on every render,
    // so the individual query fields are what actually change.
    [
      source.data,
      source.error,
      source.isError,
      source.isFetching,
      source.isPending,
      source.fetchStatus,
      source.dataUpdatedAt,
      source.refetch,
      provenance,
      partial,
      unavailable,
      maxAgeMs,
    ],
  )
}

/**
 * Roll several panel states into the one a container should present.
 *
 * Mixed outcomes resolve to `partial` rather than to the worst member, so one
 * failed source in a six-source page never blanks the five that succeeded.
 */
export function useCombinedDataState(states: readonly DataState<unknown>[]) {
  return useMemo(() => combineDataStates(states), [states])
}
