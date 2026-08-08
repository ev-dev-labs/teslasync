export interface ArrivalReliabilityQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type ArrivalSectionRequirement =
  | 'none'
  | 'included'
  | 'routes'
  | 'windows';

export type DurationFormatter = (
  value: number | null | undefined,
  options?: { precision?: number },
) => string;
