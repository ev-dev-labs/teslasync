import type { VehicleStateReadings } from '@/api/types';
import type { VerifiedVehicleStateField, VehicleStateFreshness } from '@/api/hooks/useVehicles';
import { useObservationCurrent } from './useObservationCurrent';

export function useVerifiedDriving(
  reading: {
    state?: Partial<VehicleStateReadings> | null;
    observedAt?: number | null;
    freshness?: VehicleStateFreshness;
    verifiedFields?: readonly VerifiedVehicleStateField[];
  } | null | undefined,
  blocked = false,
): boolean {
  const current = useObservationCurrent(reading?.observedAt, !blocked && reading?.freshness === 'fresh');
  const fields = reading?.verifiedFields ?? [];
  const state = reading?.state;
  return current && !(fields.includes('is_charging') && state?.is_charging === true) && (
    (fields.includes('speed') && state?.speed != null && Number.isFinite(state.speed) && state.speed > 0) ||
    (fields.includes('state') && state?.state === 'driving')
  );
}
