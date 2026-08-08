import type { CycleSource } from '../../lib/cycleStress';

export interface CycleStressQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  failedSources: CycleSource[];
  loadingSources: CycleSource[];
  onRetry: () => void;
}

export type CycleStressSectionRequirement =
  | 'none'
  | 'intervals'
  | 'cycles'
  | 'turningPoints';
