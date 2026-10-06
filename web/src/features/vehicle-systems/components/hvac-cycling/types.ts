export interface HvacCyclingQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  isPaused?: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type HvacCyclingSectionRequirement =
  | 'none'
  | 'known'
  | 'intervals'
  | 'runs';
