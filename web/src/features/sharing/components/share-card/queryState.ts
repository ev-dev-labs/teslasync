import type { ShareCardQueryState } from './types';

export interface ShareCardQueryLike {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  fetchStatus: 'fetching' | 'paused' | 'idle';
}

export function shareCardQueryState(
  query: ShareCardQueryLike,
  enabled: boolean,
  onRetry: () => void,
): ShareCardQueryState {
  const hasData = query.data !== undefined;
  return {
    enabled,
    hasData,
    isInitialLoading: enabled
      && !hasData
      && (
        query.isLoading
        || (query.isPending && query.fetchStatus === 'fetching')
      ),
    isInitialPaused: enabled && !hasData && query.fetchStatus === 'paused',
    initialError: enabled && query.isError && !hasData ? query.error : null,
    isResolved: enabled && (query.isSuccess || hasData),
    isRefreshing: enabled && hasData && query.isFetching,
    cachedRefreshError: enabled && query.isError && hasData ? query.error : null,
    cachedRefreshPaused: enabled && hasData && query.fetchStatus === 'paused',
    onRetry,
  };
}
