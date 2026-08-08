import type { CarbonIntelligenceAnalysis } from '../../lib/carbonIntelligence';

export interface CarbonQueryState {
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

export interface CarbonQueryStates {
  intensity: CarbonQueryState;
  period: CarbonQueryState;
  lifetime: CarbonQueryState;
  recommendation: CarbonQueryState;
}

export interface CarbonDisplay {
  energyUnit: 'Wh' | 'kWh';
  energyValue: (wattHours: number) => number;
  formatEnergy: (
    wattHours: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatDistance: (
    meters: number | null | undefined,
    options?: { precision?: number },
  ) => string;
  formatKg: (kilograms: number | null | undefined, precision?: number) => string;
  formatSignedKg: (
    kilograms: number | null | undefined,
    precision?: number,
  ) => string;
  formatIntensity: (
    intensity: number | null | undefined,
    precision?: number,
  ) => string;
  formatPercent: (
    percentage: number | null | undefined,
    precision?: number,
  ) => string;
  formatNumber: (
    value: number | null | undefined,
    precision?: number,
  ) => string;
  formatHour: (hour: number | null | undefined) => string;
  formatMonth: (month: string) => string;
}

export interface CarbonSectionProps {
  analysis: CarbonIntelligenceAnalysis;
  states: CarbonQueryStates;
  display: CarbonDisplay;
}
