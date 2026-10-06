import type { ShareCardQueryState } from './types';
import { deriveDataState } from '@/api/dataState';

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
  const source = deriveDataState(query);
  const hasData = source.hasData;
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
    initialError: enabled ? source.fatalError : null,
    isResolved: enabled && (query.isSuccess || hasData),
    isRefreshing: enabled && hasData && query.isFetching,
    cachedRefreshError: enabled ? source.refreshError : null,
    cachedRefreshPaused: enabled && hasData && query.fetchStatus === 'paused',
    onRetry,
  };
}
