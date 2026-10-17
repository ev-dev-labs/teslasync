import type {
  BatteryPassport,
  BatteryPassportVerifyResponse,
} from '@/api/hooks/useBatteryPassport';
import type { FormatOptions } from '@/lib/dateFormat';

export interface BatteryPassportQueryState {
  vehicleSelected: boolean;
  passport: BatteryPassport | null;
  isLoading: boolean;
  isResolved: boolean;
  initialError: unknown;
  refreshError: unknown;
  onRetry: () => void;
  timestampContext?: FormatOptions;
}

export type BatteryPassportVerificationStatus =
  | 'unavailable'
  | 'loading'
  | 'refreshing'
  | 'error'
  | 'mismatch'
  | 'valid';

export interface BatteryPassportVerificationState {
  onRetry: () => void;
  isPaused: boolean;
  isRetrying: boolean;
  status: BatteryPassportVerificationStatus;
  data: BatteryPassportVerifyResponse | null;
  error: unknown;
}
