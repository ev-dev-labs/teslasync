import type { SecurityEvent } from '@/api/types';
import { useObservationCurrent } from './useObservationCurrent';

export function useVerifiedStudioLights(
  vehicleId: number,
  query: { data?: SecurityEvent | null; isError?: boolean },
): boolean {
  const current = useObservationCurrent(query.data?.ts,
    !query.isError && query.data?.vehicle_id === vehicleId);
  // High beams confirm exterior lights; false/unknown cannot establish low-beam state.
  return current && query.data?.lights_high_beams === true;
}
