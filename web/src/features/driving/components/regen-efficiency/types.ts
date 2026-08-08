export interface RegenSectionState {
  isLoading: boolean;
  /** True only after the backing query has completed successfully. */
  isResolved: boolean;
  error: unknown | null;
  onRetry: () => void;
}

export type MonthlyRecoveryChartRow = {
  month: string;
  recoveredEnergy: number | null;
  driveEnergy: number | null;
  recoveryRatio: number | null;
  eligible: number;
  returned: number;
};
