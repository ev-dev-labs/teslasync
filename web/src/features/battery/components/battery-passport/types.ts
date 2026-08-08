import type {
  BatteryPassport,
  BatteryPassportVerifyResponse,
} from '@/api/hooks/useBatteryPassport';

export interface BatteryPassportQueryState {
  vehicleSelected: boolean;
  passport: BatteryPassport | null;
  isLoading: boolean;
  isResolved: boolean;
  initialError: unknown;
  refreshError: unknown;
  onRetry: () => void;
}

export type BatteryPassportVerificationStatus =
  | 'unavailable'
  | 'loading'
  | 'refreshing'
  | 'error'
  | 'mismatch'
  | 'valid';

export interface BatteryPassportVerificationState {
  status: BatteryPassportVerificationStatus;
  data: BatteryPassportVerifyResponse | null;
  error: unknown;
}
