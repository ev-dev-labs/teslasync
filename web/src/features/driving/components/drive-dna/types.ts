export interface DriveDnaQueryState {
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface DriveDnaSectionState {
  vehicleSelected: boolean;
  hasDrive: boolean;
  list: DriveDnaQueryState;
  telemetry: DriveDnaQueryState;
}
