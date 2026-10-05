import type { FleetAnalyticsQuery } from '../analytics/constants';

/**
 * Legacy analytics panels treat any error as a replacement for their content.
 * Keep their exact renderers and calculations, but distinguish a failed refresh
 * from an initial failure. The original query still owns cache state, freshness,
 * error evidence and recovery in PageLayout; only the content view is adapted.
 */
export function retainFleetContent(query: FleetAnalyticsQuery): FleetAnalyticsQuery {
  if (query.data === undefined || !query.isError) return query;

  return {
    ...query,
    status: 'success',
    error: null,
    isError: false,
    isSuccess: true,
    isPending: false,
    isLoading: false,
    isLoadingError: false,
    isRefetchError: false,
  };
}
