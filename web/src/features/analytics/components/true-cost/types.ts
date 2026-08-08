import type { TrueCostAnalysis } from '../../lib/trueCost';

export interface TrueCostQueryState {
  enabled: boolean;
  hasData: boolean;
  isLoading: boolean;
  isResolved: boolean;
  isFetching: boolean;
  isPaused: boolean;
  refreshPaused: boolean;
  error: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export interface TrueCostDisplay {
  distanceUnit: string;
  energyUnit: string;
  formatNumber: (value: number | null | undefined, precision?: number) => string;
  formatCurrency: (value: number | null | undefined, precision?: number) => string;
  formatSignedCurrency: (value: number | null | undefined, precision?: number) => string;
  formatDistanceKm: (kilometres: number | null | undefined) => string;
  distanceValueKm: (kilometres: number) => number;
  costPerDistanceValue: (costPerKm: number) => number;
  formatCostPerDistance: (costPerKm: number | null | undefined) => string;
  formatEnergy: (wattHours: number | null | undefined) => string;
  energyValue: (wattHours: number) => number;
  formatMonth: (month: string) => string;
}

export interface TrueCostSectionProps {
  analysis: TrueCostAnalysis;
  state: TrueCostQueryState;
  display: TrueCostDisplay;
  gasUnit: 'gallon' | 'liter';
}
