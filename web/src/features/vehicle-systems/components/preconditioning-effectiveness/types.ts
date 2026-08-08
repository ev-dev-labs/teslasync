export interface PreconditioningSourceQueryState {
  hasData: boolean;
  isLoading: boolean;
  isResolved: boolean;
  isFetching: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface PreconditioningQueryState {
  vehicleSelected: boolean;
  climate: PreconditioningSourceQueryState;
  drives: PreconditioningSourceQueryState;
  onRefresh: () => void;
}

export type PreconditioningRequirement =
  | 'none'
  | 'climate'
  | 'drives'
  | 'analysis'
  | 'classified'
  | 'comparison'
  | 'directory';

export type TemperatureDeltaFormatter = (
  value: number | null | undefined,
  options?: {
    precision?: number;
    signed?: boolean;
  },
) => string;

export type TemperatureDeltaConverter = (
  value: number | null | undefined,
) => number | null;
