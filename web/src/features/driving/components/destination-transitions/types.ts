export interface DestinationTransitionsQueryState {
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
