import { useQuery } from '@tanstack/react-query';

import { request } from '../client';

const STALE_TIMES = {
  FAST: 30_000,
} as const;

/** One result from the global /search endpoint. */
export type SearchHitType =
  | 'vehicle'
  | 'drive'
  | 'charging'
  | 'alert'
  | 'notification'
  | 'geofence'
  | 'automation'
  | 'location'
  | 'trip';

export interface SearchHit {
  type: SearchHitType;
  id: number;
  title: string;
  subtitle?: string;
  url: string;
  score: number;
  when?: string;
}

export interface SearchResponse {
  hits: SearchHit[];
  query: string;
}

/**
 * Minimum query length the server enforces. Mirrored here so the hook can
 * skip making a request when it would just bounce back empty.
 */
export const SEARCH_MIN_QUERY_LENGTH = 2;

export const searchKeys = {
  global: (
    query: string,
    types: readonly SearchHitType[] | undefined,
    limit: number | undefined,
  ) => ['search', 'global', query, types?.join(',') ?? '', limit ?? null] as const,
};

export interface UseGlobalSearchOptions {
  /** When provided, restrict the search to these entity types. */
  types?: readonly SearchHitType[];
  /** Per-type LIMIT passed to the backend (clamped server-side to [1, 25]). */
  limit?: number;
  /** When true, the hook is disabled regardless of query length. */
  disabled?: boolean;
}

/**
 * useGlobalSearch - fetches the unified entity search endpoint.
 *
 * Returns an empty hits array (without making a request) for queries
 * shorter than {@link SEARCH_MIN_QUERY_LENGTH} so callers can render
 * empty states without flicker.
 */
export function useGlobalSearch(
  query: string,
  options: UseGlobalSearchOptions = {},
) {
  const trimmed = query.trim();
  const enabled = !options.disabled && trimmed.length >= SEARCH_MIN_QUERY_LENGTH;

  return useQuery({
    queryKey: searchKeys.global(trimmed, options.types, options.limit),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ q: trimmed });
      if (options.types && options.types.length > 0) {
        params.append('types', options.types.join(','));
      }
      if (options.limit && options.limit > 0) {
        params.append('limit', String(options.limit));
      }
      return request<SearchResponse>(`/search?${params.toString()}`, { signal });
    },
    enabled,
    staleTime: STALE_TIMES.FAST,
    placeholderData: prev => prev,
  });
}
