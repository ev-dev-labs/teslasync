import type { DataState } from '@/api/dataState';
import type { DrivingStats } from '@/types/driving';
import type { UseUnitsResult } from '@/hooks/useUnits';
import type { EfficiencyModel } from './model';

export interface SourcePresentation {
  state: DataState<unknown>;
  loading: boolean;
  malformed: boolean;
}
export interface StatsPresentation {
  stats: DrivingStats | undefined;
  source: SourcePresentation;
  model: EfficiencyModel;
  units: UseUnitsResult;
}
export interface DrivesPresentation {
  source: SourcePresentation;
  model: EfficiencyModel;
  units: UseUnitsResult;
}
