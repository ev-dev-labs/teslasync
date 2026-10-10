export interface ComfortConsistencyQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  isPaused?: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type ComfortConsistencyRequirement =
  | 'none'
  | 'timestamps'
  | 'samples'
  | 'intervals'
  | 'runs'
  | 'windows';

export type TemperatureDeltaFormatter = (
  value: number | null | undefined,
  options?: { precision?: number },
) => string;
