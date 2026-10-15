export interface DepartureForecastQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isRefreshBlocked?: boolean;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}
