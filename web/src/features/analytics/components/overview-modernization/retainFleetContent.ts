import type { FleetAnalyticsQuery } from '../analytics/constants';

export type FleetContentQuery = FleetAnalyticsQuery & {
  sourceQuery?: FleetAnalyticsQuery;
};

/**
 * Legacy analytics panels treat any error as a replacement for their content.
 * Keep their exact renderers and calculations, but distinguish a failed refresh
 * from an initial failure. The original query still owns cache state, freshness,
 * error evidence and recovery in PageLayout; only the content view is adapted.
 * Domain briefs receive the original source state alongside that content view.
 */
export function retainFleetContent(query: FleetContentQuery): FleetContentQuery {
  const source = query.sourceQuery ?? query;
  if (source.data == null || !source.isError) return source;

  return {
    ...source,
    sourceQuery: source,
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
