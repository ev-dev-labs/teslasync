import type { DataState } from '@/api/dataState';

export interface DestinationTransitionsQueryState {
  sourceTrust?: Pick<DataState<unknown>, 'status' | 'hasData' | 'isRefreshing' | 'isRefreshBlocked'>;
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type DestinationTransitionsSectionRequirement =
  | 'none'
  | 'visits'
  | 'transitions'
  | 'origins'
  | 'months';
