export interface RangeBufferQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type RangeBufferSectionRequirement =
  | 'none'
  | 'included'
  | 'distance'
  | 'destinations';

export type RangeBufferDistanceFormatter = (
  value: number | null | undefined,
  options?: { precision?: number },
) => string;
