import type { CarbonQueryState } from './types';

export interface CarbonQueryLike {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

export function carbonQueryState(
  query: CarbonQueryLike,
  enabled: boolean,
  onRetry: () => void,
): CarbonQueryState {
  const hasData = query.data !== undefined;
  return {
    enabled,
    hasData,
    isLoading:
      enabled
      && !hasData
      && (
        query.isLoading
        || (query.isPending && query.fetchStatus === 'fetching')
      ),
    isResolved: enabled && (query.isSuccess || hasData),
    isFetching: enabled && query.isFetching,
    isPaused: enabled && !hasData && query.fetchStatus === 'paused',
    refreshPaused: enabled && hasData && query.fetchStatus === 'paused',
    error: enabled && query.isError && !hasData ? query.error : null,
    refreshError: enabled && query.isError && hasData ? query.error : null,
    onRetry,
  };
}
