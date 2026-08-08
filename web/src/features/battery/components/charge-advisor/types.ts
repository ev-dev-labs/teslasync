import type { ChargeAdvice } from '../../lib/chargeAdvisor';

export interface ChargeAdvisorQueryState {
  vehicleSelected: boolean;
  isLoading: boolean;
  driveLoading: boolean;
  chargingLoading: boolean;
  driveAvailable: boolean;
  chargingAvailable: boolean;
  initialError: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface ChargeAdvisorComponentProps {
  analysis: ChargeAdvice;
  state: ChargeAdvisorQueryState;
}

export type ChargeAdvisorDependency = 'drive' | 'charging' | 'both';
