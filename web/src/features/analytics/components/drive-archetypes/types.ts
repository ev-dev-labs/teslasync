import type { ArchetypeSummary } from '../../lib/driveArchetypes';

export interface ArchetypeQueryState {
  vehicleSelected: boolean;
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

export type ArchetypeSectionRequirement =
  | 'none'
  | 'resolved'
  | 'eligible'
  | 'clustered'
  | 'directory';

export interface ArchetypeSectionProps {
  summary: ArchetypeSummary;
  state: ArchetypeQueryState;
}

export interface ArchetypeDisplay {
  distanceUnit: string;
  speedUnit: string;
  temperatureUnit: string;
  energyUnit: string;
  efficiencyUnit: string;
  locale?: string;
  distanceValue: (meters: number) => number;
  speedValue: (metersPerSecond: number) => number;
  temperatureValue: (celsius: number) => number;
  energyValue: (wattHours: number) => number;
  efficiencyValue: (wattHoursPerMeter: number) => number;
  formatDistance: (value: number | null | undefined, options?: { precision?: number }) => string;
  formatSpeed: (value: number | null | undefined, options?: { precision?: number }) => string;
  formatTemperature: (value: number | null | undefined, options?: { precision?: number }) => string;
  formatEnergy: (value: number | null | undefined, options?: { precision?: number }) => string;
  formatDuration: (value: number | null | undefined, options?: { precision?: number }) => string;
  formatEfficiency: (value: number | null | undefined, precision?: number) => string;
  formatDateTime: (milliseconds: number | null) => string;
  formatMonth: (month: string) => string;
  formatHour: (hour: number) => string;
}
