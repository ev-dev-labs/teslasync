import type { UnitFormatter } from '@/hooks/useUnits';
import type { SleepEfficiencyAnalysis } from '../../lib/sleepEfficiencyAnalysis';

export interface SleepEfficiencyQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  isResolved: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface SleepEfficiencySectionProps {
  analysis: SleepEfficiencyAnalysis;
  state: SleepEfficiencyQueryState;
}

export interface SleepEfficiencyFormatters {
  formatCurrency: (amount: number, decimals?: number) => string;
  formatEnergy: UnitFormatter;
  formatTemperature: UnitFormatter;
}
