import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import type { CycleSource } from '../../lib/cycleStress';
import type { CycleStressQueryState } from '../cycle-stress/types';

/** Presentation-only fan-out: never changes rows, keys, scope or request policy. */
export function cycleStressQueryState(
  vehicleSelected: boolean,
  sessionsQuery: DataStateSource<ChargingSession[]>,
  drivesQuery: DataStateSource<Drive[]>,
) {
  const charging = deriveDataState(sessionsQuery, { provenance: 'historical' });
  const drive = deriveDataState(drivesQuery, { provenance: 'historical' });
  const sources = [
    { id: 'charging' as const, trust: charging, query: sessionsQuery },
    { id: 'drive' as const, trust: drive, query: drivesQuery },
  ];
  const available = (source: typeof sources[number]) =>
    vehicleSelected && (source.trust.hasData || Boolean(source.query.isSuccess));
  const loading = (source: typeof sources[number]) =>
    vehicleSelected && !available(source)
    && !source.trust.fatalError;
  const failedSources: CycleSource[] = vehicleSelected
    ? sources.filter(source => source.trust.fatalError).map(source => source.id)
    : [];
  const loadingSources: CycleSource[] = sources.filter(loading).map(source => source.id);
  const anyAvailable = sources.some(available);
  const allSettled = sources.every(source => available(source) || source.trust.fatalError);
  const fatalError = vehicleSelected && !anyAvailable && allSettled
    ? charging.fatalError ?? drive.fatalError
    : null;
  const refreshError = vehicleSelected && anyAvailable
    ? charging.refreshError ?? drive.refreshError
    : null;
  const state: CycleStressQueryState = {
    vehicleSelected,
    isLoading: vehicleSelected && !anyAvailable && loadingSources.length > 0,
    isResolved: vehicleSelected && (anyAvailable || allSettled),
    error: fatalError,
    refreshError,
    failedSources,
    loadingSources,
    onRetry: () => {
      sources.forEach(source => {
        if (source.query.isError || !available(source)) {
          void source.query.refetch?.();
        }
      });
    },
  };
  return { state, sources, fatalError };
}

export type CycleStressTrust = ReturnType<typeof cycleStressQueryState>;
