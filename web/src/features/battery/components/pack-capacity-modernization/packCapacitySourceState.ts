import type { DataState } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';

import type { PackCapacityQueryState } from '../pack-capacity';

/**
 * One source feeds all of this page's analytical views. Adapt its trust state
 * once; each existing section still applies its own observation/fit gate.
 * Paused-without-data is pending, not an endless active-loading spinner.
 */
export function packCapacitySourceState(
  source: DataState<ChargingSession[]>,
  vehicleSelected: boolean,
  loading: boolean,
): PackCapacityQueryState {
  return {
    vehicleSelected,
    isLoading:
      vehicleSelected
      && !source.hasData
      && source.fatalError == null
      && !source.isRefreshBlocked
      && source.status === 'initial'
      && loading,
    isResolved:
      vehicleSelected && (source.hasData || source.fatalError != null),
    error: vehicleSelected ? source.fatalError : null,
    refreshError: vehicleSelected ? source.refreshError : null,
    onRetry: () => {
      source.retry?.();
    },
  };
}
