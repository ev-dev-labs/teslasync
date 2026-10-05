import type { DataState } from '@/api/dataState';
import type { CabinThermalQueryState } from '../cabin-thermal';

/** Keep the original passive section gates and the single actionable retry owner. */
export function cabinThermalSourceState<T>(
  trust: DataState<T>,
  source: { isLoading: boolean; isSuccess: boolean },
  vehicleSelected: boolean,
  onRetry: () => void,
): CabinThermalQueryState {
  return {
    vehicleSelected,
    isLoading: vehicleSelected && !trust.hasData && source.isLoading,
    isResolved: vehicleSelected && (trust.hasData || source.isSuccess),
    // A deselected vehicle has no usable page-scoped cache. Preserve the
    // original no-vehicle gates without promoting that payload into evidence.
    error: vehicleSelected ? trust.fatalError : trust.fatalError ?? trust.refreshError,
    refreshError: vehicleSelected ? trust.refreshError : null,
    onRetry,
  };
}
