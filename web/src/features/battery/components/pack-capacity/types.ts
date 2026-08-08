export interface PackCapacityQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type PackCapacitySectionRequirement =
  | 'none'
  | 'observations'
  | 'fit';
