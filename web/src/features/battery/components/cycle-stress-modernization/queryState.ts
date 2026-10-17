import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { TFunction } from 'i18next';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';
import type { CycleSource, CycleStressResult } from '../../lib/cycleStress';
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
  const retained = vehicleSelected && sources.some(source => source.trust.hasData
    && Boolean(source.trust.refreshError || source.trust.isRefreshBlocked));
  return { state, sources, fatalError, retained };
}

export type CycleStressTrust = ReturnType<typeof cycleStressQueryState>;

/** Match the visible cycle body's admission before exposing generated chart bins. */
export function cycleStressCycleEvidence(
  result: CycleStressResult,
  state: CycleStressQueryState,
  t: TFunction,
) {
  const description = !state.vehicleSelected
    ? t('cycleStress.states.noVehiclePassive',
      'Select a vehicle to make its returned charge and drive evidence available.')
    : state.isLoading
      ? t('cycleStress.states.loadingAria', 'Loading Cycle Stress evidence')
      : state.error
        ? t('cycleStress.states.errorPassive',
          'Both source histories are unavailable; retry from the evidence status above.')
        : !state.isResolved
          ? t('cycleStress.states.pendingPassive', 'Source-history availability has not resolved.')
          : result.continuity.acceptedIntervals === 0
            ? result.driveAccounting.returnedRows + result.chargingAccounting.returnedRows === 0
              ? t('cycleStress.states.emptyPassive',
                'No drive or charging rows were returned for this vehicle.')
              : t('cycleStress.states.noQualifiedPassive',
                'No returned row had complete, valid, direction-consistent SoC endpoints.')
            : result.cycles.length === 0
              ? t('cycleStress.states.noCyclesPassive',
                'Qualified endpoints are available, but no countable rainflow range was retained.')
              : undefined;
  return { available: description === undefined, description };
}
