import { keepPreviousData, useQuery, type QueryKey } from '@tanstack/react-query';
import { useRef } from 'react';

/** Retention is renderable, but only matching source scope authorizes row actions. */
export function useRepairScopedQuery<T>(
  queryKey: QueryKey,
  queryFn: (context: { signal: AbortSignal }) => Promise<T>,
  currentScope: string,
  scopeFromKey: (key: QueryKey) => string,
) {
  const retained = useRef<{ scope: string; updatedAt: number } | null>(null);
  const query = useQuery({
    queryKey,
    queryFn,
    placeholderData: (previousData, previousQuery) => {
      if (previousData !== undefined && previousQuery) {
        retained.current = {
          scope: scopeFromKey(previousQuery.queryKey),
          updatedAt: previousQuery.state.dataUpdatedAt,
        };
      }
      return keepPreviousData(previousData);
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const sourceScope = query.data === undefined
    ? null
    : query.isPlaceholderData ? retained.current?.scope ?? null : currentScope;
  const isPreviousScope = sourceScope !== null && sourceScope !== currentScope;
  return {
    ...query,
    dataUpdatedAt: query.isPlaceholderData
      ? retained.current?.updatedAt ?? 0
      : query.dataUpdatedAt,
    sourceScope,
    currentScope,
    isPreviousScope,
    canWriteCurrentScope: query.data !== undefined && sourceScope === currentScope,
  };
}
