import { useQuery } from '@tanstack/react-query';
import { request } from '../client';
import { STALE_TIMES } from '@/lib/constants';
import type { SearchHitType, SearchResponse } from '../types';

/**
 * Minimum query length the server enforces. Mirrored here so the hook can
 * skip making a request when it would just bounce back empty.
 */
export const SEARCH_MIN_QUERY_LENGTH = 2;

export const searchKeys = {
  global: (query: string, types: readonly SearchHitType[] | undefined, limit: number | undefined) =>
    ['search', 'global', query, types?.join(',') ?? '', limit ?? null] as const,
};

export interface UseGlobalSearchOptions {
  /** When provided, restrict the search to these entity types. */
  types?: readonly SearchHitType[]
  /** Per-type LIMIT passed to the backend (clamped server-side to [1, 25]). */
  limit?: number
  /** When true, the hook is disabled regardless of query length. */
  disabled?: boolean
}

/**
 * useGlobalSearch — fetches the unified entity search endpoint.
 *
 * For queries shorter than {@link SEARCH_MIN_QUERY_LENGTH} (after trimming),
 * or when {@link UseGlobalSearchOptions.disabled} is set, the hook stays idle
 * and never fetches — `data` is `undefined`, so callers should read
 * `data?.hits ?? []`. While a *valid* new query is in flight the previous
 * page's hits are retained (no flicker); once the query drops below the floor
 * those stale hits are cleared so empty states can't show old results.
 */
export function useGlobalSearch(query: string, options: UseGlobalSearchOptions = {}) {
  const trimmed = query.trim();
  const enabled = !options.disabled && trimmed.length >= SEARCH_MIN_QUERY_LENGTH;
  return useQuery({
    queryKey: searchKeys.global(trimmed, options.types, options.limit),
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ q: trimmed });
      if (options.types && options.types.length > 0) {
        params.set('types', options.types.join(','));
      }
      if (options.limit && options.limit > 0) {
        params.set('limit', String(options.limit));
      }
      const res = await request<SearchResponse>(`/search?${params.toString()}`, { signal });
      // Null-safety: the endpoint always answers `{ hits, query }`, but a 204 or
      // a malformed body would otherwise leave `data.hits` undefined and crash
      // the `.map`/`.length` reads at every callsite. Normalise to a well-formed
      // response so consumers can always treat `hits` as an array.
      return { hits: res?.hits ?? [], query: res?.query ?? trimmed } satisfies SearchResponse;
    },
    enabled,
    staleTime: STALE_TIMES.FAST,
    // Keep the previous page's hits on screen while a NEW valid query is
    // in flight (no flicker as the user types). Crucially, drop them the
    // moment the query is disabled (too short / explicitly disabled): a
    // cleared or below-floor box must not keep surfacing stale results —
    // the command palette's empty state depends on this.
    placeholderData: enabled ? (prev) => prev : undefined,
  });
}
