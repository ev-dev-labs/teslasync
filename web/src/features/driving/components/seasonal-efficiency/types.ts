import type { ReactNode } from 'react';
import type { UseUnitsResult } from '@/hooks/useUnits';
import type { SeasonalEfficiencyResult } from '../../lib/seasonalEfficiency';

export interface SeasonalQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface SeasonalSectionProps {
  analysis: SeasonalEfficiencyResult;
  state: SeasonalQueryState;
  locale: string;
  timeZone: string;
  units: UseUnitsResult;
}

export interface SeasonalChartProps extends SeasonalSectionProps {
  children?: ReactNode;
}
