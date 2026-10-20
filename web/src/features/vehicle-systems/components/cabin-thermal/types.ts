export interface CabinThermalQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  isPaused?: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type CabinThermalSectionRequirement =
  | 'none'
  | 'rows'
  | 'candidates'
  | 'accepted';
