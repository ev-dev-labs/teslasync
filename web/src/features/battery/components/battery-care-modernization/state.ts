import type { DataState } from '@/api/dataState';
import { combineDataStates } from '@/api/dataState';
import type { BatteryCareSectionState } from '../battery-care';

export interface CareSource {
  label: string;
  state: DataState<unknown>;
  isInitialLoading?: boolean;
}

export interface CareSectionState {
  trust: DataState<unknown>;
  sources: readonly CareSource[];
  isInitialLoading: boolean;
}

/** Presentation only: never replace or transform the retained query payload. */
export function careSectionState(sources: readonly CareSource[]): CareSectionState {
  const states = sources.map(source => source.state);
  const combined = combineDataStates(states);
  const hasData = states.some(state => state.hasData);
  return {
    sources,
    isInitialLoading: !hasData && sources.some(source =>
      !source.state.fatalError && !source.state.isRefreshBlocked &&
      source.isInitialLoading === true,
    ),
    trust: {
      ...combined,
      hasData,
      data: hasData ? states.map(state => state.data) : undefined,
      retry: () => {
        for (const state of states) {
          if (state.fatalError || state.refreshError || state.isRefreshBlocked) {
            state.retry?.();
          }
        }
      },
    },
  };
}

/** Readonly specialist compatibility: only INITIAL errors may replace content. */
export function specialistState(state: CareSectionState): BatteryCareSectionState {
  return {
    isLoading: state.isInitialLoading,
    error: state.trust.fatalError,
    onRetry: () => { state.trust.retry?.(); },
  };
}
